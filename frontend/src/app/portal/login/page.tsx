"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { portalApi } from "@/lib/portal-api";
import { usePortalStore } from "@/stores/portal-store";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import type { User } from "@/types";

// Messages stored as translation keys, translated at render time.
const loginSchema = z.object({
  email: z.string().email("login.invalidEmail"),
  password: z.string().min(1, "login.passwordRequired"),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function PortalLoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const setUser = usePortalStore((state) => state.setUser);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (values: LoginForm) => {
    setServerError(null);
    try {
      const res = await portalApi.post<{ user: User }>(
        "/auth/portal/login",
        values
      );
      setUser(res.user);
      router.push("/portal");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : t("login.serverError"));
    }
  };

  const fieldError = (message?: string) =>
    message ? t(message as TranslationKey) : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-xl font-bold text-white">
            S
          </div>
          <h1 className="text-xl font-semibold">
            {t("app.name")}
            {t("app.portalSuffix")}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{t("portalLogin.subtitle")}</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label={t("login.email")} error={fieldError(errors.email?.message)}>
            <Input
              type="email"
              placeholder="you@example.com"
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
        <p className="mt-4 text-center text-xs text-slate-500">
          {t("portalLogin.staffPrompt")}{" "}
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            {t("portalLogin.useStaff")}
          </Link>
        </p>
      </Card>
    </main>
  );
}
