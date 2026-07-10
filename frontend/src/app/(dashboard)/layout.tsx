"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useBrandingStore, type Branding } from "@/stores/branding-store";
import { cx, Spinner, SkipLink } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { useThemeStore } from "@/stores/theme-store";
import { useModeStore, type CampusMode } from "@/stores/mode-store";
import { useTerms, type TermSet } from "@/lib/terms";
import { useI18n } from "@/i18n/I18nProvider";
import { usePermissions } from "@/lib/use-permissions";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { RuntimeBanner } from "@/components/RuntimeBanner";
import { SupportModeBanner } from "@/components/SupportModeBanner";
import { Toaster } from "@/components/toast";

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  adminOnly?: boolean;
  // When set, the item is hidden if the tenant has an explicit enabled-modules
  // list that does not include this key. Untagged items are always shown.
  moduleKey?: string;
  // The effective permission required to see this item. Untagged items always
  // show; owners/admins hold every permission so keep them all. Used by both the
  // super-admin nav and (PR-T2) the tenant nav for per-tenant role-aware hiding.
  perm?: string;
  // Label that varies by School/College — resolved from useTerms() in the
  // component (module-level data can't call the hook).
  termLabel?: (t: TermSet) => string;
};

type NavGroup = { title?: string; items: NavItem[] };

