/**
 * PRODUCTION EVALUATION, run from GitHub's runners by
 * .github/workflows/production-eval.yml (the development sandbox cannot reach
 * the live site). What a run does is set by evals/run.json:
 *
 *   { "run": 3, "steps": ["preflight", "diagnose", "scan"], "maxUsd": 8 }
 *
 *   preflight  GET /api/preflight
 *   diagnose   GET /api/diagnose (real calls to every provider)
 *
 * Every step talks to production with the operator token from the
 * ANALYTICS_TOKEN secret. The token is never written: every byte this script
 * writes (results file, report, job summary, console) goes through redact().
 *
 * Spend is capped twice: per run by run.json's maxUsd, and across all runs by
 * SPEND_CAP_USD, using the ledger committed in evals/results/ledger.json. A
 * step that would cross either stops before it starts.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

const REPO = resolve(dirname(new URL(import.meta.url).pathname), "..");
const BASE = (process.env.BASE_URL || "https://www.bustedlab.com").replace(/\/$/, "");
const TOKEN = process.env.ANALYTICS_TOKEN || "";
const SPEND_CAP_USD = 25;
// Serper bills about a tenth of a cent per search. SerpApi's per-search price
// depends on the plan, so it is worked out from the account diagnose reports.
const SERPER_PER_SEARCH = 0.001;
const SERPAPI_PER_SEARCH_DEFAULT = 0.01;

const RESULTS = resolve(REPO, "evals/results");
mkdirSync(RESULTS, { recursive: true });

const run = JSON.parse(readFileSync(resolve(REPO, "evals/run.json"), "utf8"));
const ledgerPath = resolve(RESULTS, "ledger.json");
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : { capUsd: SPEND_CAP_USD, runs: [] };
const spentBefore = ledger.runs.reduce((sum, r) => sum + (r.totalUsd || 0), 0);
const runCap = Math.min(Number(run.maxUsd) || 1, SPEND_CAP_USD - spentBefore);

// ── redaction ────────────────────────────────────────────────────────────
function redact(text) {
  let out = String(text ?? "");
  if (TOKEN && TOKEN.length >= 8) {
    out = out.split(TOKEN).join("[redacted]").split(encodeURIComponent(TOKEN)).join("[redacted]");
  }
  return out
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/(api_key=)[^&"\s]+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, "$1[redacted]");
}
const log = (...parts) => console.log(redact(parts.map(p => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")));

// ── spend ────────────────────────────────────────────────────────────────
const spend = { claudeUsd: 0, serpapiSearches: 0, serperSearches: 0, serpapiPerSearch: SERPAPI_PER_SEARCH_DEFAULT };
const searchUsd = () => spend.serpapiSearches * spend.serpapiPerSearch + spend.serperSearches * SERPER_PER_SEARCH;
const runUsd = () => spend.claudeUsd + searchUsd();
const canSpend = (nextUsd) => runUsd() + nextUsd <= runCap;

// ── production calls ─────────────────────────────────────────────────────
async function operator(path, init = {}, timeoutMs = 150_000) {
  const started = Date.now();
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${TOKEN}`, "User-Agent": "BustedLabEval/1.0 (production evaluation)" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { status: 0, ms: Date.now() - started, json: null, text: String(err?.message || err) };
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* kept as text */ }
  return { status: res.status, ms: Date.now() - started, json, text: json ? "" : text.slice(0, 2000) };
}

// ── steps ────────────────────────────────────────────────────────────────
const results = { run: run.run, note: run.note || "", base: BASE, startedAt: new Date().toISOString(), steps: {} };
const report = [];

async function preflight() {
  const r = await operator("/api/preflight", {}, 30_000);
  results.steps.preflight = r;
  report.push(`## Preflight\n`, `HTTP ${r.status} in ${r.ms} ms.`);
  if (r.json) {
    report.push(`Ready: **${r.json.ready}** (${r.json.environment}).`);
    for (const b of r.json.blockers || []) report.push(`- BLOCKER ${b.check}: ${b.detail}`);
    for (const w of r.json.warnings || []) report.push(`- warning ${w.check}: ${w.detail}`);
    report.push(`- ok: ${(r.json.ok || []).join(", ")}`);
    report.push(`- limits: ${JSON.stringify(r.json.limits)}`);
  } else {
    report.push("```", r.text, "```");
  }
  report.push("");
}

