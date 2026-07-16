import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env";

// Application-layer encryption for uploaded documents at rest (Phase 1).
//
// AES-256-GCM. Each stored blob is self-describing: [version(1) | iv(12) | tag(16) |
// ciphertext]. The key id is recorded per document (documents.enc_key_id) so a download
// picks the right key, and keys can be rotated without re-encrypting everything at once.
// The key id is also bound into the ciphertext as GCM additional-authenticated-data, so
// a blob can only ever be decrypted under the exact key id it was written with.
//
// Enabled ONLY when DOCUMENT_ENCRYPTION_KEY is set (base64 of exactly 32 bytes). When
// unset, documents are stored as-is (unchanged behaviour) and existing plaintext files
// stay readable. A malformed key fails fast at boot rather than silently degrading to
// plaintext — a security control must never fail open.

const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const HEADER_LEN = 1 + IV_LEN + TAG_LEN;

interface Keyring {
  activeId: string | null; // null => encryption disabled (no active key configured)
  keys: Map<string, Buffer>;
}

function decodeKey(b64: string, label: string): Buffer {
  const key = Buffer.from(b64, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error(
      `${label} must be base64 of exactly ${KEY_LEN} bytes (decoded ${key.length})`
    );
  }
  return key;
}

function buildFromEnv(): Keyring {
  const keys = new Map<string, Buffer>();
  // Retired keys (rotation): JSON map { "<id>": "<base64 32-byte key>" } — decrypt-only,
  // so files written under a previous key stay readable after the active key changes.
  if (env.documentEncryptionRetiredKeys) {
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(env.documentEncryptionRetiredKeys) as Record<string, string>;
    } catch {
      throw new Error(
        "DOCUMENT_ENCRYPTION_RETIRED_KEYS must be a JSON object of { id: base64Key }"
      );
    }
    for (const [id, b64] of Object.entries(parsed)) {
      keys.set(id, decodeKey(b64, `DOCUMENT_ENCRYPTION_RETIRED_KEYS["${id}"]`));
    }
  }
  const activeB64 = env.documentEncryptionKey;
  if (!activeB64) return { activeId: null, keys }; // disabled
  const activeId = env.documentEncryptionKeyId;
  if (!activeId) {
    throw new Error("DOCUMENT_ENCRYPTION_KEY_ID must be set when DOCUMENT_ENCRYPTION_KEY is set");
  }
  keys.set(activeId, decodeKey(activeB64, "DOCUMENT_ENCRYPTION_KEY"));
  return { activeId, keys };
}

let ring: Keyring | null = null;
function keyring(): Keyring {
  if (!ring) ring = buildFromEnv();
  return ring;
}

// Fail fast at boot: if a key is configured but malformed, throw at import time rather
// than discovering it on the first upload (or worse, silently storing plaintext).
keyring();

/** True when new uploads should be encrypted (an active key is configured). */
export function documentEncryptionEnabled(): boolean {
  return keyring().activeId !== null;
}

/** The active key id (recorded per new upload), or null when encryption is disabled. */
export function activeDocumentKeyId(): string | null {
  return keyring().activeId;
}

/** Low-level: encrypt bytes under a specific 32-byte key. Exposed for unit tests. */
export function encryptWithKey(plaintext: Buffer, key: Buffer, keyId: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(keyId, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
}

/** Low-level: decrypt a self-describing blob under a specific key. Exposed for unit tests. */
export function decryptWithKey(blob: Buffer, key: Buffer, keyId: string): Buffer {
  if (blob.length < HEADER_LEN) throw new Error("document ciphertext is too short");
  if (blob[0] !== VERSION) {
    throw new Error(`unsupported document ciphertext version: ${blob[0]}`);
  }
  const iv = blob.subarray(1, 1 + IV_LEN);
  const tag = blob.subarray(1 + IV_LEN, HEADER_LEN);
  const ct = blob.subarray(HEADER_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(keyId, "utf8"));
  decipher.setAuthTag(tag);
  // final() throws on any authentication failure (tampering, wrong key, wrong key id).
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Encrypt an uploaded document with the active key. Throws if encryption is disabled. */
export function encryptDocument(plaintext: Buffer): { blob: Buffer; keyId: string } {
  const { activeId, keys } = keyring();
  if (activeId === null) throw new Error("document encryption is not enabled");
  return { blob: encryptWithKey(plaintext, keys.get(activeId)!, activeId), keyId: activeId };
}

/** Decrypt a stored document blob using the key id recorded for it (documents.enc_key_id). */
export function decryptDocument(blob: Buffer, keyId: string): Buffer {
  const key = keyring().keys.get(keyId);
  if (!key) {
    // Encrypted under a key this process does not have (removed / rotated away). Fail
    // loudly — never return the raw ciphertext.
    throw new Error(`no document encryption key available for key id "${keyId}"`);
  }
  return decryptWithKey(blob, key, keyId);
}

/**
 * Test-only seam: inject a keyring, or pass null to rebuild from the environment.
 * Encryption env is read once at boot, so tests use this to toggle encryption on/off
 * without depending on process start-up ordering.
 */
export function __setDocumentCryptoForTests(
  keys: { id: string; keyB64: string; active?: boolean }[] | null
): void {
  if (keys === null) {
    ring = null; // next use rebuilds from env
    return;
  }
  const map = new Map<string, Buffer>();
  for (const k of keys) map.set(k.id, Buffer.from(k.keyB64, "base64"));
  const active = keys.find((k) => k.active) ?? keys[0];
  ring = { activeId: active ? active.id : null, keys: map };
}
