import { create } from "zustand";
import { UI_V2_CLASS } from "@/lib/ui-flag";
import { THEME_STORAGE_KEY } from "@/stores/theme-store";

/**
 * PR-UI2 — the modern-skin runtime engine.
 *
 * The `.ui-v2` token scope (shipped dormant in PR-UI1) is applied to <html> at
 * runtime ONLY when BOTH gates pass:
 *   1. the build-time master switch `NEXT_PUBLIC_UI_V2` (read via
 *      isModernSkinRequested), and
 *   2. the authenticated tenant's server-derived `uiV2Enabled` flag, resolved
 *      from the AUDITED platform_feature_flags registry and exposed on /auth/me.
 *
 * This store owns the single DOM side-effect (toggling the scope class) plus a
 * one-shot `resolved` latch. The dashboard holds a spinner until `resolved`
 * flips, so the first paint is already the correct skin — there is no
 * legacy↔modern flash.
 *
 * Failure-safe by construction: any error, timeout, missing tenant, or
 * super-admin session (no tenant) resolves to LEGACY (scope class absent) and
 * the app renders exactly as it does today. Nothing here runs at all while the
 * master switch is off — the caller short-circuits before touching this module.
 */

/** Toggle the dormant token-scope class on <html>. SSR-safe no-op. */
function setSkinClass(on: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(UI_V2_CLASS, on);
}

/**
 * Modern-eligible sessions open in LIGHT — but only when the user has made no
 * explicit theme choice yet. We READ (never write) the theme store's key; if
 * there is no saved "light"/"dark", we drop the boot script's `.dark` so the
 * modern skin opens light. An explicit saved choice is always respected, and a
 * later toggle still wins (this writes no storage). Because it runs only when the
 * modern skin is actually applied, legacy / off-flag light↔dark resolution is
 * never touched.
 */
function applyEligibleLightDefault(): void {
  if (typeof document === "undefined") return;
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode) — fall through to the light default */
  }
  if (saved === "light" || saved === "dark") return; // respect an explicit choice
  document.documentElement.classList.remove("dark");
}

interface SkinState {
  /** True once the skin decision (apply or legacy) is final for this session. */
  resolved: boolean;
  /** True while the modern `.ui-v2` scope class is applied to <html>. */
  active: boolean;
  /** Apply (on=true) or clear (on=false) the modern scope; latch `resolved`. */
  apply: (on: boolean) => void;
  /** Resolve to legacy (scope class cleared); latch `resolved`. */
  resolveLegacy: () => void;
}

export const useSkinStore = create<SkinState>((set) => ({
  resolved: false,
  active: false,
  apply: (on) => {
    setSkinClass(on);
    if (on) applyEligibleLightDefault();
    set({ active: on, resolved: true });
  },
  resolveLegacy: () => {
    setSkinClass(false);
    set({ active: false, resolved: true });
  },
}));

/**
 * Orchestrate the per-session skin decision.
 *
 * Starts a timeout that falls back to legacy if the tenant lookup stalls (the
 * render gate must never hang), then awaits the caller-supplied tenant lookup and
 * applies its result. The FIRST of {timeout, success, failure} to settle wins;
 * any later outcome is ignored, so a session that has already fallen back to
 * legacy is never re-skinned mid-flight (which would be exactly the flash the
 * render gate exists to prevent).
 *
 * `fetchTenantEnabled` is injected so this is trivially unit-testable and so the
 * resolver stays UI-only — the tenant boolean comes from the authenticated
 * /auth/me contract, never from client-supplied input.
 */
export async function resolveSkin(opts: {
  fetchTenantEnabled: () => Promise<boolean>;
  timeoutMs?: number;
}): Promise<void> {
  const { fetchTenantEnabled, timeoutMs = 4000 } = opts;
  const store = useSkinStore.getState();
  let settled = false;
  const settleLegacyOnce = () => {
    if (settled) return;
    settled = true;
    store.resolveLegacy();
  };
  const timer = setTimeout(settleLegacyOnce, timeoutMs);
  try {
    const enabled = await fetchTenantEnabled();
    if (settled) return; // timeout already fell back to legacy — keep it stable
    settled = true;
    clearTimeout(timer);
    store.apply(enabled);
  } catch {
    clearTimeout(timer);
    settleLegacyOnce();
  }
}
