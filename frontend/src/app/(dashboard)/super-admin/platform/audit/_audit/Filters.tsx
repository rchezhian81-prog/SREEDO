"use client";

import { Button, Input, Select } from "@/components/ui";
import type { AuditCategoriesRef, PlatformInstitution } from "@/types";
import {
  hasActiveFilters,
  resultLabel,
  severityLabel,
  type AuditFilterState,
} from "./taxonomy";

/**
 * The full advanced-filter panel: free-text search plus every server-supported
 * filter (institution, category, severity, result, actor, action, target, IP,
 * date range). Category/severity/result options come from the taxonomy reference
 * so they can never drift from what the backend computes.
 */
export function Filters({
  filters,
  onChange,
  onReset,
  institutions,
  categoriesRef,
}: {
  filters: AuditFilterState;
  onChange: (patch: Partial<AuditFilterState>) => void;
  onReset: () => void;
  institutions: PlatformInstitution[];
  categoriesRef: AuditCategoriesRef | null;
}) {
  const severities = categoriesRef?.severities ?? [];
  const results = categoriesRef?.results ?? [];
  const categories = categoriesRef?.categories ?? [];

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <Input
        placeholder="Search action / actor / target / IP / institution…"
        value={filters.q}
        onChange={(e) => onChange({ q: e.target.value })}
        aria-label="Search audit events"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          value={filters.institutionId}
          onChange={(e) => onChange({ institutionId: e.target.value })}
          aria-label="Institution"
        >
          <option value="">All institutions</option>
          {institutions.map((inst) => (
            <option key={inst.id} value={inst.id}>
              {inst.name} ({inst.code})
            </option>
          ))}
        </Select>

        <Select
          value={filters.category}
          onChange={(e) => onChange({ category: e.target.value })}
          aria-label="Category"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>

        <Select
          value={filters.severity}
          onChange={(e) => onChange({ severity: e.target.value })}
          aria-label="Severity"
        >
          <option value="">All severities</option>
          {severities.map((s) => (
            <option key={s} value={s}>
              {severityLabel(s)}
            </option>
          ))}
        </Select>

        <Select
          value={filters.result}
          onChange={(e) => onChange({ result: e.target.value })}
          aria-label="Result"
        >
          <option value="">All results</option>
          {results.map((r) => (
            <option key={r} value={r}>
              {resultLabel(r)}
            </option>
          ))}
        </Select>

        <Input
          placeholder="Action e.g. institution.suspend"
          value={filters.action}
          onChange={(e) => onChange({ action: e.target.value })}
          aria-label="Action"
        />
        <Input
          placeholder="Actor role e.g. super_admin"
          value={filters.actorRole}
          onChange={(e) => onChange({ actorRole: e.target.value })}
          aria-label="Actor role"
        />
        <Input
          placeholder="Target type e.g. institution"
          value={filters.targetType}
          onChange={(e) => onChange({ targetType: e.target.value })}
          aria-label="Target type"
        />
        <Input
          placeholder="Target ID"
          value={filters.targetId}
          onChange={(e) => onChange({ targetId: e.target.value })}
          aria-label="Target ID"
        />
        <Input
          placeholder="IP address"
          value={filters.ip}
          onChange={(e) => onChange({ ip: e.target.value })}
          aria-label="IP address"
        />
        <Input
          placeholder="Actor ID (uuid)"
          value={filters.actorId}
          onChange={(e) => onChange({ actorId: e.target.value })}
          aria-label="Actor ID"
        />

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">From date</span>
          <Input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => onChange({ dateFrom: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">To date</span>
          <Input
            type="date"
            value={filters.dateTo}
            onChange={(e) => onChange({ dateTo: e.target.value })}
          />
        </label>
      </div>

      {hasActiveFilters(filters) && (
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onReset}>
            Clear all filters
          </Button>
        </div>
      )}
    </div>
  );
}
