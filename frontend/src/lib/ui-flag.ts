/**
 * PR-UI1 — reserved build-time flag for the modern GoCampus token skin.
 *
 * This helper ONLY reads the environment variable and reports whether the modern
 * skin has been requested. It deliberately does NOT touch the DOM, add any
 * class, or switch themes — activation (the theme engine + the token-scope class)
 * is a later, separate PR. With the variable unset (the default), it returns
 * `false` and absolutely nothing changes: the token scope stays dormant.
 *
 * The name is documented here so it is stable across the codebase. Keep it OFF
 * (unset, or anything other than "true") in every environment until the
 * theme-engine PR ships.
 */

/** The reserved env var name (documented; not yet wired to any runtime toggle). */
export const MODERN_SKIN_ENV = "NEXT_PUBLIC_UI_V2";

/**
 * True only when `NEXT_PUBLIC_UI_V2` is exactly the string "true". Defaults to
 * `false`. Reserved for the future theme engine — no caller activates the skin
 * from this value in PR-UI1.
 */
export function isModernSkinRequested(): boolean {
  return process.env.NEXT_PUBLIC_UI_V2 === "true";
}
