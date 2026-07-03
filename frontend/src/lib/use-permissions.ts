"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface PermissionsState {
  role: string;
  permissions: string[];
  loading: boolean;
  /**
   * True when the caller holds `key`. Relies purely on the effective
   * permissions from `GET /auth/permissions` (owners receive every key). A
   * missing key always passes (ungated); while permissions are still loading we
   * allow, so nothing flickers/hides before settling.
   */
  can: (key?: string) => boolean;
}

/**
 * Fetches `GET /auth/permissions` once and exposes a `can(key)` gate against the
 * caller's EFFECTIVE permissions. Platform owners receive every permission, so
 * they still see everything; non-owner platform sub-roles are correctly limited.
 */
export function usePermissions(): PermissionsState {
  const [role, setRole] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .get<{ role: string; permissions: string[] }>("/auth/permissions")
      .then((data) => {
        if (!active) return;
        setRole(data.role);
        setPermissions(data.permissions);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const can = (key?: string) => {
    if (!key) return true;
    // Avoid a blank flash while the effective permissions are still loading.
    if (loading) return true;
    return permissions.includes(key);
  };

  return { role, permissions, loading, can };
}
