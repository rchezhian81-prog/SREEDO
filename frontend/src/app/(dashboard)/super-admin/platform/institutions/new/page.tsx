"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { useState } from "react";
import {
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
} from "@/components/ui";
import type { PlatformInstitution } from "@/types";
import { usePlatformGuard } from "../../_guard";

const institutionSchema = z.object({
  name: z.string().min(1, "Required"),
  code: z
    .string()
    .min(2, "Min 2 chars")
    .regex(/^[A-Za-z0-9_-]+$/, "Letters, digits, - and _ only"),
  type: z.enum(["school", "college"]),
});
type InstitutionForm = z.infer<typeof institutionSchema>;

export default function NewPlatformInstitutionPage() {
  const router = useRouter();
  const { ready, gate } = usePlatformGuard(
    "New institution",
    "Provision a new tenant"
  );

  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InstitutionForm>({
    resolver: zodResolver(institutionSchema),
    defaultValues: { type: "school" },
  });

  const onCreate = async (values: InstitutionForm) => {
    setServerError(null);
    try {
      const created = await api.post<PlatformInstitution>(
        "/platform/institutions",
        values
      );
      router.push(`/super-admin/platform/institutions/${created.id}`);
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to create institution"
      );
    }
  };

  if (!ready) return gate;

  return (
    <>
      <PageHeader title="New institution" subtitle="Provision a new tenant" />
      <div className="mb-4">
        <Link
          href="/super-admin/platform/institutions"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Institutions
        </Link>
      </div>

      <Card className="max-w-lg">
        <form onSubmit={handleSubmit(onCreate)} className="space-y-4">
          <Field label="Name" error={errors.name?.message}>
            <Input placeholder="e.g. Greenwood High" {...register("name")} />
          </Field>
          <Field label="Code" error={errors.code?.message}>
            <Input placeholder="e.g. GRNWD" {...register("code")} />
          </Field>
          <Field label="Type" error={errors.type?.message}>
            <Select {...register("type")}>
              <option value="school">School</option>
              <option value="college">College</option>
            </Select>
          </Field>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Link href="/super-admin/platform/institutions">
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Create institution"}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
