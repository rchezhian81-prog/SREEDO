"use client";

import {
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { Icon } from "@/components/icons";

export function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "danger" | "ghost";
  }
>(function Button({ variant = "primary", className, ...props }, ref) {
  const styles = {
    primary:
      "bg-brand-600 text-white shadow-[0_8px_18px_rgb(37_99_235_/_0.32)] hover:bg-brand-700 disabled:bg-brand-600/50 disabled:shadow-none",
    secondary:
      "border border-line bg-surface text-ink hover:bg-hover",
    danger:
      "bg-red-600 text-white shadow-[0_8px_18px_rgb(239_68_68_/_0.3)] hover:bg-red-700",
    ghost: "text-muted hover:bg-hover hover:text-ink",
  }[variant];
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-2",
        styles,
        className
      )}
      {...props}
    />
  );
});

const fieldStyles =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-faint transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cx(fieldStyles, className)} {...props} />;
});

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cx(fieldStyles, className)} {...props} />;
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea ref={ref} className={cx(fieldStyles, className)} {...props} />
  );
});

/**
 * Labelled form field. Associates the <label> with its control via a generated
 * id and, when there is an error, wires `aria-invalid` + `aria-describedby` so
 * screen readers announce the message (WCAG 1.3.1 / 3.3.1).
 */
export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  const errorId = `${generatedId}-error`;
  const childId =
    isValidElement(children) && (children.props as { id?: string }).id
      ? (children.props as { id?: string }).id
      : generatedId;

  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: childId,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error ? errorId : undefined,
      })
    : children;

  return (
    <div className="block">
      <label
        htmlFor={childId}
        className="mb-1.5 block text-sm font-medium text-ink"
      >
        {label}
      </label>
      {control}
      {error && (
        <span id={errorId} className="mt-1 block text-xs text-red-500">
          {error}
        </span>
      )}
    </div>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-2xl border border-line bg-surface p-5 shadow-card",
        className
      )}
    >
      {children}
    </div>
  );
}

export function Badge({
  tone = "slate",
  children,
}: {
  tone?: "slate" | "green" | "amber" | "red" | "blue";
  children: ReactNode;
}) {
  const tones = {
    slate: "bg-hover text-muted",
    green: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    amber: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
    red: "bg-red-500/12 text-red-600 dark:text-red-400",
    blue: "bg-brand-500/12 text-brand-600 dark:text-brand-300",
  }[tone];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
        tones
      )}
    >
      {children}
    </span>
  );
}

/**
 * Accessible modal dialog: labelled by its title, traps Tab focus, closes on
 * Escape, focuses itself on open and restores focus to the trigger on close
 * (WCAG 2.1.2 / 2.4.3 / 4.1.2).
 */
export function Modal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    const focusable = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
            )
          )
        : [];
    (focusable()[0] ?? node)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-pop"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-bold text-ink">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-faint transition hover:bg-hover hover:text-ink"
            aria-label="Close"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A confirm/cancel dialog built on Modal, for destructive or important actions. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} open={open} onClose={onClose}>
      <div className="space-y-5">
        <div className="text-sm text-muted">{message}</div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Loading indicator announced to assistive tech (WCAG 4.1.3). */
export function Spinner() {
  return (
    <div className="flex justify-center py-12" role="status" aria-live="polite">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand-600" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface/50 py-12 text-center text-sm text-muted">
      {message}
    </div>
  );
}

/** Error banner announced immediately to assistive tech (WCAG 4.1.3). */
export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
    >
      {message}
    </p>
  );
}

/**
 * Skip-to-content link: the first focusable element on a page, visually hidden
 * until focused, letting keyboard users jump past the navigation (WCAG 2.4.1).
 * `label` is passed in so callers can localise it; `targetId` must match the
 * page's <main id> landmark.
 */
export function SkipLink({
  label,
  targetId = "main-content",
}: {
  label: string;
  targetId?: string;
}) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-700 focus:shadow"
    >
      {label}
    </a>
  );
}
