# Deployment — Hostinger VPS Go-Live

Step-by-step runbook to deploy SRE EDU OS to a single Hostinger VPS (or any Docker
host) with Docker Compose + Nginx + TLS. The stack is **backend** (Express, auto-runs
migrations + the background worker), **frontend** (Next.js), **PostgreSQL**, **Mongo**
(optional audit/AI history), and **Nginx** (reverse proxy + TLS).

> Migrations run automatically on backend boot. The background worker (scheduler tick
> → scheduled backups + due jobs) runs in-process when `JOB_WORKER_ENABLED=true`
> (the production default in `docker-compose.yml`).

## 0. Prerequisites

- A VPS (≥ 2 vCPU / 4 GB RAM recommended) running Ubuntu 22.04+.
- A domain (e.g. `erp.example.com`) with an **A record** pointing at the VPS IP.
- SSH access as a sudo user.

## 1. Server preparation

```bash
sudo apt update && sudo apt upgrade -y
# Firewall: allow SSH + HTTP + HTTPS only.
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
# (Optional but recommended on small VPSes) add swap:
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. Install Docker + Compose

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER      # log out / back in so the group applies
docker compose version             # verify the Compose plugin
```

## 3. Get the code + configure secrets

```bash
git clone <your-repo-url> sreedo && cd sreedo
cp .env.production.example .env
# Generate strong secrets:
openssl rand -base64 48   # use for JWT_ACCESS_SECRET
openssl rand -base64 48   # use a DIFFERENT one for JWT_REFRESH_SECRET
nano .env                 # fill POSTGRES_PASSWORD, JWT_*, CORS_ORIGIN, NEXT_PUBLIC_API_URL, storage, SMTP…
```

