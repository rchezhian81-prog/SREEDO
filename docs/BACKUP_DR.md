# Backup & Disaster Recovery Runbook

> **Scope:** SRE EDU OS / GoCampusOS — multi-tenant school & college ERP.
> **Audience:** the on-call SRE / DevOps operator of the production VPS.
> **Last updated:** 2026-06-26 · **Owner:** Engineering / SRE
>
> Related: [Backup & Restore module](modules/backup-restore-module.md) (the in-app
> super-admin tooling) · [Developer handover](DEVELOPER_HANDOVER.md) · `CLAUDE.md`
> "Project state & deploy".
>
> **Source of truth for the OS-level layer is the scripts in `scripts/`** —
> `backup-db.sh`, `restore-db.sh`, `verify-backup.sh`. This document describes
> their actual behaviour; if a script changes, update this file.

---

## 1. Overview & objectives

The ERP stores **all authoritative tenant data in PostgreSQL** (every institution,
user, student, fee, exam, etc. — tenant isolation is by `institution_id` columns,
not separate databases). Losing Postgres means losing the product. Everything
below is organised around protecting it, with secondary coverage for MongoDB,
uploaded files, and secrets.

### Recovery targets (proposed defaults — adjust per contract/SLA)

| Objective | Target | How it's met |
| --- | --- | --- |
| **RPO** (max acceptable data loss) | **24 hours** | Nightly full-cluster `pg_dump` via `scripts/backup-db.sh`. Tightenable to minutes later via WAL archiving / PITR (see §11). |
| **RTO** (max acceptable downtime) | **~2-4 hours** for full restore on a fresh host | Restore latest dump with `scripts/restore-db.sh` (or stand up a new VPS from compose + restore). Most-recent verified dump is the recovery point. |
| **Backup retention** | 14 days local (`RETENTION_DAYS`), longer offsite | Local prune in `backup-db.sh`; offsite copies kept ≥30-90 days. |
| **Restore drill cadence** | Monthly | `scripts/verify-backup.sh` automated + a manual full-restore drill. |

### Two complementary backup layers

1. **OS-level full-cluster dump (primary DR).** `scripts/backup-db.sh` runs
   `pg_dump -Fc` against the whole database from cron/systemd on the VPS. This is
   the canonical, restore-the-world artifact and the basis of RPO/RTO above.
2. **In-app backups module (operational / per-tenant).** Super-admin → Backups
   produces a logical JSON snapshot via the API: `global` (whole DB, restorable
   in-app) and `institution` (per-tenant data export, download-only). It supports
   scheduling, retention, a non-destructive **restore preview**, and a guarded
   restore. It does **not** use `pg_dump` — it serializes tables with `to_jsonb`
   inside one `REPEATABLE READ` transaction. See
   [the module doc](modules/backup-restore-module.md) for full detail.

Use **layer 1** for "the server/database is gone" and **layer 2** for "one tenant
deleted data" and for self-service exports. Run **both** — they fail differently.

### Backup & restore flow

```mermaid
flowchart TD
    subgraph PROD["Production VPS (/opt/sreedo)"]
        PG[("PostgreSQL\n(all tenant data)")]
        MONGO[("MongoDB\n(audit_logs + AI history,\noptional)")]
        FILES["Uploaded files\n(S3 bucket OR\nlocal uploads volume)"]
        ENV[".env / secrets"]
    end

    subgraph L1["Layer 1 — OS-level (cron/systemd)"]
        BK["scripts/backup-db.sh\npg_dump -Fc, timestamped"]
        DUMP[/"sreedo-<ts>.dump\n(BACKUP_DIR)"/]
        VER["scripts/verify-backup.sh\nrestore into scratch DB"]
    end

    subgraph L2["Layer 2 — In-app (super-admin)"]
        APP["Backups module\nglobal / institution"]
        ART[/"backups/{id}.json.gz\n(S3 or local)"/]
    end

    subgraph OFFSITE["Offsite (separate provider/region)"]
        ENC["gpg-encrypted copies\n3-2-1 rule"]
    end

    PG --> BK --> DUMP
    DUMP --> VER
    DUMP -->|"rsync/rclone + gpg"| ENC
    PG --> APP --> ART
    FILES -->|"S3 versioning OR rsync"| ENC
    MONGO -->|"mongodump (optional)"| ENC
    ENV -->|"out-of-band, NEVER git"| ENC

    DUMP -.->|"DR restore"| RES["scripts/restore-db.sh\n--clean (DESTRUCTIVE)"]
    ART -.->|"in-app restore"| RESAPP["POST /backups/{id}/restore\n(global only, schema must match)"]
    RES -.-> PG
    RESAPP -.-> PG
```

