import { MongoClient, type Db } from "mongodb";
import { env } from "../config/env";

let client: MongoClient | null = null;
let db: Db | null = null;

/**
 * MongoDB is an optional dependency: it backs audit logs and AI conversation
 * history. When MONGO_URL is unset or the server is unreachable, those
 * features degrade gracefully instead of taking the API down.
 */
export async function connectMongo(): Promise<void> {
  if (!env.mongoUrl) {
    console.warn("MONGO_URL not set — audit logs and AI history disabled");
    return;
  }
  try {
    client = new MongoClient(env.mongoUrl, {
      serverSelectionTimeoutMS: 5_000,
    });
    await client.connect();
    db = client.db(env.mongoDb);
    await db
      .collection("audit_logs")
      .createIndex({ createdAt: -1 })
      .catch(() => undefined);
    await db
      .collection("ai_conversations")
      .createIndex({ userId: 1, updatedAt: -1 })
      .catch(() => undefined);
    console.log("Connected to MongoDB");
  } catch (err) {
    client = null;
    db = null;
    console.warn("MongoDB unavailable — continuing without it:", err);
  }
}

export function getMongoDb(): Db | null {
  return db;
}

export async function closeMongo(): Promise<void> {
  await client?.close();
  client = null;
  db = null;
}
