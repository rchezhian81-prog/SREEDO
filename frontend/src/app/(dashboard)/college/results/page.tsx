"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type {
  CollegeCgpa,
  CollegeProgram,
  CollegeSemester,
  CollegeSemesterResult,
  Paginated,
  Student,
} from "@/types";

function fmt(value: number | null, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

export default function CollegeResultsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [programs, setPrograms] = useState<CollegeProgram[]>([]);

  // --- Semester result section ---
  const [resStudentId, setResStudentId] = useState("");
  const [resProgramId, setResProgramId] = useState("");
  const [resSemesters, setResSemesters] = useState<CollegeSemester[]>([]);
  const [resSemesterId, setResSemesterId] = useState("");
  const [result, setResult] = useState<CollegeSemesterResult | null>(null);
  const [resLoading, setResLoading] = useState(false);
  const [resError, setResError] = useState<string | null>(null);

  // --- CGPA section ---
  const [cgpaStudentId, setCgpaStudentId] = useState("");
  const [cgpaProgramId, setCgpaProgramId] = useState("");
  const [cgpaSemesters, setCgpaSemesters] = useState<CollegeSemester[]>([]);
  const [cgpa, setCgpa] = useState<CollegeCgpa | null>(null);
  const [cgpaLoading, setCgpaLoading] = useState(false);
  const [cgpaError, setCgpaError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Paginated<Student>>("/students?limit=500")
      .then((res) => setStudents(res.data))
      .catch(() => undefined);
    api
      .get<CollegeProgram[]>("/college/programs")
      .then(setPrograms)
      .catch(() => undefined);
  }, []);

  // Semester dropdown depends on chosen program (for result section).
  useEffect(() => {
    setResSemesterId("");
    setResult(null);
    if (!resProgramId) {
      setResSemesters([]);
      return;
    }
    api
      .get<CollegeSemester[]>(
        `/college/semesters?programId=${encodeURIComponent(resProgramId)}`
      )
      .then(setResSemesters)
      .catch(() => setResSemesters([]));
  }, [resProgramId]);

  const loadResult = async () => {
    if (!resStudentId || !resSemesterId) return;
    setResLoading(true);
    setResError(null);
    setResult(null);
    try {
      setResult(
        await api.get<CollegeSemesterResult>(
          `/college/students/${resStudentId}/semesters/${resSemesterId}/result`
        )
      );
    } catch (err) {
      setResError(
        err instanceof ApiError ? err.message : "Failed to load result"
      );
    } finally {
      setResLoading(false);
    }
  };

  // Resolve semester names for the CGPA program's per-semester rows.
  useEffect(() => {
    setCgpa(null);
    if (!cgpaProgramId) {
      setCgpaSemesters([]);
      return;
    }
    api
      .get<CollegeSemester[]>(
        `/college/semesters?programId=${encodeURIComponent(cgpaProgramId)}`
      )
      .then(setCgpaSemesters)
      .catch(() => setCgpaSemesters([]));
  }, [cgpaProgramId]);

  const loadCgpa = async () => {
    if (!cgpaStudentId || !cgpaProgramId) return;
    setCgpaLoading(true);
    setCgpaError(null);
    setCgpa(null);
    try {
      setCgpa(
        await api.get<CollegeCgpa>(
          `/college/students/${cgpaStudentId}/cgpa?programId=${encodeURIComponent(
            cgpaProgramId
          )}`
        )
      );
    } catch (err) {
      setCgpaError(
        err instanceof ApiError ? err.message : "Failed to load CGPA"
      );
    } finally {
      setCgpaLoading(false);
    }
  };

  return (
    <>
      <PageHeader title="Results" subtitle="Semester results, GPA & CGPA" />

      <div className="mb-4">
        <Link
          href="/college"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to College
        </Link>
      </div>

      <div className="space-y-6">
        {/* Semester result */}
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">
            Semester result
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Pick a student, program and semester to view the grade summary.
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="w-64">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Student
              </span>
              <Select
                value={resStudentId}
                onChange={(event) => setResStudentId(event.target.value)}
              >
                <option value="">Select a student…</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.firstName} {student.lastName} ({student.admissionNo}
                    )
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-56">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Program
              </span>
              <Select
                value={resProgramId}
                onChange={(event) => setResProgramId(event.target.value)}
              >
                <option value="">Select a program…</option>
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-56">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Semester
              </span>
              <Select
                value={resSemesterId}
                onChange={(event) => setResSemesterId(event.target.value)}
                disabled={!resProgramId}
              >
                <option value="">Select a semester…</option>
                {resSemesters.map((semester) => (
                  <option key={semester.id} value={semester.id}>
                    {semester.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              onClick={loadResult}
              disabled={!resStudentId || !resSemesterId || resLoading}
            >
              {resLoading ? "Loading…" : "View result"}
            </Button>
          </div>

          <div className="mt-3">
            <ErrorNote message={resError} />
          </div>

          {resLoading ? (
            <Spinner />
          ) : result ? (
            <div className="mt-4">
              <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
                <span className="font-semibold text-slate-900">
                  {result.semesterName}
                </span>
                <span className="text-slate-500">
                  Total credits:{" "}
                  <strong className="text-slate-900">
                    {result.totalCredits}
                  </strong>
                </span>
                <span className="text-slate-500">
                  GPA:{" "}
                  <strong className="text-slate-900">{fmt(result.gpa)}</strong>
                </span>
              </div>
              {result.subjects.length === 0 ? (
                <EmptyState message="No subject results for this semester" />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Subject</th>
                        <th className="px-4 py-3">Credits</th>
                        <th className="px-4 py-3">Percent</th>
                        <th className="px-4 py-3">Grade</th>
                        <th className="px-4 py-3">Grade point</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {result.subjects.map((subject, index) => (
                        <tr key={index} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-900">
                            {subject.subject}
                          </td>
                          <td className="px-4 py-3">{subject.credits ?? "—"}</td>
                          <td className="px-4 py-3">
                            {subject.percent != null
                              ? `${fmt(subject.percent)}%`
                              : "—"}
                          </td>
                          <td className="px-4 py-3">{subject.grade ?? "—"}</td>
                          <td className="px-4 py-3">
                            {fmt(subject.gradePoint)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </Card>

        {/* CGPA */}
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">CGPA</h2>
          <p className="mt-1 text-sm text-slate-500">
            Pick a student and program to view cumulative GPA across semesters.
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="w-64">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Student
              </span>
              <Select
                value={cgpaStudentId}
                onChange={(event) => setCgpaStudentId(event.target.value)}
              >
                <option value="">Select a student…</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.firstName} {student.lastName} ({student.admissionNo}
                    )
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-56">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Program
              </span>
              <Select
                value={cgpaProgramId}
                onChange={(event) => setCgpaProgramId(event.target.value)}
              >
                <option value="">Select a program…</option>
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              onClick={loadCgpa}
              disabled={!cgpaStudentId || !cgpaProgramId || cgpaLoading}
            >
              {cgpaLoading ? "Loading…" : "View CGPA"}
            </Button>
          </div>

          <div className="mt-3">
            <ErrorNote message={cgpaError} />
          </div>

          {cgpaLoading ? (
            <Spinner />
          ) : cgpa ? (
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-sm font-medium text-slate-500">CGPA</p>
                  <p className="mt-1 text-3xl font-semibold text-slate-900">
                    {fmt(cgpa.cgpa)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-sm font-medium text-slate-500">
                    Total credits
                  </p>
                  <p className="mt-1 text-3xl font-semibold text-slate-900">
                    {cgpa.totalCredits}
                  </p>
                </div>
              </div>
              {cgpa.perSemester.length === 0 ? (
                <EmptyState message="No per-semester GPA available" />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Semester</th>
                        <th className="px-4 py-3">GPA</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {cgpa.perSemester.map((entry) => {
                        const semester = cgpaSemesters.find(
                          (s) => s.id === entry.semesterId
                        );
                        return (
                          <tr key={entry.semesterId} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium text-slate-900">
                              {semester?.name ?? entry.semesterId}
                            </td>
                            <td className="px-4 py-3">{fmt(entry.gpa)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