---

## 2. What to back up

| Data | Store | Criticality | Covered by |
| --- | --- | --- | --- |
| **PostgreSQL** — all institutions, users, students, fees, exams, RBAC, **and `platform_audit_log`** | `pgdata` named volume (Postgres 16) | **Critical — authoritative** | Layer 1 `pg_dump`; layer 2 global backup |
| **MongoDB** — `audit_logs` collection + AI chat history | `mongodata` named volume (Mongo 7) | Low — optional, degrades gracefully | `mongodump` (§6) |
| **Uploaded files** — documents, ID cards, branding, in-app backup artifacts | S3 bucket (`STORAGE_*`) **or** local `backenduploads` volume (`STORAGE_LOCAL_DIR`, default `uploads`) | Medium-High | S3 versioning/lifecycle **or** rsync/snapshot (§7) |
| **Secrets / `.env`** — DB password, `JWT_*` secrets, `STORAGE_*` keys, SMTP/SMS/payment keys | VPS `/opt/sreedo/.env` (NOT in git) | **Critical for recovery** | Out-of-band secret store (§9) |

Notes:
- MongoDB is an **optional dependency**. When `MONGO_URL` is unset the app logs
  `MONGO_URL not set — audit logs and AI history disabled` and runs fine. The
  **platform audit log also lives in `platform_audit_log` in Postgres**, which is
  already inside the PG dump — so audit history survives even with no Mongo backup.
  Mongo only adds the secondary `audit_logs` collection and AI conversation history.
- In-app backup **artifacts** (`backups/{id}.json.gz`) are uploaded files: with S3
  they survive container restarts; on the local fallback they live in the
  `backenduploads` volume and must be backed up like any other file (§7).

---

## 3. PostgreSQL backups (Layer 1 — primary)

### `scripts/backup-db.sh`

Creates a compressed, timestamped `pg_dump` in **custom format (`-Fc -Z6`)** with
`--no-owner --no-privileges` (portable across roles). `pg_dump` is **consistent on
a live database** — no downtime, no locking out the app.

**Environment / arguments (verified against the script):**

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | **yes** | — | libpq connection string to the DB to dump |
| `BACKUP_DIR` (or `$1`) | no | `./backups` | output directory |
| `RETENTION_DAYS` | no | `14` | prune `sreedo-*.dump` older than N days; `0` = keep all |

Output file: `sreedo-<UTC-timestamp>.dump` (e.g. `sreedo-20260626T020000Z.dump`).
Requires the `postgresql-client` package (`pg_dump`) on the host.

**Run it manually (on the VPS):**

```bash
cd /opt/sreedo
# Reuse the DB password already in .env; dump to a durable, NON-volume path.
export DATABASE_URL="postgres://sreedo:$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)@localhost:5432/sreedo"
BACKUP_DIR=/opt/sreedo/backups RETENTION_DAYS=14 ./scripts/backup-db.sh
```

> If Postgres only listens inside the Compose network, run `pg_dump` **inside** the
> container instead and copy the file out, e.g.:
> ```bash
> docker compose exec -T postgres pg_dump -U sreedo -Fc -Z6 --no-owner --no-privileges sreedo \
>   > /opt/sreedo/backups/sreedo-$(date -u +%Y%m%dT%H%M%SZ).dump
> ```
> Either way the artifact is restore-compatible with `restore-db.sh` / `verify-backup.sh`.

### Nightly cron (example — 02:00 server time)