Required at minimum: `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
(must NOT start with `dev-` — the API refuses to boot otherwise), `CORS_ORIGIN`, and
`NEXT_PUBLIC_API_URL` (both your real HTTPS origin). Configure **object storage**
(`STORAGE_*`) so uploads and backups are durable. Keep `ENABLE_API_DOCS=false`.

### Optional integrations (set the ones you use)

These are optional — the API boots and runs without them and the matching feature is
simply unavailable until configured. Variable names and inline hints all live in
`.env.production.example`.

- **Object storage** (`STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`,
  `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_MAX_MB`) — strongly recommended in
  production so uploads **and backups** are durable. Without it both fall back to the local
  `backenduploads` volume (lost if that volume is removed). Keep `STORAGE_MAX_MB` aligned
  with Nginx `client_max_body_size`.
- **Email / SMTP** (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) —
  outbound notifications and scheduled-report delivery.
- **SMS** (`SMS_PROVIDER`, `SMS_API_URL`, `SMS_API_KEY`, `SMS_SENDER`) — fee-reminder and
  absence-alert text messages.
- **Push / FCM** (`FCM_SERVER_KEY`) — mobile push notifications.
- **AI insights** (`OPENAI_API_KEY`, `OPENAI_MODEL`) — optional; unset leaves AI features off.

**Mongo** (optional audit / AI history) needs no `.env` entry — the Compose `mongo` service is
already wired to the backend via `MONGO_URL` in `docker-compose.yml` and works out of the box.

## 4. First boot

```bash
# Seed the initial data on the FIRST run only:
SEED_ON_START=true docker compose up -d --build
docker compose logs -f backend     # watch "Connected to PostgreSQL" → migrations → listening
```

`SEED_ON_START=true` seeds **demo** data (a demo school + demo logins) and is best for
**staging**. For a clean production database, leave `SEED_ON_START=false` and create only
a super admin (next step). Either way, re-set `SEED_ON_START=false` afterward.

### Production-safe initial super admin (no demo data)

```bash
ADMIN_EMAIL='admin@yourschool.com' ADMIN_PASSWORD='a-strong-password' \
docker compose exec -e ADMIN_EMAIL -e ADMIN_PASSWORD backend node -e '
const { hashPassword } = require("./dist/utils/password");
const { pool } = require("./dist/db/postgres");
(async () => {
  const hash = await hashPassword(process.env.ADMIN_PASSWORD);
  await pool.query(
    "INSERT INTO users (email,password_hash,full_name,role) VALUES ($1,$2,$3,\x27super_admin\x27) ON CONFLICT (email) DO NOTHING",
    [process.env.ADMIN_EMAIL, hash, "Platform Super Admin"]);
  console.log("super admin ready:", process.env.ADMIN_EMAIL);
  await pool.end();
})();'
```

Then sign in, create the institution + its admin from the Super Admin console, and
**rotate/disable any demo accounts** if you seeded them.

## 5. TLS / HTTPS

```bash
# Obtain a certificate (webroot or standalone). Example with standalone (stop nginx briefly):
sudo apt install -y certbot
sudo certbot certonly --standalone -d erp.example.com
# Certs land in /etc/letsencrypt/live/erp.example.com/.
```

Enable TLS in the stack:

1. `cp infra/nginx/production.conf.example infra/nginx/production.conf` and replace
   `erp.example.com` with your domain.
2. In `docker-compose.yml`, under the `nginx` service: publish `"443:443"` and mount the
   production conf + certs (the lines are present as comments — uncomment them):
   ```yaml
   ports: ["80:80", "443:443"]
   volumes:
     - ./infra/nginx/production.conf:/etc/nginx/conf.d/default.conf:ro
     - /etc/letsencrypt:/etc/letsencrypt:ro
   ```
3. `docker compose up -d nginx`

The production conf redirects **HTTP → HTTPS**, sets **HSTS** + security headers, and
proxies `/api` → backend, `/` → frontend. Renew certs via `certbot renew` (cron) and
`docker compose exec nginx nginx -s reload`.

## 6. Verify

```bash
curl -fsS https://erp.example.com/health   # {"status":"ok","postgres":true,...}
curl -fsS https://erp.example.com/ready    # {"ready":true,"checks":{...}}  (503 until DB+migrations ready)
curl -fsS https://erp.example.com/live     # {"status":"ok",...}
docker compose ps                          # all services "running"/"healthy"
```
Then sign in through the browser and run a quick smoke (dashboard, create a student).

### Pre-go-live dry-run (staging)

Before pointing real users at the box, do a full dry-run on a staging host (or the VPS
before DNS cutover). Bring the stack up with `docker compose up -d --build` against a
throwaway database and confirm each of these — they exercise every production guarantee:

- **Boot & migrations**: backend logs show `Connected to PostgreSQL` → migrations →
  `listening`; `/ready` returns `{"ready":true}` with `database`, `migrations`, `jobQueue`
  all `true`.
- **Docs off**: `GET /api/docs.json` → **404** (`ENABLE_API_DOCS=false` in production).
- **AuthZ boundaries**: an unauthenticated `GET /api/v1/students` → **401**; an institution
  admin hitting `GET /api/v1/platform/institutions` or `/observability/metrics` → **403**;
  the same as super admin → **200**.
- **Private downloads**: `GET /api/v1/backups` and `/api/v1/documents` with no token → **401**.
- **CORS**: a preflight from `CORS_ORIGIN` echoes `Access-Control-Allow-Origin`; a preflight
  from any other origin does **not**.
- **Rate limiting**: more than `AUTH_RATE_LIMIT_MAX` (default 10) *failed* logins in the
  window → **429** (successful logins don't count).
- **Cookies**: portal login `Set-Cookie` carries `HttpOnly; Secure; SameSite=Lax`.
- **Backup + restore preview**: `POST /api/v1/backups` → `status: success` with a size and
  table count; `GET /api/v1/backups/:id/restore/preview` → `restorable: true`,
  `schemaMatches: true`. (Only run the **destructive** restore against a staging DB — §8.)
- **Worker**: enable the backup schedule, then watch a scheduled backup appear and
  `next_run_at` advance — confirms the in-process worker tick is live (§7).
- **Frontend**: `GET /` and `/login` return **200** HTML.
- **No secrets committed**: only `*.env.example` templates are tracked; real `.env` is
  git-ignored.

Tear the dry-run database down afterward; the production database is created fresh at §4.

## 7. Background worker

The worker runs **inside the backend container** when `JOB_WORKER_ENABLED=true`
(production default). Each tick it: enqueues due **scheduled reports** and **scheduled
backups**, then drains the **job queue** (fee-reminder / absence-alert sweeps, report
runs, backups). Verify:

```bash
docker compose logs backend | grep -i "worker\|job"     # tick activity
# As super admin: GET /api/v1/observability/overview → jobs + queue depth + worker.enabled=true
```

To scale the worker independently later you can run a second backend container with
`JOB_WORKER_ENABLED=true` and the web ones with it off — not required on a single VPS.

## 8. Backups & restore drill

Backups are super-admin only (`backup:*`) and stored in object storage (or the local
fallback volume). See `docs/MODULE_WORKFLOWS.md` §AA.

- **Schedule**: in the web app (Super Admin → Backups) set retention (keep latest N) and
  enable the automatic schedule; the worker runs it. Or `PATCH /api/v1/backups/settings`.
- **Manual backup**: `POST /api/v1/backups` (or the "Create backup" button).
- **Download** (audited): `GET /api/v1/backups/:id/download`.

**Restore drill (practise on a staging copy, never first on production):**

1. Take a backup; confirm it shows `status: success` with a size.
2. Preview: `GET /api/v1/backups/:id/restore/preview` → check `restorable: true` and
   `schemaMatches: true`.
3. Restore: `POST /api/v1/backups/:id/restore { "confirm": true, "force": true }`
   (`force` is required in production). It runs in one transaction and rolls back on any
   error; every attempt is audited (`restore.start` → `restore.success`/`failed`).
4. Verify data + that you can still sign in.

> Restore runs `SET session_replication_role = replica` (to bypass FK checks), which
> requires a **superuser** DB role. The Compose Postgres role — `POSTGRES_USER`
> (default `sreedo`) — is the cluster bootstrap superuser, so this works out of the box.
> On managed Postgres, use a role with the equivalent privilege (e.g. `rds_superuser`).

## 9. Health, monitoring & logs

- **Probes**: `/health`, `/ready`, `/live` (public, no secrets) — wire to uptime
  monitoring and the compose healthcheck (already configured on the backend service).
- **Metrics**: `GET /api/v1/observability/metrics` (Prometheus text) and
  `/observability/overview` — **super-admin only** (`observability:*`). Scrape with
  Prometheus or curl behind auth. Includes request/error/duration, jobs, cache, and
  backup counters.
- **Logs**: structured JSON to stdout → captured by Docker. View with
  `docker compose logs -f backend`. Add rotation so disks don't fill — set in
  `/etc/docker/daemon.json`:
  ```json
  { "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
  ```
  then `sudo systemctl restart docker` and recreate the stack.
- **Error monitoring** (optional): ship stdout to a log service, or add an APM/Sentry
  DSN in a future iteration; the `x-request-id` correlation id is in every log line.

## 10. Security hardening — verified defaults

These hold automatically in `NODE_ENV=production`; confirm them at go-live:

- **JWT secrets** must be overridden (the API refuses to boot with `dev-` secrets).
- **Portal cookies** are `httpOnly` + `secure` (HTTPS-only) + `sameSite=lax` in
  production (`src/utils/cookies.ts`); `trust proxy` is set so `secure` works behind Nginx.
- **CORS** is restricted to `CORS_ORIGIN` (set it to your domain).
- **Rate limiting** is always on (`RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`).
- **Upload limits** enforced by the API (`STORAGE_MAX_MB`) and Nginx
  (`client_max_body_size`) — keep them aligned.
- **Private file downloads** (documents, backups) stay behind authenticated,
  permission-checked routes; storage keys/paths are never exposed.
- **Swagger/API docs** are OFF (`ENABLE_API_DOCS=false`); if enabled, IP-restrict in Nginx.
- **Tenant isolation + RBAC** are enforced in the app and unchanged by deployment.

## 11. Updates & rollback

```bash
# Update:
git pull
docker compose up -d --build           # migrations apply automatically on boot
docker compose ps                      # confirm healthy

# Rollback (app code): redeploy the previous commit/tag.
git checkout <previous-tag>
docker compose up -d --build
```

> Migrations are forward-only. Before a risky upgrade, **take a backup** (§8); if a
> deploy goes bad, roll back the code and **restore the backup** if the schema changed.
> Keep the `pgdata` volume across updates (it persists by default).

### Automated deploy (optional CI/CD)

`.github/workflows/deploy.yml` can deploy automatically on every push to `main`
(or on demand via *Actions → Deploy → Run workflow*). It SSHes to the VPS and runs
the same `git pull` + `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
you'd run by hand (data volumes preserved).

It is **off by default** and is skipped until you opt in, so it never affects CI.
To enable it (GitHub → **Settings → Secrets and variables → Actions**):

| Type | Name | Value |
|---|---|---|
| Variable | `DEPLOY_ENABLED` | `true` |
| Variable | `DEPLOY_PATH` | `/opt/sreedo` *(optional; this is the default)* |
| Secret | `VPS_HOST` | your VPS IP / hostname |
| Secret | `VPS_USER` | the deploy SSH user (e.g. `root`) |
| Secret | `VPS_SSH_KEY` | a private SSH key authorized on the VPS |
| Secret | `VPS_PORT` | SSH port *(optional; default `22`)* |

Use a dedicated deploy key (add its public half to `~/.ssh/authorized_keys` on the
VPS). After a deploy, verify with `curl -fsS https://gocampusos.com/health`. Take a
backup (§8) before deploys that include migrations.

## 12. Go-live checklist

- [ ] DNS A record → VPS; firewall allows 80/443 only.
- [ ] `.env` filled; strong `POSTGRES_PASSWORD` + distinct `JWT_*` secrets (not `dev-`).
- [ ] `CORS_ORIGIN` + `NEXT_PUBLIC_API_URL` = your real HTTPS origin.
- [ ] Object storage (`STORAGE_*`) configured (uploads + backups durable).
- [ ] `ENABLE_API_DOCS=false`; `SEED_ON_START=false` after first boot.
- [ ] TLS issued; HTTP→HTTPS redirect works; HSTS present.
- [ ] `/health`, `/ready`, `/live` all OK over HTTPS; `docker compose ps` healthy.
- [ ] Pre-go-live dry-run passed (§6): AuthZ 401/403, CORS, rate-limit 429, backup +
      restore-preview, worker scheduled backup, frontend loads, no secrets committed.
- [ ] Initial super admin created; demo accounts removed/rotated.
- [ ] `JOB_WORKER_ENABLED=true`; worker tick visible in logs / overview.
- [ ] Backup schedule + retention set; **manual backup taken**; **restore drill passed** on staging.
- [ ] Docker log rotation configured.
- [ ] Smoke test: sign in, create a student, record a payment, parent/student portal login.
