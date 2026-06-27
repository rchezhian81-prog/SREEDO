// Performance runner: logs in, drives each hot-endpoint scenario with autocannon,
// gates P95 (conservatively, autocannon p97.5) against the per-scenario budget, and
// surfaces cache hit/miss + error counts. Needs a RUNNING server + seeded DB; this
// is never executed in CI (CI only validates the scenario config — see validate.ts).
//
// Usage:
//   PERF_BASE_URL=http://localhost:4000/api/v1 \
//   PERF_STAFF_EMAIL=admin@sreedo.edu PERF_STAFF_PASSWORD=Admin@12345 \
//   PERF_SUPER_EMAIL=super@sreedo.edu PERF_SUPER_PASSWORD=Super@12345 \
//   npm run perf

import autocannon from "autocannon";
import { loadConfig, type Credentials, type PerfConfig } from "./config";
import { scenarios, type Scenario, type ScenarioAuth } from "./scenarios";

/** Minimal view of an autocannon result (robust across @types versions). */
interface AcResult {
  latency: Record<string, number>;
  requests: Record<string, number>;
  errors: number;
  timeouts: number;
  non2xx: number;
  "2xx": number;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Promise wrapper around autocannon's callback form (version-robust). */
function runAutocannon(opts: autocannon.Options): Promise<AcResult> {
  return new Promise((resolve, reject) => {
    autocannon(opts, (err, result) => {
      if (err) reject(err);
      else resolve(result as unknown as AcResult);
    });
  });
}

async function login(baseUrl: string, creds: Credentials): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(creds),
  });
  if (!res.ok) throw new Error(`login failed for ${creds.email} (HTTP ${res.status})`);
  const data = (await res.json()) as { accessToken: string };
  return data.accessToken;
}

interface CacheSnapshot {
  hits: number;
  misses: number;
}

/** Pull cache counters from the Prometheus metrics text (super-admin only). */
async function readCacheMetrics(baseUrl: string, token: string): Promise<CacheSnapshot | null> {
  try {
    const res = await fetch(`${baseUrl}/observability/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const text = await res.text();
    const num = (re: RegExp) => {
      const m = text.match(re);
      return m ? Number(m[1]) : 0;
    };
    return {
      hits: num(/^cache_hits_total\s+(\d+)/m),
      misses: num(/^cache_misses_total\s+(\d+)/m),
    };
  } catch {
    return null;
  }
}

interface Row {
  name: string;
  cached: boolean;
  informational: boolean;
  p50: number;
  p90: number;
  gate: number;
  p99: number;
  rps: number;
  non2xx: number;
  errors: number;
  thresholdMs: number;
  pass: boolean;
}

type Tokens = { staff?: string; super?: string };

function tokenFor(auth: ScenarioAuth, tokens: Tokens): string | null | "none" {
  if (auth === "none") return "none";
  if (auth === "staff") return tokens.staff ?? null;
  return tokens.super ?? null;
}

async function runScenario(cfg: PerfConfig, s: Scenario, tokens: Tokens): Promise<Row | null> {
  const tok = tokenFor(s.auth, tokens);
  if (tok === null) {
    console.warn(`· skipping ${s.name} (no ${s.auth} credentials provided)`);
    return null;
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (tok !== "none") headers.Authorization = `Bearer ${tok}`;
  const url = `${cfg.baseUrl}${s.path.replace("{today}", today())}`;
  const body = s.isLogin && cfg.staff ? JSON.stringify(cfg.staff) : undefined;

  // Warm the path once so a cache-backed endpoint's first request isn't a miss.
  if (cfg.warmup) {
    await fetch(url, { method: s.method, headers, body }).catch(() => undefined);
  }

  const result = await runAutocannon({
    url,
    method: s.method,
    headers,
    body,
    connections: cfg.connections,
    duration: cfg.durationSec,
  });

  const lat = result.latency;
  const gate = lat.p97_5 ?? lat.p99 ?? lat.p90; // conservative stand-in for P95 (≥ p95)
  const total = (result["2xx"] ?? 0) + (result.non2xx ?? 0);
  const errorRate = total > 0 ? result.non2xx / total : 0;
  const hardErrors = result.errors + result.timeouts;
  const withinBudget = gate <= s.thresholdMs && hardErrors === 0 && errorRate < 0.01;
  // Informational scenarios (e.g. login) are measured but never gated.
  const pass = s.informational ? true : withinBudget;

  return {
    name: s.name,
    cached: Boolean(s.cached),
    informational: Boolean(s.informational),
    p50: lat.p50,
    p90: lat.p90,
    gate,
    p99: lat.p99,
    rps: Math.round(result.requests.average ?? 0),
    non2xx: result.non2xx,
    errors: hardErrors,
    thresholdMs: s.thresholdMs,
    pass,
  };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.staff && !cfg.super) {
    console.error(
      "No credentials set. Provide PERF_STAFF_EMAIL/PERF_STAFF_PASSWORD (and optionally PERF_SUPER_*)."
    );
    process.exit(2);
  }
  console.log(
    `Perf run → ${cfg.baseUrl}  (connections=${cfg.connections}, duration=${cfg.durationSec}s)\n`
  );

  const tokens: Tokens = {};
  if (cfg.staff) tokens.staff = await login(cfg.baseUrl, cfg.staff);
  if (cfg.super) tokens.super = await login(cfg.baseUrl, cfg.super);

  const before = tokens.super ? await readCacheMetrics(cfg.baseUrl, tokens.super) : null;

  const rows: Row[] = [];
  for (const s of scenarios) {
    const row = await runScenario(cfg, s, tokens);
    if (row) rows.push(row);
  }

  const after = tokens.super ? await readCacheMetrics(cfg.baseUrl, tokens.super) : null;

  const header = ["scenario", "cache", "p50", "p90", "p95~", "p99", "req/s", "non2xx", "err", "budget", ""];
  console.log("\n" + header.join("\t"));
  for (const r of rows) {
    console.log(
      [
        r.name,
        r.cached ? "yes" : "no",
        `${r.p50.toFixed(0)}ms`,
        `${r.p90.toFixed(0)}ms`,
        `${r.gate.toFixed(0)}ms`,
        `${r.p99.toFixed(0)}ms`,
        String(r.rps),
        String(r.non2xx),
        String(r.errors),
        `${r.thresholdMs}ms`,
        r.informational ? "INFO" : r.pass ? "PASS" : "FAIL",
      ].join("\t")
    );
  }
  console.log("\n(p95~ = autocannon p97.5, a conservative upper bound for P95)");

  if (before && after) {
    console.log(
      `Cache during run: hits +${after.hits - before.hits}, misses +${after.misses - before.misses}`
    );
  }
  const mem = process.memoryUsage();
  console.log(
    `Runner memory: rss ${(mem.rss / 1048576).toFixed(0)}MB, heapUsed ${(mem.heapUsed / 1048576).toFixed(0)}MB`
  );

  const gated = rows.filter((r) => !r.informational);
  const failed = gated.filter((r) => !r.pass);
  const info = rows.filter((r) => r.informational);
  console.log(
    `\n${gated.length - failed.length}/${gated.length} gated scenarios within budget` +
      (info.length ? ` (${info.map((r) => r.name).join(", ")} informational, not gated).` : ".")
  );
  if (failed.length > 0 && !cfg.soft) {
    console.error(`FAIL: ${failed.map((r) => r.name).join(", ")} exceeded budget or had errors.`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
