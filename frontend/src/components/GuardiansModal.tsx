"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  ErrorNote,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
} from "@/components/ui";
import type { AccountUser, Paginated, Student } from "@/types";

interface Guardian {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  relationship: string;
}

/**
 * Admin dialog to link/unlink parent accounts to a student. A linked parent can
 * then see the child in the parent portal (server enforces the scoping).
 */
export function GuardiansModal({
  student,
  onClose,
}: {
  student: Student | null;
  onClose: () => void;
}) {
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [parents, setParents] = useState<AccountUser[]>([]);
  const [userId, setUserId] = useState("");
  const [relationship, setRelationship] = useState("guardian");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    setError(null);
    try {
      const [links, users] = await Promise.all([
        api.get<Guardian[]>(`/students/${student.id}/guardians`),
        api.get<Paginated<AccountUser>>("/users?role=parent&limit=200"),
      ]);
      setGuardians(links);
      setParents(users.data);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load guardians"
      );
    } finally {
      setLoading(false);
    }
  }, [student]);

  useEffect(() => {
    if (student) {
      setUserId("");
      setRelationship("guardian");
      void load();
    }
  }, [student, load]);

  const link = async () => {
    if (!student || !userId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/students/${student.id}/guardians`, {
        userId,
        relationship: relationship.trim() || undefined,
      });
      setUserId("");
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to link guardian"
      );
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (guardianId: string) => {
    if (!student) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/students/${student.id}/guardians/${guardianId}`);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to unlink guardian"
      );
    } finally {
      setBusy(false);
    }
  };

  // Only offer parents who aren't already linked to this student.
  const linkedIds = new Set(guardians.map((g) => g.userId));
  const available = parents.filter((p) => !linkedIds.has(p.id));

  return (
    <Modal
      title={
        student
          ? `Guardians · ${student.firstName} ${student.lastName}`
          : "Guardians"
      }
      open={student !== null}
      onClose={onClose}
    >
      <div className="space-y-4">
        {loading ? (
          <Spinner />
        ) : (
          <>
            {guardians.length === 0 ? (
              <p className="text-sm text-muted">
                No parent accounts linked yet.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {guardians.map((g) => (
                  <li
                    key={g.id}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {g.fullName}
                      </p>
                      <p className="text-xs text-faint">
                        {g.email} · {g.relationship}
                      </p>
                    </div>
                    <button
                      onClick={() => unlink(g.id)}
                      disabled={busy}
                      className="text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      Unlink
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
              <Field label="Link a parent account">
                <Select
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                >
                  <option value="">
                    {available.length
                      ? "Select a parent…"
                      : "No parent accounts available"}
                  </option>
                  {available.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} ({p.email})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Relationship">
                <Input
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  placeholder="guardian"
                />
              </Field>
            </div>
          </>
        )}
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="button" disabled={busy || !userId} onClick={link}>
            {busy ? "Saving…" : "Link parent"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
