"use client";

// Lightweight global toast: call `toast.success("Saved")` from anywhere; a single
// <Toaster /> (mounted once in the dashboard layout) renders the stack. No context
// wrapping / prop drilling — a tiny module-level pub/sub keeps it self-contained.
import { useEffect, useState } from "react";

type ToastType = "success" | "error" | "info";
export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

let counter = 0;
const listeners = new Set<(t: ToastItem) => void>();

function emit(message: string, type: ToastType) {
  const item: ToastItem = { id: (counter += 1), message, type };
  listeners.forEach((l) => l(item));
}

export const toast = {
  success: (message: string) => emit(message, "success"),
  error: (message: string) => emit(message, "error"),
  info: (message: string) => emit(message, "info"),
};

const TONE: Record<ToastType, string> = {
  success: "bg-emerald-600 text-white",
  error: "bg-red-600 text-white",
  info: "bg-slate-800 text-white",
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (t: ToastItem) => {
      setItems((s) => [...s, t]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), 4000);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          aria-live="polite"
          className={`pointer-events-auto max-w-sm rounded-lg px-4 py-2.5 text-sm shadow-pop ${TONE[t.type]}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
