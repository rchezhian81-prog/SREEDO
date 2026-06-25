/**
 * Money helpers. Amounts live in Postgres as NUMERIC(12,2) (exact decimal) and
 * cross the API as JSON numbers of rupees. The one place precision can be lost is
 * JavaScript float arithmetic *between* reading and writing — e.g.
 * `0.1 + 0.2 === 0.30000000000000004`, or percentage/proration math.
 *
 * These helpers convert to integer paise, do the arithmetic in integers (exact
 * up to 2^53, far beyond NUMERIC(12,2)'s range) and round explicitly only where a
 * real fraction of a paisa must collapse. No epsilon comparisons needed: compare
 * paise integers directly.
 */

/**
 * Parse a money value — a NUMERIC string from node-postgres, or a JS number from
 * the API — into integer paise, rounded to the nearest paisa. Throws on a
 * non-finite input rather than silently producing NaN.
 */
export function toPaise(value: string | number): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) throw new Error(`Invalid money value: ${String(value)}`);
  return Math.round(n * 100);
}

/** Integer paise → rupees (safe to store in NUMERIC(12,2) and send as JSON). */
export function toRupees(paise: number): number {
  return Math.round(paise) / 100;
}

/** Sum money values exactly, returning paise. */
export function sumPaise(values: Array<string | number>): number {
  return values.reduce<number>((acc, v) => acc + toPaise(v), 0);
}

/** `percent`% of a base amount (paise), rounded to the nearest paisa. */
export function percentOf(basePaise: number, percent: number): number {
  return Math.round((basePaise * percent) / 100);
}

/**
 * total × part / whole (paise), rounded to the nearest paisa — e.g. per-day
 * proration. Returns 0 when `whole` is 0 or negative.
 */
export function prorate(totalPaise: number, part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((totalPaise * part) / whole);
}

/**
 * Split `totalPaise` across `weights` using largest-remainder rounding, so the
 * returned parts sum EXACTLY to the total — no paisa created or lost. Use this
 * for percentage breakdowns and splits instead of rounding each part
 * independently (which can drift the total by a paisa). Returns all-zero when the
 * weights sum to 0.
 */
export function allocate(totalPaise: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (totalPaise * w) / totalWeight);
  const out = raw.map((r) => Math.floor(r));
  let remainder = totalPaise - out.reduce((a, b) => a + b, 0);
  // Hand each leftover paisa to the largest fractional remainder first.
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && remainder > 0; k += 1) {
    out[order[k].i] += 1;
    remainder -= 1;
  }
  return out;
}
