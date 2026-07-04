"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useModeStore } from "@/stores/mode-store";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import type { User } from "@/types";

// Validation messages are stored as translation KEYS and translated at render
// time, so they react to the selected language.
const loginSchema = z.object({
  email: z.string().email("login.invalidEmail"),
  password: z.string().min(1, "login.passwordRequired"),
  totpCode: z.string().optional(),
});

type LoginForm = z.infer<typeof loginSchema>;

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

/** The minimal user shape echoed back with a 2FA-setup-required login. */
interface SetupUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

type LoginResult =
  | LoginResponse
  | { twoFactorRequired: true }
  | { twoFactorSetupRequired: true; setupToken: string; user: SetupUser };

/** Which step of the sign-in journey the page is currently showing. */
type LoginStep = "login" | "setup" | "enabled";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const setSession = useAuthStore((state) => state.setSession);
  const mode = useModeStore((state) => state.mode);
  const [serverError, setServerError] = useState<string | null>(null);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);

  // ── Mandatory-2FA enrolment gate ──────────────────────────────────────────
  // The setupToken is a scoped, setup-only credential. It lives ONLY in this
  // component's state — never in the persistent auth store / localStorage — and
  // is never used as a session to reach the dashboard.
  const [step, setStep] = useState<LoginStep>("login");
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [setupUser, setSetupUser] = useState<SetupUser | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(
    null
  );
  const [setupCode, setSetupCode] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (values: LoginForm) => {
    setServerError(null);
    try {
      const res = await api.post<LoginResult>("/auth/login", {
        ...values,
        totpCode: values.totpCode || undefined,
      });
      if ("twoFactorSetupRequired" in res) {
        // Role now mandates 2FA and the user hasn't enrolled: switch into the
        // setup step and fetch a secret using the scoped setup token.
        setSetupToken(res.setupToken);
        setSetupUser(res.user);
        setSetupCode("");
        setSetupError(null);
        setStep("setup");
        await beginSetup(res.setupToken);
        return;
      }
      if ("twoFactorRequired" in res) {
        setTwoFactorRequired(true); // prompt for the authenticator code
        return;
      }
      setSession(res);
      router.replace("/dashboard");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : t("login.serverError"));
    }
  };

  // Fetch the authenticator secret with the setup token as an explicit bearer.
  const beginSetup = async (token: string) => {
    setSetupBusy(true);
    setSetupError(null);
    try {
      const s = await api.post<{ secret: string; otpauthUrl: string }>(
        "/auth/2fa/setup",
        undefined,
        token
      );
      setSetup(s);
    } catch (err) {
      setSetupError(
        err instanceof ApiError && err.status === 401
          ? t("login.setupExpired")
          : err instanceof ApiError
            ? err.message
            : t("login.serverError")
      );
    } finally {
      setSetupBusy(false);
    }
  };

  const confirmEnable = async () => {
    if (!setupToken) return;
    setSetupBusy(true);
    setSetupError(null);
    try {
      await api.post("/auth/2fa/enable", { code: setupCode }, setupToken);
      // Enrolled — drop the scoped token from memory and confirm. The next
      // sign-in goes through the normal twoFactorRequired code prompt.
      setSetupToken(null);
      setSetupUser(null);
      setSetup(null);
      setSetupCode("");
      setStep("enabled");
    } catch (err) {
      setSetupError(
        err instanceof ApiError && err.status === 401
          ? t("login.setupExpired")
          : err instanceof ApiError
            ? err.message
            : t("login.serverError")
      );
    } finally {
      setSetupBusy(false);
    }
  };

  // Return to a clean sign-in form, discarding any setup-only state.
  const backToLogin = () => {
    setStep("login");
    setSetupToken(null);
    setSetupUser(null);
    setSetup(null);
    setSetupCode("");
    setSetupError(null);
    setTwoFactorRequired(false);
    setServerError(null);
  };

  const copySecret = async () => {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the key is on screen to copy manually.
    }
  };

  const fieldError = (message?: string) =>
    message ? t(message as TranslationKey) : undefined;

  // School vs College presentation — driven by the pre-login selector.
  const isCollege = mode === "college";
  const modeLabel = isCollege ? "College" : "School";
  const modeIcon = isCollege ? "graduation" : "school";
  const panelBg = isCollege
    ? "linear-gradient(160deg,#4c1d95 0%,#6d28d9 55%,#7c3aed 100%)"
    : "linear-gradient(160deg,#1c3380 0%,#122257 55%,#0b1840 100%)";
  const tile = isCollege
    ? "from-[#8b5cf6] to-[#6d28d9] shadow-[0_10px_24px_rgb(124_58_237_/_0.45)]"
    : "from-[#4f8cff] to-[#1e40af] shadow-[0_10px_24px_rgb(37_99_235_/_0.45)]";
  const accentText = isCollege
    ? "text-violet-600 dark:text-violet-400"
    : "text-brand-600 dark:text-brand-400";
  const linkText = isCollege
    ? "text-violet-600 hover:text-violet-700 dark:text-violet-400"
    : "text-brand-600 hover:text-brand-700 dark:text-brand-400";
  const badge = isCollege
    ? "bg-violet-500/12 text-violet-700 dark:text-violet-300"
    : "bg-brand-500/12 text-brand-700 dark:text-brand-300";
  const bullets = isCollege
    ? [
        "Departments, programs & semesters",
        "Enrollments, credits & GPA results",
        "Fees, transport, hostel & more",
      ]
    : [
        "Classes, sections & timetables",
        "Attendance, exams & report cards",
        "Fees, transport, hostel & more",
      ];

  return (
    <main className="flex min-h-screen bg-app">
      {/* Brand panel (desktop) — themed to the chosen campus */}
      <aside
        className="relative hidden w-1/2 flex-col justify-between overflow-hidden p-10 text-white lg:flex"
        style={{ background: panelBg }}
      >
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/15 backdrop-blur">
            <Icon name="cap" className="h-6 w-6" />
          </div>
          <span className="text-xl font-extrabold tracking-tight">GoCampus</span>
        </div>

        <div className="relative max-w-md">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wide backdrop-blur">
            <Icon name={modeIcon} className="h-4 w-4" /> {modeLabel} edition
          </div>
          <h2 className="text-[2rem] font-extrabold leading-tight">
            The complete {modeLabel.toLowerCase()} management platform.
          </h2>
          <ul className="mt-7 space-y-3">
            {bullets.map((b) => (
              <li key={b} className="flex items-center gap-3 text-sm text-white/90">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/15">
                  <Icon name="check" className="h-3.5 w-3.5" />
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-white/60">© 2026 GoCampus · School &amp; College ERP</p>
        <div className="pointer-events-none absolute -right-24 top-1/3 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
      </aside>

      {/* Form side */}
      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center justify-between">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${badge}`}
            >
              <Icon name={modeIcon} className="h-3.5 w-3.5" /> {modeLabel}
            </span>
            <div className="flex items-center gap-3">
              <Link
                href="/select"
                className="text-xs font-semibold text-muted transition hover:text-ink"
              >
                Change
              </Link>
              <LanguageSwitcher />
            </div>
          </div>

          <div className="mb-7 text-center lg:text-left">
            <div
              className={`mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br text-white lg:mx-0 ${tile}`}
            >
              <Icon name="cap" className="h-8 w-8" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-ink">
              Go<span className={accentText}>Campus</span>
            </h1>
            <p className="mt-1 text-sm text-muted">
              Sign in to your {modeLabel.toLowerCase()} workspace
            </p>
          </div>

          {step === "login" && (
            <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <Field label={t("login.email")} error={fieldError(errors.email?.message)}>
                  <Input
                    type="email"
                    placeholder="admin@sreedo.edu"
                    autoComplete="email"
                    {...register("email")}
                  />
                </Field>
                <Field
                  label={t("login.password")}
                  error={fieldError(errors.password?.message)}
                >
                  <Input
                    type="password"
                    placeholder="••••••••"
                    autoComplete="current-password"
                    {...register("password")}
                  />
                </Field>
                {!twoFactorRequired && (
                  <div className="-mt-1 flex justify-end">
                    <Link
                      href="/forgot-password"
                      className={`text-xs font-medium hover:underline ${linkText}`}
                    >
                      {t("login.forgotPassword")}
                    </Link>
                  </div>
                )}
                {twoFactorRequired && (
                  <Field label={t("login.twoFactorCode")}>
                    <Input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      maxLength={6}
                      autoFocus
                      {...register("totpCode")}
                    />
                    <p className="mt-1 text-xs text-muted">{t("login.twoFactorHint")}</p>
                  </Field>
                )}
                <ErrorNote message={serverError} />
                <Button type="submit" disabled={isSubmitting} className="w-full">
                  {isSubmitting
                    ? t("login.signingIn")
                    : twoFactorRequired
                      ? t("login.verify")
                      : t("login.signIn")}
                </Button>
              </form>
              <p className="mt-4 text-center text-xs text-muted">
                {t("login.portalPrompt")}{" "}
                <Link href="/portal/login" className={`font-medium hover:underline ${linkText}`}>
                  {t("login.usePortal")}
                </Link>
              </p>
            </div>
          )}

          {step === "setup" && (
            <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
              <div className="mb-4 flex items-center gap-3">
                <div
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white ${tile}`}
                >
                  <Icon name="shield" className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-bold leading-tight text-ink">
                    {t("login.setupTitle")}
                  </h2>
                  {setupUser && (
                    <p className="truncate text-xs text-muted">{setupUser.email}</p>
                  )}
                </div>
              </div>
              <p className="mb-4 text-sm text-muted">{t("login.setupIntro")}</p>

              {setupBusy && !setup ? (
                <p className="py-6 text-center text-sm text-muted">
                  {t("login.setupPreparing")}
                </p>
              ) : setup ? (
                <div className="space-y-4">
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-ink">
                      {t("login.setupKeyLabel")}
                    </p>
                    <div className="flex items-stretch gap-2">
                      <code className="min-w-0 flex-1 break-all rounded-xl border border-line bg-surface-2 px-3 py-2.5 font-mono text-sm text-ink">
                        {setup.secret}
                      </code>
                      <Button type="button" variant="secondary" onClick={copySecret}>
                        <Icon name={copied ? "check" : "clipboard"} className="h-4 w-4" />
                        {copied ? t("login.copied") : t("login.copy")}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs text-muted">{t("login.setupLinkLabel")}</p>
                    <code className="block break-all rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-[11px] text-muted">
                      {setup.otpauthUrl}
                    </code>
                  </div>
                  <Field label={t("login.setupCodeLabel")}>
                    <Input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      maxLength={6}
                      autoFocus
                      value={setupCode}
                      onChange={(e) =>
                        setSetupCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                    />
                  </Field>
                  <ErrorNote message={setupError} />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={backToLogin}
                      disabled={setupBusy}
                    >
                      {t("login.backToSignIn")}
                    </Button>
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={confirmEnable}
                      disabled={setupBusy || setupCode.length < 6}
                    >
                      {setupBusy ? t("login.setupEnabling") : t("login.setupEnable")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <ErrorNote message={setupError} />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={backToLogin}
                    className="w-full"
                  >
                    {t("login.backToSignIn")}
                  </Button>
                </div>
              )}
            </div>
          )}

          {step === "enabled" && (
            <div className="rounded-2xl border border-line bg-surface p-6 text-center shadow-card">
              <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                <Icon name="check" className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-bold text-ink">{t("login.setupDoneTitle")}</h2>
              <p className="mt-2 text-sm text-muted">{t("login.setupDoneBody")}</p>
              <Button type="button" className="mt-5 w-full" onClick={backToLogin}>
                {t("login.signIn")}
              </Button>
            </div>
          )}

          <p className="mt-6 text-center text-xs text-faint lg:text-left">
            © 2026 GoCampus · {modeLabel} Management ERP
          </p>
        </div>
      </div>
    </main>
  );
}
