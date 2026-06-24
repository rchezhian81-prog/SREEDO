"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { Paginated, SchoolClass } from "@/types";

const STATUSES = [
  "enquiry",
  "applied",
  "under_review",
  "admitted",
  "rejected",
  "enrolled",
] as const;
type Status = (typeof STATUSES)[number];

interface AdmissionApplication {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  gender: string | null;
  gradeApplying: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  address: string | null;
  source: string | null;
  status: Status;
  notes: string | null;
  sectionId: string | null;
  studentId: string | null;
  createdAt: string;
}

function statusTone(status: string): "green" | "amber" | "red" | "slate" | "blue" {
  switch (status) {
    case "enrolled":
      return "green";
    case "admitted":
      return "blue";
    case "rejected":
      return "red";
    case "under_review":
    case "applied":
      return "amber";
    default:
      return "slate";
  }
}

const admissionSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  gender: z.enum(["male", "female", "other"]).optional(),
  dateOfBirth: z.string().optional(),
  gradeApplying: z.string().optional(),
  guardianName: z.string().optional(),
  guardianPhone: z.string().optional(),
  guardianEmail: z.string().email("Enter a valid email").optional().or(z.literal("")),
});
type AdmissionForm = z.infer<typeof admissionSchema>;

interface SectionOption {
  id: string;
  label: string;
}

export default function AdmissionsPage() {
  const [apps, setApps] = useState<AdmissionApplication[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const [convertFor, setConvertFor] = useState<AdmissionApplication | null>(null);
  const [convertSection, setConvertSection] = useState("");
  const [converting, setConverting] = useState(false);

  const limit = 10;

  const load = useCallback(async () => {
    setLoading(true);
    setRowError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      const result = await api.get<Paginated<AdmissionApplication>>(
        `/admissions?${params.toString()}`
      );
      setApps(result.data);
      setTotal(result.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    api
      .get<SchoolClass[]>("/classes")
      .then((classes) =>
        setSections(
          classes.flatMap((schoolClass) =>
            schoolClass.sections.map((section) => ({
              id: section.id,
              label: `${schoolClass.name} — ${section.name}`,
            }))
          )
        )
      )
      .catch(() => undefined);
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AdmissionForm>({ resolver: zodResolver(admissionSchema) });

  const onSubmit = async (values: AdmissionForm) => {
    setServerError(null);
    try {
      await api.post("/admissions", {
        ...values,
        gender: values.gender || undefined,
        dateOfBirth: values.dateOfBirth || undefined,
        gradeApplying: values.gradeApplying || undefined,
        guardianEmail: values.guardianEmail || undefined,
      });
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to save application"
      );
    }
  };

  const changeStatus = async (app: AdmissionApplication, status: string) => {
    setRowError(null);
    try {
      await api.patch(`/admissions/${app.id}`, { status });
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to update status");
    }
  };

  const removeApp = async (app: AdmissionApplication) => {
    if (!confirm(`Delete the application for ${app.firstName} ${app.lastName}?`)) return;
    setRowError(null);
    try {
      await api.delete(`/admissions/${app.id}`);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  const doConvert = async () => {
    if (!convertFor) return;
    setConverting(true);
    setRowError(null);
    try {
      await api.post(`/admissions/${convertFor.id}/convert`, {
        sectionId: convertSection || undefined,
      });
      setConvertFor(null);
      setConvertSection("");
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to enroll applicant");
    } finally {
      setConverting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <PageHeader
        title="Admissions"
        subtitle="Capture enquiries and move applicants through to enrollment"
        action={<Button onClick={() => setModalOpen(true)}>+ New application</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-64">
          <Input
            placeholder="Search name or guardian phone…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-48">
          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <ErrorNote message={rowError} />

      {loading ? (
        <Spinner />
      ) : apps.length === 0 ? (
        <EmptyState message="No applications yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Applicant</th>
                <th className="px-4 py-3">Grade</th>
                <th className="px-4 py-3">Guardian</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {apps.map((app) => (
                <tr key={app.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium text-ink">
                    {app.firstName} {app.lastName}
                  </td>
                  <td className="px-4 py-3 text-muted">{app.gradeApplying ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">
                    {app.guardianName ?? "—"}
                    {app.guardianPhone && (
                      <span className="block text-xs text-faint">{app.guardianPhone}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{app.source ?? "—"}</td>
                  <td className="px-4 py-3">
                    {app.status === "enrolled" ? (
                      <Badge tone="green">enrolled</Badge>
                    ) : (
                      <Select
                        value={app.status}
                        onChange={(e) => changeStatus(app, e.target.value)}
                      >
                        {STATUSES.filter((s) => s !== "enrolled").map((s) => (
                          <option key={s} value={s}>
                            {s.replace("_", " ")}
                          </option>
                        ))}
                      </Select>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      {app.status === "admitted" && !app.studentId && (
                        <button
                          onClick={() => {
                            setConvertFor(app);
                            setConvertSection(app.sectionId ?? "");
                          }}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300"
                        >
                          Enroll →
                        </button>
                      )}
                      <button
                        onClick={() => removeApp(app)}
                        className="text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-muted">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <Modal title="New application" open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" error={errors.firstName?.message}>
              <Input {...register("firstName")} />
            </Field>
            <Field label="Last name" error={errors.lastName?.message}>
              <Input {...register("lastName")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Grade applying for">
              <Input placeholder="e.g. Grade 1" {...register("gradeApplying")} />
            </Field>
            <Field label="Date of birth">
              <Input type="date" {...register("dateOfBirth")} />
            </Field>
          </div>
          <Field label="Gender">
            <Select {...register("gender")}>
              <option value="">—</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Guardian name">
            <Input {...register("guardianName")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Guardian phone">
              <Input {...register("guardianPhone")} />
            </Field>
            <Field label="Guardian email" error={errors.guardianEmail?.message}>
              <Input type="email" {...register("guardianEmail")} />
            </Field>
          </div>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save application"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        title="Enroll applicant as student"
        open={convertFor !== null}
        onClose={() => setConvertFor(null)}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            This creates a student record for{" "}
            <span className="font-medium text-ink">
              {convertFor?.firstName} {convertFor?.lastName}
            </span>{" "}
            (admission number auto-generated) and marks the application enrolled.
          </p>
          <Field label="Assign to section (optional)">
            <Select value={convertSection} onChange={(e) => setConvertSection(e.target.value)}>
              <option value="">Unassigned</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.label}
                </option>
              ))}
            </Select>
          </Field>
          <ErrorNote message={rowError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConvertFor(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={converting} onClick={doConvert}>
              {converting ? "Enrolling…" : "Enroll student"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
