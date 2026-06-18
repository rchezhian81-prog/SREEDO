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
import type { User } from "@/types";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function PortalLoginPage() {
  const router = useRouter();
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
      setServerError(
        err instanceof ApiError ? err.message : "Unable to reach the server"
      );
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-xl font-bold text-white">
            S
          </div>
          <h1 className="text-xl font-semibold">SRE EDU OS · Portal</h1>
          <p className="mt-1 text-sm text-slate-500">
            Sign in to the parent &amp; student portal
          </p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Email" error={errors.email?.message}>
            <Input
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              {...register("email")}
            />
          </Field>
          <Field label="Password" error={errors.password?.message}>
            <Input
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              {...register("password")}
            />
          </Field>
          <ErrorNote message={serverError} />
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">
          Staff member?{" "}
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            Staff sign-in →
          </Link>
        </p>
      </Card>
    </main>
  );
}