// Tenant sidebar organised into a stable information architecture (PR-T4) — the
// flat ~60-item list is grouped into eleven sections. Original per-item RBAC
// gates are preserved; admin-sensitive items that previously showed to any staff
// role now carry `adminOnly`. Reports (run / build / schedule) collapse into one
// hub entry; the exam "report cards" page moves under Exams & Results.
function tenantGroups(mode: CampusMode): NavGroup[] {
  const isCollege = mode === "college";
  const academic: NavItem[] = isCollege
    ? [
        { href: "/college", label: "College Home", icon: "building", perm: "college:read" },
        { href: "/college/departments", label: "Departments", icon: "network", perm: "departments:read" },
        { href: "/college/programs", label: "Programs", icon: "layers", perm: "programs:read" },
        { href: "/college/semesters", label: "Semesters", icon: "calendar", perm: "semesters:read" },
        { href: "/college/subjects", label: "Subjects", termLabel: (t) => t.subjectPlural, icon: "bookOpen" },
        { href: "/college/enrollments", label: "Enrollments", icon: "userPlus" },
        { href: "/timetable", label: "Timetable", icon: "calendar", moduleKey: "timetable", perm: "timetable:read" },
        { href: "/timetable/generate", label: "Auto Timetable", icon: "sparkles", adminOnly: true, moduleKey: "timetable" },
        { href: "/calendar", label: "Calendar", icon: "calendar" },
      ]
    : [
        { href: "/classes", label: "Classes", icon: "school" },
        { href: "/timetable", label: "Timetable", icon: "calendar", moduleKey: "timetable", perm: "timetable:read" },
        { href: "/timetable/generate", label: "Auto Timetable", icon: "sparkles", adminOnly: true, moduleKey: "timetable" },
        { href: "/calendar", label: "Calendar", icon: "calendar" },
      ];
  const examsResults: NavItem[] = [
    { href: "/exams", label: "Exams", icon: "file", moduleKey: "exams" },
    ...(isCollege
      ? [{ href: "/college/results", label: "Results", icon: "clipboard" } as NavItem]
      : []),
    // Formerly the mislabelled "/reports" nav item — it is the report-card/grade
    // page, so it lives under results with a terminology-aware label.
    { href: "/reports", label: "Report Cards", termLabel: (t) => `${t.reportCard}s`, icon: "clipboard", moduleKey: "reports", perm: "reports:read" },
  ];
  return [
    {
      title: "Overview",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: "grid" },
        { href: "/get-started", label: "Get Started", icon: "rocket", adminOnly: true },
        { href: "/help", label: "Help & SOP", icon: "bookOpen", perm: "tenant_help:read" },
        { href: "/analytics", label: "Analytics", icon: "trendUp", adminOnly: true },
        { href: "/ai-insights", label: "AI Insights", icon: "sparkles", perm: "ai:read" },
        { href: "/copilot", label: "AI Copilot", icon: "sparkles", perm: "ai:copilot" },
      ],
    },
    { title: "Academic Setup", items: academic },
    {
      title: "Students & Admissions",
      items: [
        { href: "/students", label: "Students", icon: "cap", moduleKey: "students", perm: "students:read" },
        { href: "/admissions", label: "Admissions", icon: "userPlus", adminOnly: true, moduleKey: "admissions" },
        { href: "/id-cards", label: "ID Cards", icon: "card", perm: "id_cards:read" },
        { href: "/transfer-certificates", label: "Transfer Certificates", icon: "file", adminOnly: true },
        { href: "/documents", label: "Documents", icon: "file", moduleKey: "documents", perm: "documents:read" },
        { href: "/alumni", label: "Alumni", icon: "users", adminOnly: true },
      ],
    },
    {
      title: "Attendance & Daily Work",
      items: [
        { href: "/attendance", label: "Attendance", icon: "calcheck", moduleKey: "attendance" },
        { href: "/period-attendance", label: "Period Attendance", icon: "calcheck", moduleKey: "attendance" },
        { href: "/homework", label: "Homework", icon: "board", perm: "homework:read" },
        { href: "/leave", label: "Staff Leave", icon: "calcheck", perm: "leave:read" },
        { href: "/student-leave", label: "Student Leave", icon: "calcheck", perm: "student_leave:read" },
        { href: "/disciplinary", label: "Disciplinary", icon: "shield", adminOnly: true },
        { href: "/study-materials", label: "Study Materials", icon: "bookOpen" },
        { href: "/live-classes", label: "Live Classes", icon: "video" },
        { href: "/quizzes", label: "Quizzes", icon: "quiz" },
        { href: "/biometric", label: "Biometric", icon: "fingerprint", adminOnly: true },
      ],
    },
    {
      title: "Fees & Accounts",
      items: [
        { href: "/fees", label: "Fees", icon: "card", moduleKey: "fees", perm: "fees:read" },
        { href: "/fees/setup", label: "Fee Setup", icon: "gear", adminOnly: true },
        { href: "/fees/refunds", label: "Fee Refunds", icon: "receipt", adminOnly: true },
        { href: "/online-payments", label: "Online Payments", icon: "wallet", adminOnly: true },
        { href: "/accounting", label: "Accounting", icon: "wallet", adminOnly: true },
      ],
    },
    { title: "Exams & Results", items: examsResults },
    {
      title: "Staff & HR",
      items: [
        { href: "/teachers", label: "Teachers", termLabel: (t) => t.teachers, icon: "board", moduleKey: "staff" },
        { href: "/staff/directory", label: "Staff Directory", icon: "users", moduleKey: "staff", perm: "teachers:manage" },
        { href: "/staff", label: "Staff Attendance", icon: "briefcase", perm: "staff_attendance:read" },
        { href: "/payroll", label: "Payroll", icon: "wallet", adminOnly: true, moduleKey: "payroll" },
      ],
    },
    {
      title: "Operations",
      items: [
        { href: "/library", label: "Library", icon: "bookOpen", moduleKey: "library", perm: "library:read" },
        { href: "/transport", label: "Transport", icon: "bus", moduleKey: "transport", perm: "transport:read" },
        { href: "/hostel", label: "Hostel", icon: "building", moduleKey: "hostel", perm: "hostel:read" },
        { href: "/inventory", label: "Inventory", icon: "package", moduleKey: "inventory", perm: "inventory:read" },
        { href: "/front-office", label: "Front Office", icon: "help", perm: "front_office:read" },
        { href: "/infirmary", label: "Infirmary", icon: "health", adminOnly: true },
        { href: "/cafeteria", label: "Cafeteria", icon: "utensils", adminOnly: true },
        { href: "/gallery", label: "Gallery", icon: "image", adminOnly: true },
      ],
    },
    {
      title: "Communication",
      items: [
        { href: "/announcements", label: "Announcements", icon: "megaphone" },
        { href: "/communication", label: "Communication", icon: "mail", moduleKey: "communication", perm: "communication:read" },
        { href: "/messaging", label: "Messaging", icon: "message" },
        { href: "/ptm", label: "Parent Meetings", icon: "users", perm: "ptm:read" },
        { href: "/polls", label: "Polls", icon: "barChart" },
      ],
    },
    {
      title: "Reports",
      items: [{ href: "/reports-hub", label: "Reports", icon: "barChart", perm: "reports:read" }],
    },
    {
      title: "Administration",
      items: [
        { href: "/settings", label: "Settings", icon: "gear", adminOnly: true },
        { href: "/settings/rbac", label: "Roles & Permissions", icon: "shield", perm: "tenant_rbac:read" },
        { href: "/users", label: "Users", icon: "users", adminOnly: true },
        { href: "/data-io", label: "Import / Export", icon: "package", perm: "data_io:read" },
        { href: "/branding", label: "Branding", icon: "palette", adminOnly: true },
        { href: "/integrations", label: "Integrations", icon: "link", adminOnly: true },
        { href: "/jobs", label: "Jobs", icon: "gear", adminOnly: true },
        { href: "/activity", label: "Activity Log", icon: "file", adminOnly: true },
        { href: "/assistant", label: "AI Assistant", icon: "sparkles" },
        { href: "/security", label: "Security", icon: "shield" },
      ],
    },
  ];
}

