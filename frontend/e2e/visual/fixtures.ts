import type { Page } from "@playwright/test";

/**
 * Fixed, non-personal session + API stubs so the staff shell renders identically
 * on every run and inside CI. NO production or real personal data appears here —
 * the "person" is an obviously-synthetic demo staff account, and every endpoint
 * the shell touches returns a stable, hard-coded shape.
 */

const USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "demo.staff@example.test",
  fullName: "Demo Staff",
  role: "admin",
  institutionId: "00000000-0000-0000-0000-0000000000aa",
  institutionName: "Demo Academy",
  institutionType: "school",
};

// A fixed permission + module set → a deterministic, populated sidebar.
const PERMISSIONS = [
  "students:read", "fees:read", "attendance:read", "exams:read", "staff:read",
  "timetable:read", "communication:read", "reports:read", "transport:read",
  "library:read", "hostel:read", "settings:read", "academics:read", "admissions:read",
];
const ENABLED_MODULES = [
  "students", "fees", "attendance", "exams", "staff", "timetable", "communication",
  "reports", "transport", "library", "hostel", "academics", "admissions",
];

/** Seed the persisted auth session + an explicit saved theme before any app JS. */
export async function seedSession(page: Page, opts: { dark: boolean }) {
  await page.addInitScript(
    ([user, dark]) => {
      localStorage.setItem(
        "sreedo-auth",
        JSON.stringify({
          state: {
            user,
            accessToken: "visual-fixture-token",
            refreshToken: "visual-fixture-refresh",
            support: null,
          },
          version: 0,
        })
      );
      // Explicit choice so the eligible-session light default respects it and the
      // dark screenshot is stable.
      localStorage.setItem("gocampus-theme", dark ? "dark" : "light");
    },
    [USER, opts.dark] as const
  );
}

/** Stub every shell/page API call. `uiV2` drives the audited tenant flag only. */
export async function installShellMocks(page: Page, opts: { uiV2: boolean }) {
  await page.route("**/api/v1/**", async (route) => {
    const url = route.request().url();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    if (url.includes("/auth/me"))
      return json({
        id: USER.id,
        email: USER.email,
        fullName: USER.fullName,
        role: USER.role,
        institutionId: USER.institutionId,
        institutionName: USER.institutionName,
        institutionType: USER.institutionType,
        enabledModules: ENABLED_MODULES,
        twoFactorEnabled: false,
        uiV2Enabled: opts.uiV2,
      });
    if (url.includes("/auth/permissions")) return json({ role: USER.role, permissions: PERMISSIONS });
    if (url.includes("/branding"))
      return json({ displayName: "Demo Academy", logoUrl: null, primaryColor: null, tagline: "Excellence in Education" });
    if (url.includes("/academic-years")) return json([{ id: "yr1", name: "2026-27", isCurrent: true }]);
    if (url.includes("/communication/inbox/unread-count")) return json({ count: 0 });
    if (url.includes("/dashboard/summary")) return json({ needsAttention: [] });
    if (url.includes("/search")) return json({ results: [] });
    // Everything else is a page-content call (the content area is masked). Abort
    // it so the masked page never competes with the shell's own requests — this
    // keeps the skin resolve deterministic and off the render-gate timeout.
    return route.abort();
  });
}
