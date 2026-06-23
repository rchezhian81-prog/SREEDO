"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
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
});

type LoginForm = z.infer<typeof loginSchema>;

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const setSession = useAuthStore((state) => state.setSession);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (values: LoginForm) => {
    setServerError(null);
    try {
      const session = await api.post<LoginResponse>("/auth/login", values);
      setSession(session);
      router.replace("/dashboard");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : t("login.serverError"));
    }
  };

  const fieldError = (message?: string) =>
    message ? t(message as TranslationKey) : undefined;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app p-4">
      {/* soft brand glow */}
      <div className="pointer-events-none absolute -top-32 left-1/2 h-80 w-[36rem] -translate-x-1/2 rounded-full bg-brand-500/15 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#4f8cff] to-[#1e40af] text-white shadow-[0_10px_24px_rgb(37_99_235_/_0.45)]">
            <Icon name="cap" className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">
            Go<span className="text-brand-600 dark:text-brand-400">Campus</span>
          </h1>
          <p className="mt-1 text-sm text-muted">{t("login.subtitle")}</p>
        </div>

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
            <Field label={t("login.password")} error={fieldError(errors.password?.message)}>
              <Input
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                {...register("password")}
              />
            </Field>
            <ErrorNote message={serverError} />
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? t("login.signingIn") : t("login.signIn")}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-muted">
            {t("login.portalPrompt")}{" "}
            <Link
              href="/portal/login"
              className="font-medium text-brand-600 hover:underline"
            >
              {t("login.usePortal")}
            </Link>
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-faint">
          © 2026 GoCampus · School Management ERP
        </p>
      </div>
    </main>
  );
}