const SUPER_ADMIN_NAV: NavItem[] = [
  { href: "/super-admin/platform", label: "Platform Overview", icon: "grid", perm: "platform:read" },
  { href: "/super-admin/platform/tenants", label: "Tenants", icon: "building", perm: "platform:read" },
  { href: "/super-admin/platform/audit", label: "Audit Console", icon: "file", perm: "platform:audit_read" },
  { href: "/super-admin/platform/support", label: "Support Access", icon: "help", perm: "platform:impersonate" },
  { href: "/super-admin/admins", label: "Platform Admins", icon: "users", perm: "platform:manage_admins" },
  { href: "/super-admin/rbac", label: "Roles & Permissions", icon: "shield", perm: "platform:rbac_read" },
  { href: "/super-admin/security", label: "Security Center", icon: "lock", perm: "platform:security_read" },
  { href: "/super-admin/packages", label: "Packages", icon: "package", perm: "platform:read" },
  { href: "/super-admin/subscriptions", label: "Subscriptions", icon: "receipt", perm: "platform:read" },
  { href: "/super-admin/revenue", label: "Revenue", icon: "trendUp", perm: "platform:read" },
  { href: "/super-admin/invoices", label: "Invoices", icon: "file", perm: "platform:read" },
  { href: "/super-admin/coupons", label: "Coupons", icon: "tag", perm: "platform:read" },
  { href: "/super-admin/settings", label: "Settings", icon: "gear", perm: "platform:settings_read" },
  { href: "/super-admin/exports", label: "Data Exports", icon: "package", perm: "platform:read" },
  { href: "/super-admin/health", label: "System Health", icon: "alert", perm: "platform:health_read" },
  { href: "/super-admin/observability", label: "Observability", icon: "barChart", perm: "observability:read" },
  { href: "/super-admin/communication", label: "Communication Admin", icon: "mail", perm: "comm:dashboard_read" },
  { href: "/super-admin/backups", label: "Backups", icon: "shield", perm: "backup:read" },
  { href: "/super-admin/jobs", label: "Jobs", icon: "gear", perm: "jobs:read" },
  { href: "/super-admin/help", label: "Help & SOP", icon: "bookOpen", perm: "help:read" },
  { href: "/security", label: "Security", icon: "shield" },
];

