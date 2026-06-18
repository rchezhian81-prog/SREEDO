"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import { money } from "@/lib/payroll";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type {
  Paginated,
  PayrollCalcType,
  SalaryComponent,
  SalaryStructure,
  SalaryStructureDetail,
  Teacher,
} from "@/types";

interface LineDraft {
  componentId: string;
  calcType: PayrollCalcType;
  value: string;
}

export default function PayrollStructuresPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("payroll:create");
  const canDelete = can("payroll:delete");

  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [teacherFilter, setTeacherFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Assign modal state.
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTeacher, setAssignTeacher] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // View detail modal state.
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<SalaryStructureDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async (teacherId: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = teacherId ? `?teacherId=${teacherId}` : "";
      setStructures(
        await api.get<SalaryStructure[]>(`/payroll/structures${qs}`)
      );
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load structures"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permsLoading || !can("payroll:read")) {
      setLoading(false);
      return;
    }
    load(teacherFilter);
  }, [permsLoading, can, load, teacherFilter]);

  useEffect(() => {
    if (permsLoading || !can("payroll:read")) return;
    Promise.all([
      api.get<Paginated<Teacher>>("/teachers?limit=200"),
      api.get<SalaryComponent[]>("/payroll/components"),
    ])
      .then(([teacherRes, componentList]) => {
        setTeachers(teacherRes.data);
        setComponents(componentList.filter((c) => c.isActive));
      })
      .catch(() => undefined);
  }, [permsLoading, can]);

  const componentById = useMemo(() => {
    const map = new Map<string, SalaryComponent>();
    components.forEach((c) => map.set(c.id, c));
    return map;
  }, [components]);

  const openAssign = () => {
    setAssignTeacher("");
    setEffectiveDate("");
    setLines([{ componentId: "", calcType: "fixed", value: "" }]);
    setFormError(null);
    setAssignOpen(true);
  };

  const addLine = () =>
    setLines((prev) => [
      ...prev,
      { componentId: "", calcType: "fixed", value: "" },
    ]);

  const removeLine = (index: number) =>
    setLines((prev) => prev.filter((_, i) => i !== index));

  const updateLine = (index: number, patch: Partial<LineDraft>) =>
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line))
    );

  // When a component is picked, seed calcType/value from its defaults.
  const pickComponent = (index: number, componentId: string) => {
    const component = componentById.get(componentId);
    updateLine(index, {
      componentId,
      calcType: component?.calcType ?? "fixed",
      value:
        component && component.defaultValue != null
          ? String(component.defaultValue)
          : "",
    });
  };

  // Live preview mirrors the backend: percent components apply to the
  // fixed-earnings base. (The auto unpaid-leave deduction is run-time only.)
  const preview = useMemo(() => {
    const resolved = lines
      .filter((l) => l.componentId)
      .map((l) => {
        const component = componentById.get(l.componentId);
        return {
          type: component?.type ?? "earning",
          calcType: l.calcType,
          value: Number(l.value) || 0,
        };
      });
    const base = resolved
      .filter((l) => l.type === "earning" && l.calcType === "fixed")
      .reduce((s, l) => s + l.value, 0);
    const amount = (l: { calcType: PayrollCalcType; value: number }) =>
      l.calcType === "fixed" ? l.value : (l.value / 100) * base;
    const gross = resolved
      .filter((l) => l.type === "earning")
      .reduce((s, l) => s + amount(l), 0);
    const deductions = resolved
      .filter((l) => l.type === "deduction")
      .reduce((s, l) => s + amount(l), 0);
    return { gross, deductions, net: gross - deductions };
  }, [lines, componentById]);

  const submitAssign = async () => {
    setFormError(null);
    if (!assignTeacher) {
      setFormError("Pick a staff member");
      return;
    }
    const validLines = lines.filter((l) => l.componentId && l.value !== "");
    if (validLines.length === 0) {
      setFormError("Add at least one component line");
      return;
    }
    setSaving(true);
    try {
      await api.post("/payroll/structures", {
        teacherId: assignTeacher,
        effectiveDate: effectiveDate || undefined,
        components: validLines.map((l) => ({
          componentId: l.componentId,
          calcType: l.calcType,
          value: Number(l.value),
        })),
      });
      setAssignOpen(false);
      await load(teacherFilter);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save structure"
      );
    } finally {
      setSaving(false);
    }
  };

  const viewDetail = async (structure: SalaryStructure) => {
    setDetailOpen(true);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      setDetail(
        await api.get<SalaryStructureDetail>(
          `/payroll/structures/${structure.id}`
        )
      );
    } catch (err) {
      setDetailError(
        err instanceof ApiError ? err.message : "Failed to load structure"
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const remove = async (structure: SalaryStructure) => {
    if (!confirm(`Delete salary structure for ${structure.teacherName}?`))
      return;
    try {
      await api.delete(`/payroll/structures/${structure.id}`);
      await load(teacherFilter);
    } catch (err) {
      alert(
        err instanceof ApiError ? err.message : "Failed to delete structure"
      );
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Salary structures" subtitle="Staff salary setup" />
        <Spinner />
      </>
    );
  }

  if (!can("payroll:read")) {
    return (
      <>
        <PageHeader title="Salary structures" subtitle="Staff salary setup" />
        <EmptyState message="You do not have access to payroll." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Salary structures"
        subtitle="Assign salary structures to staff"
        action={
          canCreate ? (
            <Button onClick={openAssign}>+ Assign structure</Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/payroll"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Payroll
        </Link>
      </div>

      <div className="mb-4 w-64">
        <Select
          value={teacherFilter}
          onChange={(event) => setTeacherFilter(event.target.value)}
        >
          <option value="">All staff</option>
          {teachers.map((teacher) => (
            <option key={teacher.id} value={teacher.id}>
              {teacher.firstName} {teacher.lastName} ({teacher.employeeNo})
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : structures.length === 0 ? (
        <EmptyState message="No salary structures yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Employee No</th>
                <th className="px-4 py-3">Effective</th>
                <th className="px-4 py-3 text-right">Fixed earnings</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {structures.map((structure) => (
                <tr key={structure.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {structure.teacherName}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {structure.employeeNo}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {structure.effectiveDate
                      ? new Date(structure.effectiveDate).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {money(structure.fixedEarnings)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={structure.isActive ? "green" : "slate"}>
                      {structure.isActive ? "Active" : "Superseded"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => viewDetail(structure)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        View
                      </button>
                      {canDelete && (
                        <button
                          onClick={() => remove(structure)}
                          className="text-xs font-medium text-red-600 hover:text-red-700"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Assign structure modal */}
      <Modal
        title="Assign salary structure"
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Staff member">
              <Select
                value={assignTeacher}
                onChange={(event) => setAssignTeacher(event.target.value)}
              >
                <option value="">Select staff…</option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.firstName} {teacher.lastName} ({teacher.employeeNo})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Effective date (optional)">
              <Input
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            </Field>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">
                Components
              </span>
              <Button type="button" variant="ghost" onClick={addLine}>
                + Add line
              </Button>
            </div>
            {components.length === 0 && (
              <p className="text-xs text-slate-500">
                No active components — create components first.
              </p>
            )}
            {lines.map((line, index) => (
              <div key={index} className="flex items-end gap-2">
                <div className="flex-1">
                  <Select
                    value={line.componentId}
                    onChange={(event) =>
                      pickComponent(index, event.target.value)
                    }
                  >
                    <option value="">Component…</option>
                    {components.map((component) => (
                      <option key={component.id} value={component.id}>
                        {component.name} ({component.type})
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="w-28">
                  <Select
                    value={line.calcType}
                    onChange={(event) =>
                      updateLine(index, {
                        calcType: event.target.value as PayrollCalcType,
                      })
                    }
                  >
                    <option value="fixed">Fixed</option>
                    <option value="percent">Percent</option>
                  </Select>
                </div>
                <div className="w-28">
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Value"
                    value={line.value}
                    onChange={(event) =>
                      updateLine(index, { value: event.target.value })
                    }
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(index)}
                  className="mb-2 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                  aria-label="Remove line"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Gross</span>
              <span className="font-medium text-emerald-600">
                {money(preview.gross)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Deductions</span>
              <span className="font-medium text-red-600">
                {money(preview.deductions)}
              </span>
            </div>
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1">
              <span className="font-medium text-slate-700">Net</span>
              <span className="font-semibold text-slate-900">
                {money(preview.net)}
              </span>
            </div>
          </div>

          <ErrorNote message={formError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAssignOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={submitAssign} disabled={saving}>
              {saving ? "Saving…" : "Save structure"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Structure detail modal */}
      <Modal
        title={`Structure — ${detail?.teacherName ?? ""}`}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      >
        {detailLoading ? (
          <Spinner />
        ) : detailError ? (
          <ErrorNote message={detailError} />
        ) : detail ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              Effective:{" "}
              <strong>
                {detail.effectiveDate
                  ? new Date(detail.effectiveDate).toLocaleDateString()
                  : "—"}
              </strong>
            </p>
            {detail.components.length === 0 ? (
              <EmptyState message="No component lines" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Component</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Calc</th>
                      <th className="px-4 py-3 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detail.components.map((line) => (
                      <tr key={line.id}>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {line.name}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            tone={line.type === "earning" ? "green" : "red"}
                          >
                            {line.type}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {line.calcType}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-900">
                          {line.calcType === "percent"
                            ? `${money(line.value)}%`
                            : money(line.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <EmptyState message="Structure not found" />
        )}
      </Modal>
    </>
  );
}
