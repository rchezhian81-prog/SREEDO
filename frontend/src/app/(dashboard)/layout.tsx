"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { cx, Spinner } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

type NavItem = { href: string; tkey: TranslationKey; icon: string; adminOnly?: boolean };

const SCHOOL_NAV: NavItem[] = [
  { href: "/dashboard", tkey: "nav.dashboard", icon: "📊" },
  { href: "/students", tkey: "nav.students", icon: "🎓" },
  { href: "/teachers", tkey: "nav.teachers", icon: "👩‍🏫" },
  { href: "/classes", tkey: "nav.classes", icon: "🏫" },
  { href: "/timetable", tkey: "nav.timetable", icon: "📅" },
  { href: "/college", tkey: "nav.college", icon: "🏛️" },
  { href: "/library", tkey: "nav.library", icon: "📖" },
  { href: "/transport", tkey: "nav.transport", icon: "🚌" },
  { href: "/hostel", tkey: "nav.hostel", icon: "🏨" },
  { href: "/inventory", tkey: "nav.inventory", icon: "📦" },
  { href: "/staff", tkey: "nav.staffAttendance", icon: "🧑‍💼" },
  { href: "/leave", tkey: "nav.leave", icon: "🌴" },
  { href: "/payroll", tkey: "nav.payroll", icon: "💰" },
  { href: "/attendance", tkey: "nav.attendance", icon: "🗓️" },
  { href: "/exams", tkey: "nav.exams", icon: "📝" },
  { href: "/reports", tkey: "nav.reports", icon: "📄" },
  { href: "/documents", tkey: "nav.documents", icon: "📁" },
  { href: "/homework", tkey: "nav.homework", icon: "📚" },
  { href: "/id-cards", tkey: "nav.idCards", icon: "🪪" },
  { href: "/transfer-certificates", tkey: "nav.transferCerts", icon: "📜" },
  { href: "/reports-center", tkey: "nav.reportsCenter", icon: "📈" },
  { href: "/report-builder", tkey: "nav.reportBuilder", icon: "🧱" },
  { href: "/scheduled-reports", tkey: "nav.scheduledReports", icon: "⏰" },
  { href: "/disciplinary", tkey: "nav.disciplinary", icon: "⚖️" },
  { href: "/fees", tkey: "nav.fees", icon: "💳" },
  { href: "/fees/setup", tkey: "nav.feeSetup", icon: "🧾" },
  { href: "/online-payments", tkey: "nav.onlinePayments", icon: "🏦" },
  { href: "/announcements", tkey: "nav.announcements", icon: "📣" },
  { href: "/communication", tkey: "nav.communication", icon: "📨" },
  { href: "/messaging", tkey: "nav.messaging", icon: "💬" },
  { href: "/assistant", tkey: "nav.aiAssistant", icon: "✨" },
  { href: "/ai-insights", tkey: "nav.aiInsights", icon: "🧠" },
  { href: "/jobs", tkey: "nav.jobs", icon: "⚙️", adminOnly: true },
  { href: "/users", tkey: "nav.users", icon: "👥", adminOnly: true },
];

const SUPER_ADMIN_NAV: NavItem[] = [
  { href: "/super-admin", tkey: "nav.institutions", icon: "🏢" },
  { href: "/super-admin/platform", tkey: "nav.platformOverview", icon: "🛰️" },
  {
    href: "/super-admin/platform/institutions",
    tkey: "nav.platformTenants",
    icon: "🏬",
  },
  { href: "/super-admin/platform/audit", tkey: "nav.platformAudit", icon: "🧾" },
  { href: "/super-admin/platform/support", tkey: "nav.supportAccess", icon: "🛟" },
  { href: "/super-admin/rbac", tkey: "nav.rolesPermissions", icon: "🔐" },
  { href: "/super-admin/packages", tkey: "nav.packages", icon: "📦" },
  { href: "/super-admin/settings", tkey: "nav.instSettings", icon: "⚙️" },
  { href: "/super-admin/audit-logs", tkey: "nav.auditLogs", icon: "📜" },
  { href: "/super-admin/exports", tkey: "nav.dataExports", icon: "💾" },
  { href: "/super-admin/health", tkey: "nav.systemHealth", icon: "❤️‍🩹" },
  { href: "/super-admin/observability", tkey: "nav.observability", icon: "📡" },
  { href: "/super-admin/backups", tkey: "nav.backups", icon: "🗄️" },
  { href: "/super-admin/jobs", tkey: "nav.jobs", icon: "⚙️" },
];

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

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">
            S
          </div>
          <span className="font-semibold text-slate-900">
            {t("app.name")}
            {isSuper ? t("app.platformSuffix") : ""}
          </span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            // Section landing pages (`/super-admin`, `/super-admin/platform`)
            // have child routes with their own nav entries, so they only count
            // as active on an exact match; deeper items use prefix matching.
            const hasDeeperEntry = navItems.some(
              (other) =>
                other.href !== item.href &&
                other.href.startsWith(`${item.href}/`)
            );
            const active = hasDeeperEntry
              ? pathname === item.href
              : pathname === item.href ||
                pathname.startsWith(`${item.href}/`);
            return (
            <Link
              key={item.href}
              href={item.href}
              className={cx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              <span aria-hidden>{item.icon}</span>
              {t(item.tkey)}
            </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <p className="truncate text-sm font-medium text-slate-900">
            {user?.fullName}
          </p>
          <p className="truncate text-xs capitalize text-slate-500">
            {user?.role?.replace("_", " ")}
          </p>
          <LanguageSwitcher className="mt-3" />
          <button
            onClick={handleLogout}
            className="mt-3 block text-sm font-medium text-red-600 hover:text-red-700"
          >
            {t("common.signOut")}
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6 md:p-8">{children}</main>
    </div>
  );
}
