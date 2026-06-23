"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { SchoolClass } from "@/types";

const classSchema = z.object({
  name: z.string().min(1, "Required"),
  gradeLevel: z.coerce.number().int().min(0).max(20),
});

type ClassForm = z.infer<typeof classSchema>;

export default function ClassesPage() {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setClasses(await api.get<SchoolClass[]>("/classes"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ClassForm>({ resolver: zodResolver(classSchema) });

  const onSubmit = async (values: ClassForm) => {
    setServerError(null);
    try {
      await api.post("/classes", values);
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Failed to create class"
      );
    }
  };

  const addSection = async (schoolClass: SchoolClass) => {
    const name = prompt(`New section name for ${schoolClass.name} (e.g. C):`);
    if (!name) return;
    try {
      await api.post(`/classes/${schoolClass.id}/sections`, { name });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to add section");
    }
  };

  const removeClass = async (schoolClass: SchoolClass) => {
    if (
      !confirm(
        `Delete ${schoolClass.name} and all of its sections? Students become unassigned.`
      )
    )
      return;
    await api.delete(`/classes/${schoolClass.id}`);
    await load();
  };

  return (
    <>
      <PageHeader
        title="Classes"
        subtitle="Grades, sections and capacity"
        action={<Button onClick={() => setModalOpen(true)}>+ Add class</Button>}
      />

      {loading ? (
        <Spinner />
      ) : classes.length === 0 ? (
        <EmptyState message="No classes yet — add the first grade" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {classes.map((schoolClass) => (
            <Card key={schoolClass.id}>
              <div className="flex items-start justify-between">
                <h3 className="font-semibold text-ink">
                  {schoolClass.name}
                </h3>
                <button
                  onClick={() => removeClass(schoolClass)}
                  className="text-xs font-medium text-red-600 hover:text-red-700"
                >
                  Delete
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {schoolClass.sections.length === 0 ? (
                  <p className="text-sm text-faint">No sections</p>
                ) : (
                  schoolClass.sections.map((section) => (
                    <div
                      key={section.id}
                      className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm"
                    >
                      <span className="font-medium">
                        Section {section.name}
                      </span>
                      <span className="text-muted">
                        {section.studentCount}/{section.capacity} students
                      </span>
                    </div>
                  ))
                )}
              </div>
              <Button
                variant="secondary"
                className="mt-3 w-full"
                onClick={() => addSection(schoolClass)}
              >
                + Add section
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Modal
        title="Add class"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Class name" error={errors.name?.message}>
            <Input placeholder="Grade 5" {...register("name")} />
          </Field>
          <Field label="Grade level" error={errors.gradeLevel?.message}>
            <Input type="number" min={0} max={20} {...register("gradeLevel")} />
          </Field>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save class"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
