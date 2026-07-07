"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Select, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { EmailTemplate, TemplateListResult } from "@/types";
import { formatNumber } from "../../platform/_utils";
import { TemplateEditorModal } from "./TemplateEditorModal";
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_STATUSES,
  templateStatusTone,
  titleCase,
} from "./taxonomy";

const PAGE_SIZE = 50;

interface Filters {
  q: string;
  category: string;
  status: string;
  builtin: string;
}

const EMPTY_FILTERS: Filters = { q: "", category: "", status: "", builtin: "" };

export function TemplatesTab({ reloadKey, onChanged }: { reloadKey: number; onChanged: () => void }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TemplateListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);

  // editorKey: undefined = closed; null = create; string = edit that key.
  const [editorKey, setEditorKey] = useState<string | null | undefined>(undefined);

  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.q.trim()) p.set("q", filters.q.trim());
    if (filters.category) p.set("category", filters.category);
    if (filters.status) p.set("status", filters.status);
    if (filters.builtin) p.set("builtin", filters.builtin);
    p.set("page", String(page));
    p.set("pageSize", String(PAGE_SIZE));
    return p.toString();
  }, [filters, page]);

  const filterKey = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.q.trim()) p.set("q", filters.q.trim());
    if (filters.category) p.set("category", filters.category);
    if (filters.status) p.set("status", filters.status);
    if (filters.builtin) p.set("builtin", filters.builtin);
    return p.toString();
  }, [filters]);
  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<TemplateListResult>(`/comm-admin/templates?${query}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey, localReload]);

  const refresh = () => setLocalReload((k) => k + 1);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="space-y-4">
      <Card className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            value={filters.q}
            onChange={(e) => patch({ q: e.target.value })}
            placeholder="Search key, name, subject…"
            aria-label="Search templates"
          />
          <Select value={filters.category} onChange={(e) => patch({ category: e.target.value })} aria-label="Category">
            <option value="">All categories</option>
            {TEMPLATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {titleCase(c)}
              </option>
            ))}
          </Select>
          <Select value={filters.status} onChange={(e) => patch({ status: e.target.value })} aria-label="Status">
            <option value="">All statuses</option>
            {TEMPLATE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
          <Select value={filters.builtin} onChange={(e) => patch({ builtin: e.target.value })} aria-label="Origin">
            <option value="">Built-in &amp; custom</option>
            <option value="true">Built-in only</option>
            <option value="false">Custom only</option>
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
            Reset
          </Button>
          <Button onClick={() => setEditorKey(null)}>
            <Icon name="plus" className="h-4 w-4" />
            New template
          </Button>
        </div>
      </Card>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No templates match these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Template</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Version</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((t) => (
                  <TemplateRow key={t.key} t={t} onOpen={() => setEditorKey(t.key)} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 text-sm text-muted">
            <span>
              Page {page} of {totalPages} · {formatNumber(total)} total
            </span>
            <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <Icon name="chevronLeft" className="h-4 w-4" />
              Prev
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
              <Icon name="chevronRight" className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      <TemplateEditorModal
        templateKey={editorKey === undefined ? null : editorKey}
        open={editorKey !== undefined}
        onClose={() => setEditorKey(undefined)}
        onChanged={() => {
          refresh();
          onChanged();
        }}
      />
    </section>
  );
}

function TemplateRow({ t, onOpen }: { t: EmailTemplate; onOpen: () => void }) {
  return (
    <tr className="hover:bg-hover">
      <td className="px-4 py-3">
        <button onClick={onOpen} className="block text-left font-medium text-ink hover:text-brand-600">
          {t.name}
        </button>
        <span className="block font-mono text-xs text-faint">{t.key}</span>
      </td>
      <td className="px-4 py-3 text-muted">{titleCase(t.category)}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={templateStatusTone(t.status)}>{titleCase(t.status)}</Badge>
          {t.isBuiltin && <Badge tone="blue">Built-in</Badge>}
        </div>
      </td>
      <td className="px-4 py-3 text-right text-muted">v{t.version}</td>
      <td className="px-4 py-3">
        <div className="flex justify-end">
          <Button variant="secondary" className="!px-2.5 !py-1.5" onClick={onOpen}>
            Edit
          </Button>
        </div>
      </td>
    </tr>
  );
}
