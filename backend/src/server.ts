import { createApp } from "./app";
import { env } from "./config/env";
import { closeMongo, connectMongo } from "./db/mongo";
import { assertPostgresConnection, pool } from "./db/postgres";
import { runMigrations } from "./db/migrate";
import { seedIfEmpty } from "./db/seed";

async function main(): Promise<void> {
  await assertPostgresConnection();
  console.log("Connected to PostgreSQL");

  await runMigrations();
  if (env.seedOnStart) {
    await seedIfEmpty();
  }
  await connectMongo();

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`SRE EDU OS API listening on port ${env.port}`);
    console.log(`Swagger UI: http://localhost:${env.port}/api/docs`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received — shutting down`);
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
