# Email (SMTP / Transactional) Setup & Troubleshooting

Operator guide for configuring outbound transactional email in **SRE EDU OS
(GoCampusOS)**. Grounded in `backend/src/utils/mailer.ts`,
`backend/src/config/env.ts`, `backend/src/server.ts`, and
`backend/src/modules/platform/platform.routes.ts`.

## 1. Overview

SRE EDU OS sends a small set of **transactional** emails through a single
[nodemailer](https://nodemailer.com) SMTP transport (`backend/src/utils/mailer.ts`).
Email is an **optional dependency**: when SMTP is not configured the app boots and
runs normally — outbound mail is simply skipped with a warning. No request ever
fails because email couldn't be sent.

What actually sends email (every consumer of `sendMail()` in the codebase):

| Feature | Source | Recipient | Notes |
|---|---|---|---|
| **Password reset** (critical) | `backend/src/modules/auth/auth.service.ts` | the user requesting the reset | Subject `Reset your GoCampus password`; link built from `APP_PUBLIC_URL`, valid for `PASSWORD_RESET_TTL_MINUTES`. |
| **Fee payment receipt** | `backend/src/modules/fees/fees.service.ts` | the student's `guardian_email` | Sent after a payment is recorded; skipped if the guardian has no email. |
| **In-app message fan-out** | `backend/src/modules/communication/communication.channels.ts` (`dispatchExternal`) | recipients who opted into email | Best-effort; also fans out to SMS/push, each degrading independently. |

> **Critical degradation note:** Password reset is the one flow users *cannot*
> work around. With SMTP unconfigured, `POST /auth/password/reset/request`
> still returns success (it deliberately never reveals whether an account
> exists), but **no reset link is delivered**. If self-service password reset
> matters to your deployment, SMTP **must** be configured. Admins can always
> reset a user's password directly regardless of SMTP.

The transport is built **once at process start**, guarded by `SMTP_HOST`:

```ts
// backend/src/utils/mailer.ts
if (env.smtpHost) {
  transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,      // 465 → implicit TLS; else STARTTLS
    auth: env.smtpUser && env.smtpPass ? { user, pass } : undefined,
  });
}
```

If `SMTP_HOST` is unset, no transport exists and `sendMail()` logs
`SMTP not configured — skipping email to <to>` and returns. **Changing SMTP
env vars requires a backend restart** to take effect.

## 2. Environment variables

All defined in `backend/src/config/env.ts` and templated in
`backend/.env.example`. New env vars must live in both files (project rule).

| Name | Required? | Default | Description |
|---|---|---|---|
| `SMTP_HOST` | **Yes, to enable email** | *(unset → email disabled)* | SMTP server hostname. Presence of this var is the on/off switch for the whole subsystem. |
| `SMTP_PORT` | No | `587` | SMTP port. **`465` → `secure: true` (implicit TLS)**; **any other value (e.g. `587`, `2587`) → plaintext connect upgraded via STARTTLS**. |
| `SMTP_USER` | No* | *(unset)* | SMTP username. Auth is only enabled when **both** `SMTP_USER` and `SMTP_PASS` are set; otherwise the transport connects unauthenticated. |
| `SMTP_PASS` | No* | *(unset)* | SMTP password / API secret. See `SMTP_USER`. |
| `SMTP_FROM` | No | `SRE EDU OS <no-reply@sreedo.edu>` | RFC 5322 `From` header for every message. Set this to a sender on **your** domain (see §5). |
| `APP_PUBLIC_URL` | Recommended | *(unset → falls back to first `CORS_ORIGIN`, then `http://localhost:3000`)* | Public base URL of the web app; used to build the password-reset link (`<base>/reset-password?token=...`). Set this in production or reset links point at the wrong host. |
| `PASSWORD_RESET_TTL_MINUTES` | No | `60` | Lifetime of a password-reset token, in minutes. Surfaced in the reset email copy. |

\* Most public providers (SES, SendGrid, Gmail, Mailgun) **require** auth, so in
practice you will set `SMTP_USER` + `SMTP_PASS`. Auth is optional only for
internal relays that authenticate by IP.

## 3. Provider quick-starts

Pick one. Set the variables, restart the backend, then verify with §4. SRE EDU OS
is widely deployed for Indian institutions — for **DPDP / data-residency**
comfort, prefer a provider with an India/Asia region or one that lets you pin
region (AWS SES `ap-south-1` Mumbai, Mailgun EU, etc.). All examples assume port
`587`/STARTTLS unless noted.

### Amazon SES (recommended for AWS / India `ap-south-1`)
Create SMTP credentials in the SES console (these differ from your AWS keys) and
verify your domain/sender first.

```dotenv
SMTP_HOST=email-smtp.ap-south-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=AKIAIOSFODNN7EXAMPLE          # SES SMTP username
SMTP_PASS=BInExampleSesSmtpPasswordXXXXXXXXXXXXXXXXXXXX
SMTP_FROM="GoCampus <no-reply@yourschool.edu>"
```

### SendGrid
Username is the literal string `apikey`; password is your API key.

```dotenv
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG.xxxxxxxxxxxxxxxxxxxxxx
SMTP_FROM="GoCampus <no-reply@yourschool.edu>"
```

### Mailgun (has an EU region for residency)
Use the SMTP credentials from your sending domain. Swap host to
`smtp.eu.mailgun.org` for the EU region.

```dotenv
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@mg.yourschool.edu
SMTP_PASS=your-mailgun-smtp-password
SMTP_FROM="GoCampus <no-reply@mg.yourschool.edu>"
```

### Gmail / Google Workspace (app password)
Only works with an **App Password** (requires 2-Step Verification); your normal
account password will be rejected. Best for low volume / pilots, not bulk mail.

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465                            # implicit TLS → secure:true
SMTP_USER=admin@yourschool.edu
SMTP_PASS=abcd efgh ijkl mnop           # 16-char Google App Password (no spaces)
SMTP_FROM="GoCampus <admin@yourschool.edu>"
```

### Generic SMTP relay
Any standards-compliant server. Use `465` only for implicit-TLS servers.

```dotenv
SMTP_HOST=mail.yourprovider.com
SMTP_PORT=587
SMTP_USER=smtp-user
SMTP_PASS=smtp-secret
SMTP_FROM="GoCampus <no-reply@yourschool.edu>"
```

## 4. Verifying it works

### (a) Boot log
On startup `backend/src/server.ts` calls `verifyMailer()` (non-fatal) and logs
exactly one of:

```
SMTP not configured — transactional email (password reset, notifications) is disabled
SMTP configured but verification FAILED: <error message>
SMTP verified — transactional email is deliverable
```

The middle line means `SMTP_HOST` is set but the connection/handshake/auth
failed — go to §6.

### (b) Super-admin endpoints
Two **super-admin-only** endpoints expose live status and a test send (mounted
under `/platform`, requiring a `super_admin` token **and** the
`platform:health_read` permission). Neither leaks credentials.

**Status — `GET /platform/email/status`** (returns `verifyMailer()` output):

```bash
curl -s https://api.yourschool.edu/platform/email/status \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN"
```

```jsonc
{ "configured": true,  "ok": true }                       // healthy
{ "configured": true,  "ok": false, "error": "..." }      // misconfigured
{ "configured": false, "ok": false }                      // SMTP_HOST unset
```

**Test send — `POST /platform/email/test`** (body `{ "to": "<email>" }`):

```bash
curl -s -X POST https://api.yourschool.edu/platform/email/test \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"you@example.com"}'
```

```jsonc
{ "ok": true }                                            // delivered to relay
{ "ok": false, "error": "<smtp error>" }                  // send failed
// HTTP 503 if SMTP_HOST is unset:
{ "ok": false, "error": "SMTP is not configured" }
```

A successful test sends an email titled **"SRE EDU OS — SMTP test email"**. Test
sends are written to the security audit log (`platform.email.test`). `{ "ok": true }`
means the relay **accepted** the message — confirm it actually lands in the inbox
(check spam too, then §5).

## 5. Deliverability

Acceptance by the relay ≠ inbox placement. To stay out of spam:

- **From a domain you control.** Set `SMTP_FROM` to an address on your school's
  domain (e.g. `no-reply@yourschool.edu`), not the default `@sreedo.edu`. Many
  providers reject/quarantine mail whose `From` domain you haven't verified.
- **SPF** — publish a TXT record on the From domain authorizing your provider,
  e.g. `v=spf1 include:amazonses.com -all` (SES) / `include:sendgrid.net` /
  `include:mailgun.org`.
- **DKIM** — enable DKIM in the provider console and publish the CNAME/TXT
  records it gives you so messages are cryptographically signed.
- **DMARC** — publish `_dmarc.yourschool.edu` such as
  `v=DMARC1; p=none; rua=mailto:dmarc@yourschool.edu` (start at `p=none` to
  monitor, then tighten to `quarantine`/`reject`).
- Use a real, monitored or clearly no-reply mailbox; keep subjects honest;
  warm up volume gradually on a new domain/IP.

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Boot log: `SMTP not configured …`; `/platform/email/status` → `configured:false` | `SMTP_HOST` is unset/empty | Set `SMTP_HOST` (and usually `SMTP_USER`/`SMTP_PASS`), then **restart the backend**. |
| Boot log: `SMTP configured but verification FAILED: …`; status `ok:false` | Wrong host/port, bad credentials, TLS mismatch, or blocked egress | Re-check host/port for the provider; confirm `SMTP_USER`/`SMTP_PASS`; ensure the server can reach the SMTP port outbound (firewall/security group). |
| Error mentions `wrong version number` / TLS handshake | TLS mode mismatch | Use `SMTP_PORT=465` for implicit-TLS servers (→ `secure:true`); use `587` for STARTTLS servers. |
| `535` / "authentication failed" | Bad/missing credentials, or provider needs an app-specific secret | Gmail → App Password; SendGrid → user `apikey` + API key; SES → SES SMTP creds (not AWS keys). |
| Status/test ok, but no email arrives | Spam filtering or unverified sender/domain | Check spam; verify sender/domain at the provider; configure SPF/DKIM/DMARC (§5). |
| Test send returns HTTP `503` `SMTP is not configured` | `mailerConfigured()` is false (`SMTP_HOST` unset) | Same as the first row. |
| Password-reset link points at `localhost`/wrong host | `APP_PUBLIC_URL` unset → falls back to first `CORS_ORIGIN` | Set `APP_PUBLIC_URL` to your public web URL and restart. |
| Reset link expired too quickly | `PASSWORD_RESET_TTL_MINUTES` too low | Raise it (default `60`); message copy reflects the value. |
| Logs show `SMTP not configured — skipping email to …` per send | Transport never built (no `SMTP_HOST`) | Configure SMTP. Until then sends are intentionally no-ops (never errors). |
| `403`/`429` from provider | Sandbox mode (SES) or rate/quota limits | Move SES out of sandbox; raise provider quota or throttle volume. |

## 7. Security notes

- **Never commit credentials.** Only `backend/.env.example` (a template with
  blank/placeholder values) belongs in git; real `SMTP_USER`/`SMTP_PASS` go in
  the deployment environment / secret store only.
- **Use a scoped, app-specific credential** — a Gmail App Password, a SendGrid
  API key restricted to Mail Send, or dedicated SES SMTP credentials — never a
  human's primary account password.
- **Least privilege:** grant the credential send-only scope; do not reuse
  broad cloud keys (SES SMTP credentials are distinct from AWS access keys).
- **Rotate** SMTP secrets periodically and immediately if a `.env`/host is
  exposed; revoke the old key at the provider after rotating.
- The status/test endpoints are **super-admin-only** and never return secrets —
  `verifyMailer()`/status responses contain only `configured`/`ok`/`error`.
- Test sends are audited (`platform.email.test`); avoid sending tests to
  third-party addresses.
