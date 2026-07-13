"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

// PR-SEC1 — the caller's own-class teaching scope, mirrored from the backend
// GET /teaching-scope. `unrestricted` means every section is visible (admins,
// broad-view staff, or the ENFORCE_TEACHER_SCOPE kill-switch is off); otherwise
// `sectionIds` is the exhaustive set of sections the teacher owns. Section
// dropdowns filter to this so a scoped teacher only picks their own classes;
// the backend independently enforces the same boundary, so the UI can fail open.

export interface TeachingScope {
  unrestricted: boolean;
  sectionIds: string[];
}

export interface TeachingScopeState extends TeachingScope {
  loading: boolean;
}

const UNRESTRICTED: TeachingScope = { unrestricted: true, sectionIds: [] };

export function useTeachingScope(): TeachingScopeState {
  const [scope, setScope] = useState<TeachingScope>(UNRESTRICTED);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .get<TeachingScope>("/teaching-scope")
      .then((result) => {
        if (alive) setScope(result);
      })
      // Fail open in the UI (the backend still enforces every write/read).
      .catch(() => {
        if (alive) setScope(UNRESTRICTED);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { ...scope, loading };
}

/** Narrow a list of `{ id }` section options to the owned set when scoped. */
export function filterToScope<T extends { id: string }>(
  options: T[],
  scope: TeachingScope
): T[] {
  if (scope.unrestricted) return options;
  const owned = new Set(scope.sectionIds);
  return options.filter((option) => owned.has(option.id));
}
