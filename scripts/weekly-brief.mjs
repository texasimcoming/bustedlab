/**
 * THE WEEKLY GROWTH BRIEF AND CONTENT PACK, run by
 * .github/workflows/weekly-brief.yml every Monday.
 *
 * Reads GET /api/stats?days=7 (operator token) and GET /api/leaderboard
 * (public), and nothing else in production. Writes, into OUT_DIR:
 *   weekly-<date>.md   funnel step ratios, scan outcome mix, failure reasons,
 *                      "wrong product" counts, cost per scan against the caps,
 *                      and the three highest-leverage fixes the numbers point at
 *   content-<date>.md  the week's five biggest verified markups, each with a
 *                      caption, three hooks, hashtags, and links to its scan
 *                      page and share image (posting stays manual)
 *   issue.md           both, for the GitHub issue the workflow opens
 *
 * Every number is computed in scripts/lib/autopilot.mjs. When the
 * ANTHROPIC_API_KEY secret is set, one Sonnet 5.5 call writes a short summary
 * around those numbers: bounded so it cannot cost more than $0.02 (the input
 * is checked before the call, max_tokens caps the output), measured from the
 * usage it reports, and dropped if it states a number the code did not
 * compute. Without the secret, the brief is the numbers alone.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { briefNumbers, leverageFixes, briefMarkdown, contentPack, allowedNumbers, summaryIsGrounded, redact } from "./lib/autopilot.mjs";
import { readClaudeReply } from "../src/lib/model-rules.ts";

const BASE = (process.env.BASE_URL || "https://www.bustedlab.com").replace(/\/$/, "");
const TOKEN = process.env.ANALYTICS_TOKEN || "";
const KEY = process.env.ANTHROPIC_API_KEY || "";
const OUT = resolve(process.env.OUT_DIR || "reports-out");
// Overridable only so scripts/check-autopilot.mjs can point it at a local mock.
const ANTHROPIC_URL = process.env.ANTHROPIC_URL || "https://api.anthropic.com/v1/messages";
const date = new Date().toISOString().slice(0, 10);
const scrub = (t) => redact(t, [TOKEN, KEY]);

// Sonnet 5.5 list prices, USD per million tokens (platform.claude.com/docs/en/about-claude/pricing, 2026-10-03).
const SONNET = { id: "claude-sonnet-5-5", input: 2, output: 10 };
const SUMMARY_CAP_USD = 0.02;
const SUMMARY_MAX_TOKENS = 1200;

async function get(path, auth) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}), "User-Agent": "BustedLabBrief/1.0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${path} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** One call, or none. Returns { text, costUsd, note }. */
async function summarize(numbers, fixes) {
  if (!KEY) return { text: "", costUsd: 0, note: "no ANTHROPIC_API_KEY secret: numbers only" };
  const prompt = [
    "You write the opening paragraph of a weekly business brief for a solo founder.",
    "Write 3 to 5 plain-English sentences about what changed and what matters, using ONLY the numbers in the JSON below.",
    "Do not state any number that is not in it, do not compute new numbers, and do not use dashes as punctuation.",
    "",
    JSON.stringify({ numbers, fixes }),
  ].join("\n");
  // Bounded before it is sent: about 3.5 characters a token for this input,
  // and max_tokens caps thinking plus the answer.
  const worstCase = (Math.ceil(prompt.length / 3.5) * SONNET.input + SUMMARY_MAX_TOKENS * SONNET.output) / 1_000_000;
  if (worstCase > SUMMARY_CAP_USD) return { text: "", costUsd: 0, note: `skipped: the call could cost up to $${worstCase.toFixed(4)}, over the $${SUMMARY_CAP_USD} cap` };
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    // The documented request surface for Sonnet 5.5 (src/lib/model-rules.ts):
    // no sampling, thinking left on (adaptive), effort low.
    body: JSON.stringify({ model: SONNET.id, max_tokens: SUMMARY_MAX_TOKENS, output_config: { effort: "low" }, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { text: "", costUsd: 0, note: `the summary call answered ${res.status}: ${scrub(JSON.stringify(data).slice(0, 200))}` };
  const u = data.usage || {};
  const costUsd = ((u.input_tokens || 0) * SONNET.input + (u.output_tokens || 0) * SONNET.output) / 1_000_000;
  const reply = readClaudeReply(data);
  if (!reply.text) return { text: "", costUsd, note: `no summary text (stop_reason ${reply.stopReason})` };
  if (!summaryIsGrounded(reply.text, allowedNumbers(numbers, fixes))) return { text: "", costUsd, note: "summary dropped: it stated a number the code did not compute" };
  return { text: reply.text.trim(), costUsd, note: "summary written by Sonnet 5.5 from the computed numbers" };
}

if (!TOKEN) {
  console.error("ANALYTICS_TOKEN is not set for this job");
  process.exit(1);
}

const [stats, leaderboard] = await Promise.all([get("/api/stats?days=7", true), get("/api/leaderboard", false)]);
const numbers = briefNumbers(stats);
const fixes = leverageFixes(numbers);
const summary = await summarize(numbers, fixes);
const brief = briefMarkdown({ date, numbers, fixes, summary: summary.text, base: BASE })
  + `\n_Summary: ${summary.note}; it cost $${summary.costUsd.toFixed(4)}._\n`;
const pack = contentPack({ weekTop: leaderboard.weekTop || [], base: BASE, date });

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, `weekly-${date}.md`), scrub(brief));
writeFileSync(resolve(OUT, `content-${date}.md`), scrub(pack.markdown) + "\n");
writeFileSync(resolve(OUT, "issue.md"), scrub(`${brief}\n---\n\n${pack.markdown}\n`));
writeFileSync(resolve(OUT, "date.txt"), date);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, scrub(brief) + "\n");
console.log(scrub(brief));
console.log(`content pack: ${pack.rows.length} item(s)`);