```cron
# /etc/cron.d/sreedo-backup   (runs as root; reads .env for the DB password)
0 2 * * * root cd /opt/sreedo && \
  DATABASE_URL="postgres://sreedo:$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)@localhost:5432/sreedo" \
  BACKUP_DIR=/opt/sreedo/backups RETENTION_DAYS=14 \
  /opt/sreedo/scripts/backup-db.sh >> /var/log/sreedo-backup.log 2>&1
```

### systemd timer (alternative)

```ini
# /etc/systemd/system/sreedo-backup.service
[Unit]
Description=SRE EDU OS PostgreSQL backup
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/sreedo
EnvironmentFile=/opt/sreedo/.env
# Build DATABASE_URL from the EnvironmentFile vars:
Environment=BACKUP_DIR=/opt/sreedo/backups
Environment=RETENTION_DAYS=14
ExecStart=/bin/bash -lc 'DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}" /opt/sreedo/scripts/backup-db.sh'
```

```ini
# /etc/systemd/system/sreedo-backup.timer
[Unit]
Description=Nightly SRE EDU OS DB backup

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now sreedo-backup.timer
sudo systemctl start sreedo-backup.service   # test once now
journalctl -u sreedo-backup.service          # check the result
```

> **Do not store backups only inside a Docker volume or only on the same disk as
> `pgdata`.** Write to a separate path/disk and copy offsite (§9).

---

## 4. Restore

> **DANGER — restore is destructive.** `restore-db.sh` runs `pg_restore --clean
> --if-exists`, which **drops and recreates objects** in the target. Restoring into
> the wrong database **will erase live tenant data.** Read this whole section first.

### `scripts/restore-db.sh` (OS-level, full-cluster)

**Environment / arguments (verified against the script):**

| Var | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | **TARGET** database to restore **INTO** |
| `$1` | **yes** | path to the `.dump` file produced by `backup-db.sh` |
| `CONFIRM` | yes-ish | must equal `yes` to proceed; or pass `-y` as `$2`; otherwise it prompts interactively |
| `FORCE` | conditional | set to `1` to allow a target whose URL contains `prod`/`production` |

Built-in guards:
- If `DATABASE_URL` contains `prod` or `production` and `FORCE` is not `1`, it
  **refuses** with exit code 2 ("target looks like production").
- It will not proceed without `CONFIRM=yes` (or `-y`, or typing `yes` at the prompt).
- It uses `--clean --if-exists --no-owner --no-privileges`.

**Restore into a staging / scratch DB first (the safe, normal path):**

```bash
cd /opt/sreedo
DATABASE_URL="postgres://sreedo:PASS@localhost:5432/sreedo_staging" \
  ./scripts/restore-db.sh /opt/sreedo/backups/sreedo-20260626T020000Z.dump -y
```

**Restore into production (true DR only — site is already down/destroyed):**

```bash
# Only when production data is already lost and you are intentionally rebuilding it.
FORCE=1 CONFIRM=yes \
  DATABASE_URL="postgres://sreedo:PASS@localhost:5432/sreedo" \
  ./scripts/restore-db.sh /opt/sreedo/backups/sreedo-20260626T020000Z.dump
```

> **NEVER wire `restore-db.sh` into automated deploys or CI.** The backend already
> runs `runMigrations()` on boot (`backend/src/server.ts`) — deploys never need a
> restore. Restore is a deliberate, human-confirmed action. **Always verify the
> dump first (§5) and restore into staging before touching production.**

### In-app restore (Layer 2, tenant-aware) — `super_admin` only

For "one tenant deleted data" or schema-matched whole-DB rollback, use the Backups
module instead of nuking the cluster:

1. `GET /api/v1/backups/{id}/restore/preview` — **non-destructive.** Reports scope,
   backup vs current `schema_version`, `schemaMatches`, `restorable`, and per-table
   counts. **Always preview first.**
2. `POST /api/v1/backups/{id}/restore` with `{ "confirm": true }` (and
   `"force": true` in production). Constraints:
   - Only **`global`** backups are restorable; `institution` backups are
     download-only exports.
   - The backup's **schema version must match** the current DB (i.e. same number of
     applied migrations) or restore is rejected.
   - The restore runs in one transaction with `SET LOCAL session_replication_role =
     replica`, which **requires a DB superuser** (Compose `sreedo` is one). Audited
     as `restore.start` / `restore.success` / `restore.failed`.

