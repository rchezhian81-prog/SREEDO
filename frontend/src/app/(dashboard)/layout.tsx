"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { cx, Spinner } from "@/components/ui";

const NAV_ITEMS: Array<{
  href: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
}> = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/students", label: "Students", icon: "🎓" },
  { href: "/teachers", label: "Teachers", icon: "👩‍🏫" },
  { href: "/classes", label: "Classes", icon: "🏫" },
  { href: "/attendance", label: "Attendance", icon: "🗓️" },
  { href: "/exams", label: "Exams", icon: "📝" },
  { href: "/fees", label: "Fees", icon: "💳" },
  { href: "/announcements", label: "Announcements", icon: "📣" },
  { href: "/assistant", label: "AI Assistant", icon: "✨" },
  { href: "/users", label: "Users", icon: "👥", adminOnly: true },
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
    if (hydrated && !accessToken) router.replace("/login");
  }, [hydrated, accessToken, router]);

  if (!hydrated || !accessToken) return <Spinner />;

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
          <span className="font-semibold text-slate-900">SRE EDU OS</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.filter(
            (item) => !item.adminOnly || user?.role === "admin"
          ).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                pathname.startsWith(item.href)
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
            {user?.role}
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
