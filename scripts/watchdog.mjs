/**
 * THE WATCHDOG, run by .github/workflows/watchdog.yml.
 *
 *   MODE=hourly    GET /api/preflight and /api/stats (free): not ready, the
 *                  Anthropic account refusing (credit exhausted, spend cap),
 *                  or a spike in scans that could not be completed.
 *   MODE=diagnose  the same, plus GET /api/diagnose (about 3 cents of Claude
 *                  and 5 Serper credits): every failed layer. Weekly, and
 *                  after every production deploy.
 *
 * Read-only against production: those three endpoints, nothing else. Any
 * problem exits non-zero, so the run fails and GitHub emails the owner; the
 * workflow also opens (or updates) a "watchdog" issue that mentions them,
 * and closes it when a later run passes. What is written (the job summary,
 * watchdog-result.md) names each failed layer and its error body, with the
 * operator token and any key scrubbed.
 *
 *   ANALYTICS_TOKEN=... BASE_URL=https://www.bustedlab.com MODE=hourly node scripts/watchdog.mjs
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { evaluateHourly, evaluateDiagnose, watchdogMarkdown, redact } from "./lib/autopilot.mjs";

const BASE = (process.env.BASE_URL || "https://www.bustedlab.com").replace(/\/$/, "");
const TOKEN = process.env.ANALYTICS_TOKEN || "";
const MODE = process.env.MODE === "diagnose" ? "diagnose" : "hourly";
const EXPECT_COMMIT = process.env.EXPECT_COMMIT || null;
const scrub = (t) => redact(t, [TOKEN]);

async function get(path, timeoutMs) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, "User-Agent": "BustedLabWatchdog/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* kept as text */ }
    return { status: res.status, json, text: json ? "" : text.slice(0, 1000) };
  } catch (err) {
    return { status: 0, json: null, text: String(err?.message || err) };
  }
}

if (!TOKEN) {
  console.error("ANALYTICS_TOKEN is not set for this job");
  process.exit(1);
}

const [preflight, stats] = await Promise.all([get("/api/preflight", 30_000), get("/api/stats?days=2", 30_000)]);
const hourly = evaluateHourly({ preflight, stats });
const problems = [...hourly.problems];
const notes = [...hourly.notes];
if (MODE === "diagnose") {
  const diagnose = await get("/api/diagnose", 90_000);
  const d = evaluateDiagnose({ diagnose, expectCommit: EXPECT_COMMIT });
  problems.push(...d.problems);
  notes.push(...d.notes);
}

const markdown = scrub(watchdogMarkdown({ mode: MODE, problems, notes, base: BASE, at: new Date().toISOString() }));
writeFileSync("watchdog-result.md", markdown + "\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
console.log(markdown);
for (const p of problems) console.log(scrub(`::error title=${p.layer}::${p.error}`));
process.exit(problems.length ? 1 : 0);
