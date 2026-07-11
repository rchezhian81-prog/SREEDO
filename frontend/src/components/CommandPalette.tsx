"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { cx } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import type { NavItem } from "@/lib/nav";

// PR-PX2 — ⌘K command palette. Navigation only: every row is a deep-link into
// an existing, already-permission-filtered page (the caller passes the SAME
// filtered registry the sidebar renders), plus tenant-scoped people results
// from the existing staff-only /search endpoint. Nothing here executes an
// action — Enter always just navigates.

type PersonHit = { type: string; id: string; label: string; sub: string | null; href: string };

type Row = { key: string; icon: IconName; label: string; sub?: string; href: string };
type Section = { title: string; rows: Row[] };

const PERSON_ICON: Record<string, IconName> = {
  student: "cap",
  staff: "board",
  class: "school",
  program: "layers",
};

const toRow = (prefix: string) => (i: NavItem): Row => ({
  key: `${prefix}:${i.href}`,
  icon: i.icon,
  label: i.label,
  href: i.href,
});

export function CommandPalette({
  open,
  onClose,
  pages,
  actions,
  pinned,
  recents,
}: {
  open: boolean;
  onClose: () => void;
  /** Filtered + terminology-resolved nav items (exactly what the sidebar shows). */
  pages: NavItem[];
  /** Filtered quick-action deep-links. */
  actions: NavItem[];
  pinned: NavItem[];
  recents: NavItem[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(0);
  const [people, setPeople] = useState<PersonHit[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  // 403 = the caller's role can't use /search — hide the section entirely
  // rather than pretending; the palette stays permission-truthful.
  const [peopleDenied, setPeopleDenied] = useState(false);

  useEffect(() => {
    if (open) {
      setQ("");
      setSelected(0);
      setPeople([]);
      setPeopleError(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    const query = q.trim();
    if (!open || peopleDenied || query.length < 2) {
      setPeople([]);
      setPeopleLoading(false);
      setPeopleError(null);
      return;
    }
    setPeopleLoading(true);
    const handle = setTimeout(() => {
      api
        .get<{ results: PersonHit[] }>(`/search?q=${encodeURIComponent(query)}`)
        .then((r) => {
          setPeople(r.results.slice(0, 6));
          setPeopleError(null);
        })
        .catch((err) => {
          setPeople([]);
          if (err instanceof ApiError && err.status === 403) setPeopleDenied(true);
          else setPeopleError("People search failed");
        })
        .finally(() => setPeopleLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [q, open, peopleDenied]);

  const sections: Section[] = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (query === "") {
      const pinnedRows = pinned.map(toRow("pin"));
      const pinnedHrefs = new Set(pinned.map((i) => i.href));
      const recentRows = recents.filter((i) => !pinnedHrefs.has(i.href)).map(toRow("rec"));
      return [
        { title: "Pinned", rows: pinnedRows },
        { title: "Recent", rows: recentRows },
        { title: "Quick actions", rows: actions.map(toRow("act")) },
      ].filter((s) => s.rows.length > 0);
    }
    const match = (label: string) => label.toLowerCase().includes(query);
    return [
      { title: "Pages", rows: pages.filter((i) => match(i.label)).slice(0, 8).map(toRow("page")) },
      { title: "Quick actions", rows: actions.filter((i) => match(i.label)).slice(0, 4).map(toRow("act")) },
      {
        title: "People & records",
        rows: people.map((p) => ({
          key: `person:${p.type}-${p.id}`,
          icon: PERSON_ICON[p.type] ?? "search",
          label: p.label,
          sub: p.sub ?? undefined,
          href: p.href,
        })),
      },
    ].filter((s) => s.rows.length > 0);
  }, [q, pages, actions, pinned, recents, people]);

  const flatRows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  useEffect(() => {
    if (selected >= flatRows.length) setSelected(Math.max(0, flatRows.length - 1));
  }, [flatRows.length, selected]);

  if (!open) return null;

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, Math.max(0, flatRows.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter" && flatRows[selected]) {
      e.preventDefault();
      go(flatRows[selected].href);
    }
  };

  const busy = peopleLoading && q.trim().length >= 2;
  let rowIndex = -1;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" onClick={onClose} />
      <div
        className="absolute left-1/2 top-[12%] w-[min(92vw,620px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Icon name="search" className="h-[17px] w-[17px] shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSelected(0);
            }}
            className="h-12 w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
            placeholder="Go to a page, find a person, or start a task…"
            aria-label="Command palette search"
          />
          <kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-faint">
            esc
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-1.5">
          {flatRows.length === 0 && !busy ? (
            <div className="px-4 py-6 text-center text-sm text-muted">
              {q.trim() === ""
                ? "Nothing pinned or recent yet — start typing to search pages and people."
                : `No matches for “${q.trim()}”.`}
            </div>
          ) : (
            sections.map((section) => (
              <div key={section.title} className="mb-1">
                <div className="px-4 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-faint">
                  {section.title}
                </div>
                {section.rows.map((row) => {
                  rowIndex += 1;
                  const idx = rowIndex;
                  return (
                    <button
                      key={row.key}
                      onClick={() => go(row.href)}
                      onMouseEnter={() => setSelected(idx)}
                      className={cx(
                        "flex w-full items-center gap-3 px-4 py-2.5 text-left transition",
                        idx === selected ? "bg-hover" : "hover:bg-hover"
                      )}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-500/12 text-brand-600 dark:text-brand-300">
                        <Icon name={row.icon} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink">{row.label}</span>
                        {row.sub && <span className="block truncate text-xs text-muted">{row.sub}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
          {busy && <div className="px-4 py-2 text-sm text-muted">Searching people…</div>}
          {peopleError && <div className="px-4 py-2 text-sm text-muted">{peopleError}</div>}
        </div>

        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-faint">
          <span><kbd className="font-bold">↑↓</kbd> navigate</span>
          <span><kbd className="font-bold">↵</kbd> open</span>
          <span className="ml-auto">Navigation only — nothing runs from here</span>
        </div>
      </div>
    </div>
  );
}
