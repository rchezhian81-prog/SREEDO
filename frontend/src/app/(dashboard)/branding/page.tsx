"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorNote, Field, Input, PageHeader, Spinner } from "@/components/ui";

interface Branding {
  displayName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  tagline: string | null;
}

const DEFAULT_COLOR = "#1d4ed8";

export default function BrandingPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_COLOR);
  const [tagline, setTagline] = useState("");

  useEffect(() => {
    api
      .get<Branding>("/branding")
      .then((b) => {
        setDisplayName(b.displayName ?? "");
        setLogoUrl(b.logoUrl ?? "");
        setPrimaryColor(b.primaryColor ?? DEFAULT_COLOR);
        setTagline(b.tagline ?? "");
      })
      .catch(() => setError("Could not load branding."))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.patch("/branding", {
        displayName: displayName || null,
        logoUrl: logoUrl || null,
        primaryColor: primaryColor || null,
        tagline: tagline || null,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;

  const initial = (displayName || "S").trim().charAt(0).toUpperCase();

  return (
    <>
      <PageHeader title="Branding" subtitle="White-label the portal & dashboard for your institution" />

      <ErrorNote message={error} />
      {saved ? (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Branding saved.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4 rounded-xl border border-line bg-surface p-5">
          <Field label="Display name">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Green Valley School" />
          </Field>
          <Field label="Logo URL">
            <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" />
          </Field>
          <Field label="Tagline">
            <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. Learn & Grow" />
          </Field>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Primary colour</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : DEFAULT_COLOR}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded border border-line bg-surface"
              />
              <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} placeholder="#1d4ed8" />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save branding"}
            </Button>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Preview</p>
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="flex items-center gap-3 border-b border-line px-4 py-4">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Logo" className="h-9 w-9 rounded-lg object-cover" />
              ) : (
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-lg font-bold text-white"
                  style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : DEFAULT_COLOR }}
                >
                  {initial}
                </div>
              )}
              <div>
                <div className="font-semibold text-ink">{displayName || "Your School"}</div>
                {tagline ? <div className="text-xs text-muted">{tagline}</div> : null}
              </div>
            </div>
            <div className="space-y-2 p-4">
              <div
                className="rounded-lg px-3 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : DEFAULT_COLOR }}
              >
                Primary button
              </div>
              <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">Navigation item</div>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            Your logo &amp; name now appear in the dashboard and parent/student portal. Tinting the full
            app with your primary colour is rolling out next.
          </p>
        </div>
      </div>
    </>
  );
}
