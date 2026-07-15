import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "../config/env";

export type StorageMode = "s3" | "local";

/** Result of a real connectivity probe (used by the offsite backup "test" action). */
export interface StoragePingResult {
  ok: boolean;
  /** Short, safe detail — NEVER contains keys/secrets. */
  detail: string;
}

export interface Storage {
  readonly mode: StorageMode;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  /** Live reachability check of the backing store (no secrets in the result). */
  ping(): Promise<StoragePingResult>;
}

/** True only when all S3 settings are present (otherwise local disk is used). */
export function storageConfigured(): boolean {
  return Boolean(
    env.storageEndpoint &&
      env.storageBucket &&
      env.storageAccessKey &&
      env.storageSecretKey
  );
}

// Local-disk fallback (development only). Keys are app-generated (uuid-based),
// so there is no user-controlled path traversal.
class LocalDiskStorage implements Storage {
  readonly mode = "local" as const;
  private root = path.resolve(env.storageLocalDir);

  async put(key: string, body: Buffer): Promise<void> {
    const full = path.join(this.root, key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  async get(key: string): Promise<Buffer> {
    return readFile(path.join(this.root, key));
  }
  async remove(key: string): Promise<void> {
    await unlink(path.join(this.root, key)).catch(() => undefined);
  }
  async ping(): Promise<StoragePingResult> {
    // Prove the backup directory is writable with a tiny probe file (cleaned up).
    try {
      const probe = path.join(this.root, ".backup-probe");
      await mkdir(this.root, { recursive: true });
      await writeFile(probe, Buffer.from("ok"));
      await unlink(probe).catch(() => undefined);
      return { ok: true, detail: `Local disk writable (${this.root})` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message.slice(0, 200) : "Local disk not writable" };
    }
  }
}

// S3-compatible object storage (AWS S3, MinIO, R2, …); endpoint/bucket/keys
// all come from env — nothing hardcoded.
class S3Storage implements Storage {
  readonly mode = "s3" as const;
  private client = new S3Client({
    endpoint: env.storageEndpoint,
    region: env.storageRegion,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.storageAccessKey as string,
      secretAccessKey: env.storageSecretKey as string,
    },
  });

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: env.storageBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
  }
  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: env.storageBucket, Key: key })
    );
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
  async remove(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: env.storageBucket, Key: key })
    );
  }
  async ping(): Promise<StoragePingResult> {
    // HeadBucket confirms the endpoint + credentials + bucket without listing or
    // exposing any object. Only a safe, host-level detail is returned.
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: env.storageBucket }));
      const host = (() => {
        try {
          return env.storageEndpoint ? new URL(env.storageEndpoint).host : "s3";
        } catch {
          return "s3";
        }
      })();
      return { ok: true, detail: `Reached bucket "${env.storageBucket}" at ${host}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message.slice(0, 200) : "S3 unreachable" };
    }
  }
}

export const storage: Storage = storageConfigured()
  ? new S3Storage()
  : new LocalDiskStorage();

export const storageMode: StorageMode = storage.mode;

// --- DB-backup storage target (decoupled from the document store) ---
// Database backups must NOT follow the document-storage singleton: enabling S3 for
// *documents* (STORAGE_*) must never silently start writing DB dumps offsite. Backups
// therefore default to a dedicated local-disk backend and only use S3 when offsite is
// EXPLICITLY enabled (backup_settings.offsite_enabled) AND S3 is configured — so
// offsite backups stay a deliberate DR-hardening decision, not a side effect.
const backupLocalStorage: Storage = new LocalDiskStorage();

/** Where a DB backup is WRITTEN: S3 only when offsite is explicitly enabled AND S3 is
 *  configured; otherwise the application-server disk. */
export function backupWriteStorage(offsiteEnabled: boolean): Storage {
  return offsiteEnabled && storageConfigured() ? storage : backupLocalStorage;
}

/** Where a stored DB backup is READ/removed, resolved by its recorded storage_mode so
 *  local and s3 artifacts each use the right backend regardless of the document store. */
export function backupStorageFor(mode: StorageMode | null | undefined): Storage {
  return mode === "s3" && storageConfigured() ? storage : backupLocalStorage;
}
