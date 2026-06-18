"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type {
  LibraryBook,
  LibraryHistoryRow,
  LibraryMember,
} from "@/types";

const RETURN_CONDITIONS = ["ok", "lost", "damaged"] as const;

const issueSchema = z.object({
  memberId: z.string().min(1, "Required"),
  bookId: z.string().min(1, "Required"),
  dueDate: z.string().optional(),
});

type IssueForm = z.infer<typeof issueSchema>;

function fmtDate(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

export default function LibraryCirculationPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canIssue = can("library:issue");
  const canReturn = can("library:return");
  const canFines = can("library:fines");

  const [members, setMembers] = useState<LibraryMember[]>([]);
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issueOk, setIssueOk] = useState(false);

  // Loan management.
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [loans, setLoans] = useState<LibraryHistoryRow[]>([]);
  const [loansLoading, setLoansLoading] = useState(false);
  const [loansError, setLoansError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [returnCondition, setReturnCondition] = useState<
    Record<string, (typeof RETURN_CONDITIONS)[number]>
  >({});

  const loadLists = useCallback(async () => {
    setLoadError(null);
    try {
      const [memberList, bookList] = await Promise.all([
        api.get<LibraryMember[]>("/library/members"),
        api.get<LibraryBook[]>("/library/books"),
      ]);
      setMembers(memberList);
      setBooks(bookList);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load circulation data"
      );
    }
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  const loadLoans = useCallback(async (memberId: string) => {
    if (!memberId) {
      setLoans([]);
      return;
    }
    setLoansLoading(true);
    setLoansError(null);
    try {
      const history = await api.get<LibraryHistoryRow[]>(
        `/library/members/${memberId}/history`
      );
      setLoans(history.filter((row) => row.status !== "returned"));
    } catch (err) {
      setLoansError(
        err instanceof ApiError ? err.message : "Failed to load loans"
      );
    } finally {
      setLoansLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLoans(selectedMemberId);
  }, [selectedMemberId, loadLoans]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<IssueForm>({ resolver: zodResolver(issueSchema) });

  const onIssue = async (values: IssueForm) => {
    setIssueError(null);
    setIssueOk(false);
    try {
      await api.post("/library/issues", {
        memberId: values.memberId,
        bookId: values.bookId,
        dueDate: values.dueDate || undefined,
      });
      setIssueOk(true);
      reset({ memberId: values.memberId, bookId: "", dueDate: "" });
      await loadLists();
      // Refresh loans if the issued member is the one being viewed.
      if (selectedMemberId === values.memberId) {
        await loadLoans(selectedMemberId);
      }
    } catch (err) {
      setIssueError(
        err instanceof ApiError ? err.message : "Failed to issue book"
      );
    }
  };

  const runAction = async (
    loan: LibraryHistoryRow,
    action: "renew" | "return" | "waive-fine" | "post-fine"
  ) => {
    setActionId(loan.id);
    setActionError(null);
    try {
      if (action === "return") {
        await api.post(`/library/issues/${loan.id}/return`, {
          condition: returnCondition[loan.id] ?? "ok",
        });
      } else {
        await api.post(`/library/issues/${loan.id}/${action}`);
      }
      await Promise.all([loadLoans(selectedMemberId), loadLists()]);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : `Failed to ${action}`
      );
    } finally {
      setActionId(null);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Circulation" subtitle="Issue & return" />
        <Spinner />
      </>
    );
  }

  if (!can("library:read")) {
    return (
      <>
        <PageHeader title="Circulation" subtitle="Issue & return" />
        <EmptyState message="You do not have access to the library." />
      </>
    );
  }

  const availableBooks = books.filter((book) => book.availableCopies > 0);

  return (
    <>
      <PageHeader title="Circulation" subtitle="Issue, return & renew" />

      <div className="mb-4">
        <Link
          href="/library"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Library
        </Link>
      </div>

      <ErrorNote message={loadError} />

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        {/* Issue form */}
        {canIssue ? (
          <Card className="h-fit">
            <h2 className="text-sm font-semibold text-slate-900">Issue a book</h2>
            <form onSubmit={handleSubmit(onIssue)} className="mt-4 space-y-4">
              <Field label="Member" error={errors.memberId?.message}>
                <Select {...register("memberId")}>
                  <option value="">Select a member…</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                      {member.memberCode ? ` (${member.memberCode})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Book" error={errors.bookId?.message}>
                <Select {...register("bookId")}>
                  <option value="">Select a book…</option>
                  {availableBooks.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.title} ({book.availableCopies} available)
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Due date (optional)" error={errors.dueDate?.message}>
                <Input type="date" {...register("dueDate")} />
              </Field>
              {issueOk && (
                <p className="text-sm text-emerald-600">Book issued.</p>
              )}
              <ErrorNote message={issueError} />
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting || availableBooks.length === 0}
              >
                {isSubmitting ? "Issuing…" : "Issue book"}
              </Button>
            </form>
          </Card>
        ) : (
          <Card className="h-fit">
            <p className="text-sm text-slate-500">
              You do not have permission to issue books. Use the loan lookup to
              view a member&apos;s open loans.
            </p>
          </Card>
        )}

        {/* Loan management */}
        <div>
          <div className="mb-4 w-72">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Open loans for member
            </span>
            <Select
              value={selectedMemberId}
              onChange={(event) => {
                setSelectedMemberId(event.target.value);
                setActionError(null);
              }}
            >
              <option value="">Select a member…</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                  {member.openLoans ? ` · ${member.openLoans} open` : ""}
                </option>
              ))}
            </Select>
          </div>

          <ErrorNote message={actionError} />

          {!selectedMemberId ? (
            <EmptyState message="Select a member to view and manage their open loans" />
          ) : loansLoading ? (
            <Spinner />
          ) : loansError ? (
            <ErrorNote message={loansError} />
          ) : loans.length === 0 ? (
            <EmptyState message="No open loans for this member" />
          ) : (
            <div className="space-y-3">
              {loans.map((loan) => {
                const busy = actionId === loan.id;
                const fine = Number(loan.fineAmount ?? 0);
                return (
                  <Card key={loan.id}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {loan.title}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {loan.accessionNumber
                            ? `Copy ${loan.accessionNumber} · `
                            : ""}
                          Issued {fmtDate(loan.issueDate)} · Due{" "}
                          {fmtDate(loan.dueDate)}
                          {loan.renewedCount > 0
                            ? ` · Renewed ${loan.renewedCount}×`
                            : ""}
                        </p>
                        {fine > 0 && (
                          <p className="mt-1 text-xs text-slate-500">
                            Fine: {loan.fineAmount}
                            {loan.fineStatus ? ` (${loan.fineStatus})` : ""}
                          </p>
                        )}
                      </div>
                      <Badge tone={loan.overdue ? "red" : "blue"}>
                        {loan.overdue ? "overdue" : loan.status}
                      </Badge>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {canReturn && (
                        <>
                          <Select
                            className="w-28"
                            value={returnCondition[loan.id] ?? "ok"}
                            onChange={(event) =>
                              setReturnCondition((prev) => ({
                                ...prev,
                                [loan.id]: event.target
                                  .value as (typeof RETURN_CONDITIONS)[number],
                              }))
                            }
                          >
                            {RETURN_CONDITIONS.map((condition) => (
                              <option key={condition} value={condition}>
                                {condition}
                              </option>
                            ))}
                          </Select>
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => runAction(loan, "return")}
                          >
                            Return
                          </Button>
                        </>
                      )}
                      {canIssue && (
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => runAction(loan, "renew")}
                        >
                          Renew
                        </Button>
                      )}
                      {canFines && fine > 0 && (
                        <>
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => runAction(loan, "post-fine")}
                          >
                            Post fine
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() => runAction(loan, "waive-fine")}
                          >
                            Waive fine
                          </Button>
                        </>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
