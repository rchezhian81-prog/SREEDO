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
import { useModeStore } from "@/stores/mode-store";
import { useTerms } from "@/lib/terms";
import { useI18n } from "@/i18n/I18nProvider";
import { usePermissions } from "@/lib/use-permissions";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { RuntimeBanner } from "@/components/RuntimeBanner";
import { SupportModeBanner } from "@/components/SupportModeBanner";
import { Toaster } from "@/components/toast";
import { CommandPalette } from "@/components/CommandPalette";
import { useNavStore } from "@/stores/nav-store";
import {
  tenantGroups,
  filterNavGroups,
  flattenItems,
  defaultOpenGroups,
  splitFold,
  FOLD_LIMIT,
  QUICK_ACTIONS,
  type NavGroup,
  type NavItem,
} from "@/lib/nav";

// The tenant registry lives in @/lib/nav (PR-PX2) so the sidebar and the
// command palette share one permission-truthful source. The super-admin nav
// below is deliberately untouched (Super Admin is frozen).
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

function NavRow({
  item,
  active,
  onNavigate,
  pinned,
  onTogglePin,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
  pinned: boolean;
  onTogglePin?: (href: string) => void;
}) {
  return (
    <div className="group/nav relative">
      <Link
        href={item.href}
        onClick={onNavigate}
        className={cx(
          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
          onTogglePin && "pr-9",
          active
            ? "bg-gradient-to-r from-[#3070f7] to-[#2563eb] text-white shadow-[0_8px_18px_rgb(37_99_235_/_0.4)]"
            : "text-[#a8b6dc] hover:bg-white/10 hover:text-white"
        )}
      >
        <Icon name={item.icon} className="h-[19px] w-[19px] shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
      {onTogglePin && (
        <button
          onClick={() => onTogglePin(item.href)}
          aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
          className={cx(
            "absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md transition",
            pinned
              ? "text-amber-300"
              : "text-transparent hover:!text-white focus-visible:text-white group-hover/nav:text-white/50"
          )}
        >
          <Icon name="star" className={cx("h-3.5 w-3.5", pinned && "fill-current")} />
        </button>
      )}
    </div>
  );
}

