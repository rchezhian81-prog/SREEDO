"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { LibraryBook, LibraryMember, LibrarySettings } from "@/types";

const SUB_PAGES: { href: string; label: string; icon: string; desc: string }[] =
  [
    {
      href: "/library/catalogue",
      label: "Catalogue",
      icon: "📚",
      desc: "Books, categories and copies",
    },
    {
      href: "/library/circulation",
      label: "Circulation",
      icon: "🔄",
      desc: "Issue, return and renew loans",
    },
    {
      href: "/library/members",
      label: "Members",
      icon: "🧑‍🤝‍🧑",
      desc: "Library members and borrowing history",
    },
    {
      href: "/library/reports",
      label: "Reports",
      icon: "📈",
      desc: "Stock, overdue, fines and more",
    },
    {
      href: "/library/reservations",
      label: "Reservations",
      icon: "🔖",
      desc: "Student book reservation requests",
    },
  ];

const settingsSchema = z.object({
  loanDays: z.coerce.number().int().min(1, "Min 1"),
  finePerDay: z.coerce.number().min(0, "Min 0"),
  maxRenewals: z.coerce.number().int().min(0, "Min 0"),
  maxBooksPerMember: z.coerce.number().int().min(1, "Min 1"),
});

type SettingsForm = z.infer<typeof settingsSchema>;

export default function LibraryHubPage() {
  const { can, loading: permsLoading } = usePermissions();

  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [members, setMembers] = useState<LibraryMember[]>([]);
  const [settings, setSettings] = useState<LibrarySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SettingsForm>({ resolver: zodResolver(settingsSchema) });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [bookList, memberList, settingsData] = await Promise.all([
        api.get<LibraryBook[]>("/library/books"),
        api.get<LibraryMember[]>("/library/members"),
        api.get<LibrarySettings>("/library/settings"),
      ]);
      setBooks(bookList);
      setMembers(memberList);
      setSettings(settingsData);
      reset(settingsData);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load library data"
      );
    } finally {
      setLoading(false);
    }
  }, [reset]);

  useEffect(() => {
    load();
  }, [load]);

  const totalCopies = books.reduce((sum, book) => sum + book.totalCopies, 0);
  const availableCopies = books.reduce(
    (sum, book) => sum + book.availableCopies,
    0
  );
  const issuedCopies = totalCopies - availableCopies;

  const stats = [
    { label: "Titles", value: books.length },
    { label: "Total copies", value: totalCopies },
    { label: "Available", value: availableCopies },
    { label: "Issued", value: issuedCopies },
    { label: "Members", value: members.length },
  ];

  const canEditSettings = can("library:update");

  const onSaveSettings = async (values: SettingsForm) => {
    setSavingSettings(true);
    setSettingsError(null);
    setSettingsSaved(false);
    try {
      const updated = await api.patch<LibrarySettings>(
        "/library/settings",
        values
      );
      setSettings(updated);
      reset(updated);
      setSettingsSaved(true);
    } catch (err) {
      setSettingsError(
        err instanceof ApiError ? err.message : "Failed to save settings"
      );
    } finally {
      setSavingSettings(false);
    }
  };

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader title="Library" subtitle="Catalogue, circulation & members" />
        <Spinner />
      </>
    );
  }

  if (!can("library:read")) {
    return (
      <>
        <PageHeader title="Library" subtitle="Catalogue, circulation & members" />
        <EmptyState message="You do not have access to the library." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Library" subtitle="Catalogue, circulation & members" />

      {loadError ? (
        <ErrorNote message={loadError} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {stats.map((stat) => (
              <Card key={stat.label}>
                <p className="text-sm font-medium text-slate-500">
                  {stat.label}
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-900">
                  {stat.value}
                </p>
              </Card>
            ))}
          </div>

          {settings && (
            <Card>
              <h2 className="text-sm font-semibold text-slate-900">
                Library settings
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Loan duration, fines and borrowing limits.
              </p>
              <form
                onSubmit={handleSubmit(onSaveSettings)}
                className="mt-4 space-y-4"
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Loan days" error={errors.loanDays?.message}>
                    <Input
                      type="number"
                      min={1}
                      disabled={!canEditSettings}
                      {...register("loanDays")}
                    />
                  </Field>
                  <Field
                    label="Fine per day"
                    error={errors.finePerDay?.message}
                  >
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      disabled={!canEditSettings}
                      {...register("finePerDay")}
                    />
                  </Field>
                  <Field
                    label="Max renewals"
                    error={errors.maxRenewals?.message}
                  >
                    <Input
                      type="number"
                      min={0}
                      disabled={!canEditSettings}
                      {...register("maxRenewals")}
                    />
                  </Field>
                  <Field
                    label="Max books / member"
                    error={errors.maxBooksPerMember?.message}
                  >
                    <Input
                      type="number"
                      min={1}
                      disabled={!canEditSettings}
                      {...register("maxBooksPerMember")}
                    />
                  </Field>
                </div>
                {canEditSettings && (
                  <div className="flex items-center justify-end gap-3">
                    {settingsSaved && (
                      <span className="text-sm text-emerald-600">Saved</span>
                    )}
                    <Button type="submit" disabled={savingSettings}>
                      {savingSettings ? "Saving…" : "Save settings"}
                    </Button>
                  </div>
                )}
                <ErrorNote message={settingsError} />
              </form>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SUB_PAGES.map((page) => (
              <Link key={page.href} href={page.href} className="block">
                <Card className="h-full transition hover:border-brand-300 hover:shadow-md">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl" aria-hidden>
                      {page.icon}
                    </span>
                    <div>
                      <h3 className="font-semibold text-slate-900">
                        {page.label}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">{page.desc}</p>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
