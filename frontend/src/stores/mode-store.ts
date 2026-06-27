import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Campus mode — chosen on the pre-login selector screen and used to drive a
 * fully separate School vs College experience (distinct sidebar, theming and
 * copy). The choice is purely a presentation context; the authenticated user
 * still belongs to a single tenant on the backend.
 */
export type CampusMode = "school" | "college";

export const MODE_STORAGE_KEY = "sreedo-mode";

interface ModeState {
  mode: CampusMode;
  /** True once the user has explicitly picked a campus on the selector. */
  hasChosen: boolean;
  setMode: (mode: CampusMode) => void;
  reset: () => void;
}

export const useModeStore = create<ModeState>()(
  persist(
    (set) => ({
      mode: "school",
      hasChosen: false,
      setMode: (mode) => set({ mode, hasChosen: true }),
      reset: () => set({ mode: "school", hasChosen: false }),
    }),
    { name: MODE_STORAGE_KEY }
  )
);
