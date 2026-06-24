"use client";

import { useEffect, useState } from "react";
import { portalApi } from "@/lib/portal-api";
import { usePortalStore } from "@/stores/portal-store";
import {
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";

interface Material {
  id: string;
  classId: string | null;
  className: string | null;
  subjectId: string | null;
  subjectName: string | null;
  title: string;
  description: string | null;
  fileUrl: string;
  createdAt: string;
}

export default function PortalMaterialsPage() {
  const { t } = useI18n();
  const studentId = usePortalStore((state) => state.selectedStudentId);
  const [rows, setRows] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!studentId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    portalApi
      .get<Material[]>(`/portal/students/${studentId}/materials`)
      .then(setRows)
      .catch(() => setError("Could not load study materials."))
      .finally(() => setLoading(false));
  }, [studentId]);

  return (
    <div>
      <PageHeader title={t("portalNav.materials")} subtitle="Notes, resources & links shared by your teachers" />

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : rows.length === 0 ? (
        <EmptyState message="No study materials have been shared yet." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((m) => (
            <Card key={m.id} className="flex flex-col gap-2">
              <div>
                <h3 className="font-semibold text-slate-900">{m.title}</h3>
                <p className="text-xs text-slate-500">
                  {m.subjectName ? `${m.subjectName} · ` : ""}
                  {m.className ?? "School-wide"}
                </p>
              </div>
              {m.description ? (
                <p className="text-sm text-slate-600">{m.description}</p>
              ) : null}
              <a
                href={m.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-auto inline-block text-sm font-medium text-brand-600 hover:underline"
              >
                Open resource →
              </a>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