const SIDEBAR_BG =
  "linear-gradient(193deg,#1c3380 0%,#122257 55%,#0b1840 100%)";

function isActive(href: string, pathname: string) {
  // Overview routes that are prefixes of their own sub-pages match exactly so
  // they don't stay highlighted while you're on a child route.
  return href === "/super-admin" || href === "/college"
    ? pathname === href
    : pathname.startsWith(href);
}

/**
 * Map a sidebar href to a coarse support-module key, for gating the nav while a
 * module-limited support session is engaged. Returns null for hrefs that don't
 * correspond to any support module (those are hidden in module-limited mode).
 * This is defense-in-depth only — the backend enforces scope on every request.
 */
function hrefToSupportModule(href: string): string | null {
  if (href === "/dashboard") return "overview";
  if (href.startsWith("/students")) return "students";
  if (href.startsWith("/teachers") || href.startsWith("/staff")) return "staff";
  if (href.startsWith("/fees")) return "fees";
  if (href.startsWith("/attendance")) return "attendance";
  if (href.startsWith("/exams")) return "exams";
  if (
    href.startsWith("/announcements") ||
    href.startsWith("/messages") ||
    href.startsWith("/messaging") ||
    href.startsWith("/communication")
  )
    return "communication";
  if (href.startsWith("/reports")) return "reports";
  if (href.startsWith("/documents")) return "documents";
  if (href.startsWith("/invoices")) return "billing";
  if (href.startsWith("/settings")) return "settings";
  return null;
}

