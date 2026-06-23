import { create } from "zustand";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "gocampus-theme";

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* storage may be unavailable (private mode) — theme still applies in-memory */
  }
}

interface ThemeState {
  theme: Theme;
  /** Sync the store with whatever the no-flash boot script already applied. */
  hydrate: () => void;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: "light",
  hydrate: () => {
    if (typeof document === "undefined") return;
    set({
      theme: document.documentElement.classList.contains("dark")
        ? "dark"
        : "light",
    });
  },
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  toggle: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    applyTheme(next);
    set({ theme: next });
  },
}));
