"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Maintenance / announcement banner driven by global platform settings.
// The backend (GET /platform/runtime-status) gates the announcement by the
// caller's role, so this only renders what the current user is allowed to see.
interface RuntimeStatus {
  maintenance: { active: boolean; message: string | null; startsAt: string | null; endsAt: string | null };
  announcement: { active: boolean; text: string | null; visibility: string } | null;
}

export function RuntimeBanner() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<RuntimeStatus>("/platform/runtime-status")
      .then((s) => { if (alive) setStatus(s); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  if (!status) return null;
  const banners: { tone: "amber" | "brand"; text: string }[] = [];
  if (status.maintenance.active) {
    banners.push({ tone: "amber", text: status.maintenance.message || "Scheduled maintenance is in progress." });
  }
  if (status.announcement?.active && status.announcement.text) {
    banners.push({ tone: "brand", text: status.announcement.text });
  }
  if (!banners.length) return null;

  return (
    <div>
      {banners.map((b, i) => (
        <div
          key={i}
          role="status"
          className={
            "px-4 py-2 text-center text-sm font-medium md:px-6 " +
            (b.tone === "amber" ? "bg-amber-100 text-amber-900" : "bg-brand-600 text-white")
          }
        >
          {b.text}
        </div>
      ))}
    </div>
  );
}