function SidebarContent({
  navGroups,
  pathname,
  subtitle,
  currentYearLabel,
  onNavigate,
  readOnly = false,
  pinnedItems = [],
  recentItems = [],
  onTogglePin,
  openGroups = {},
  onToggleGroup,
  expandedFolds = {},
  onToggleFold,
}: {
  navGroups: NavGroup[];
  pathname: string;
  subtitle: string;
  // The tenant's current academic year name, or null when none is configured.
  currentYearLabel: string | null;
  onNavigate?: () => void;
  // Support-mode only: a read-only session shows a pill and keeps the full nav.
  readOnly?: boolean;
  // PX2 — pinned/recent blocks + collapsible groups. All optional so the
  // super-admin sidebar (no title groups, no pins) renders exactly as before.
  pinnedItems?: NavItem[];
  recentItems?: NavItem[];
  onTogglePin?: (href: string) => void;
  openGroups?: Record<string, boolean>;
  onToggleGroup?: (title: string) => void;
  expandedFolds?: Record<string, boolean>;
  onToggleFold?: (title: string) => void;
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
        {pinnedItems.length > 0 && (
          <div className="space-y-0.5">
            <div className="px-3 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-[#6e7fb0]">
              Pinned
            </div>
            {pinnedItems.map((item) => (
              <NavRow
                key={`pin-${item.href}`}
                item={item}
                active={isActive(item.href, pathname)}
                onNavigate={onNavigate}
                pinned
                onTogglePin={onTogglePin}
              />
            ))}
          </div>
        )}
        {recentItems.length > 0 && (
          <div className="space-y-0.5">
            <div className="px-3 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-[#6e7fb0]">
              Recent
            </div>
            {recentItems.map((item) => (
              <NavRow
                key={`rec-${item.href}`}
                item={item}
                active={isActive(item.href, pathname)}
                onNavigate={onNavigate}
                pinned={false}
                onTogglePin={undefined}
              />
            ))}
          </div>
        )}
        {navGroups.map((group) => {
          // Untitled groups (the frozen super-admin nav) render exactly as
          // before PX2: always open, no fold, no pin affordance.
          if (!group.title) {
            return (
              <div key="_" className="space-y-0.5">
                {group.items.map((item) => (
                  <NavRow
                    key={item.href}
                    item={item}
                    active={isActive(item.href, pathname)}
                    onNavigate={onNavigate}
                    pinned={false}
                    onTogglePin={undefined}
                  />
                ))}
              </div>
            );
          }
          const title = group.title;
          const open = openGroups[title] ?? true;
          const activeHref =
            group.items.find((i) => isActive(i.href, pathname))?.href ?? null;
          const { visible, foldedCount } = splitFold(
            group.items,
            activeHref,
            expandedFolds[title] ?? false
          );
          return (
            <div key={title} className="space-y-0.5">
              <button
                onClick={() => onToggleGroup?.(title)}
                aria-expanded={open}
                className="flex w-full items-center justify-between rounded-md px-3 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-[#6e7fb0] transition hover:text-white"
              >
                <span>{title}</span>
                <span className="flex items-center gap-1.5">
                  {!open && <span className="font-bold">{group.items.length}</span>}
                  <Icon name={open ? "chevronDown" : "chevronRight"} className="h-3 w-3" />
                </span>
              </button>
              {open && (
                <>
                  {visible.map((item) => (
                    <NavRow
                      key={item.href}
                      item={item}
                      active={isActive(item.href, pathname)}
                      onNavigate={onNavigate}
                      pinned={pinnedItems.some((p) => p.href === item.href)}
                      onTogglePin={onTogglePin}
                    />
                  ))}
                  {foldedCount > 0 && (
                    <button
                      onClick={() => onToggleFold?.(title)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[12px] font-semibold text-[#6e7fb0] transition hover:text-white"
                    >
                      <Icon name="chevronDown" className="h-3.5 w-3.5" />
                      Show {foldedCount} more
                    </button>
                  )}
                  {foldedCount === 0 &&
                    (expandedFolds[title] ?? false) &&
                    group.items.length > FOLD_LIMIT && (
                      <button
                        onClick={() => onToggleFold?.(title)}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[12px] font-semibold text-[#6e7fb0] transition hover:text-white"
                      >
                        <Icon name="chevronRight" className="h-3.5 w-3.5" />
                        Show less
                      </button>
                    )}
                </>
              )}
            </div>
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
  onOpenPalette,
}: {
  user: { fullName?: string; email?: string; role?: string } | null;
  onMenu: () => void;
  onLogout: () => void;
  currentYearLabel: string | null;
  unreadCount: number;
  alertCount: number;
  // PX2 — opens the command palette; absent for super admins (frozen area).
  onOpenPalette?: () => void;
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

      {onOpenPalette && (
        <button
          onClick={onOpenPalette}
          title="Command palette (Ctrl+K)"
          aria-label="Open command palette"
          className="hidden h-11 shrink-0 items-center rounded-xl border border-line bg-surface px-3 text-xs font-extrabold tracking-wide text-muted transition hover:bg-hover hover:text-ink sm:flex"
        >
          ⌘K
        </button>
      )}

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
  // PX2 shell state: command-palette visibility + per-session group/fold toggles.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [groupToggles, setGroupToggles] = useState<Record<string, boolean>>({});
  const [expandedFolds, setExpandedFolds] = useState<Record<string, boolean>>({});

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
  let navGroups: NavGroup[] = filterNavGroups(rawGroups, {
    isSuper,
    isAdmin: user?.role === "admin",
    enabledModules,
    can: canNav,
    term,
  });
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

  // ---- PX2: pinned + recent + nav diet + command palette (tenant roles only;
  // the super-admin sidebar and behavior are byte-identical to pre-PX2). ----
  const flatNav = flattenItems(navGroups);
  const byHref = new Map(flatNav.map((i) => [i.href, i]));
  const navPrefs = useNavStore((s) => (user?.id ? s.byUser[user.id] : undefined));
  const togglePin = useNavStore((s) => s.togglePin);
  const pushRecent = useNavStore((s) => s.pushRecent);
  const pins = navPrefs?.pins ?? [];
  const recents = navPrefs?.recents ?? [];
  // Pins/recents render only when the item survived RBAC/module filtering —
  // an href the user can no longer see simply doesn't show (never faked).
  const pinnedItems = isSuper ? [] : pins.map((h) => byHref.get(h)).filter((i): i is NavItem => !!i);
  const recentItems = isSuper ? [] : recents.map((h) => byHref.get(h)).filter((i): i is NavItem => !!i);
  const quickActions = isSuper
    ? []
    : flattenItems(
        filterNavGroups([{ items: QUICK_ACTIONS }], {
          isSuper: false,
          isAdmin: user?.role === "admin",
          enabledModules,
          can: canNav,
          term,
        })
      );

  // Group collapse state: per-role defaults, the active route's group is always
  // forced open, and explicit user toggles win for the session.
  const roleDefaults = defaultOpenGroups(user?.role);
  const activeGroupTitle = navGroups.find(
    (g) => g.title && g.items.some((i) => isActive(i.href, pathname))
  )?.title;
  const openGroups = Object.fromEntries(
    navGroups
      .filter((g) => g.title)
      .map((g) => [
        g.title as string,
        groupToggles[g.title as string] ??
          (roleDefaults.has(g.title as string) || g.title === activeGroupTitle),
      ])
  ) as Record<string, boolean>;
  const handleToggleGroup = (title: string) =>
    setGroupToggles((s) => ({ ...s, [title]: !openGroups[title] }));
  const handleToggleFold = (title: string) =>
    setExpandedFolds((s) => ({ ...s, [title]: !(s[title] ?? false) }));
  const userId = user?.id;
  const handleTogglePin = userId && !isSuper ? (href: string) => togglePin(userId, href) : undefined;

  // ⌘K / Ctrl-K toggles the palette anywhere in the tenant dashboard. The
  // super-admin console is frozen — the shortcut is inert there.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (isSuper) return;
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSuper]);

  // Record the visited page (longest matching registry href, RBAC-filtered) as
  // a recent. /dashboard is the landing page — recording it would be noise.
  useEffect(() => {
    if (!hydrated || isSuper || !userId) return;
    const match = flatNav
      .filter((i) => isActive(i.href, pathname))
      .sort((a, b) => b.href.length - a.href.length)[0];
    if (match && match.href !== "/dashboard") pushRecent(userId, match.href);
    // flatNav is derived per render; pathname is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, hydrated, isSuper, userId]);

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
            pinnedItems={pinnedItems}
            recentItems={recentItems}
            onTogglePin={handleTogglePin}
            openGroups={openGroups}
            onToggleGroup={handleToggleGroup}
            expandedFolds={expandedFolds}
            onToggleFold={handleToggleFold}
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
              pinnedItems={pinnedItems}
              recentItems={recentItems}
              onTogglePin={handleTogglePin}
              openGroups={openGroups}
              onToggleGroup={handleToggleGroup}
              expandedFolds={expandedFolds}
              onToggleFold={handleToggleFold}
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
          onOpenPalette={isSuper ? undefined : () => setPaletteOpen(true)}
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
      {!isSuper && (
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          pages={flatNav}
          actions={quickActions}
          pinned={pinnedItems}
          recents={recentItems}
        />
      )}
      <Toaster />
    </div>
  );
}
