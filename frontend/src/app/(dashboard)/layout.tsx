"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { cx, Spinner, SkipLink } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { useThemeStore } from "@/stores/theme-store";
import { useI18n } from "@/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  adminOnly?: boolean;
};

const SCHOOL_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "grid" },
  { href: "/students", label: "Students", icon: "cap" },
  { href: "/admissions", label: "Admissions", icon: "card", adminOnly: true },
  { href: "/teachers", label: "Teachers", icon: "board" },
  { href: "/classes", label: "Classes", icon: "school" },
  { href: "/timetable", label: "Timetable", icon: "calendar" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/college", label: "College", icon: "building" },
  { href: "/library", label: "Library", icon: "file" },
  { href: "/transport", label: "Transport", icon: "bus" },
  { href: "/hostel", label: "Hostel", icon: "building" },
  { href: "/inventory", label: "Inventory", icon: "package" },
  { href: "/staff", label: "Staff Attendance", icon: "briefcase" },
  { href: "/front-office", label: "Front Office", icon: "help", adminOnly: true },
  { href: "/infirmary", label: "Infirmary", icon: "file", adminOnly: true },
  { href: "/alumni", label: "Alumni", icon: "users", adminOnly: true },
  { href: "/cafeteria", label: "Cafeteria", icon: "grid", adminOnly: true },
  { href: "/leave", label: "Leave", icon: "calcheck" },
  { href: "/payroll", label: "Payroll", icon: "wallet" },
  { href: "/attendance", label: "Attendance", icon: "calcheck" },
  { href: "/exams", label: "Exams", icon: "file" },
  { href: "/reports", label: "Reports", icon: "barChart" },
  { href: "/documents", label: "Documents", icon: "file" },
  { href: "/homework", label: "Homework", icon: "board" },
  { href: "/study-materials", label: "Study Materials", icon: "file" },
  { href: "/quizzes", label: "Quizzes", icon: "board" },
  { href: "/biometric", label: "Biometric", icon: "shield", adminOnly: true },
  { href: "/id-cards", label: "ID Cards", icon: "card" },
  { href: "/transfer-certificates", label: "Transfer Certificates", icon: "file" },
  { href: "/reports-center", label: "Reports Center", icon: "barChart" },
  { href: "/report-builder", label: "Report Builder", icon: "barChart" },
  { href: "/scheduled-reports", label: "Scheduled Reports", icon: "calendar" },
  { href: "/disciplinary", label: "Disciplinary", icon: "shield" },
  { href: "/fees", label: "Fees", icon: "card" },
  { href: "/fees/setup", label: "Fee Setup", icon: "gear" },
  { href: "/online-payments", label: "Online Payments", icon: "wallet" },
  { href: "/accounting", label: "Accounting", icon: "wallet", adminOnly: true },
  { href: "/announcements", label: "Announcements", icon: "megaphone" },
  { href: "/communication", label: "Communication", icon: "mail" },
  { href: "/messaging", label: "Messaging", icon: "message" },
  { href: "/feedback", label: "Feedback", icon: "message", adminOnly: true },
  { href: "/assistant", label: "AI Assistant", icon: "sparkles" },
  { href: "/ai-insights", label: "AI Insights", icon: "trendUp" },
  { href: "/jobs", label: "Jobs", icon: "gear", adminOnly: true },
  { href: "/users", label: "Users", icon: "users", adminOnly: true },
  { href: "/activity", label: "Activity Log", icon: "file", adminOnly: true },
  { href: "/security", label: "Security", icon: "shield" },
];

const SUPER_ADMIN_NAV: NavItem[] = [
  { href: "/super-admin", label: "Institutions", icon: "building" },
  { href: "/super-admin/platform", label: "Platform Overview", icon: "grid" },
  { href: "/super-admin/platform/institutions", label: "Tenants", icon: "building" },
  { href: "/super-admin/platform/audit", label: "Platform Audit", icon: "file" },
  { href: "/super-admin/platform/support", label: "Support Access", icon: "help" },
  { href: "/super-admin/rbac", label: "Roles & Permissions", icon: "shield" },
  { href: "/super-admin/packages", label: "Packages", icon: "package" },
  { href: "/super-admin/settings", label: "Settings", icon: "gear" },
  { href: "/super-admin/audit-logs", label: "Audit Logs", icon: "file" },
  { href: "/super-admin/exports", label: "Data Exports", icon: "package" },
  { href: "/super-admin/health", label: "System Health", icon: "alert" },
  { href: "/super-admin/observability", label: "Observability", icon: "barChart" },
  { href: "/super-admin/backups", label: "Backups", icon: "shield" },
  { href: "/super-admin/jobs", label: "Jobs", icon: "gear" },
  { href: "/security", label: "Security", icon: "shield" },
];

