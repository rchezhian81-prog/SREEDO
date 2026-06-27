"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

// Validation messages are translation KEYS, resolved at render time.
const schema = z
  .object({
    newPassword: z
      .string()
      .min(8, "resetPassword.weak")
      .regex(/[A-Za-z]/, "resetPassword.weak")
      .regex(/[0-9]/, "resetPassword.weak"),
    confirmPassword: z.string().min(1, "resetPassword.mismatch"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "resetPassword.mismatch",
  });

type Form = z.infer<typeof schema>;

function ResetPasswordForm() {
  const { t } = useI18n();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: Form) => {
    setServerError(null);
    try {
      await api.post("/auth/reset-password", {
        token,
        newPassword: values.newPassword,
      });
      setDone(true);
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : t("resetPassword.serverError")
      );
    }
  };

  const fieldError = (message?: string) =>
    message ? t(message as TranslationKey) : undefined;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app p-4">
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
            {t("resetPassword.title")}
          </h1>
          <p className="mt-1 text-sm text-muted">{t("resetPassword.subtitle")}</p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
          {done ? (
            <div className="space-y-4">
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                {t("resetPassword.success")}
              </p>
              <Link
                href="/login"
                className="block text-center text-sm font-medium text-brand-600 hover:underline"
              >
                {t("resetPassword.backToLogin")}
              </Link>
            </div>
          ) : !token ? (
            <div className="space-y-4">
              <ErrorNote message={t("resetPassword.missingToken")} />
              <Link
                href="/forgot-password"
                className="block text-center text-sm font-medium text-brand-600 hover:underline"
              >
                {t("forgotPassword.title")}
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <Field
                label={t("resetPassword.newPassword")}
                error={fieldError(errors.newPassword?.message)}
              >
                <Input
                  type="password"
                  placeholder="••••••••"
                  autoComplete="new-password"
                  {...register("newPassword")}
                />
              </Field>
              <Field
                label={t("resetPassword.confirmPassword")}
                error={fieldError(errors.confirmPassword?.message)}
              >
                <Input
                  type="password"
                  placeholder="••••••••"
                  autoComplete="new-password"
                  {...register("confirmPassword")}
                />
              </Field>
              <ErrorNote message={serverError} />
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting
                  ? t("resetPassword.resetting")
                  : t("resetPassword.submit")}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-faint">
          © 2026 GoCampus · School Management ERP
        </p>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams must be inside a Suspense boundary for the Next.js build.
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
