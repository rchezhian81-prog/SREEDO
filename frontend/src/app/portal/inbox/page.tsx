"use client";

import { useCallback, useEffect, useState } from "react";
import { portalApi } from "@/lib/portal-api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { InboxMessage } from "@/types";

export default function PortalInboxPage() {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMessages(await portalApi.get<InboxMessage[]>("/communication/inbox"));
    } catch {
      setError("Could not load your inbox.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markRead = async (id: string) => {
    try {
      await portalApi.post("/communication/inbox/" + id + "/read");
      await load();
    } catch {
      setError("Could not mark the message as read.");
    }
  };

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader title="Inbox" subtitle="Messages from the school" />
      <ErrorNote message={error} />
      {messages.length === 0 ? (
        <EmptyState message="Your inbox is empty." />
      ) : (
        <div className="space-y-3">
          {messages.map((message) => {
            const unread = message.readAt === null;
            return (
              <Card key={message.id}>
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
                  {message.senderName ?? "School"}
                </p>
                {unread && (
                  <div className="mt-3">
                    <Button
                      variant="secondary"
                      onClick={() => markRead(message.id)}
                    >
                      Mark read
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
