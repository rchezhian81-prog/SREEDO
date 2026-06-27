import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PortalChild, User } from "@/types";

interface PortalState {
  user: User | null;
  children: PortalChild[];
  selectedStudentId: string | null;
  setUser: (user: User | null) => void;
  setChildren: (children: PortalChild[]) => void;
  setSelected: (selectedStudentId: string | null) => void;
  reset: () => void;
}

export const usePortalStore = create<PortalState>()(
  persist(
    (set) => ({
      user: null,
      children: [],
      selectedStudentId: null,
      setUser: (user) => set({ user }),
      setChildren: (children) => set({ children }),
      setSelected: (selectedStudentId) => set({ selectedStudentId }),
      reset: () => set({ user: null, children: [], selectedStudentId: null }),
    }),
    {
      name: "sreedo-portal",
      // children are session-scoped; only persist identity + selection.
      partialize: (state) => ({
        user: state.user,
        selectedStudentId: state.selectedStudentId,
      }),
    }
  )
);
