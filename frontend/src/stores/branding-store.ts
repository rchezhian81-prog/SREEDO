import { create } from "zustand";

export interface Branding {
  displayName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  tagline: string | null;
}

interface BrandingState {
  branding: Branding | null;
  setBranding: (b: Branding) => void;
}

/**
 * Holds the current institution's white-label branding (logo, name, tagline).
 * Populated by the dashboard / portal shells on load. Identity branding (logo +
 * name) is applied in the sidebars; runtime colour theming is a deliberate
 * follow-up (the `brand` palette must first be consolidated onto CSS variables).
 */
export const useBrandingStore = create<BrandingState>((set) => ({
  branding: null,
  setBranding: (b) => {
    if (typeof document !== "undefined" && b.displayName) {
      document.title = b.displayName;
    }
    set({ branding: b });
  },
}));
