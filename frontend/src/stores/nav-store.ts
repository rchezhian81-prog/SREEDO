import { create } from "zustand";
import { persist } from "zustand/middleware";

// PR-PX2 — pinned + recent nav items, persisted locally per USER id so pins
// never leak between accounts on a shared browser. No backend involved.

export const MAX_PINS = 8;
export const MAX_RECENTS = 5;

/** Toggle href in a pin list; adding beyond MAX_PINS is a no-op. */
export function togglePinList(pins: string[], href: string): string[] {
  if (pins.includes(href)) return pins.filter((p) => p !== href);
  if (pins.length >= MAX_PINS) return pins;
  return [...pins, href];
}

/** Most-recent-first, deduplicated, capped at MAX_RECENTS. */
export function pushRecentList(recents: string[], href: string): string[] {
  return [href, ...recents.filter((r) => r !== href)].slice(0, MAX_RECENTS);
}

type NavPrefs = { pins: string[]; recents: string[] };

interface NavState {
  byUser: Record<string, NavPrefs>;
  togglePin: (userId: string, href: string) => void;
  pushRecent: (userId: string, href: string) => void;
}

const EMPTY: NavPrefs = { pins: [], recents: [] };

export const useNavStore = create<NavState>()(
  persist(
    (set) => ({
      byUser: {},
      togglePin: (userId, href) =>
        set((s) => {
          const prefs = s.byUser[userId] ?? EMPTY;
          return { byUser: { ...s.byUser, [userId]: { ...prefs, pins: togglePinList(prefs.pins, href) } } };
        }),
      pushRecent: (userId, href) =>
        set((s) => {
          const prefs = s.byUser[userId] ?? EMPTY;
          if (prefs.recents[0] === href) return s; // no churn on repeat visits
          return { byUser: { ...s.byUser, [userId]: { ...prefs, recents: pushRecentList(prefs.recents, href) } } };
        }),
    }),
    { name: "sreedo-nav" }
  )
);