See [the module troubleshooting table](modules/backup-restore-module.md#10-common-troubleshooting)
for the exact error→fix mapping (force/schema/superuser/etc).

---

## 5. Backup verification

> **A backup you have never restored is not a backup.** Verify automatically, and
> drill a real restore monthly.

### `scripts/verify-backup.sh`

Restores a dump into a **disposable scratch database** on the same server, runs a
row-count sanity check on core tables (`institutions`, `users`, `students`), then
**drops the scratch DB** (via an `EXIT` trap, so it cleans up even on failure).
Touches nothing else. Exits non-zero if the restore fails or core tables are missing.

**Environment / arguments (verified against the script):**

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ADMIN_URL` | **yes** | — | connection to a DB you may `CREATE`/`DROP` from (e.g. the maintenance `postgres` DB on the same server) |
| `$1` | **yes** | — | the `.dump` file to verify |
| `SCRATCH_DB` | no | `sreedo_verify_<pid>` | name of the scratch DB to create/drop |

```bash
cd /opt/sreedo
ADMIN_URL="postgres://sreedo:PASS@localhost:5432/postgres" \
  ./scripts/verify-backup.sh /opt/sreedo/backups/sreedo-20260626T020000Z.dump
# → "VERIFY OK: dump restored cleanly and core tables are present."
```

**Wire verification into the nightly job** (verify the dump you just took):

```cron
# After the 02:00 backup, verify the newest dump at 02:30.
30 2 * * * root cd /opt/sreedo && \
  ADMIN_URL="postgres://sreedo:$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)@localhost:5432/postgres" \
  ./scripts/verify-backup.sh "$(ls -t /opt/sreedo/backups/sreedo-*.dump | head -1)" \
  >> /var/log/sreedo-verify.log 2>&1
```

**Monthly restore drill (manual):** restore the latest dump into `sreedo_staging`
with `restore-db.sh -y`, log in as an admin, and confirm a few records look right.
Record the date and the measured restore time (your real RTO) in your ops log.

---

## 6. MongoDB backup (optional, low criticality)

MongoDB backs `audit_logs` + AI chat history and **degrades gracefully** — if it's
absent the app still runs and the **platform audit trail is preserved in Postgres**
(`platform_audit_log`, inside the PG dump). Back up Mongo only if you want the
secondary `audit_logs` collection and AI history.

```bash
# Dump (gzip archive) from inside the mongo container:
docker compose exec -T mongo mongodump --db=sreedo --archive --gzip \
  > /opt/sreedo/backups/mongo-$(date -u +%Y%m%dT%H%M%SZ).archive.gz

# Restore into a scratch DB to verify, or into the target on recovery:
docker compose exec -T mongo mongorestore --archive --gzip --drop \
  < /opt/sreedo/backups/mongo-<ts>.archive.gz
```

> `MONGO_DB` defaults to the same name as `POSTGRES_DB` (`sreedo`) in compose.
> If `MONGO_URL` is unset in your deployment, skip this section entirely.

---

## 7. Uploaded files

Where files live depends on `STORAGE_*` (`src/config/env.ts`):

- **Object storage configured** (`STORAGE_ENDPOINT` + `STORAGE_BUCKET` + keys):
  - Enable **bucket versioning** so overwrites/deletes are recoverable.
  - Add a **lifecycle rule** (e.g. expire noncurrent versions after 90 days; keep
    in-app backup artifacts under `backups/` longer).
  - Enable cross-region replication (or periodic `rclone sync` to a second
    provider/region) for offsite durability.
  ```bash
  rclone sync s3-prod:sreedo-bucket s3-dr:sreedo-bucket-dr --fast-list
  ```

- **Local disk fallback** (no `STORAGE_*`): files (and in-app backup artifacts)
  live in the `backenduploads` Docker volume at `/app/uploads`
  (`STORAGE_LOCAL_DIR`, default `uploads`). Snapshot it nightly:
  ```bash
  # Copy the volume contents out to the backup dir, then offsite it.
  docker run --rm -v sreedo_backenduploads:/data:ro -v /opt/sreedo/backups:/out alpine \
    tar czf /out/uploads-$(date -u +%Y%m%dT%H%M%SZ).tgz -C /data .
  ```
  > **Strongly prefer object storage in production** — local-disk artifacts (and
  > in-app backups) do not survive a lost host unless separately copied offsite.

---

## 8. Disaster scenarios & recovery procedures

| # | Scenario | Detection | Layer | Recovery steps |
| --- | --- | --- | --- | --- |
| **a** | **DB corruption** (Postgres won't start / errors, data inconsistent) | `/ready` health fails; `docker compose logs postgres`; app 500s | **L1** | 1. Stop app: `docker compose stop backend`. 2. Verify newest dump: `verify-backup.sh`. 3. Restore into a fresh DB and cut over, **or** `FORCE=1 CONFIRM=yes restore-db.sh` into prod (data already lost). 4. Start backend (migrations re-run on boot). 5. Smoke test `/health`. |
| **b** | **Accidental data deletion in ONE tenant** (admin deleted students/fees for one institution) | Tenant report; audit log (`platform_audit_log`) shows the delete | **L2 preferred** | **Do NOT restore the whole cluster.** Option A: restore the latest **global** in-app backup into **staging**, export just that tenant's rows, and re-insert into prod (scoped by `institution_id`). Option B: if loss is recent and acceptable cluster-wide, restore latest L1 dump into staging and copy the missing rows out. Avoid prod-wide `restore-db.sh` for a single-tenant issue. |
| **c** | **Full VPS loss** (host dead/terminated) | Host unreachable; provider alert | **L1 + files + secrets** | 1. Provision a new host, install Docker + `git`. 2. `git clone` to `/opt/sreedo`; restore the **server-local** `docker-compose.prod.yml` and `infra/` SSL files from your out-of-band copy; restore `.env`. 3. `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres` (empty DB). 4. `restore-db.sh` the latest **offsite** dump into it (`FORCE=1 CONFIRM=yes`). 5. Restore uploaded files (re-point `STORAGE_*` to the same bucket, or restore the uploads tarball). 6. Bring up the full stack; migrations re-run on boot. 7. Re-point DNS. 8. Smoke test. |
| **d** | **Ransomware / malicious encryption or deletion** | Files encrypted/altered; backups on the host tampered with | **Offsite, immutable** | 1. **Isolate** the host (do not reuse it). 2. Recover from the **offsite, encrypted, ideally immutable/object-locked** copies — **not** on-host backups (assume those are compromised). 3. Rebuild on a clean host (as in **c**). 4. **Rotate ALL secrets** (`POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `STORAGE_*`, SMTP/SMS/payment keys) — rotating `JWT_*` invalidates all outstanding tokens. 5. Forensics before declaring clean. |

