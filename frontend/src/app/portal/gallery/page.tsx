"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { portalApi } from "@/lib/portal-api";
import { EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";

interface Album {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  photoCount: number;
}

export default function PortalGalleryPage() {
  const { t } = useI18n();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    portalApi
      .get<Album[]>("/portal/gallery")
      .then(setAlbums)
      .catch(() => setError("Could not load the gallery."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader title={t("portalNav.gallery")} subtitle="School photo albums" />

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : albums.length === 0 ? (
        <EmptyState message="No albums have been published yet." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {albums.map((a) => (
            <Link
              key={a.id}
              href={`/portal/gallery/${a.id}`}
              className="block overflow-hidden rounded-xl border border-slate-200 bg-white"
            >
              <div className="aspect-video bg-slate-100">
                {a.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.coverUrl} alt={a.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-400">📷</div>
                )}
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-slate-900">{a.title}</h3>
                <p className="text-xs text-slate-500">{a.photoCount} photos</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
