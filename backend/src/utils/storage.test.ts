import { describe, it, expect } from "vitest";
import {
  backupWriteStorage,
  backupStorageFor,
  documentStorageFor,
  storageConfigured,
} from "./storage";

// Guarantee: enabling S3 for *documents* (STORAGE_*) must NEVER silently send database
// backups offsite. DB backups only use S3 when offsite is EXPLICITLY enabled AND S3 is
// configured; otherwise they stay on the application-server disk. Reads route by each
// backup's recorded storage_mode so the document-storage singleton can be S3 while
// backups remain local.
describe("backup storage target is decoupled from document storage", () => {
  it("offsite DISABLED → backups always go to local disk (the core decoupling guarantee)", () => {
    // Unconditional: `false && ...` short-circuits, so this never returns the S3 store,
    // regardless of whether S3 is configured for documents.
    expect(backupWriteStorage(false).mode).toBe("local");
  });

  it("a 'local' backup always reads back from local disk", () => {
    expect(backupStorageFor("local").mode).toBe("local");
    expect(backupStorageFor(null).mode).toBe("local");
  });

  it("without S3 configured, neither documents nor backups can go offsite", () => {
    if (storageConfigured()) return; // env provides S3 → this env-specific check doesn't apply
    expect(backupWriteStorage(true).mode).toBe("local"); // offsite intent, but no S3 → stays local
    expect(backupStorageFor("s3").mode).toBe("local"); // 's3' record falls back to local when S3 absent
  });
});

// Guarantee (PR-OPS3): a stored document is read/removed from the SAME backend it was
// written to (its recorded storage_mode) — so enabling S3 for new uploads never orphans
// files already on local disk. Unlike backups, an 's3' document must NOT silently fall
// back to local disk: if S3 is unavailable the router throws so the caller returns 503,
// never hiding an S3 permission/outage error behind a local-disk miss.
describe("document storage routing follows each file's recorded storage_mode", () => {
  it("'local'/null/undefined always resolve to local disk (legacy files stay readable after an S3 flip)", () => {
    expect(documentStorageFor("local").mode).toBe("local");
    expect(documentStorageFor(null).mode).toBe("local");
    expect(documentStorageFor(undefined).mode).toBe("local");
  });

  it("an 's3' file with S3 NOT configured THROWS (no silent local fallback — S3 errors are never masked)", () => {
    if (storageConfigured()) return; // env provides S3 → this env-specific check doesn't apply
    expect(() => documentStorageFor("s3")).toThrow(/not configured/i);
  });

  it("an 's3' file with S3 configured routes to the S3 backend", () => {
    if (!storageConfigured()) return; // only meaningful when env provides S3
    expect(documentStorageFor("s3").mode).toBe("s3");
  });

  it("an unrecognised storage mode THROWS (never silently served from local disk)", () => {
    // documents.storage_mode is TEXT with no CHECK constraint, so a row could hold an
    // unexpected value — it must fail loudly (→ 503), not fall through to local.
    expect(() => documentStorageFor("gcs")).toThrow(/unsupported storage mode/i);
    expect(() => documentStorageFor("")).toThrow(/unsupported storage mode/i);
  });
});
