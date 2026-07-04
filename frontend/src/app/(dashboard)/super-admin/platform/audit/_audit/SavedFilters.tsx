"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  ConfirmDialog,
  ErrorNote,
  Field,
  Input,
  Modal,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import type { AuditSavedFilter } from "@/types";
import {
  compactFilters,
  toFilterState,
  type AuditFilterState,
} from "./taxonomy";

/**
 * Load / save / set-default / delete saved audit filters. A filter stores the
 * non-empty filter fields as a JSON bag; applying one seeds the console filters.
 * When a default exists it is auto-applied once on first mount (unless the user
 * arrived via a deep link, in which case `enableAutoDefault` is false).
 */
export function SavedFilters({
  currentFilters,
  onApply,
  enableAutoDefault,
}: {
  currentFilters: AuditFilterState;
  onApply: (filters: AuditFilterState) => void;
  enableAutoDefault: boolean;
}) {
  const [items, setItems] = useState<AuditSavedFilter[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [isShared, setIsShared] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<AuditSavedFilter | null>(null);
  const autoApplied = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await api.get<AuditSavedFilter[]>("/platform/audit/saved-filters");
      setItems(rows);
      if (enableAutoDefault && !autoApplied.current) {
        autoApplied.current = true;
        const def = rows.find((r) => r.isDefault);
        if (def) onApply(toFilterState(def.filters));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load saved filters");
    }
  }, [enableAutoDefault, onApply]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/platform/audit/saved-filters", {
        name: name.trim(),
        filters: compactFilters(currentFilters),
        isShared,
        isDefault,
      });
      setSaveOpen(false);
      setName("");
      setIsShared(false);
      setIsDefault(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save filter");
    } finally {
      setBusy(false);
    }
  };

  const toggleDefault = async (sf: AuditSavedFilter) => {
    setError(null);
    try {
      await api.patch(`/platform/audit/saved-filters/${sf.id}`, {
        isDefault: !sf.isDefault,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update filter");
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/platform/audit/saved-filters/${toDelete.id}`);
      setToDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete filter");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-slate-500">Saved views:</span>

      {items.length === 0 && (
        <span className="text-xs text-slate-400">none yet</span>
      )}

      {items.map((sf) => (
        <span
          key={sf.id}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white py-0.5 pl-2.5 pr-1 text-sm"
        >
          <button
            onClick={() => onApply(toFilterState(sf.filters))}
            className="font-medium text-slate-700 hover:text-brand-600"
            title="Apply this saved view"
          >
            {sf.name}
          </button>
          {sf.isShared && (
            <Icon name="users" className="h-3.5 w-3.5 text-slate-400" aria-label="shared" />
          )}
          {sf.isOwn && (
            <button
              onClick={() => toggleDefault(sf)}
              title={sf.isDefault ? "Unset default" : "Set as default"}
              className={sf.isDefault ? "text-amber-500" : "text-slate-300 hover:text-amber-500"}
            >
              <Icon name="star" className="h-3.5 w-3.5" />
            </button>
          )}
          {(sf.isOwn || sf.isShared) && (
            <button
              onClick={() => setToDelete(sf)}
              title="Delete saved view"
              className="rounded-full p-0.5 text-slate-300 hover:bg-slate-100 hover:text-red-500"
            >
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      ))}

      <Button variant="secondary" onClick={() => setSaveOpen(true)}>
        <Icon name="plus" className="h-4 w-4" />
        Save current
      </Button>

      {error && (
        <div className="w-full">
          <ErrorNote message={error} />
        </div>
      )}

      <Modal title="Save current filters" open={saveOpen} onClose={() => setSaveOpen(false)}>
        <div className="space-y-4">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Critical events, last 30 days"
              autoFocus
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
            />
            Share with all platform admins
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            Make this my default view
          </label>
          <p className="text-xs text-slate-400">
            Stores the currently-applied filter fields. It never captures audit data.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSaveOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || !name.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete saved view"
        message={
          <>
            Delete <span className="font-semibold">{toDelete?.name}</span>?
            {toDelete?.isShared && " This is shared with all platform admins."} This
            only removes the saved filter — it never affects audit history.
          </>
        }
        confirmLabel="Delete"
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  );
}
