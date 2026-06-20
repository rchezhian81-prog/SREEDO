"use client";

import { useEffect, useState } from "react";
import { portalApi } from "@/lib/portal-api";
import {
  Badge,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { Announcement, Paginated } from "@/types";
import { useI18n } from "@/i18n/I18nProvider";

export default function PortalAnnouncementsPage() {
  const { t } = useI18n();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    portalApi
      .get<Paginated<Announcement> | Announcement[]>("/announcements")
      .then((r) => {
        const list = Array.isArray(r) ? r : r.data;
        setAnnouncements(list);
      })
      .catch(() => setError("Could not load notices."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader title={t("portalPages.announcements.title")} subtitle="Announcements from the school" />
      <ErrorNote message={error} />
      {announcements.length === 0 ? (
        <EmptyState message="No notices yet." />
      ) : (
        <div className="space-y-3">
          {announcements.map((announcement) => (
            <Card key={announcement.id}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-medium text-slate-900">
                  {announcement.title}
                </h3>
                {announcement.isPinned && <Badge tone="amber">Pinned</Badge>}
              </div>
              <p className="mt-1 whitespace-pre-line text-sm text-slate-600">
                {announcement.body}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                {new Date(announcement.publishedAt).toLocaleDateString()} ·{" "}
                {announcement.createdByName ?? "School"}
              </p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
