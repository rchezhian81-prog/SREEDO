"use client";

import { useEffect, useState } from "react";

/**
 * A ticking clock: returns `Date.now()` and re-renders every `intervalMs`.
 * Shared by the Active-sessions list and the support-mode banner to drive live
 * countdowns. Pass `active = false` to pause the interval (e.g. the banner while
 * no support session is engaged) so idle pages don't re-render every second.
 */
export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return now;
}
