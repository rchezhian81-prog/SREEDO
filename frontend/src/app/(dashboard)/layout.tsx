"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { cx, Spinner } from "@/components/ui";

type NavItem = { href: string; label: string; icon: string; adminOnly?: boolean };

const SCHOOL_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/students", label: "Students", icon: "🎓" },
  { href: "/teachers", label: "Teachers", icon: "👩‍🏫" },
  { href: "/classes", label: "Classes", icon: "🏫" },
  { href: "/timetable", label: "Timetable", icon: "📅" },
  { href: "/college", label: "College", icon: "🏛️" },
  { href: "/attendance", label: "Attendance", icon: "🗓️" },
  { href: "/exams", label: "Exams", icon: "📝" },
  { href: "/reports", label: "Reports", icon: "📄" },
  { href: "/documents", label: "Documents", icon: "📁" },
  { href: "/homework", label: "Homework", icon: "📚" },
  { href: "/id-cards", label: "ID Cards", icon: "🪪" },
  { href: "/reports-center", label: "Reports Center", icon: "📈" },
  { href: "/fees", label: "Fees", icon: "💳" },
  { href: "/announcements", label: "Announcements", icon: "📣" },
  { href: "/communication", label: "Communication", icon: "📨" },
  { href: "/assistant", label: "AI Assistant", icon: "✨" },
  { href: "/users", label: "Users", icon: "👥", adminOnly: true },
];

const SUPER_ADMIN_NAV: NavItem[] = [
  { href: "/super-admin", label: "Institutions", icon: "🏢" },
  { href: "/super-admin/packages", label: "Packages", icon: "📦" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
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
            SRE EDU OS{isSuper ? " · Platform" : ""}
          </span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                (
                  item.href === "/super-admin"
                    ? pathname === item.href
                    : pathname.startsWith(item.href)
                )
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <p className="truncate text-sm font-medium text-slate-900">
            {user?.fullName}
          </p>
          <p className="truncate text-xs capitalize text-slate-500">
            {user?.role?.replace("_", " ")}
          </p>
          <button
            onClick={handleLogout}
            className="mt-3 text-sm font-medium text-red-600 hover:text-red-700"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6 md:p-8">{children}</main>
    </div>
  );
}