General rule: **single-tenant problem → Layer 2 (preview then targeted restore);
infrastructure/whole-DB problem → Layer 1 dump.** Always restore into staging and
verify before touching production unless production data is already gone.

---

## 9. Offsite copies & encryption (3-2-1)

**3-2-1 rule:** ≥**3** copies of the data, on ≥**2** different media/storage types,
with ≥**1** copy **offsite** (different provider/region). On-host backups alone do
not survive scenarios (c) and (d).

**Encrypt every artifact at rest before it leaves the host** (dumps may contain PII):

```bash
# Encrypt a dump for an offsite recipient (asymmetric — no shared passphrase on disk):
gpg --encrypt --recipient backups@yourorg.example \
  /opt/sreedo/backups/sreedo-20260626T020000Z.dump
# → sreedo-20260626T020000Z.dump.gpg   (ship this; keep the private key offline)

# Symmetric alternative (store the passphrase in your secret manager, NEVER on the box):
gpg --symmetric --cipher-algo AES256 /opt/sreedo/backups/sreedo-<ts>.dump
```

**Copy offsite** to a separate provider/region (e.g. a different cloud's object
store). Enable **object-lock / immutability / WORM** on the offsite bucket so a
compromised host can't delete history:

```bash
rclone copy /opt/sreedo/backups offsite:sreedo-dr --include 'sreedo-*.dump.gpg' --include 'uploads-*.tgz'
```

