import { describe, it, expect } from "vitest";
import { backupWriteStorage, backupStorageFor, storageConfigured } from "./storage";

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
