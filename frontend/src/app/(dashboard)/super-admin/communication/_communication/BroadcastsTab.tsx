"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Select, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { Broadcast, BroadcastListResult } from "@/types";
import { formatNumber } from "../../platform/_utils";
import { BroadcastEditorModal } from "./BroadcastEditorModal";
import {
  BROADCAST_AUDIENCES,
  BROADCAST_STATUSES,
  audienceLabel,
  broadcastStatusTone,
  channelLabel,
  formatDateTime,
  titleCase,
} from "./taxonomy";

const PAGE_SIZE = 50;

interface Filters {
  q: string;
  status: string;
  audience: string;
}

const EMPTY_FILTERS: Filters = { q: "", status: "", audience: "" };

export function BroadcastsTab({ reloadKey, onChanged }: { reloadKey: number; onChanged: () => void }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BroadcastListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);

  // editorId: undefined = closed; null = create; string = edit that id.
  const [editorId, setEditorId] = useState<string | null | undefined>(undefined);

  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.q.trim()) p.set("q", filters.q.trim());
    if (filters.status) p.set("status", filters.status);
    if (filters.audience) p.set("audience", filters.audience);
    p.set("page", String(page));
    p.set("pageSize", String(PAGE_SIZE));
    return p.toString();
  }, [filters, page]);

  const filterKey = useMemo(
    () => `${filters.q.trim()}|${filters.status}|${filters.audience}`,
    [filters]
  );
  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<BroadcastListResult>(`/comm-admin/broadcasts?${query}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load broadcasts");
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
            placeholder="Search title…"
            aria-label="Search broadcasts"
          />
          <Select value={filters.status} onChange={(e) => patch({ status: e.target.value })} aria-label="Status">
            <option value="">All statuses</option>
            {BROADCAST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
          <Select value={filters.audience} onChange={(e) => patch({ audience: e.target.value })} aria-label="Audience">
            <option value="">All audiences</option>
            {BROADCAST_AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {audienceLabel(a)}
              </option>
            ))}
          </Select>
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
              Reset
            </Button>
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => setEditorId(null)}>
            <Icon name="plus" className="h-4 w-4" />
            New broadcast
          </Button>
        </div>
      </Card>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No broadcasts match these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Broadcast</th>
                  <th className="px-4 py-3">Audience</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Recipients</th>
                  <th className="px-4 py-3 text-right">Sent / failed</th>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((b) => (
                  <BroadcastRow key={b.id} b={b} onOpen={() => setEditorId(b.id)} />
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
            <Button variant="secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next
              <Icon name="chevronRight" className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      <BroadcastEditorModal
        id={editorId === undefined ? null : editorId}
        open={editorId !== undefined}
        onClose={() => setEditorId(undefined)}
        onChanged={() => {
          refresh();
          onChanged();
        }}
      />
    </section>
  );
}

function BroadcastRow({ b, onOpen }: { b: Broadcast; onOpen: () => void }) {
  const when = b.sentAt ?? b.scheduledAt ?? b.createdAt;
  return (
    <tr className="hover:bg-hover">
      <td className="px-4 py-3">
        <button onClick={onOpen} className="block max-w-[18rem] truncate text-left font-medium text-ink hover:text-brand-600" title={b.title}>
          {b.title}
        </button>
        <span className="block text-xs text-faint">{channelLabel(b.channel)}</span>
      </td>
      <td className="px-4 py-3 text-muted">{audienceLabel(b.audience)}</td>
      <td className="px-4 py-3">
        <Badge tone={broadcastStatusTone(b.status)}>{titleCase(b.status)}</Badge>
      </td>
      <td className="px-4 py-3 text-right text-muted">{formatNumber(b.recipientCount)}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
        {formatNumber(b.sentCount)}
        {" / "}
        <span className={b.failedCount > 0 ? "text-red-600" : "text-muted"}>{formatNumber(b.failedCount)}</span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-faint">{formatDateTime(when)}</td>
      <td className="px-4 py-3">
        <div className="flex justify-end">
          <Button variant="secondary" className="!px-2.5 !py-1.5" onClick={onOpen}>
            {b.status === "draft" ? "Edit" : "View"}
          </Button>
        </div>
      </td>
    </tr>
  );
}
