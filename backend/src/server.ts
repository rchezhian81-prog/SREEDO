import { createApp } from "./app";
import { env } from "./config/env";
import { closeMongo, connectMongo } from "./db/mongo";
import { assertPostgresConnection, pool } from "./db/postgres";
import { runMigrations } from "./db/migrate";
import { seedIfEmpty } from "./db/seed";
import { verifyMailer } from "./utils/mailer";
import { startWorker, stopWorker } from "./modules/jobs/jobs.worker";

async function main(): Promise<void> {
  await assertPostgresConnection();
  console.log("Connected to PostgreSQL");

  await runMigrations();
  if (env.seedOnStart) {
    await seedIfEmpty();
  }
  await connectMongo();

  // Validate SMTP up front so a misconfiguration surfaces in the boot logs
  // rather than silently dropping every password-reset email. Non-fatal.
  const mail = await verifyMailer();
  if (!mail.configured) {
    console.warn(
      "SMTP not configured — transactional email (password reset, notifications) is disabled"
    );
  } else if (!mail.ok) {
    console.warn(`SMTP configured but verification FAILED: ${mail.error}`);
  } else {
    console.log("SMTP verified — transactional email is deliverable");
  }

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`SRE EDU OS API listening on port ${env.port}`);
    console.log(`Swagger UI: http://localhost:${env.port}/api/docs`);
  });

  // Optional in-process background worker (off unless JOB_WORKER_ENABLED=true).
  startWorker();

  const shutdown = (signal: string) => {
    console.log(`${signal} received — shutting down`);
    stopWorker();
    server.close(async () => {
      await Promise.allSettled([pool.end(), closeMongo()]);
      process.exit(0);
    });
    // Force-exit if connections refuse to drain.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
