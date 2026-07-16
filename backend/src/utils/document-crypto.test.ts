import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  encryptWithKey,
  decryptWithKey,
  encryptDocument,
  decryptDocument,
  documentEncryptionEnabled,
  activeDocumentKeyId,
  __setDocumentCryptoForTests,
} from "./document-crypto";

const KEY_A = randomBytes(32);
const KEY_B = randomBytes(32);
const b64 = (b: Buffer) => b.toString("base64");

// Restore the env-derived keyring (disabled in the test env) after every test.
afterEach(() => __setDocumentCryptoForTests(null));

describe("document-crypto (AES-256-GCM, application-layer document encryption)", () => {
  it("round-trips arbitrary binary data and never leaves plaintext in the blob", () => {
    // Binary payload (NUL + high bytes) built from an ASCII source — proves it handles
    // real file bytes, not just text.
    const pt = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10, 0x7f, 0xa5]);
    const blob = encryptWithKey(pt, KEY_A, "k1");
    expect(blob.equals(pt)).toBe(false); // stored bytes are ciphertext, not the file
    expect(decryptWithKey(blob, KEY_A, "k1").equals(pt)).toBe(true);
  });

  it("detects tampering — a single flipped byte fails authentication", () => {
    const blob = encryptWithKey(Buffer.from("secret"), KEY_A, "k1");
    blob[blob.length - 1] ^= 0x01;
    expect(() => decryptWithKey(blob, KEY_A, "k1")).toThrow();
  });

  it("refuses the wrong key and a mismatched key id (AAD binding)", () => {
    const blob = encryptWithKey(Buffer.from("secret"), KEY_A, "k1");
    expect(() => decryptWithKey(blob, KEY_B, "k1")).toThrow(); // wrong key
    expect(() => decryptWithKey(blob, KEY_A, "k2")).toThrow(); // right key, wrong key id
  });

  it("rejects a wrong-length key (AES-256 requires 32 bytes)", () => {
    expect(() => encryptWithKey(Buffer.from("x"), randomBytes(16), "k1")).toThrow();
  });

  it("is disabled with no active key and throws if asked to encrypt", () => {
    expect(documentEncryptionEnabled()).toBe(false); // env has no key in tests
    expect(activeDocumentKeyId()).toBeNull();
    expect(() => encryptDocument(Buffer.from("x"))).toThrow();
  });

  it("encrypts with the active key when one is injected", () => {
    __setDocumentCryptoForTests([{ id: "k1", keyB64: b64(KEY_A), active: true }]);
    expect(documentEncryptionEnabled()).toBe(true);
    expect(activeDocumentKeyId()).toBe("k1");
    const { blob, keyId } = encryptDocument(Buffer.from("hello"));
    expect(keyId).toBe("k1");
    expect(decryptDocument(blob, "k1").toString()).toBe("hello");
  });

  it("supports rotation: reads a retired-key file while new uploads use the active key; unknown id fails", () => {
    const oldFile = encryptWithKey(Buffer.from("old file"), KEY_A, "k1");
    __setDocumentCryptoForTests([
      { id: "k2", keyB64: b64(KEY_B), active: true }, // new active key
      { id: "k1", keyB64: b64(KEY_A) }, // retired, decrypt-only
    ]);
    expect(activeDocumentKeyId()).toBe("k2"); // new uploads use k2
    expect(decryptDocument(oldFile, "k1").toString()).toBe("old file"); // old file still reads
    expect(() => decryptDocument(oldFile, "kX")).toThrow(); // key we don't have -> surfaced
  });
});
