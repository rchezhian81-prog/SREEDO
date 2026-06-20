"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
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
  Textarea,
} from "@/components/ui";
import type {
  InboxMessage,
  Paginated,
  SchoolClass,
  SentMessage,
  Student,
} from "@/types";
import { useI18n } from "@/i18n/I18nProvider";

type Tab = "compose" | "sent" | "inbox";

type AudienceType =
  | "all_students"
  | "all_parents"
  | "staff"
  | "section"
  | "class"
  | "student";

const AUDIENCE_OPTIONS: { value: AudienceType; label: string }[] = [
  { value: "all_students", label: "All students" },
  { value: "all_parents", label: "All parents" },
  { value: "staff", label: "Staff" },
  { value: "section", label: "Section" },
  { value: "class", label: "Class" },
  { value: "student", label: "Student" },
];

interface SectionOption {
  id: string;
  label: string;
}

interface ClassOption {
  id: string;
  label: string;
}

function tabClass(active: boolean) {
  return active
    ? "border-brand-600 text-brand-700"
    : "border-transparent text-slate-500 hover:text-slate-700";
}

export default function CommunicationPage() {
  const { t } = useI18n();
  const role = useAuthStore((state) => state.user?.role);
  const canSendNotifications =
    role === "admin" || role === "teacher" || role === "accountant";
  const isAdmin = role === "admin";

  const [tab, setTab] = useState<Tab>("compose");

  return (
    <>
      <PageHeader
        title={t("pages.communication.title")}
        subtitle={t("pages.communication.subtitle")}
      />

      <div className="mb-6 flex gap-2 border-b border-slate-200">
        <button
          onClick={() => setTab("compose")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition ${tabClass(
            tab === "compose"
          )}`}
        >
          Compose
        </button>
        <button
          onClick={() => setTab("sent")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition ${tabClass(
            tab === "sent"
          )}`}
        >
          Sent
        </button>
        <button
          onClick={() => setTab("inbox")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition ${tabClass(
            tab === "inbox"
          )}`}
        >
          Inbox
        </button>
      </div>

      {tab === "compose" && (
        <ComposeTab canSendNotifications={canSendNotifications} />
      )}
      {tab === "sent" && <SentTab isAdmin={isAdmin} />}
      {tab === "inbox" && <InboxTab />}
    </>
  );
}

function ComposeTab({
  canSendNotifications,
}: {
  canSendNotifications: boolean;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("message");
  const [audienceType, setAudienceType] = useState<AudienceType>("all_students");
  const [audienceRef, setAudienceRef] = useState("");

  const [sections, setSections] = useState<SectionOption[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [pickersLoaded, setPickersLoaded] = useState(false);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const needsRef =
    audienceType === "section" ||
    audienceType === "class" ||
    audienceType === "student";

  // Load picker data lazily the first time a ref-based audience is selected.
  useEffect(() => {
    if (!needsRef || pickersLoaded) return;
    let cancelled = false;
    Promise.all([
      api.get<SchoolClass[]>("/classes"),
      api.get<Paginated<Student>>("/students?limit=100"),
    ])
      .then(([schoolClasses, studentRes]) => {
        if (cancelled) return;
        setClasses(
          schoolClasses.map((schoolClass) => ({
            id: schoolClass.id,
            label: schoolClass.name,
          }))
        );
        setSections(
          schoolClasses.flatMap((schoolClass) =>
            schoolClass.sections.map((section) => ({
              id: section.id,
              label: `${schoolClass.name} - ${section.name}`,
            }))
          )
        );
        setStudents(studentRes.data);
        setPickersLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load recipient options.");
      });
    return () => {
      cancelled = true;
    };
  }, [needsRef, pickersLoaded]);

  const onAudienceChange = (value: AudienceType) => {
    setAudienceType(value);
    setAudienceRef("");
  };

  const send = async () => {
    setError(null);
    setSuccess(null);
    if (!subject.trim() || !body.trim()) {
      setError("Subject and message are required.");
      return;
    }
    if (needsRef && !audienceRef) {
      setError("Select a recipient for the chosen audience.");
      return;
    }
    setSending(true);
    try {
      const result = await api.post<{
        messageId: string;
        recipientCount: number;
      }>("/communication/messages", {
        subject,
        body,
        category,
        audienceType,
        ...(needsRef ? { audienceRef } : {}),
      });
      setSuccess(`Sent to ${result.recipientCount} recipients`);
      setSubject("");
      setBody("");
      setAudienceRef("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">
          New message
        </h2>
        <div className="space-y-4">
          <Field label="Subject">
            <Input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </Field>
          <Field label="Message">
            <Textarea
              rows={5}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category">
              <Select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="message">Message</option>
                <option value="announcement">Announcement</option>
                <option value="general">General</option>
              </Select>
            </Field>
            <Field label="Audience">
              <Select
                value={audienceType}
                onChange={(event) =>
                  onAudienceChange(event.target.value as AudienceType)
                }
              >
                {AUDIENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {audienceType === "section" && (
            <Field label="Section">
              <Select
                value={audienceRef}
                onChange={(event) => setAudienceRef(event.target.value)}
              >
                <option value="">Select section…</option>
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {audienceType === "class" && (
            <Field label="Class">
              <Select
                value={audienceRef}
                onChange={(event) => setAudienceRef(event.target.value)}
              >
                <option value="">Select class…</option>
                {classes.map((schoolClass) => (
                  <option key={schoolClass.id} value={schoolClass.id}>
                    {schoolClass.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {audienceType === "student" && (
            <Field label="Student">
              <Select
                value={audienceRef}
                onChange={(event) => setAudienceRef(event.target.value)}
              >
                <option value="">Select student…</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.firstName} {student.lastName} (
                    {student.admissionNo})
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {success && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {success}
            </p>
          )}
          <ErrorNote message={error} />

          <div className="flex justify-end">
            <Button onClick={send} disabled={sending}>
              {sending ? "Sending…" : "Send message"}
            </Button>
          </div>
        </div>
      </Card>

      {canSendNotifications && <NotificationsCard />}
    </div>
  );
}

function NotificationsCard() {
  const [feeLoading, setFeeLoading] = useState(false);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [feeResult, setFeeResult] = useState<string | null>(null);

  const [date, setDate] = useState("");
  const [absenceLoading, setAbsenceLoading] = useState(false);
  const [absenceError, setAbsenceError] = useState<string | null>(null);
  const [absenceResult, setAbsenceResult] = useState<string | null>(null);

  const sendFeeReminders = async () => {
    setFeeLoading(true);
    setFeeError(null);
    setFeeResult(null);
    try {
      const result = await api.post<{ students: number; recipients: number }>(
        "/communication/fee-reminders",
        {}
      );
      setFeeResult(
        `Reminders for ${result.students} students sent to ${result.recipients} recipients`
      );
    } catch (err) {
      setFeeError(
        err instanceof ApiError ? err.message : "Failed to send fee reminders"
      );
    } finally {
      setFeeLoading(false);
    }
  };

  const sendAbsenceAlerts = async () => {
    setAbsenceError(null);
    setAbsenceResult(null);
    if (!date) {
      setAbsenceError("Select a date first.");
      return;
    }
    setAbsenceLoading(true);
    try {
      const result = await api.post<{ students: number; recipients: number }>(
        "/communication/absence-alerts",
        { date }
      );
      setAbsenceResult(
        `Alerts for ${result.students} students sent to ${result.recipients} recipients`
      );
    } catch (err) {
      setAbsenceError(
        err instanceof ApiError ? err.message : "Failed to send absence alerts"
      );
    } finally {
      setAbsenceLoading(false);
    }
  };

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold text-slate-900">
        Notifications
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        Trigger automated reminders to parents.
      </p>

      <div className="space-y-6">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={sendFeeReminders} disabled={feeLoading}>
              {feeLoading ? "Sending…" : "Send fee reminders"}
            </Button>
            {feeResult && (
              <span className="text-sm text-emerald-700">{feeResult}</span>
            )}
          </div>
          <div className="mt-2">
            <ErrorNote message={feeError} />
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-48">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Absence date
              </span>
              <Input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <Button onClick={sendAbsenceAlerts} disabled={absenceLoading}>
              {absenceLoading ? "Sending…" : "Send absence alerts"}
            </Button>
            {absenceResult && (
              <span className="text-sm text-emerald-700">{absenceResult}</span>
            )}
          </div>
          <div className="mt-2">
            <ErrorNote message={absenceError} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function SentTab({ isAdmin }: { isAdmin: boolean }) {
  const [messages, setMessages] = useState<SentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMessages(await api.get<SentMessage[]>("/communication/messages"));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not load sent messages."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (message: SentMessage) => {
    if (!confirm(`Delete "${message.subject}"?`)) return;
    try {
      await api.delete(`/communication/messages/${message.id}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete message");
    }
  };

  if (loading) return <Spinner />;

  return (
    <>
      <ErrorNote message={error} />
      {messages.length === 0 ? (
        <EmptyState message="No messages sent yet." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Audience</th>
                <th className="px-4 py-3">Read</th>
                <th className="px-4 py-3">Sent</th>
                {isAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {messages.map((message) => (
                <tr key={message.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {message.subject}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone="blue">{message.category}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {message.audienceType ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {message.readCount}/{message.recipientCount} read
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(message.createdAt).toLocaleString()}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => remove(message)}
                        className="text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function InboxTab() {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMessages(await api.get<InboxMessage[]>("/communication/inbox"));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not load your inbox."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markRead = async (message: InboxMessage) => {
    if (message.readAt !== null) return;
    try {
      await api.post(`/communication/inbox/${message.id}/read`);
      await load();
    } catch {
      // Surface nothing intrusive; a failed read can be retried by clicking.
    }
  };

  if (loading) return <Spinner />;

  return (
    <>
      <ErrorNote message={error} />
      {messages.length === 0 ? (
        <EmptyState message="Your inbox is empty." />
      ) : (
        <div className="space-y-3">
          {messages.map((message) => {
            const unread = message.readAt === null;
            return (
              <Card
                key={message.id}
                className={unread ? "cursor-pointer ring-1 ring-brand-200" : ""}
              >
                <div
                  onClick={() => markRead(message)}
                  role={unread ? "button" : undefined}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-medium text-slate-900">
                      {message.subject}
                    </h3>
                    {unread && <Badge tone="green">Unread</Badge>}
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-600">
                    {message.body}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    {new Date(message.createdAt).toLocaleString()} ·{" "}
                    {message.senderName ?? "System"}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
