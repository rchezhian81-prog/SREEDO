"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
  cx,
} from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { usePlatformGuard } from "../platform/_guard";
import { formatNumber } from "../platform/_utils";
import {
  WINDOW_OPTIONS,
  alertTone,
  formatDateTime,
  type SecurityAlert,
  type SecuritySummary,
  type SecurityWindow,
} from "./_security";

type TileTone = "ink" | "amber" | "red" | "blue" | "green";

function SummaryTile({
  label,
  value,
  tone = "ink",
  href,
}: {
  label: string;
  value: number | undefined;
  tone?: TileTone;
  href?: string;
}) {
  const color =
    tone === "red"
      ? "text-red-600 dark:text-red-400"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "green"
          ? "text-green-600 dark:text-green-400"
          : tone === "blue"
            ? "text-brand-600 dark:text-brand-300"
            : "text-ink";
  const body = (
    <Card
      className={cx(
        "min-w-[9rem] flex-1",
        href && "transition hover:border-brand-500/40 hover:shadow-pop"
      )}
    >
      <p className="text-xs uppercase tracking-wide text-faint">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>
        {formatNumber(value ?? 0)}
      </p>
    </Card>
  );
  return href ? (
    <Link href={href} className="min-w-[9rem] flex-1">
      {body}
    </Link>
  ) : (
    body
  );
}

const SUB_PAGES: {
  href: string;
  icon: IconName;
  title: string;
  desc: string;
}[] = [
  {
    href: "/super-admin/security/two-factor",
    icon: "fingerprint",
    title: "2FA enforcement",
    desc: "Per-role two-factor requirements & compliance.",
  },
  {
    href: "/super-admin/security/sessions",
    icon: "users",
    title: "Sessions",
    desc: "Active platform-admin sessions & revocation.",
  },
  {
    href: "/super-admin/security/login-history",
    icon: "clipboard",
    title: "Login history",
    desc: "Sign-in successes, failures & failed-login monitoring.",
  },
  {
    href: "/super-admin/security/locked-accounts",
    icon: "lock",
    title: "Locked accounts",
    desc: "Locked platform accounts, lock & unlock.",
  },
  {
    href: "/super-admin/security/password-policy",
    icon: "shield",
    title: "Password policy",
    desc: "Password rules & the enforced auth baseline.",
  },
  {
    href: "/super-admin/security/ip-allowlist",
    icon: "network",
    title: "IP allowlist",
    desc: "Restrict sensitive actions to allowed IPs.",
  },
  {
    href: "/super-admin/security/api-tokens",
    icon: "key",
    title: "API tokens",
    desc: "Platform API tokens — create, rotate, revoke.",
  },
  {
    href: "/super-admin/security/high-risk",
    icon: "alert",
    title: "High-risk feed",
    desc: "Sensitive actions across the platform.",
  },
  {
    href: "/super-admin/security/reports",
    icon: "file",
    title: "Compliance reports",
    desc: "Run & export audit / compliance reports.",
  },
];

const ALERT_CLASS: Record<SecurityAlert["severity"], string> = {
  critical:
    "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  warning:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  info: "border-brand-500/30 bg-brand-500/10 text-brand-600 dark:text-brand-300",
};

const ALERT_ICON: Record<SecurityAlert["severity"], IconName> = {
  critical: "alert",
  warning: "alert",
  info: "bell",
};

