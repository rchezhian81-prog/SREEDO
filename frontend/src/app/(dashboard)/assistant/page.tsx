"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, cx, Input, PageHeader } from "@/components/ui";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setMessages((current) => [...current, { role: "user", content: message }]);
    setBusy(true);
    try {
      const result = await api.post<{
        reply: string;
        conversationId: string | null;
      }>("/ai/assistant", {
        message,
        ...(conversationId ? { conversationId } : {}),
      });
      setConversationId(result.conversationId);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: result.reply },
      ]);
    } catch (err) {
      const detail =
        err instanceof ApiError && err.status === 503
          ? "The AI assistant is not configured. Set OPENAI_API_KEY on the server to enable it."
          : err instanceof ApiError
            ? err.message
            : "Something went wrong.";
      setMessages((current) => [
        ...current,
        { role: "assistant", content: `⚠️ ${detail}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-11rem)] flex-col">
      <PageHeader
        title="AI Assistant"
        subtitle="Ask about students, attendance, fees — powered by GPT-4o with live school data"
      />
      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-line bg-surface p-4">
        {messages.length === 0 && (
          <div className="py-16 text-center text-sm text-faint">
            <p className="text-3xl">✨</p>
            <p className="mt-2">
              Try: “How many students are enrolled?” or “What fees are
              outstanding?”
            </p>
          </div>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={cx(
              "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
              message.role === "user"
                ? "ml-auto bg-brand-600 text-white"
                : "bg-hover text-ink"
            )}
          >
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        ))}
        {busy && (
          <div className="max-w-[80%] rounded-2xl bg-hover px-4 py-2.5 text-sm text-faint">
            Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          placeholder="Ask the assistant…"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void send();
          }}
        />
        <Button onClick={send} disabled={busy || !input.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}
