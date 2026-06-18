"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface PermissionsState {
  role: string;
  permissions: string[];
  loading: boolean;
  /** True for super_admin (sees everything) or when the key is granted. */
  can: (key: string) => boolean;
}

/**
 * Fetches `GET /auth/permissions` once and exposes a `can(key)` gate.
 * super_admin is treated as having every permission.
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

  const can = (key: string) =>
    role === "super_admin" || permissions.includes(key);

  return { role, permissions, loading, can };
}
