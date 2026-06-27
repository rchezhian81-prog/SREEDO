"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { AdminInstitutionBrief, DataExport } from "@/types";

function statusTone(status: string): "green" | "amber" | "red" | "slate" {
  switch (status) {
    case "completed":
      return "green";
    case "pending":
    case "running":
      return "amber";
    case "failed":
      return "red";
    default:
      return "slate";
  }
}

export default function ExportsPage() {
  const [institutions, setInstitutions] = useState<AdminInstitutionBrief[]>([]);
  const [exports, setExports] = useState<DataExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<DataExport | null>(null);

  const [viewing, setViewing] = useState<DataExport | null>(null);

  const loadExports = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setExports(await api.get<DataExport[]>("/admin/exports"));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load exports"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api
      .get<AdminInstitutionBrief[]>("/admin/institutions")
      .then(setInstitutions)
      .catch(() => undefined);
    loadExports();
  }, [loadExports]);

  const onGenerate = async () => {
    if (!selectedId) return;
    setGenerating(true);
    setGenError(null);
    try {
      const created = await api.post<DataExport>(
        `/admin/institutions/${selectedId}/export`
      );
      setLastExport(created);
      await loadExports();
    } catch (err) {
      setGenError(
        err instanceof ApiError ? err.message : "Failed to generate export"
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Backups / exports"
        subtitle="Generate safe tenant data-export summaries (counts & metadata only)"
      />

      <Card className="mb-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">
          Generate export
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-72">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Institution
            </span>
            <Select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="">Select an institution…</option>
              {institutions.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.name} ({inst.code})
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={onGenerate} disabled={!selectedId || generating}>
            {generating ? "Generating…" : "Generate export"}
          </Button>
        </div>
        <div className="mt-3">
          <ErrorNote message={genError} />
        </div>

        {lastExport && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <p className="mb-2 text-sm font-medium text-emerald-800">
              Export generated for {lastExport.summary.institution.name}
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-700">
              {Object.entries(lastExport.summary.counts).map(([key, value]) => (
                <span key={key}>
                  <span className="capitalize text-slate-500">{key}:</span>{" "}
                  <span className="font-medium">{value}</span>
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Generated {new Date(lastExport.summary.generatedAt).toLocaleString()}
            </p>
          </div>
        )}
      </Card>

      <h2 className="mb-3 text-lg font-semibold text-slate-900">
        Export history
      </h2>
      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : exports.length === 0 ? (
        <EmptyState message="No exports generated yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Institution</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {exports.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {row.institutionName ?? row.summary.institution.name}
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-600">
                    {row.kind}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="secondary" onClick={() => setViewing(row)}>
                      View summary
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        title="Export summary"
        open={viewing !== null}
        onClose={() => setViewing(null)}
      >
        {viewing && (
          <div className="space-y-4">
            <div>
              <h3 className="mb-1 text-sm font-semibold text-slate-700">
                Institution
              </h3>
              <p className="text-sm text-slate-600">
                {viewing.summary.institution.name} (
                {viewing.summary.institution.code}) —{" "}
                <span className="capitalize">
                  {viewing.summary.institution.type}
                </span>
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">
                Counts
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(viewing.summary.counts).map(([key, value]) => (
                  <div
                    key={key}
                    className="rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <p className="text-xs capitalize text-slate-500">{key}</p>
                    <p className="text-lg font-semibold text-slate-900">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Generated {new Date(viewing.summary.generatedAt).toLocaleString()}
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