export default function SecurityCenterPage() {
  const { ready, gate } = usePlatformGuard(
    "Security Center",
    "Platform security posture, compliance & controls"
  );

  const [windowSel, setWindowSel] = useState<SecurityWindow>("7d");
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  // Deep-link ?window= (client-only, avoids the useSearchParams suspense rule).
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("window");
    if (raw === "today" || raw === "7d" || raw === "30d") setWindowSel(raw);
  }, []);

  const setWindow = (w: SecurityWindow) => {
    setWindowSel(w);
    const url = new URL(window.location.href);
    url.searchParams.set("window", w);
    window.history.replaceState(null, "", url.toString());
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const [s, a] = await Promise.all([
        api.get<SecuritySummary>(`/platform/security/summary?window=${windowSel}`),
        api.get<SecurityAlert[]>("/platform/security/alerts"),
      ]);
      setSummary(s);
      setAlerts(a);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else
        setError(
          err instanceof ApiError ? err.message : "Failed to load security summary"
        );
    } finally {
      setLoading(false);
    }
  }, [windowSel]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  if (!ready) return gate;

  if (forbidden) {
    return (
      <>
        <PageHeader
          title="Security Center"
          subtitle="Platform security posture, compliance & controls"
        />
        <EmptyState message="You don't have permission to view the Security Center." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Security Center"
        subtitle="Platform security posture, compliance & controls"
        action={
          <div className="inline-flex rounded-xl border border-line bg-surface p-1">
            {WINDOW_OPTIONS.map((w) => (
              <button
                key={w.value}
                onClick={() => setWindow(w.value)}
                className={cx(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  windowSel === w.value
                    ? "bg-brand-600 text-white shadow"
                    : "text-muted hover:text-ink"
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
        }
      />

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : (
        <>
          {/* Summary cards */}
          <div className="mb-6 flex flex-wrap gap-3">
            <SummaryTile
              label="Platform admins"
              value={summary?.platformAdminsTotal}
            />
            <SummaryTile
              label="Without 2FA"
              value={summary?.platformAdminsWithout2fa}
              tone={summary && summary.platformAdminsWithout2fa > 0 ? "amber" : "ink"}
              href="/super-admin/security/two-factor"
            />
            <SummaryTile
              label="Active sessions"
              value={summary?.activePlatformSessions}
              tone="blue"
              href="/super-admin/security/sessions"
            />
            <SummaryTile
              label="Failed logins today"
              value={summary?.failedLoginsToday}
              tone={summary && summary.failedLoginsToday > 0 ? "amber" : "ink"}
              href="/super-admin/security/login-history"
            />
            <SummaryTile
              label="Failed logins (7d)"
              value={summary?.failedLoginsWeek}
              href="/super-admin/security/login-history"
            />
            <SummaryTile
              label="Locked accounts"
              value={summary?.lockedAccounts}
              tone={summary && summary.lockedAccounts > 0 ? "red" : "ink"}
              href="/super-admin/security/locked-accounts"
            />
            <SummaryTile
              label="Disabled admins"
              value={summary?.disabledPlatformAdmins}
            />
            <SummaryTile
              label="Active support sessions"
              value={summary?.activeSupportSessions}
              tone={summary && summary.activeSupportSessions > 0 ? "amber" : "ink"}
            />
            <SummaryTile
              label="Recent high-risk RBAC"
              value={summary?.recentHighRiskRbac}
              href="/super-admin/security/high-risk?category=rbac"
            />
            <SummaryTile
              label="Recent high-risk audit"
              value={summary?.recentHighRiskAudit}
              href="/super-admin/security/high-risk"
            />
            <SummaryTile
              label="Recent 2FA resets"
              value={summary?.recent2faResets}
            />
            <SummaryTile
              label="Recent session revocations"
              value={summary?.recentSessionRevocations}
            />
            <SummaryTile
              label="Suspicious login attempts"
              value={summary?.suspiciousLoginAttempts}
              tone={summary && summary.suspiciousLoginAttempts > 0 ? "red" : "ink"}
              href="/super-admin/security/login-history?outcome=failed"
            />
            <SummaryTile
              label="API tokens active"
              value={summary?.apiTokensActive}
              tone="blue"
              href="/super-admin/security/api-tokens"
            />
          </div>
          <p className="mb-6 -mt-3 text-xs text-faint">
            &quot;Recent&quot; counts reflect the selected window
            {summary?.lastExportAt
              ? ` · last export ${formatDateTime(summary.lastExportAt)}`
              : ""}
            .
          </p>

          {/* Alerts */}
          <div className="mb-8">
            <h2 className="mb-3 text-lg font-bold text-ink">Security alerts</h2>
            {alerts.length === 0 ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                <Icon name="check" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
                No active security alerts.
              </div>
            ) : (
              <div className="space-y-2.5">
                {alerts.map((a) => (
                  <Link
                    key={a.key}
                    href={a.link}
                    className={cx(
                      "flex items-start gap-3 rounded-xl border px-4 py-3 transition hover:shadow-pop",
                      ALERT_CLASS[a.severity]
                    )}
                  >
                    <Icon name={ALERT_ICON[a.severity]} className="mt-0.5 h-5 w-5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{a.title}</span>
                        <Badge tone={alertTone(a.severity)}>
                          {a.severity}
                        </Badge>
                        <span className="text-xs opacity-80">
                          {formatNumber(a.count)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm opacity-90">{a.detail}</p>
                    </div>
                    <Icon name="chevronRight" className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Quick links */}
          <h2 className="mb-3 text-lg font-bold text-ink">Security controls</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SUB_PAGES.map((p) => (
              <Link key={p.href} href={p.href}>
                <Card className="h-full transition hover:border-brand-500/40 hover:shadow-pop">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
                      <Icon name={p.icon} className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-ink">{p.title}</p>
                      <p className="mt-0.5 text-xs text-muted">{p.desc}</p>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
