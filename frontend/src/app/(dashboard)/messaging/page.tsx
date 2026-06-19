"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  Card,
  cx,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
  Textarea,
} from "@/components/ui";
import type { Thread, ThreadDetail } from "@/types";

interface UserOption {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

/** Compact relative time for thread/message timestamps. */
function relativeTime(value: string | null): string {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(value).toLocaleDateString();
}

function threadTitle(subject: string | null, fallback: string): string {
  if (subject && subject.trim()) return subject;
  if (fallback && fallback.trim()) return fallback;
  return "Conversation";
}

export default function MessagingPage() {
  const { can, loading: permsLoading } = usePermissions();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [composeOpen, setComposeOpen] = useState(false);
  const [addPeopleOpen, setAddPeopleOpen] = useState(false);

  const canRead = can("threads:read");

  const loadThreads = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setThreads(await api.get<Thread[]>("/communication/threads"));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load conversations"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permsLoading || !canRead) return;
    loadThreads();
  }, [permsLoading, canRead, loadThreads]);

  // Open a thread: load detail, mark read, then refresh the list's unread state.
  const openThread = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      try {
        const data = await api.get<ThreadDetail>(
          `/communication/threads/${id}`
        );
        setDetail(data);
        try {
          await api.post(`/communication/threads/${id}/read`);
          setThreads((prev) =>
            prev.map((thread) =>
              thread.id === id ? { ...thread, unreadCount: 0 } : thread
            )
          );
        } catch {
          // A failed read is non-fatal; the badge simply lingers.
        }
      } catch (err) {
        setDetailError(
          err instanceof ApiError ? err.message : "Failed to load conversation"
        );
      } finally {
        setDetailLoading(false);
      }
    },
    []
  );

  const onCreated = async (thread: ThreadDetail) => {
    setComposeOpen(false);
    await loadThreads();
    setSelectedId(thread.id);
    setDetail(thread);
    setDetailError(null);
  };

  const onMessageSent = (thread: ThreadDetail) => {
    setDetail(thread);
    void loadThreads();
  };

  const onPeopleAdded = (thread: ThreadDetail) => {
    setAddPeopleOpen(false);
    setDetail(thread);
    void loadThreads();
  };

  const archive = async (id: string) => {
    if (!confirm("Archive this conversation? It will be hidden from your list."))
      return;
    try {
      await api.delete(`/communication/threads/${id}`);
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      await loadThreads();
    } catch (err) {
      alert(
        err instanceof ApiError ? err.message : "Failed to archive conversation"
      );
    }
  };

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader title="Messaging" subtitle="Threaded conversations" />
        <Spinner />
      </>
    );
  }

  if (!canRead) {
    return (
      <>
        <PageHeader title="Messaging" subtitle="Threaded conversations" />
        <EmptyState message="You don't have access to messaging." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Messaging"
        subtitle="Threaded conversations"
        action={
          can("threads:create") ? (
            <Button onClick={() => setComposeOpen(true)}>New conversation</Button>
          ) : undefined
        }
      />

      <ErrorNote message={loadError} />

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        {/* Thread list */}
        <div className="space-y-2">
          {threads.length === 0 ? (
            <EmptyState message="No conversations yet." />
          ) : (
            threads.map((thread) => {
              const active = thread.id === selectedId;
              const unread = thread.unreadCount > 0;
              return (
                <button
                  key={thread.id}
                  onClick={() => openThread(thread.id)}
                  className={cx(
                    "w-full rounded-xl border p-4 text-left transition",
                    active
                      ? "border-brand-300 bg-brand-50"
                      : "border-slate-200 bg-white hover:border-brand-200"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={cx(
                        "truncate text-sm",
                        unread
                          ? "font-semibold text-slate-900"
                          : "font-medium text-slate-800"
                      )}
                    >
                      {threadTitle(thread.subject, thread.participants)}
                    </span>
                    {unread && <Badge tone="green">{thread.unreadCount}</Badge>}
                  </div>
                  {thread.lastMessage && (
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {thread.lastMessage}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    {relativeTime(thread.lastMessageAt ?? thread.createdAt)}
                  </p>
                </button>
              );
            })
          )}
        </div>

        {/* Thread detail */}
        <div className="min-w-0">
          {!selectedId ? (
            <EmptyState message="Select a conversation to read it." />
          ) : (
            <ThreadDetailPane
              key={selectedId}
              threadId={selectedId}
              detail={detail}
              loading={detailLoading}
              error={detailError}
              canReply={can("threads:reply")}
              canManage={can("threads:manage")}
              canArchive={can("threads:delete")}
              onMessageSent={onMessageSent}
              onAddPeople={() => setAddPeopleOpen(true)}
              onArchive={() => archive(selectedId)}
            />
          )}
        </div>
      </div>

      {composeOpen && (
        <ComposeModal
          open={composeOpen}
          onClose={() => setComposeOpen(false)}
          onCreated={onCreated}
        />
      )}

      {addPeopleOpen && detail && (
        <AddPeopleModal
          open={addPeopleOpen}
          threadId={detail.id}
          existing={detail.participants.map((participant) => participant.userId)}
          onClose={() => setAddPeopleOpen(false)}
          onAdded={onPeopleAdded}
        />
      )}
    </>
  );
}

function ThreadDetailPane({
  threadId,
  detail,
  loading,
  error,
  canReply,
  canManage,
  canArchive,
  onMessageSent,
  onAddPeople,
  onArchive,
}: {
  threadId: string;
  detail: ThreadDetail | null;
  loading: boolean;
  error: string | null;
  canReply: boolean;
  canManage: boolean;
  canArchive: boolean;
  onMessageSent: (thread: ThreadDetail) => void;
  onAddPeople: () => void;
  onArchive: () => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      await api.post(`/communication/threads/${threadId}/messages`, {
        body: body.trim(),
      });
      const refreshed = await api.get<ThreadDetail>(
        `/communication/threads/${threadId}`
      );
      onMessageSent(refreshed);
      setBody("");
    } catch (err) {
      setSendError(
        err instanceof ApiError ? err.message : "Failed to send message"
      );
    } finally {
      setSending(false);
    }
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!detail) return <EmptyState message="Conversation not found." />;

  return (
    <Card className="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-slate-900">
            {threadTitle(
              detail.subject,
              detail.participants.map((p) => p.name).join(", ")
            )}
          </h2>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {detail.participants.map((p) => p.name).join(", ")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {canManage && (
            <Button variant="secondary" onClick={onAddPeople}>
              Add people
            </Button>
          )}
          {canArchive && (
            <Button variant="ghost" onClick={onArchive}>
              Archive
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {detail.messages.length === 0 ? (
          <EmptyState message="No messages yet." />
        ) : (
          detail.messages.map((message) => (
            <div key={message.id} className="rounded-lg bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-800">
                  {message.senderName ?? "Unknown"}
                </span>
                <span className="text-xs text-slate-400">
                  {new Date(message.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                {message.body}
              </p>
            </div>
          ))
        )}
      </div>

      {canReply && (
        <div className="border-t border-slate-200 pt-3">
          <Textarea
            rows={3}
            placeholder="Write a reply…"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="mt-2">
            <ErrorNote message={sendError} />
          </div>
          <div className="mt-2 flex justify-end">
            <Button onClick={send} disabled={sending || !body.trim()}>
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ComposeModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (thread: ThreadDetail) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<UserOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchDenied, setSearchDenied] = useState(false);
  const [selected, setSelected] = useState<UserOption[]>([]);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced participant search against /users (admin-only on the backend).
  useEffect(() => {
    const term = search.trim();
    if (!term) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(() => {
      api
        .get<unknown>(`/users?search=${encodeURIComponent(term)}`)
        .then((raw) => {
          if (cancelled) return;
          // The endpoint may return a bare array or a paginated { data: [...] }.
          const list = Array.isArray(raw)
            ? raw
            : Array.isArray((raw as { data?: unknown }).data)
              ? (raw as { data: unknown[] }).data
              : [];
          setResults(list as UserOption[]);
          setSearchDenied(false);
        })
        .catch((err) => {
          if (cancelled) return;
          setResults([]);
          if (err instanceof ApiError && err.status === 403) {
            setSearchDenied(true);
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [search]);

  const toggle = (user: UserOption) => {
    setSelected((prev) =>
      prev.some((selectedUser) => selectedUser.id === user.id)
        ? prev.filter((selectedUser) => selectedUser.id !== user.id)
        : [...prev, user]
    );
  };

  const create = async () => {
    setError(null);
    if (selected.length === 0) {
      setError("Add at least one participant.");
      return;
    }
    setSubmitting(true);
    try {
      const thread = await api.post<ThreadDetail>("/communication/threads", {
        participantIds: selected.map((user) => user.id),
        ...(subject.trim() ? { subject: subject.trim() } : {}),
        ...(body.trim() ? { body: body.trim() } : {}),
      });
      onCreated(thread);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to start conversation"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="New conversation" open={open} onClose={onClose}>
      {searchDenied ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Participant search requires admin; you can reply to conversations
          you&apos;re part of.
        </p>
      ) : (
        <div className="space-y-4">
          <Field label="Add people">
            <Input
              placeholder="Search by name or email…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selected.map((user) => (
                <span
                  key={user.id}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700"
                >
                  {user.fullName}
                  <button
                    type="button"
                    onClick={() => toggle(user)}
                    className="text-brand-500 hover:text-brand-700"
                    aria-label={`Remove ${user.fullName}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          {searching ? (
            <p className="text-xs text-slate-400">Searching…</p>
          ) : (
            results.length > 0 && (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1">
                {results.map((user) => {
                  const picked = selected.some(
                    (selectedUser) => selectedUser.id === user.id
                  );
                  return (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => toggle(user)}
                      className={cx(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition",
                        picked
                          ? "bg-brand-50 text-brand-700"
                          : "hover:bg-slate-50"
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-800">
                          {user.fullName}
                        </span>
                        <span className="block truncate text-xs text-slate-400">
                          {user.email}
                        </span>
                      </span>
                      <Badge tone="slate">{user.role}</Badge>
                    </button>
                  );
                })}
              </div>
            )
          )}

          <Field label="Subject (optional)">
            <Input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </Field>

          <Field label="Message (optional)">
            <Textarea
              rows={4}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </Field>

          <ErrorNote message={error} />

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={create} disabled={submitting}>
              {submitting ? "Starting…" : "Start conversation"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function AddPeopleModal({
  open,
  threadId,
  existing,
  onClose,
  onAdded,
}: {
  open: boolean;
  threadId: string;
  existing: string[];
  onClose: () => void;
  onAdded: (thread: ThreadDetail) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<UserOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchDenied, setSearchDenied] = useState(false);
  const [selected, setSelected] = useState<UserOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = search.trim();
    if (!term) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(() => {
      api
        .get<unknown>(`/users?search=${encodeURIComponent(term)}`)
        .then((raw) => {
          if (cancelled) return;
          const list = Array.isArray(raw)
            ? raw
            : Array.isArray((raw as { data?: unknown }).data)
              ? (raw as { data: unknown[] }).data
              : [];
          setResults(
            (list as UserOption[]).filter(
              (user) => !existing.includes(user.id)
            )
          );
          setSearchDenied(false);
        })
        .catch((err) => {
          if (cancelled) return;
          setResults([]);
          if (err instanceof ApiError && err.status === 403) {
            setSearchDenied(true);
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [search, existing]);

  const toggle = (user: UserOption) => {
    setSelected((prev) =>
      prev.some((selectedUser) => selectedUser.id === user.id)
        ? prev.filter((selectedUser) => selectedUser.id !== user.id)
        : [...prev, user]
    );
  };

  const submit = async () => {
    setError(null);
    if (selected.length === 0) {
      setError("Select at least one person to add.");
      return;
    }
    setSubmitting(true);
    try {
      const thread = await api.post<ThreadDetail>(
        `/communication/threads/${threadId}/participants`,
        { participantIds: selected.map((user) => user.id) }
      );
      onAdded(thread);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add people");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Add people" open={open} onClose={onClose}>
      {searchDenied ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Participant search requires admin.
        </p>
      ) : (
        <div className="space-y-4">
          <Field label="Search people">
            <Input
              placeholder="Search by name or email…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selected.map((user) => (
                <span
                  key={user.id}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700"
                >
                  {user.fullName}
                  <button
                    type="button"
                    onClick={() => toggle(user)}
                    className="text-brand-500 hover:text-brand-700"
                    aria-label={`Remove ${user.fullName}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          {searching ? (
            <p className="text-xs text-slate-400">Searching…</p>
          ) : (
            results.length > 0 && (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1">
                {results.map((user) => {
                  const picked = selected.some(
                    (selectedUser) => selectedUser.id === user.id
                  );
                  return (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => toggle(user)}
                      className={cx(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition",
                        picked
                          ? "bg-brand-50 text-brand-700"
                          : "hover:bg-slate-50"
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-800">
                          {user.fullName}
                        </span>
                        <span className="block truncate text-xs text-slate-400">
                          {user.email}
                        </span>
                      </span>
                      <Badge tone="slate">{user.role}</Badge>
                    </button>
                  );
                })}
              </div>
            )
          )}

          <ErrorNote message={error} />

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Adding…" : "Add to conversation"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
