// Shared formatting helpers. Currency/date rendering is centralised here so the
// whole app shows money as "₹1,500.00" and dates as "28 Jun 2026" consistently.
// All formatting is deterministic (fixed locale + UTC) to avoid SSR/client
// hydration mismatches.

const LOCALE_BY_CURRENCY: Record<string, string> = {
  INR: "en-IN",
  USD: "en-US",
  EUR: "en-IE",
  GBP: "en-GB",
  AED: "en-AE",
  SGD: "en-SG",
};

/** Format an amount as a localized currency string; falls back to "CUR 0.00". */
export function formatMoney(
  amount: string | number | null | undefined,
  currency = "INR"
): string {
  const n = Number(amount) || 0;
  const cur = (currency || "INR").toUpperCase();
  try {
    return new Intl.NumberFormat(LOCALE_BY_CURRENCY[cur] ?? "en-IN", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${cur} ${n.toFixed(2)}`;
  }
}

/** Render an ISO date/timestamp as "28 Jun 2026" (deterministic, UTC). */
export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const iso = value.slice(0, 10);
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(d);
  } catch {
    return iso;
  }
}
