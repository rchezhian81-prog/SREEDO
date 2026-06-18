"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { portalApi } from "@/lib/portal-api";
import { usePortalStore } from "@/stores/portal-store";
import { cx, Select, Spinner } from "@/components/ui";
import type { PortalChild, User } from "@/types";

const NAV = [
  { href: "/portal", label: "Dashboard", icon: "📊" },
  { href: "/portal/profile", label: "Profile", icon: "🪪" },
  { href: "/portal/attendance", label: "Attendance", icon: "🗓️" },
  { href: "/portal/timetable", label: "Timetable", icon: "📅" },
  { href: "/portal/reports", label: "Report Card", icon: "📄" },
  { href: "/portal/documents", label: "Documents", icon: "📁" },
  { href: "/portal/homework", label: "Homework", icon: "📚" },
  { href: "/portal/fees", label: "Fees", icon: "💳" },
  { href: "/portal/announcements", label: "Notices", icon: "📣" },
  { href: "/portal/inbox", label: "Inbox", icon: "📨" },
];

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isLogin = pathname === "/portal/login";

  const {
    user,
    children: kids,
    selectedStudentId,
    setUser,
    setChildren,
    setSelected,
    reset,
  } = usePortalStore();

  const [hydrated, setHydrated] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (isLogin || !hydrated) return;
    let cancelled = false;

    (async () => {
      try {
        let current = usePortalStore.getState().user;
        if (!current) {
          current = await portalApi.get<User>("/auth/me");
          if (cancelled) return;
          setUser(current);
        }
        const list = await portalApi.get<PortalChild[]>("/portal/children");
        if (cancelled) return;
        setChildren(list);
        const selected = usePortalStore.getState().selectedStudentId;
        if ((!selected || !list.some((c) => c.id === selected)) && list[0]) {
          setSelected(list[0].id);
        }
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) router.replace("/portal/login");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, isLogin]);

  if (isLogin) return <>{children}</>;

  if (!hydrated || !ready) return <Spinner />;

  const handleLogout = async () => {
    await portalApi.post("/auth/portal/logout").catch(() => undefined);
    reset();
    router.replace("/portal/login");
  };

  const selectedChild = kids.find((c) => c.id === selectedStudentId);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">
            S
          </div>
          <span className="font-semibold text-slate-900">
            SRE EDU OS · Portal
          </span>
        </div>

        <div className="border-b border-slate-200 px-4 py-3">
          {kids.length > 1 ? (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                Viewing
              </span>
              <Select
                value={selectedStudentId ?? ""}
                onChange={(event) => setSelected(event.target.value)}
              >
                {kids.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.firstName} {child.lastName}
                  </option>
                ))}
              </Select>
            </label>
          ) : selectedChild ? (
            <div>
              <p className="text-xs font-medium text-slate-500">Viewing</p>
              <p className="truncate text-sm font-medium text-slate-900">
                {selectedChild.firstName} {selectedChild.lastName}
              </p>
            </div>
          ) : null}
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                (
                  item.href === "/portal"
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
