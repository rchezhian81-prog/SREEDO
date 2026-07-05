"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AdminInstitutionBrief } from "@/types";

/**
 * Load the institution list for the tenant selectors. Degrades to an empty list
 * on error (the selectors stay usable — a tenant is optional for most scopes and
 * only some scopes/actions require one). `enabled` defers the fetch (e.g. until a
 * modal opens) to avoid loading it for tabs that never need it.
 */
export function useInstitutions(enabled = true): AdminInstitutionBrief[] {
  const [rows, setRows] = useState<AdminInstitutionBrief[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api
      .get<AdminInstitutionBrief[]>("/admin/institutions")
      .then((r) => {
        if (live) setRows(r);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [enabled]);
  return rows;
}
