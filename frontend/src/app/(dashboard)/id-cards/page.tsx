"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Button,
  Card,
  ErrorNote,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { AccountUser, Paginated, SchoolClass, Student } from "@/types";

interface SectionOption {
  id: string;
  label: string;
}

async function downloadPdf(path: string, filename: string) {
  const base =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const d = await res.json();
      if (typeof d.error === "string") msg = d.error;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function IdCardsPage() {
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === "admin";

  const [students, setStudents] = useState<Student[]>([]);
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [staff, setStaff] = useState<AccountUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Student ID download state.
  const [studentId, setStudentId] = useState("");
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentError, setStudentError] = useState<string | null>(null);

  // Bulk (section) download state.
  const [sectionId, setSectionId] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Staff ID download state.
  const [staffId, setStaffId] = useState("");
  const [myLoading, setMyLoading] = useState(false);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api
        .get<Paginated<Student>>("/students?limit=100")
        .then((res) => setStudents(res.data))
        .catch(() => undefined),
      api
        .get<SchoolClass[]>("/classes")
        .then((classes) => {
          const options = classes.flatMap((schoolClass) =>
            schoolClass.sections.map((section) => ({
              id: section.id,
              label: `${schoolClass.name} - ${section.name}`,
            }))
          );
          setSections(options);
        })
        .catch(() => undefined),
      // Staff list is admin-only — guard so non-admins never call it.
      isAdmin
        ? api
            .get<Paginated<AccountUser>>("/users?limit=100")
            .then((res) => setStaff(res.data))
            .catch(() => undefined)
        : Promise.resolve(),
    ]).finally(() => setLoading(false));
  }, [isAdmin]);

  const downloadStudentId = async () => {
    if (!studentId) {
      setStudentError("Select a student first");
      return;
    }
    setStudentLoading(true);
    setStudentError(null);
    try {
      await downloadPdf(
        `/id-cards/student/${studentId}/download`,
        "student-id-card.pdf"
      );
    } catch (err) {
      setStudentError(
        err instanceof ApiError ? err.message : "Failed to download ID card"
      );
    } finally {
      setStudentLoading(false);
    }
  };

  const downloadSectionIds = async () => {
    if (!sectionId) {
      setBulkError("Select a section first");
      return;
    }
    setBulkLoading(true);
    setBulkError(null);
    try {
      await downloadPdf(
        `/id-cards/section/${sectionId}/bulk`,
        "section-id-cards.pdf"
      );
    } catch (err) {
      setBulkError(
        err instanceof ApiError ? err.message : "Failed to download ID cards"
      );
    } finally {
      setBulkLoading(false);
    }
  };

  const downloadMyId = async () => {
    if (!user?.id) {
      setStaffError("No user session found");
      return;
    }
    setMyLoading(true);
    setStaffError(null);
    try {
      await downloadPdf(
        `/id-cards/staff/${user.id}/download`,
        "my-id-card.pdf"
      );
    } catch (err) {
      setStaffError(
        err instanceof ApiError ? err.message : "Failed to download ID card"
      );
    } finally {
      setMyLoading(false);
    }
  };

  const downloadStaffId = async () => {
    if (!staffId) {
      setStaffError("Select a staff member first");
      return;
    }
    setStaffLoading(true);
    setStaffError(null);
    try {
      await downloadPdf(
        `/id-cards/staff/${staffId}/download`,
        "staff-id-card.pdf"
      );
    } catch (err) {
      setStaffError(
        err instanceof ApiError ? err.message : "Failed to download ID card"
      );
    } finally {
      setStaffLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="ID Cards"
        subtitle="Generate student and staff ID cards"
      />

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Student ID
            </h2>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-72">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  Student
                </span>
                <Select
                  value={studentId}
                  onChange={(event) => setStudentId(event.target.value)}
                >
                  <option value="">Select student…</option>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.firstName} {student.lastName} (
                      {student.admissionNo})
                    </option>
                  ))}
                </Select>
              </div>
              <Button onClick={downloadStudentId} disabled={studentLoading}>
                {studentLoading ? "Downloading…" : "Download ID card"}
              </Button>
            </div>
            <div className="mt-3">
              <ErrorNote message={studentError} />
            </div>
          </Card>

          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Bulk (section)
            </h2>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-72">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  Section
                </span>
                <Select
                  value={sectionId}
                  onChange={(event) => setSectionId(event.target.value)}
                >
                  <option value="">Select section…</option>
                  {sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button onClick={downloadSectionIds} disabled={bulkLoading}>
                {bulkLoading ? "Downloading…" : "Download section ID cards"}
              </Button>
            </div>
            <div className="mt-3">
              <ErrorNote message={bulkError} />
            </div>
          </Card>

          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Staff ID
            </h2>
            <div className="flex flex-wrap items-end gap-3">
              <Button onClick={downloadMyId} disabled={myLoading}>
                {myLoading ? "Downloading…" : "Download my ID card"}
              </Button>
              {isAdmin && (
                <>
                  <div className="w-72">
                    <span className="mb-1 block text-sm font-medium text-slate-700">
                      Staff member
                    </span>
                    <Select
                      value={staffId}
                      onChange={(event) => setStaffId(event.target.value)}
                    >
                      <option value="">Select staff…</option>
                      {staff.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.fullName} ({member.role.replace("_", " ")})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button onClick={downloadStaffId} disabled={staffLoading}>
                    {staffLoading ? "Downloading…" : "Download staff ID card"}
                  </Button>
                </>
              )}
            </div>
            <div className="mt-3">
              <ErrorNote message={staffError} />
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