function SidebarContent({
  navGroups,
  pathname,
  subtitle,
  currentYearLabel,
  onNavigate,
  readOnly = false,
}: {
  navGroups: NavGroup[];
  pathname: string;
  subtitle: string;
  // The tenant's current academic year name, or null when none is configured.
  currentYearLabel: string | null;
  onNavigate?: () => void;
  // Support-mode only: a read-only session shows a pill and keeps the full nav.
  readOnly?: boolean;
}) {
  const branding = useBrandingStore((s) => s.branding);
  return (
    <div
      className="flex h-full flex-col px-3 pb-4 text-[#a8b6dc]"
      style={{ background: SIDEBAR_BG }}
    >
      <div className="mb-2 flex h-[72px] items-center gap-3 border-b border-white/10 px-1.5">
        {branding?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding.logoUrl}
            alt=""
            className="h-11 w-11 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#4f8cff] to-[#1e40af] text-white shadow-[0_6px_16px_rgb(37_99_235_/_0.45)]">
            <Icon name="cap" className="h-6 w-6" />
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-[18px] font-extrabold leading-tight tracking-tight text-white">
            {branding?.displayName ? (
              branding.displayName
            ) : (
              <>
                Go<span className="text-[#9ec1ff]">Campus</span>
              </>
            )}
          </div>
          <div className="truncate text-[10px] font-bold tracking-wide text-[#6e7fb0]">
            {branding?.tagline || subtitle}
          </div>
        </div>
      </div>

      {readOnly && (
        <div className="mb-1 flex items-center gap-2 rounded-lg bg-amber-500/20 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-200">
          <Icon name="lock" className="h-3.5 w-3.5" />
          Read-only
        </div>
      )}

      <nav className="flex-1 space-y-3 overflow-y-auto py-1">
        {navGroups.map((group) => (
          <div key={group.title ?? "_"} className="space-y-0.5">
            {group.title && (
              <div className="px-3 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-[#6e7fb0]">
                {group.title}
              </div>
            )}
            {group.items.map((item) => {
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
          </div>
        ))}
      </nav>

      <div className="mt-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#4f8cff]/20 text-[#9ec1ff]">
          <Icon name="calendar" className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-bold tracking-wide text-[#6e7fb0]">
            CURRENT SESSION
          </div>
          <div className="truncate text-[13.5px] font-bold text-white">
            {currentYearLabel ?? "Not configured"}
          </div>
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

type SearchHit = { type: string; id: string; label: string; sub: string | null; href: string };

const SEARCH_ICON: Record<string, IconName> = {
  student: "cap",
  staff: "board",
  class: "school",
  program: "layers",
};
const SEARCH_TYPE_LABEL: Record<string, string> = {
  student: "Student",
  staff: "Staff",
  class: "Class",
  program: "Program",
};

/**
 * Real, tenant-scoped global search (PR-T4). Debounced calls hit the backend
 * `/search` (staff-only, RBAC-gated, isolation-safe); each result routes to its
 * module page. Honest states — searching / no-results / empty — never a fake
 * live input.
 */
function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      api
        .get<{ results: SearchHit[] }>(`/search?q=${encodeURIComponent(query)}`)
        .then((r) => setResults(r.results))
        .catch((err) => {
          console.error("search failed:", err);
          setResults([]);
        })
        .finally(() => {
          setSearched(true);
          setLoading(false);
        });
    }, 250);
    return () => clearTimeout(handle);
  }, [q]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  const show = open && q.trim().length >= 2;
  return (
    <div className="relative max-w-[460px] flex-1">
      <div className="flex h-11 items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-4 text-muted">
        <Icon name="search" className="h-[17px] w-[17px] shrink-0" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && results[0]) go(results[0].href);
          }}
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
          placeholder="Search students, staff, classes…"
          aria-label="Search"
        />
      </div>
      {show && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-[calc(100%+6px)] z-50 max-h-[360px] w-full overflow-auto rounded-2xl border border-line bg-surface py-1 shadow-pop">
            {loading ? (
              <div className="px-4 py-3 text-sm text-muted">Searching…</div>
            ) : results.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted">
                {searched ? "No results found" : "Type to search"}
              </div>
            ) : (
              results.map((r) => (
                <button
                  key={`${r.type}-${r.id}`}
                  onClick={() => go(r.href)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-hover"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-500/12 text-brand-600 dark:text-brand-300">
                    <Icon name={SEARCH_ICON[r.type] ?? "search"} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {r.label}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {SEARCH_TYPE_LABEL[r.type] ?? r.type}
                      {r.sub ? ` · ${r.sub}` : ""}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Topbar({
  user,
  onMenu,
  onLogout,
  currentYearLabel,
  unreadCount,
  alertCount,
}: {
  user: { fullName?: string; email?: string; role?: string } | null;
  onMenu: () => void;
  onLogout: () => void;
  currentYearLabel: string | null;
  unreadCount: number;
  alertCount: number;
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

      <GlobalSearch />

      {/* Current academic session — real value from Tenant Settings, links there. */}
      <Link
        href="/settings"
        className="ml-auto hidden h-11 shrink-0 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-bold text-ink transition hover:bg-hover sm:flex"
        title="Academic year — manage in Settings"
      >
        <Icon name="calendar" className="h-[17px] w-[17px] text-brand-600" />
        {currentYearLabel ?? "No academic year"}
        <Icon name="chevronDown" className="h-3.5 w-3.5 text-muted" />
      </Link>

      {/* Alerts badge — real "needs attention" count; hidden when there are none. */}
      <Link
        href="/dashboard"
        aria-label={`Alerts${alertCount > 0 ? ` (${alertCount})` : ""}`}
        className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-surface text-muted transition hover:bg-hover hover:text-ink"
      >
        <Icon name="bell" className="h-5 w-5" />
        {alertCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid h-[19px] min-w-[19px] place-items-center rounded-full border-2 border-surface bg-red-500 px-1 text-[10.5px] font-extrabold text-white">
            {alertCount > 9 ? "9+" : alertCount}
          </span>
        )}
      </Link>
      {/* Messages badge — real unread in-app message count; hidden when zero. */}
      <Link
        href="/communication"
        aria-label={`Messages${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-surface text-muted transition hover:bg-hover hover:text-ink"
      >
        <Icon name="message" className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid h-[19px] min-w-[19px] place-items-center rounded-full border-2 border-surface bg-red-500 px-1 text-[10.5px] font-extrabold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Link>

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
  const { user, accessToken, refreshToken, logout, support } = useAuthStore();
  const mode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);
  // Effective-permission gate for the super-admin nav (owners hold every key, so
  // they keep every item; non-owner platform sub-roles are correctly limited).
  const { can: canNav } = usePermissions();
  const term = useTerms();
  const [hydrated, setHydrated] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Real shell chrome data (PR-T4): current academic year for the session pill,
  // unread in-app messages + needs-attention count for the honest badges.
  const [currentYearLabel, setCurrentYearLabel] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    if (!hydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    // Students and parents belong to the cookie-based portal, not the staff
    // dashboard — send them there. Exception: while an operator is in support
    // mode AS a student/parent, keep them in the dashboard (support != null only).
    if ((user?.role === "student" || user?.role === "parent") && !support) {
      router.replace("/portal/login");
      return;
    }
    // Super admins live in the /super-admin console; everyone else in the
    // school dashboard. Keep each role on its own side. /security is a shared
    // account page (2FA/password/sessions) that every role — super admins
    // included — must be able to reach, so treat it as allowed.
    const inSuperArea = pathname.startsWith("/super-admin");
    const superAllowed = inSuperArea || pathname === "/security";
    if (user?.role === "super_admin" && !superAllowed) {
      router.replace("/super-admin/platform");
    } else if (user && user.role !== "super_admin" && inSuperArea) {
      router.replace("/dashboard");
    }
  }, [hydrated, accessToken, user, pathname, router, support]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setSidebarOpen(false), [pathname]);

  // Load this institution's white-label branding (skipped for super admins,
  // who have no tenant).
  const setBranding = useBrandingStore((s) => s.setBranding);
  useEffect(() => {
    if (!hydrated || !accessToken || user?.role === "super_admin") return;
    api
      .get<Branding>("/branding")
      .then(setBranding)
      .catch((err) => console.error("branding load failed:", err));
  }, [hydrated, accessToken, user, setBranding]);

  // The institution's type on the backend is the source of truth for School vs
  // College — reconcile the (pre-login, user-guessed) mode to it on load. We also
  // capture the tenant's enabled-modules list to gate the sidebar.
  const [enabledModules, setEnabledModules] = useState<string[] | null>(null);
  useEffect(() => {
    if (!hydrated || !accessToken || user?.role === "super_admin") return;
    api
      .get<{ institutionType: "school" | "college" | null; enabledModules: string[] | null }>("/auth/me")
      .then((me) => {
        if (me.institutionType) setMode(me.institutionType);
        setEnabledModules(me.enabledModules ?? null);
      })
      .catch((err) => console.error("profile/mode load failed:", err));
  }, [hydrated, accessToken, user, setMode]);

  // Shell chrome: real current academic year + unread messages + alert count.
  // Each degrades gracefully (a failure or missing permission leaves the pill
  // "not configured" and hides the badge) but is never faked.
  useEffect(() => {
    if (!hydrated || !accessToken || user?.role === "super_admin") return;
    api
      .get<{ id: string; name: string; isCurrent: boolean }[]>("/academic-years")
      .then((years) => setCurrentYearLabel(years.find((y) => y.isCurrent)?.name ?? null))
      .catch((err) => console.error("academic year load failed:", err));
    api
      .get<{ count: number }>("/communication/inbox/unread-count")
      .then((r) => setUnreadCount(r.count))
      .catch(() => setUnreadCount(0)); // no communication access → no badge
    api
      .get<{ needsAttention: unknown[] }>("/dashboard/summary")
      .then((s) => setAlertCount(s.needsAttention?.length ?? 0))
      .catch(() => setAlertCount(0));
  }, [hydrated, accessToken, user]);

  const isSuper = user?.role === "super_admin";
  const inSuperArea = pathname.startsWith("/super-admin");
  // Support-mode nav gating (defense-in-depth; the server enforces scope on every
  // request). All support branches guard on `support` being non-null, so the nav
  // is byte-for-byte unchanged when not in a support session.
  const supportScope = support?.session.scope ?? null;
  const supportReadOnly = support !== null && supportScope === "read_only";
  // Grouped nav (PR-T4): super admins keep their (untitled) single group; tenant
  // users get the eleven-section IA. Within each group, items are filtered by
  // adminOnly, the tenant's enabled-modules toggle, and the caller's effective
  // permissions; empty groups are dropped so headers never sit alone. Labels are
  // resolved from useTerms() so School↔College nouns flip.
  const rawGroups: NavGroup[] = isSuper ? [{ items: SUPER_ADMIN_NAV }] : tenantGroups(mode);
  let navGroups: NavGroup[] = rawGroups
    .map((group) => ({
      title: group.title,
      items: group.items
        .filter((item) => isSuper || !item.adminOnly || user?.role === "admin")
        .filter(
          (item) =>
            !item.moduleKey ||
            !enabledModules ||
            enabledModules.length === 0 ||
            enabledModules.includes(item.moduleKey)
        )
        .filter((item) => canNav(item.perm))
        .map((item) => ({ ...item, label: item.termLabel ? item.termLabel(term) : item.label })),
    }))
    .filter((group) => group.items.length > 0);
  // In a module-limited support session, keep only /dashboard plus items whose
  // mapped module is in the session's allowed set.
  if (support && supportScope === "module_limited") {
    const allowed = support.session.allowedModules;
    navGroups = navGroups
      .map((group) => ({
        title: group.title,
        items: group.items.filter((item) => {
          if (item.href === "/dashboard") return true;
          const mod = hrefToSupportModule(item.href);
          return mod !== null && allowed.includes(mod);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }

  // While unauthenticated or mid-redirect to the correct area, show a spinner.
  // A super admin on the shared /security page is allowed to stay (it renders
  // with the super-admin sidebar), so don't block it as an out-of-area redirect.
  if (!hydrated || !accessToken) return <Spinner />;
  if (isSuper !== inSuperArea && !(isSuper && pathname === "/security")) return <Spinner />;

  const handleLogout = async () => {
    if (refreshToken) {
      // Best-effort server-side revoke; local logout proceeds regardless.
      await api
        .post("/auth/logout", { refreshToken })
        .catch((err) => console.error("logout revoke failed:", err));
    }
    logout();
    router.replace("/login");
  };

  const subtitle = isSuper
    ? "PLATFORM CONSOLE"
    : mode === "college"
      ? "COLLEGE MANAGEMENT ERP"
      : "SCHOOL MANAGEMENT ERP";

  return (
    <div className="flex min-h-screen bg-app">
      <SkipLink label={t("a11y.skipToContent")} />
      {/* Desktop sidebar */}
      <aside className="hidden w-[258px] shrink-0 md:block">
        <div className="sticky top-0 h-screen">
          <SidebarContent
            navGroups={navGroups}
            pathname={pathname}
            subtitle={subtitle}
            currentYearLabel={isSuper ? null : currentYearLabel}
            readOnly={supportReadOnly}
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
              navGroups={navGroups}
              pathname={pathname}
              subtitle={subtitle}
              currentYearLabel={isSuper ? null : currentYearLabel}
              onNavigate={() => setSidebarOpen(false)}
              readOnly={supportReadOnly}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          onMenu={() => setSidebarOpen(true)}
          onLogout={handleLogout}
          currentYearLabel={isSuper ? null : currentYearLabel}
          unreadCount={isSuper ? 0 : unreadCount}
          alertCount={isSuper ? 0 : alertCount}
        />
        <SupportModeBanner />
        <RuntimeBanner />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 p-5 focus:outline-none md:p-7"
        >
          {children}
        </main>
      </div>
      <Toaster />
    </div>
  );
}
