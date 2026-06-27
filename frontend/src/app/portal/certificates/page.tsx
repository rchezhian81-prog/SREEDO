"use client";

import { useEffect, useState } from "react";
import { portalApi } from "@/lib/portal-api";
import { ApiError } from "@/lib/api";
import {
  Badge,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { TransferCertificate } from "@/types";

const STATUS_TONES: Record<
  TransferCertificate["status"],
  "slate" | "green" | "red"
> = {
  draft: "slate",
  issued: "green",
  cancelled: "red",
};

async function downloadPortalPdf(path: string, filename: string) {
  const base =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
  const res = await fetch(`${base}${path}`, { credentials: "include" });
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
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PortalCertificatesPage() {
  const [certificates, setCertificates] = useState<TransferCertificate[] | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    portalApi
      .get<TransferCertificate[]>("/transfer-certificates")
      .then(setCertificates)
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not load transfer certificates."
        )
      )
      .finally(() => setLoading(false));
  }, []);

  const download = async (tc: TransferCertificate) => {
    setDownloadError(null);
    try {
      await downloadPortalPdf(
        `/transfer-certificates/${tc.id}/download`,
        `${tc.tcNo}.pdf`
      );
    } catch (err) {
      setDownloadError(
        err instanceof ApiError ? err.message : "Failed to download PDF"
      );
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="Certificates" />
        <Spinner />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Certificates"
        subtitle="Transfer certificates"
      />
      <ErrorNote message={error} />
      <ErrorNote message={downloadError} />

      {!certificates || certificates.length === 0 ? (
        <EmptyState message="No transfer certificates available." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">TC No</th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Issue Date</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {certificates.map((tc) => (
                <tr key={tc.id}>
                  <td className="px-4 py-3 font-mono text-xs">{tc.tcNo}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {tc.studentName}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONES[tc.status]}>{tc.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {tc.dateOfIssue
                      ? new Date(tc.dateOfIssue).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {tc.status === "issued" ? (
                      <button
                        onClick={() => download(tc)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        Download
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">
                        Not yet issued
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
