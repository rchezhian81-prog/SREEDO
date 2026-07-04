"use client";

import { Badge, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { SupportScope } from "@/types";
import { moduleLabel, scopeLabel, scopeTone } from "./taxonomy";

const SCOPE_HINT: Record<string, string> = {
  read_only: "View-only. No writes of any kind.",
  write_enabled: "Full write access as the target user.",
  module_limited: "Writes limited to the selected modules only.",
};

/**
 * Scope picker for a new support session. Radios are rendered from the scopes
 * the backend advertises (`/templates`), never hardcoded; when `module_limited`
 * is chosen a checkbox grid of the advertised module keys appears and at least
 * one must be selected.
 */
export function ScopeSelector({
  scopes,
  modules,
  scope,
  selectedModules,
  onScopeChange,
  onModulesChange,
}: {
  scopes: string[];
  modules: string[];
  scope: SupportScope;
  selectedModules: string[];
  onScopeChange: (scope: SupportScope) => void;
  onModulesChange: (modules: string[]) => void;
}) {
  const toggleModule = (m: string) => {
    onModulesChange(
      selectedModules.includes(m)
        ? selectedModules.filter((x) => x !== m)
        : [...selectedModules, m]
    );
  };

  return (
    <div className="space-y-3">
      <span className="block text-sm font-medium text-ink">Access scope</span>
      <div className="grid gap-2 sm:grid-cols-3">
        {scopes.map((s) => {
          const active = scope === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onScopeChange(s as SupportScope)}
              aria-pressed={active}
              className={cx(
                "flex flex-col gap-1 rounded-xl border p-3 text-left transition",
                active
                  ? "border-brand-500 bg-brand-500/5 ring-2 ring-brand-500/30"
                  : "border-line bg-surface hover:bg-hover"
              )}
            >
              <span className="flex items-center justify-between">
                <Badge tone={scopeTone(s)}>{scopeLabel(s)}</Badge>
                {active && <Icon name="check" className="h-4 w-4 text-brand-600" />}
              </span>
              <span className="text-xs text-muted">{SCOPE_HINT[s] ?? ""}</span>
            </button>
          );
        })}
      </div>

      {scope === "module_limited" && (
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <p className="mb-2 text-xs font-medium text-muted">
            Select the modules this session may write to (at least one).
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {modules.map((m) => {
              const checked = selectedModules.includes(m);
              return (
                <label
                  key={m}
                  className={cx(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
                    checked
                      ? "border-brand-500 bg-brand-500/5 text-ink"
                      : "border-line bg-surface text-muted hover:bg-hover"
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
                    checked={checked}
                    onChange={() => toggleModule(m)}
                  />
                  {moduleLabel(m)}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
