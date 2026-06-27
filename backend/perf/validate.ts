// CI-safe validation of the performance suite: checks the scenario config and the
// config loader WITHOUT any network or database access, so it can run on every CI
// build and keep the suite from rotting. No server is required.

import { loadConfig } from "./config";
import { scenarios, HOT_READ_P95_MS, type ScenarioAuth } from "./scenarios";

const problems: string[] = [];
const fail = (msg: string) => problems.push(msg);

// Every hot endpoint named in the module scope must have a scenario.
const REQUIRED = [
  "auth:login",
  "dashboard:stats",
  "students:list",
  "staff:list",
  "attendance:summary",
  "fees:summary",
  "reports:center",
  "timetable:reads",
  "rbac:catalogue",
  "rbac:matrix",
];

const validAuth: ScenarioAuth[] = ["none", "staff", "super"];
const seen = new Set<string>();

if (scenarios.length === 0) fail("no scenarios defined");

for (const s of scenarios) {
  if (!s.name) fail("a scenario is missing a name");
  if (seen.has(s.name)) fail(`duplicate scenario name: ${s.name}`);
  seen.add(s.name);
  if (s.method !== "GET" && s.method !== "POST") fail(`${s.name}: invalid method ${s.method}`);
  if (!s.path.startsWith("/")) fail(`${s.name}: path must start with "/" (got ${s.path})`);
  if (!validAuth.includes(s.auth)) fail(`${s.name}: invalid auth ${s.auth}`);
  if (!Number.isFinite(s.thresholdMs) || s.thresholdMs <= 0) fail(`${s.name}: invalid thresholdMs`);
  if (s.isLogin && s.method !== "POST") fail(`${s.name}: login scenario must be POST`);
}

for (const name of REQUIRED) {
  if (!seen.has(name)) fail(`missing required scenario: ${name}`);
}

// The cached hot reads must hold themselves to the documented 300 ms P95 target.
for (const s of scenarios) {
  if (s.cached && s.thresholdMs > HOT_READ_P95_MS) {
    fail(`${s.name}: cached hot read budget ${s.thresholdMs}ms exceeds the ${HOT_READ_P95_MS}ms target`);
  }
}

// The config loader must produce a sane default config (no creds needed).
const cfg = loadConfig();
if (!cfg.baseUrl.startsWith("http")) fail(`config baseUrl looks wrong: ${cfg.baseUrl}`);
if (cfg.connections < 1) fail("config connections must be >= 1");
if (cfg.durationSec < 1) fail("config durationSec must be >= 1");

if (problems.length > 0) {
  console.error("Performance suite validation FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `✓ Performance suite valid — ${scenarios.length} scenarios, ` +
    `${scenarios.filter((s) => s.cached).length} cached hot reads, baseUrl default ${cfg.baseUrl}`
);