async function diagnose() {
  if (!canSpend(0.15)) { report.push("## Diagnose\n\nSkipped: the spend cap would be crossed.\n"); return; }
  const r = await operator("/api/diagnose", {}, 90_000);
  results.steps.diagnose = r;
  report.push(`## Diagnose\n`, `HTTP ${r.status} in ${r.ms} ms.`);
  const d = r.json;
  if (!d || !Array.isArray(d.layers)) {
    report.push("```", r.text || JSON.stringify(d), "```", "");
    return;
  }
  spend.claudeUsd += Number(d.cost?.claudeUsd) || 0;
  spend.serpapiSearches += Number(d.cost?.searches?.serpapiLens) || 0;
  spend.serperSearches += Number(d.cost?.searches?.serper) || 0;
  const account = d.layers.find(l => l.layer === "serpapi account");
  const perMonth = Number(account?.searchesPerMonth);
  const plans = { 1000: 25, 5000: 75, 15000: 150, 30000: 275 };
  if (plans[perMonth]) spend.serpapiPerSearch = plans[perMonth] / perMonth;
  report.push(`Pass: **${d.pass}**. Failing: ${(d.failing || []).join(", ") || "none"}. Spend mode: ${d.spend?.mode}, today $${d.spend?.todayUsd} of $${d.spend?.dailyBudgetUsd}. This run's Claude cost: $${d.cost?.claudeUsd}. Thinking per call: ${d.thinking?.perCallApprox ?? "n/a"}.`);
  report.push("", "| layer | pass | status | ms | detail |", "|---|---|---|---|---|");
  for (const l of d.layers) {
    report.push(`| ${l.layer} | ${l.pass ? "pass" : "FAIL"} | ${l.status} | ${l.latencyMs} | ${String(l.detail || "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 400)} |`);
  }
  report.push("");
}

const STEPS = { preflight, diagnose };

// ── main ─────────────────────────────────────────────────────────────────
if (!TOKEN) {
  console.error("ANALYTICS_TOKEN is not set for this job");
  process.exit(1);
}
log(`run ${run.run}: steps ${run.steps.join(", ")}; spent before $${spentBefore.toFixed(4)}; this run may spend $${runCap.toFixed(2)}`);
for (const name of run.steps || []) {
  const step = STEPS[name];
  if (!step) { report.push(`Unknown step "${name}"; skipped.`); continue; }
  log(`step ${name}`);
  try {
    await step();
  } catch (err) {
    report.push(`## ${name}\n\nThe step threw: ${String(err?.stack || err)}\n`);
  }
}

results.finishedAt = new Date().toISOString();
results.spend = { ...spend, searchUsd: searchUsd(), totalUsd: runUsd(), spentBeforeUsd: spentBefore, capUsd: SPEND_CAP_USD };
ledger.runs = ledger.runs.filter(r => r.run !== run.run);
ledger.runs.push({ run: run.run, at: results.finishedAt, claudeUsd: +spend.claudeUsd.toFixed(4), searchUsd: +searchUsd().toFixed(4), totalUsd: +runUsd().toFixed(4) });
ledger.totalUsd = +ledger.runs.reduce((sum, r) => sum + r.totalUsd, 0).toFixed(4);

const header = [
  `# Production eval, run ${run.run}`,
  "",
  `${BASE}, ${results.startedAt} to ${results.finishedAt}. ${run.note || ""}`,
  "",
  `Spend this run: $${runUsd().toFixed(4)} (Claude $${spend.claudeUsd.toFixed(4)}, search $${searchUsd().toFixed(4)}). All runs: $${ledger.totalUsd.toFixed(4)} of the $${SPEND_CAP_USD} cap.`,
  "",
];
const markdown = redact([...header, ...report].join("\n"));
writeFileSync(resolve(RESULTS, `run-${run.run}.json`), redact(JSON.stringify(results, null, 2)) + "\n");
writeFileSync(resolve(RESULTS, `run-${run.run}.md`), markdown + "\n");
writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
log(markdown);
