import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Like `required`, but refuses the published dev default when NODE_ENV=production.
// Otherwise a missing/weak JWT secret would sign tokens with a secret committed
// to this repo — anyone could forge a valid session. This supersedes the older
// `jwtAccessSecret.startsWith("dev-")` boot check: it covers BOTH the access and
// refresh secrets, and the empty/unset cases, and fails fast at boot.
export function requiredSecret(name: string, devFallback: string): string {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? devFallback : raw;
  if (
    process.env.NODE_ENV === "production" &&
    (value === devFallback || value.startsWith("dev-"))
  ) {
    throw new Error(
      `${name} must be set to a strong, unique value in production ` +
        `(the dev default is published in this repository).`
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim()),

  databaseUrl: required(
    "DATABASE_URL",
    "postgres://sreedo:sreedo@localhost:5432/sreedo"
  ),
  mongoUrl: optional("MONGO_URL"),
  mongoDb: process.env.MONGO_DB ?? "sreedo",

  jwtAccessSecret: requiredSecret(
    "JWT_ACCESS_SECRET",
    "dev-access-secret-change-me"
  ),
  jwtRefreshSecret: requiredSecret(
    "JWT_REFRESH_SECRET",
    "dev-refresh-secret-change-me"
  ),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
  jwtRefreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 7),

  // Public base URL of the web app — used to build links in transactional email
  // (e.g. the password-reset link). Falls back to the first CORS origin when unset.
  appPublicUrl: optional("APP_PUBLIC_URL"),
  // Self-service password-reset token lifetime, in minutes.
  passwordResetTtlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 60),

  // Per-account lockout: after this many consecutive failed logins the account
  // is locked for the configured number of minutes (an admin can unlock sooner).
  authMaxFailedAttempts: Number(process.env.AUTH_MAX_FAILED_ATTEMPTS ?? 5),
  authLockoutMinutes: Number(process.env.AUTH_LOCKOUT_MINUTES ?? 15),

  rateLimitWindowMinutes: Number(process.env.RATE_LIMIT_WINDOW_MINUTES ?? 15),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 300),
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
  // Per-tenant limiter (keyed by institution) for the external `/ext` API surface.
  tenantRateLimitMax: Number(process.env.TENANT_RATE_LIMIT_MAX ?? 600),

  openaiApiKey: optional("OPENAI_API_KEY"),
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o",

  smtpHost: optional("SMTP_HOST"),
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: optional("SMTP_USER"),
  smtpPass: optional("SMTP_PASS"),
  smtpFrom: process.env.SMTP_FROM ?? "SRE EDU OS <no-reply@sreedo.edu>",

  // SMS adapter (provider-agnostic; degrades to no-op when unset).
  smsProvider: optional("SMS_PROVIDER"),
  smsApiKey: optional("SMS_API_KEY"),
  smsApiUrl: optional("SMS_API_URL"),
  smsSender: process.env.SMS_SENDER ?? "SREEDO",

  // Firebase Cloud Messaging (push); degrades to no-op when unset.
  fcmServerKey: optional("FCM_SERVER_KEY"),

  // Object storage (S3-compatible). When unset, files fall back to local disk
  // (development only). No credentials are hardcoded.
  storageEndpoint: optional("STORAGE_ENDPOINT"),
  storageRegion: process.env.STORAGE_REGION ?? "us-east-1",
  storageBucket: optional("STORAGE_BUCKET"),
  storageAccessKey: optional("STORAGE_ACCESS_KEY"),
  storageSecretKey: optional("STORAGE_SECRET_KEY"),
  storageLocalDir: process.env.STORAGE_LOCAL_DIR ?? "uploads",
  storageMaxMb: Number(process.env.STORAGE_MAX_MB ?? 10),

  seedOnStart: process.env.SEED_ON_START === "true",

  // Background job worker (Postgres-backed; no external broker). Off by default
  // so tests/CI stay deterministic; enable in self-hosted deployments to run the
  // scheduler tick + drain the queue on an interval.
  jobWorkerEnabled: process.env.JOB_WORKER_ENABLED === "true",
  jobWorkerIntervalMs: Number(process.env.JOB_WORKER_INTERVAL_MS ?? 15000),

  // Subscription lifecycle (Billing Phase B1). The sweep transitions expired
  // subscriptions and sends renewal reminders; it runs in the worker tick (when
  // JOB_WORKER_ENABLED) or on demand via POST /platform/subscriptions/run-lifecycle.
  // Days of grace after a term ends before a subscription is marked expired.
  billingGraceDays: Number(process.env.BILLING_GRACE_DAYS ?? 14),
  // Days-before-expiry on which to send a renewal reminder (comma-separated).
  billingReminderDays: (process.env.BILLING_REMINDER_DAYS ?? "14,7,1")
    .split(",")
    .map((d) => Number(d.trim()))
    .filter((d) => Number.isFinite(d) && d > 0),
  // When true, an expired subscription also suspends the institution
  // (institutions.is_active = false). OFF by default so the sweep is non-disruptive.
  billingAutoSuspend: process.env.BILLING_AUTO_SUSPEND === "true",
  // Placeholder enforcement: when true, requireActiveSubscription blocks writes
  // for expired/suspended tenants. OFF by default (the guard is not yet mounted).
  billingEnforceSubscription: process.env.BILLING_ENFORCE_SUBSCRIPTION === "true",

  // SaaS invoicing (Billing Phase B2) — gateway-free. Prefix + default currency
  // for operator-issued subscription invoices (paid offline; no gateway).
  saasInvoicePrefix: process.env.SAAS_INVOICE_PREFIX ?? "SINV-",
  saasInvoiceCurrency: process.env.SAAS_INVOICE_CURRENCY ?? "INR",
  // Operator/seller identity printed on the invoice PDF "from" block. Name has a
  // sensible default; the rest are optional and omitted from the PDF when unset.
  saasCompanyName: process.env.SAAS_COMPANY_NAME ?? "SRE EDU OS",
  saasCompanyAddress: optional("SAAS_COMPANY_ADDRESS"),
  saasCompanyEmail: optional("SAAS_COMPANY_EMAIL"),
  saasCompanyGstin: optional("SAAS_COMPANY_GSTIN"),
  saasCompanyLogoPath: optional("SAAS_COMPANY_LOGO_PATH"),

  // Online payment gateway (provider-agnostic hosted checkout) — optional.
  // When PAYMENT_GATEWAY_PROVIDER + PAYMENT_GATEWAY_WEBHOOK_SECRET are unset the
  // gateway is "not configured": online payments degrade gracefully and offline
  // fee collection keeps working. No provider credentials are ever hardcoded.
  paymentGatewayProvider: optional("PAYMENT_GATEWAY_PROVIDER"),
  paymentGatewayWebhookSecret: optional("PAYMENT_GATEWAY_WEBHOOK_SECRET"),
  paymentCheckoutBaseUrl: optional("PAYMENT_CHECKOUT_BASE_URL"),
  paymentCurrency: process.env.PAYMENT_CURRENCY ?? "INR",

  // Platform SaaS-invoice payment gateway (Razorpay) — Super Admin C-4. Optional
  // env FALLBACK for the secrets when the singleton DB settings row leaves them
  // blank (the super admin normally enters these in the masked settings UI).
  // Nothing is hardcoded; when no key id/secret is configured the gateway is off
  // and operators keep collecting SaaS invoices offline (mark-paid) as before.
  razorpayKeyId: optional("RAZORPAY_KEY_ID"),
  razorpayKeySecret: optional("RAZORPAY_KEY_SECRET"),
  razorpayWebhookSecret: optional("RAZORPAY_WEBHOOK_SECRET"),
  razorpayApiBase: process.env.RAZORPAY_API_BASE ?? "https://api.razorpay.com/v1",

  // API docs (Swagger) default off in production; override with ENABLE_API_DOCS.
  enableApiDocs:
    process.env.ENABLE_API_DOCS !== undefined
      ? process.env.ENABLE_API_DOCS === "true"
      : process.env.NODE_ENV !== "production",
};
