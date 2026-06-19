import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
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

  jwtAccessSecret: required("JWT_ACCESS_SECRET", "dev-access-secret-change-me"),
  jwtRefreshSecret: required(
    "JWT_REFRESH_SECRET",
    "dev-refresh-secret-change-me"
  ),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
  jwtRefreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 7),

  rateLimitWindowMinutes: Number(process.env.RATE_LIMIT_WINDOW_MINUTES ?? 15),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 300),
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),

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

  // Online payment gateway (provider-agnostic hosted checkout) — optional.
  // When PAYMENT_GATEWAY_PROVIDER + PAYMENT_GATEWAY_WEBHOOK_SECRET are unset the
  // gateway is "not configured": online payments degrade gracefully and offline
  // fee collection keeps working. No provider credentials are ever hardcoded.
  paymentGatewayProvider: optional("PAYMENT_GATEWAY_PROVIDER"),
  paymentGatewayWebhookSecret: optional("PAYMENT_GATEWAY_WEBHOOK_SECRET"),
  paymentCheckoutBaseUrl: optional("PAYMENT_CHECKOUT_BASE_URL"),
  paymentCurrency: process.env.PAYMENT_CURRENCY ?? "INR",

  // API docs (Swagger) default off in production; override with ENABLE_API_DOCS.
  enableApiDocs:
    process.env.ENABLE_API_DOCS !== undefined
      ? process.env.ENABLE_API_DOCS === "true"
      : process.env.NODE_ENV !== "production",
};

if (env.isProduction && env.jwtAccessSecret.startsWith("dev-")) {
  throw new Error("JWT secrets must be overridden in production");
}
