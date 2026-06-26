// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Capture router.push and stub the deps the page pulls in (i18n switcher, auth).
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));
vi.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => null,
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (sel: (s: { accessToken: string | null }) => unknown) =>
    sel({ accessToken: null }),
}));

import SelectCampusPage from "@/app/select/page";
import { useModeStore } from "@/stores/mode-store";

afterEach(cleanup);
beforeEach(() => {
  useModeStore.getState().reset();
  pushMock.mockClear();
});

describe("campus selector", () => {
  it("offers both campuses", () => {
    render(<SelectCampusPage />);
    expect(screen.getByRole("button", { name: /School/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /College/i })).toBeTruthy();
  });

  it("choosing College sets college mode and routes to login", () => {
    render(<SelectCampusPage />);
    fireEvent.click(screen.getByRole("button", { name: /College/i }));
    expect(useModeStore.getState().mode).toBe("college");
    expect(useModeStore.getState().hasChosen).toBe(true);
    expect(pushMock).toHaveBeenCalledWith("/login");
  });

  it("choosing School sets school mode and routes to login", () => {
    render(<SelectCampusPage />);
    fireEvent.click(screen.getByRole("button", { name: /School/i }));
    expect(useModeStore.getState().mode).toBe("school");
    expect(pushMock).toHaveBeenCalledWith("/login");
  });
});
