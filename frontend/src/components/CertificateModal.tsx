"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { Button, ErrorNote, Field, Input, Modal, Select } from "@/components/ui";
import type { Student } from "@/types";

const CERT_TYPES = [
  { value: "bonafide", label: "Bonafide certificate" },
  { value: "conduct", label: "Conduct certificate" },
  { value: "character", label: "Character certificate" },
];

/** Fetch the certificate PDF with the staff bearer token and save it. */
async function downloadCertificate(
  studentId: string,
  type: string,
  purpose: string
): Promise<void> {
  const base =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
  const token = useAuthStore.getState().accessToken;
  const qs = purpose ? `?purpose=${encodeURIComponent(purpose)}` : "";
  const res = await fetch(
    `${base}/certificates/student/${studentId}/${type}/download${qs}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const d = await res.json();
      if (typeof d.error === "string") msg = d.error;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${type}-certificate.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Staff dialog to generate a bonafide/conduct/character certificate PDF. */
export function CertificateModal({
  student,
  onClose,
}: {
  student: Student | null;
  onClose: () => void;
}) {
  const [type, setType] = useState("bonafide");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    if (!student) return;
    setBusy(true);
    setError(null);
    try {
      await downloadCertificate(student.id, type, purpose.trim());
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to generate certificate"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={
        student
          ? `Certificate · ${student.firstName} ${student.lastName}`
          : "Certificate"
      }
      open={student !== null}
      onClose={onClose}
    >
      <div className="space-y-4">
        <Field label="Certificate type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {CERT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Purpose (optional)">
          <Input
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. bank account opening"
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={download}>
            {busy ? "Generating…" : "Download PDF"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