const SIDEBAR_BG =
  "linear-gradient(193deg,#1c3380 0%,#122257 55%,#0b1840 100%)";

function isActive(href: string, pathname: string) {
  return href === "/super-admin"
    ? pathname === href
    : pathname.startsWith(href);
}

function SidebarContent({
  navItems,
  pathname,
  subtitle,
  onNavigate,
}: {
  navItems: NavItem[];
  pathname: string;
  subtitle: string;
  onNavigate?: () => void;
}) {
  return (
    <div
      className="flex h-full flex-col px-3 pb-4 text-[#a8b6dc]"
      style={{ background: SIDEBAR_BG }}
    >
      <div className="mb-2 flex h-[72px] items-center gap-3 border-b border-white/10 px-1.5">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#4f8cff] to-[#1e40af] text-white shadow-[0_6px_16px_rgb(37_99_235_/_0.45)]">
          <Icon name="cap" className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <div className="text-[18px] font-extrabold leading-tight tracking-tight text-white">
            Go<span className="text-[#9ec1ff]">Campus</span>
          </div>
          <div className="truncate text-[10px] font-bold tracking-wide text-[#6e7fb0]">
            {subtitle}
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto py-1">
        {navItems.map((item) => {
          const active = isActive(item.href, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cx(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                active
                  ? "bg-gradient-to-r from-[#3070f7] to-[#2563eb] text-white shadow-[0_8px_18px_rgb(37_99_235_/_0.4)]"
                  : "text-[#a8b6dc] hover:bg-white/10 hover:text-white"
              )}
            >
              <Icon name={item.icon} className="h-[19px] w-[19px] shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#4f8cff]/20 text-[#9ec1ff]">
          <Icon name="calendar" className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-bold tracking-wide text-[#6e7fb0]">
            CURRENT SESSION
          </div>
          <div className="text-[13.5px] font-bold text-white">2026 – 2027</div>
        </div>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { theme, hydrate, toggle } = useThemeStore();
  useEffect(() => hydrate(), [hydrate]);
  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-surface text-muted transition hover:bg-hover hover:text-ink"
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} className="h-5 w-5" />
    </button>
  );
}

function Topbar({
  user,
  onMenu,
  onLogout,
}: {
  user: { fullName?: string; email?: string; role?: string } | null;
  onMenu: () => void;
  onLogout: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const initial = (user?.fullName?.[0] ?? "U").toUpperCase();
  const role = user?.role?.replace("_", " ");

  return (
    <header className="sticky top-0 z-30 flex h-[72px] items-center gap-3 border-b border-line bg-surface px-4 md:px-6">
      <button
        onClick={onMenu}
        aria-label="Open menu"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-hover md:hidden"
      >
        <Icon name="menu" className="h-[21px] w-[21px]" />
      </button>

      <div className="flex h-11 max-w-[460px] flex-1 items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-4 text-muted">
        <Icon name="search" className="h-[17px] w-[17px] shrink-0" />
        <input
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
          placeholder="Search student, admission no., mobile no…"
        />
      </div>

      <button className="ml-auto hidden h-11 shrink-0 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-bold text-ink transition hover:bg-hover sm:flex">
        <Icon name="calendar" className="h-[17px] w-[17px] text-brand-600" />
        2026 – 2027
        <Icon name="chevronDown" className="h-3.5 w-3.5 text-muted" />
      </button>

      <button
        aria-label="Notifications"
        className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-surface text-muted transition hover:bg-hover hover:text-ink"
      >
        <Icon name="bell" className="h-5 w-5" />
        <span className="absolute -right-1.5 -top-1.5 grid h-[19px] min-w-[19px] place-items-center rounded-full border-2 border-surface bg-red-500 px-1 text-[10.5px] font-extrabold text-white">
          5
        </span>
      </button>
      <button
        aria-label="Messages"
        className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-surface text-muted transition hover:bg-hover hover:text-ink"
      >
        <Icon name="message" className="h-5 w-5" />
        <span className="absolute -right-1.5 -top-1.5 grid h-[19px] min-w-[19px] place-items-center rounded-full border-2 border-surface bg-red-500 px-1 text-[10.5px] font-extrabold text-white">
          3
        </span>
      </button>

      <LanguageSwitcher />
      <ThemeToggle />

      <div className="relative shrink-0">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="flex h-11 items-center gap-2.5 rounded-xl pl-1 pr-1.5 transition hover:bg-hover"
        >
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#4f8cff] to-[#1e40af] text-sm font-extrabold text-white">
            {initial}
          </div>
          <div className="hidden text-left leading-tight lg:block">
            <div className="text-[13.5px] font-extrabold text-ink">
              {user?.fullName ?? "User"}
            </div>
            <div className="flex items-center gap-1 text-[11.5px] capitalize text-muted">
              {role}
              <Icon name="chevronDown" className="h-3 w-3" />
            </div>
          </div>
        </button>

        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-60 overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
              <div className="border-b border-line px-4 py-3">
                <div className="truncate text-sm font-bold text-ink">
                  {user?.fullName ?? "User"}
                </div>
                {user?.email && (
                  <div className="truncate text-xs text-muted">
                    {user.email}
                  </div>
                )}
                {role && (
                  <div className="mt-1 inline-flex rounded-full bg-brand-500/12 px-2 py-0.5 text-[11px] font-semibold capitalize text-brand-600 dark:text-brand-300">
                    {role}
                  </div>
                )}
              </div>
              <button
                onClick={onLogout}
                className="flex w-full items-center gap-2.5 px-4 py-3 text-sm font-semibold text-red-600 transition hover:bg-hover dark:text-red-400"
              >
                <Icon name="logout" className="h-[18px] w-[18px]" />
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
  const { user, accessToken, refreshToken, logout } = useAuthStore();
  const [hydrated, setHydrated] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    if (!hydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    // Students and parents belong to the cookie-based portal, not the staff
    // dashboard — send them there.
    if (user?.role === "student" || user?.role === "parent") {
      router.replace("/portal/login");
      return;
    }
    // Super admins live in the /super-admin console; everyone else in the
    // school dashboard. Keep each role on its own side.
    const inSuperArea = pathname.startsWith("/super-admin");
    if (user?.role === "super_admin" && !inSuperArea) {
      router.replace("/super-admin");
    } else if (user && user.role !== "super_admin" && inSuperArea) {
      router.replace("/dashboard");
    }
  }, [hydrated, accessToken, user, pathname, router]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setSidebarOpen(false), [pathname]);

  const isSuper = user?.role === "super_admin";
  const inSuperArea = pathname.startsWith("/super-admin");
  const navItems = isSuper
    ? SUPER_ADMIN_NAV
    : SCHOOL_NAV.filter((item) => !item.adminOnly || user?.role === "admin");

  // While unauthenticated or mid-redirect to the correct area, show a spinner.
  if (!hydrated || !accessToken) return <Spinner />;
  if (isSuper !== inSuperArea) return <Spinner />;

  const handleLogout = async () => {
    if (refreshToken) {
      await api.post("/auth/logout", { refreshToken }).catch(() => undefined);
    }
    logout();
    router.replace("/login");
  };

  const subtitle = isSuper ? "PLATFORM CONSOLE" : "SCHOOL MANAGEMENT ERP";

  return (
    <div className="flex min-h-screen bg-app">
      <SkipLink label={t("a11y.skipToContent")} />
      {/* Desktop sidebar */}
      <aside className="hidden w-[258px] shrink-0 md:block">
        <div className="sticky top-0 h-screen">
          <SidebarContent
            navItems={navItems}
            pathname={pathname}
            subtitle={subtitle}
          />
        </div>
      </aside>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-[258px] shadow-pop">
            <SidebarContent
              navItems={navItems}
              pathname={pathname}
              subtitle={subtitle}
              onNavigate={() => setSidebarOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          onMenu={() => setSidebarOpen(true)}
          onLogout={handleLogout}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 p-5 focus:outline-none md:p-7"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
