"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { portalApi } from "@/lib/portal-api";
import { usePortalStore } from "@/stores/portal-store";
import { cx, Select, Spinner, SkipLink } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import type { PortalChild, User } from "@/types";

const NAV: { href: string; tkey: TranslationKey; icon: string }[] = [
  { href: "/portal", tkey: "portalNav.dashboard", icon: "📊" },
  { href: "/portal/profile", tkey: "portalNav.profile", icon: "🪪" },
  { href: "/portal/attendance", tkey: "portalNav.attendance", icon: "🗓️" },
  { href: "/portal/timetable", tkey: "portalNav.timetable", icon: "📅" },
  { href: "/portal/reports", tkey: "portalNav.reportCard", icon: "📄" },
  { href: "/portal/documents", tkey: "portalNav.documents", icon: "📁" },
  { href: "/portal/certificates", tkey: "portalNav.certificates", icon: "📜" },
  { href: "/portal/homework", tkey: "portalNav.homework", icon: "📚" },
  { href: "/portal/materials", tkey: "portalNav.materials", icon: "📒" },
  { href: "/portal/quizzes", tkey: "portalNav.quizzes", icon: "📝" },
  { href: "/portal/library", tkey: "portalNav.library", icon: "📖" },
  { href: "/portal/polls", tkey: "portalNav.polls", icon: "📊" },
  { href: "/portal/mess", tkey: "portalNav.mess", icon: "🍽️" },
  { href: "/portal/disciplinary", tkey: "portalNav.disciplinary", icon: "⚖️" },
  { href: "/portal/fees", tkey: "portalNav.fees", icon: "💳" },
  { href: "/portal/announcements", tkey: "portalNav.notices", icon: "📣" },
  { href: "/portal/inbox", tkey: "portalNav.inbox", icon: "📨" },
  { href: "/portal/messages", tkey: "portalNav.messages", icon: "💬" },
];

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
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
      <SkipLink label={t("a11y.skipToContent")} />
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">
            S
          </div>
          <span className="font-semibold text-slate-900">
            {t("app.name")}
            {t("app.portalSuffix")}
          </span>
        </div>

        <div className="border-b border-slate-200 px-4 py-3">
          {kids.length > 1 ? (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                {t("common.viewing")}
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
              <p className="text-xs font-medium text-slate-500">
                {t("common.viewing")}
              </p>
              <p className="truncate text-sm font-medium text-slate-900">
                {selectedChild.firstName} {selectedChild.lastName}
              </p>
            </div>
          ) : null}
        </div>

        <nav aria-label={t("a11y.primaryNavigation")} className="flex-1 space-y-1 p-3">
          {NAV.map((item) => {
            const active =
              item.href === "/portal"
                ? pathname === item.href
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
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
      <main
        id="main-content"
        tabIndex={-1}
        className="min-w-0 flex-1 p-6 focus:outline-none md:p-8"
      >
        {children}
      </main>
    </div>
  );
}