**Secrets are recovery-critical and must be stored OUT of band** — never in git,
never only on the VPS:
- `.env` (DB password, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `STORAGE_*`,
  SMTP/SMS/payment keys), plus the **server-local** `docker-compose.prod.yml` and
  `infra/` SSL files (certbot, `nginx/prod.conf`, `enable-https.sh`,
  `init-letsencrypt.sh`, `secure-admins.sh`) — these live only on the VPS per
  `CLAUDE.md`, so **a copy must be kept in a password/secret manager.** Without
  them a dump is restorable but the app can't be brought back up identically.
- Store the **gpg private key** offline / in escrow — losing it makes encrypted
  backups unrecoverable.

---

## 10. Operational checklists

### Daily (mostly automated — confirm, don't do by hand)
- [ ] Nightly `backup-db.sh` ran and produced a new `sreedo-*.dump` (check
      `/var/log/sreedo-backup.log` and the file's timestamp/size).
- [ ] Nightly `verify-backup.sh` printed `VERIFY OK` (`/var/log/sreedo-verify.log`).
- [ ] Latest dump was copied offsite (encrypted) and the offsite copy exists.
- [ ] App health green: `GET /health`, `GET /ready`.

### Weekly
- [ ] Spot-check offsite storage: newest encrypted dump present, size sane, decrypts.
- [ ] Confirm retention is doing its job (local `BACKUP_DIR` not unbounded; offsite
      lifecycle pruning old objects but keeping the required window).
- [ ] Review `platform_audit_log` for unexpected `backup.*` / `restore.*` /
      bulk-delete activity.
- [ ] If using the in-app module: confirm scheduled backups succeeded
      (`JOB_WORKER_ENABLED=true`, schedule enabled, recent `success` rows).

### Monthly
- [ ] **Restore drill:** restore the latest dump into `sreedo_staging` with
      `restore-db.sh`, log in, validate data. **Record the measured restore time
      (your real RTO).**
- [ ] Verify uploaded-files backup (S3 versioning on, or uploads tarball restores).
- [ ] Confirm secrets backup is current and that `.env` /
      `docker-compose.prod.yml` / `infra/` copies match the VPS.
- [ ] Test that an offsite, encrypted copy can be fetched **and decrypted** on a
      machine other than the VPS.

### Quarterly
- [ ] Full DR rehearsal: rebuild the stack on a throwaway host from offsite
      artifacts end-to-end (scenario c). Time it against the RTO target.
- [ ] Review/rotate the gpg key and confirm secret-rotation runbook is current.

---

## 11. "First 30 minutes" incident quick-start

1. **0-5 min — Assess & stop the bleeding.**
   `docker compose ps`, `docker compose logs --tail=100 backend postgres`, hit
   `GET /health` and `GET /ready`. If data is being actively corrupted/deleted,
   `docker compose stop backend` to freeze writes. Identify scenario (a/b/c/d, §8).

2. **5-10 min — Locate a known-good backup.**
   `ls -t /opt/sreedo/backups/sreedo-*.dump | head`. If the host is suspect
   (ransomware) or gone, go to the **offsite** store instead. Note the timestamp →
   that's your recovery point (data after it is lost = your actual RPO this incident).

3. **10-20 min — Verify before you restore.**
   `verify-backup.sh <dump>` → must print `VERIFY OK`. **Never restore an
   unverified backup into anything you care about.**

4. **20-30 min — Restore into the right place.**
   - Single tenant (b): restore into **staging**, extract that tenant, re-insert.
   - Whole DB / new host (a/c/d): `restore-db.sh` the verified dump
     (`FORCE=1 CONFIRM=yes` only if prod data is already lost), then start the
     backend (migrations re-run on boot), then smoke test `/health` and a login.

5. **After:** for ransomware/breach, **rotate all secrets** (`POSTGRES_PASSWORD`,
   `JWT_*`, `STORAGE_*`, provider keys) and rebuild on a clean host. Write an
   incident note: scenario, recovery point used, measured RTO, follow-ups. Update
   this runbook if any step was wrong.

> Golden rules: **verify before restore**; **restore into staging unless prod is
> already lost**; **never automate destructive restore**; **keep secrets and an
> encrypted dump offsite.**
