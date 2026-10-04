/**
 * COST MODEL for the scan engine's Claude API and search spend.
 *
 * The call sequences below are the ones scripts/check-identification.mjs
 * OBSERVES the engine making (it prints the gate calls and candidates per
 * scenario), priced from the published rates. Every assumption is a named
 * constant so it can be argued with, corrected and re-run:
 *
 *   npm run cost-model                    # thinking priced at 300 / 1,000 / 3,000 tokens per call
 *   npm run cost-model -- --thinking 640  # one measured figure, e.g. from /api/diagnose
 *   npm run cost-model -- --measured evals/results/run-5.json
 *                                         # what real production scans cost, from the traces
 *                                         # the evaluation recorded (scripts/production-eval.mjs)
 *
 * The product runs on two models, Claude Sonnet 5.5 (first read and gate,
 * chosen by the production evaluation) and Claude Opus 5.5 (escalation and
 * the gate's fallback), and both think on every call: adaptive thinking cannot be turned off, and
 * effort (set to low) is the only control. Thinking is billed as output, so
 * it is the term that decides what a scan costs, and it cannot be known from
 * here: /api/diagnose reports each probe's output tokens from a real call.
 * Until that number exists, every figure is shown at three thinking levels.
 */

// ── Published rates, USD per million tokens, checked 2026-10-03 ──────────
// https://platform.claude.com/docs/en/about-claude/pricing
// https://platform.claude.com/docs/en/build-with-claude/prompt-caching
// Cache write (5 minutes) is 1.25x input on both; cache read is 0.05x input
// on Opus 5.5 and 0.1x on Sonnet 5.5 ($0.20 per million either way). Both
// cache a prefix from 512 tokens, so the reference photo caches on both.
const MODELS = {
  opus: { id: "claude-opus-5-5", input: 4.0, output: 20.0, cacheRead: 0.05, cacheMinimum: 512 },
  sonnet: { id: "claude-sonnet-5-5", input: 2.0, output: 10.0, cacheRead: 0.1, cacheMinimum: 512 },
};
const CACHE_WRITE_MULTIPLIER = 1.25;

// ── Token assumptions. Image tokens are about (width x height) / 750. ────
const T = {
  // The photo is capped at 1568px on its long edge before any model sees it
  // (src/lib/image-cap.ts): a 1170x2532 screenshot becomes 725x1568, about
  // 1,516 tokens. Uncapped, the 5.5 models would read it at about 3,950.
  // Measured in production (run 5): the first read wrote 1,690 photo tokens
  // on average to the cache.
  referenceImage: 1700,
  // Lens and Shopping thumbnails are small, typically 200-300px square.
  // Measured (run 5): about 190 tokens each with its label.
  candidateThumbnail: 175,
  extractPrompt: 700,
  extractOutput: 180,
  // The batch instruction, plus a label block per candidate.
  gatePromptBase: 600,
  gateLabelPerCandidate: 15,
  // "a few words naming the feature that decided it", not a sentence.
  gateOutputPerCandidate: 25,
  gateOutputOverhead: 20,
};

// ── Thinking per call, in tokens. ────────────────────────────────────────
const arg = process.argv.indexOf("--thinking");
const MEASURED = arg > 0 ? Number(process.argv[arg + 1]) : null;
const THINKING_LEVELS = MEASURED !== null && Number.isFinite(MEASURED) ? [MEASURED] : [300, 1000, 3000];

function price(tier, { input = 0, cacheWrite = 0, cacheRead = 0, output = 0 }) {
  const m = MODELS[tier];
  return (
    input * m.input +
    cacheWrite * m.input * CACHE_WRITE_MULTIPLIER +
    cacheRead * m.input * m.cacheRead +
    output * m.output
  ) / 1_000_000;
}

const photoCaches = (tier) => T.referenceImage >= MODELS[tier].cacheMinimum;

// How the photo is cached, for comparison:
//   "shared"     every call opens with the same photo prefix, so the first
//                read writes it and every gate call on the same model reads
//                it (THE PHOTO, ONCE PER SCAN in src/lib/scan.ts; budget mode)
//   "gate-only"  before budget mode: the first read sent the photo uncached
//                and the first gate wave wrote it again
//   "none"       no prompt caching at all
let CACHING = "shared";

/** One call carrying the photo: written, read back, or paid in full, per CACHING. */
function photoTokens(tier, cacheState, role) {
  if (CACHING === "none" || !photoCaches(tier) || (CACHING === "gate-only" && role === "extract")) {
    return { input: T.referenceImage };
  }
  if (cacheState[tier]) return { cacheRead: T.referenceImage };
  cacheState[tier] = true;
  return { cacheWrite: T.referenceImage };
}

/** The vision extraction: one photo, one prompt, a small JSON answer, plus thinking. */
function extract(tier, thinking, cacheState) {
  const photo = photoTokens(tier, cacheState, "extract");
  return price(tier, { ...photo, input: (photo.input || 0) + T.extractPrompt, output: T.extractOutput + thinking });
}

/** One gate call covering `candidates` candidates, the photo first. */
function gateCall(tier, candidates, cacheState, thinking) {
  const rest = T.gatePromptBase + candidates * (T.candidateThumbnail + T.gateLabelPerCandidate);
  const output = T.gateOutputOverhead + candidates * T.gateOutputPerCandidate + thinking;
  const photo = photoTokens(tier, cacheState, "gate");
  return price(tier, { ...photo, input: (photo.input || 0) + rest, output });
}

// ── The call sequences the engine makes ──────────────────────────────────
// Each gate entry is [tier, candidates-in-this-call]. Wave one judges six
// candidates; a second wave of six runs only when the first confirmed
// nothing; the pricing search judges up to four; the rebrand and retailer
// pools (four each at most) share ONE call.
const SEQUENCES = {
  cold: {
    label: "cold scan: Lens hits, wave one confirms, priced, rebrand + retailer checked",
    extract: "sonnet",
    gate: [["sonnet", 6], ["sonnet", 2], ["sonnet", 2]],
  },
  hard: {
    label: "hard scan: nothing confirms in wave one, every layer fires",
    extract: "sonnet",
    gate: [["sonnet", 6], ["sonnet", 6], ["sonnet", 4], ["sonnet", 8]],
  },
  identity: {
    label: "cached identity: another photo of a product identified in the last hour",
    extract: "sonnet",
    gate: [["sonnet", 1]],
  },
  degraded: {
    label: "degraded: the day's budget is spent, Sonnet 5.5 gate, no enhancement layers",
    extract: "sonnet",
    gate: [["sonnet", 6], ["sonnet", 2]],
  },
  fallback: {
    label: "Sonnet 5.5 refusing every call (400s are not billed): Opus 5.5 judges",
    extract: "sonnet",
    gate: [["opus", 6], ["opus", 2], ["opus", 2]],
  },
  previous: {
    label: "for comparison: the cold scan with the gate on Opus 5.5, as before the evaluation",
    extract: "sonnet",
    gate: [["opus", 6], ["opus", 2], ["opus", 2]],
  },
};

function scanCost(name, thinking, caching = CACHING) {
  const saved = CACHING;
  CACHING = caching;
  const seq = SEQUENCES[name];
  const cacheState = {};
  let total = extract(seq.extract, thinking, cacheState);
  for (const [tier, n] of seq.gate) total += gateCall(tier, n, cacheState, thinking);
  CACHING = saved;
  return total;
}

// ── Search, budget mode (SEARCH PROVIDERS in src/lib/scan.ts) ────────────
//   Serper:  the primary for Lens and Shopping. Prepaid credits, about $0.001
//            each on the smallest pack, 2,500 free to start. Measured from the
//            credits Serper reports on each response (run 5, 2026-10-03): a
//            Lens search is 3 credits, a Shopping search 2, an organic search
//            1. --measured uses each scan's reported credits.
//   SerpApi: the last-resort backup, only when Serper fails and only above
//            its reserve; free plan 250 searches a month, paid about $0.015 a
//            search. The Amazon/Walmart/eBay sweep (three SerpApi searches)
//            is off unless RETAILER_SWEEP=1. Normal operation spends none.
const SERPAPI_PER_SEARCH = 0.015;
const SERPER_PER_CREDIT = 0.001;
const SERPER_LENS_CREDITS = 3;
const SERPER_SHOPPING_CREDITS = 2;
const SERPER_FREE_CREDITS = 2500;
// Serper credits per scan: Lens, then the Shopping searches each path makes.
// Measured (run 5): 5 credits a scan in five of six scans (Lens and one
// Shopping search), 7 when a rebrand search ran.
const SEARCH_CALLS = {
  cold: { serpapi: 0, serper: SERPER_LENS_CREDITS + SERPER_SHOPPING_CREDITS },
  hard: { serpapi: 0, serper: SERPER_LENS_CREDITS + 3 * SERPER_SHOPPING_CREDITS },
  identity: { serpapi: 0, serper: SERPER_LENS_CREDITS },
  degraded: { serpapi: 0, serper: SERPER_LENS_CREDITS + SERPER_SHOPPING_CREDITS },
  fallback: { serpapi: 0, serper: SERPER_LENS_CREDITS + SERPER_SHOPPING_CREDITS },
  previous: { serpapi: 0, serper: SERPER_LENS_CREDITS + SERPER_SHOPPING_CREDITS },
};
const searchCost = (name) => SEARCH_CALLS[name].serpapi * SERPAPI_PER_SEARCH + SEARCH_CALLS[name].serper * SERPER_PER_CREDIT;

// ── Measured: real production scans, from an evaluation results file ────
const measuredArg = process.argv.indexOf("--measured");
if (measuredArg > 0) {
  const { readFileSync } = await import("node:fs");
  const files = process.argv.slice(measuredArg + 1).filter(a => !a.startsWith("--"));
  const scans = files.flatMap(f => (JSON.parse(readFileSync(f, "utf8")).scans || []))
    .filter(s => s.json?.evaluation?.trace);
  const kind = (s) => {
    const r = s.json;
    if (r.error) return "incomplete";
    if (/\+reused/.test(r.engineUsed || "")) return "identity reuse";
    if (r.mode === "UNRESOLVED") return "no answer";
    return r.matchConfidence === "unverified" ? "lookalike" : "identified";
  };
  const groups = {};
  const calls = {};
  for (const s of scans) {
    const t = s.json.evaluation.trace;
    const g = (groups[kind(s)] = groups[kind(s)] || []);
    const serpapi = t.searchesByProvider?.serpapi || 0;
    // Credits as Serper reported them; before budget mode, one per search.
    const serper = t.creditsByProvider?.serper ?? t.searchesByProvider?.serper ?? 0;
    g.push({ model: t.claudeUsd || 0, serpapi, serper, ms: t.totalMs || 0, thinking: t.thinkingPerCall, cache: t.cache || null });
    for (const c of t.calls || []) {
      const key = `${c.model} ${c.layer}`;
      const e = (calls[key] = calls[key] || { n: 0, usd: 0, think: 0, ms: 0, input: 0, output: 0, read: 0, write: 0, reading: 0 });
      e.n++; e.usd += c.costUsd || 0; e.think += c.thinkingApprox || 0; e.ms += c.ms || 0;
      e.read += c.cacheReadTokens || 0; e.write += c.cacheWriteTokens || 0; if ((c.cacheReadTokens || 0) > 0) e.reading++;
      e.input += (c.inputTokens || 0) + (c.cacheReadTokens || 0) + (c.cacheWriteTokens || 0); e.output += c.outputTokens || 0;
    }
  }
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const median = (xs) => { const v = [...xs].sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };
  console.log(`\nMEASURED IN PRODUCTION: ${scans.length} traced scans from ${files.join(", ")}`);
  console.log("-".repeat(78));
  console.log(`  SerpApi priced at $${SERPAPI_PER_SEARCH} a search (paid plans), Serper at $${SERPER_PER_CREDIT} a credit.`);
  console.log(`  ${"scan".padEnd(16)}${"n".padStart(4)}${"model mean".padStart(12)}${"SerpApi".padStart(9)}${"Serper cr".padStart(10)}${"total mean".padStart(12)}${"median s".padStart(10)}${"max s".padStart(8)}`);
  for (const [k, g] of Object.entries(groups)) {
    const model = mean(g.map(x => x.model));
    const sa = mean(g.map(x => x.serpapi));
    const se = mean(g.map(x => x.serper));
    const total = model + sa * SERPAPI_PER_SEARCH + se * SERPER_PER_CREDIT;
    console.log(`  ${k.padEnd(16)}${String(g.length).padStart(4)}${("$" + model.toFixed(4)).padStart(12)}${sa.toFixed(1).padStart(9)}${se.toFixed(1).padStart(10)}${("$" + total.toFixed(4)).padStart(12)}${(median(g.map(x => x.ms)) / 1000).toFixed(1).padStart(10)}${(Math.max(...g.map(x => x.ms)) / 1000).toFixed(1).padStart(8)}`);
  }
  console.log(`\n  ${"model and layer".padEnd(32)}${"calls".padStart(6)}${"mean $".padStart(10)}${"thinking".padStart(10)}${"input".padStart(8)}${"output".padStart(8)}${"mean s".padStart(8)}${"cache read".padStart(12)}${"written".padStart(9)}${"reading".padStart(9)}`);
  for (const [k, e] of Object.entries(calls).sort()) {
    console.log(`  ${k.padEnd(32)}${String(e.n).padStart(6)}${("$" + (e.usd / e.n).toFixed(4)).padStart(10)}${Math.round(e.think / e.n).toString().padStart(10)}${Math.round(e.input / e.n).toString().padStart(8)}${Math.round(e.output / e.n).toString().padStart(8)}${(e.ms / e.n / 1000).toFixed(1).padStart(8)}${Math.round(e.read / e.n).toString().padStart(12)}${Math.round(e.write / e.n).toString().padStart(9)}${`${e.reading}/${e.n}`.padStart(9)}`);
  }
  const allThinking = Object.values(calls).reduce((a, e) => a + e.think, 0) / Math.max(1, Object.values(calls).reduce((a, e) => a + e.n, 0));
  console.log(`\n  Thinking per call, all calls: ${Math.round(allThinking)} tokens. The modelled sections below use it.\n`);
  if (MEASURED === null) THINKING_LEVELS.splice(0, THINKING_LEVELS.length, Math.round(allThinking));
}

// ── Report ───────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const money = (n) => `$${n.toFixed(4)}`;
const rule = () => console.log("-".repeat(78));

console.log("\nASSUMPTIONS");
rule();
console.log(`  reference photo        ${T.referenceImage} tokens (capped at 1568px; ~3,950 uncapped on the 5.5 models)`);
console.log(`  candidate thumbnail    ${T.candidateThumbnail} tokens`);
for (const m of Object.values(MODELS)) {
  console.log(`  ${pad(m.id, 22)} $${m.input} in / $${m.output} out per Mtok, cache read ${m.cacheRead}x, minimum ${m.cacheMinimum} -> photo caches`);
}
console.log(`  thinking               ${THINKING_LEVELS.map(t => t.toLocaleString()).join(" / ")} tokens per call (effort low; billed as output)`);
console.log(`  first-read escalation  not included: adds one Opus 5.5 extraction when the first read fails`);

console.log("\n\nMODEL SPEND PER SCAN, BY THINKING TOKENS PER CALL");
rule();
console.log(`  ${pad("", 14)}${pad("calls", 8)}${THINKING_LEVELS.map(t => lpad(`${t.toLocaleString()} think`, 14)).join("")}${lpad("no thinking", 14)}`);
for (const name of Object.keys(SEQUENCES)) {
  const calls = 1 + SEQUENCES[name].gate.length;
  const cells = THINKING_LEVELS.map(t => lpad(money(scanCost(name, t)), 14)).join("");
  console.log(`  ${pad(name, 14)}${pad(calls, 8)}${cells}${lpad(money(scanCost(name, 0)), 14)}`);
}
console.log(`  ${pad("result cache", 14)}${pad(0, 8)}${THINKING_LEVELS.map(() => lpad("$0.0000", 14)).join("")}${lpad("$0.0000", 14)}`);
console.log("\n  cold      " + SEQUENCES.cold.label);
console.log("  hard      " + SEQUENCES.hard.label);
console.log("  identity  " + SEQUENCES.identity.label);
console.log("  degraded  " + SEQUENCES.degraded.label);
console.log("  fallback  " + SEQUENCES.fallback.label);
console.log("  previous  " + SEQUENCES.previous.label);
console.log("  result cache: the same photo or link again within 24 hours; nothing runs");

// The level the budget and viral-day sections are worked at: the measured
// figure when there is one, otherwise the middle of the three.
const think = THINKING_LEVELS.length === 1 ? THINKING_LEVELS[0] : 1000;
const c = (name) => scanCost(name, think);
const thinkingShare = (c("cold") - scanCost("cold", 0)) / c("cold");
console.log(`\n  At ${think.toLocaleString()} thinking tokens per call, thinking is ${(thinkingShare * 100).toFixed(0)}% of a cold scan's model spend.`);

console.log(`\n\nPROMPT CACHE: THE PHOTO ONCE PER SCAN (thinking ${think.toLocaleString()} per call)`);
rule();
console.log("  The first read writes the photo to Sonnet 5.5's cache; every gate call reads it back.");
for (const name of ["cold", "hard", "identity", "degraded"]) {
  const shared = scanCost(name, think, "shared");
  const gateOnly = scanCost(name, think, "gate-only");
  const none = scanCost(name, think, "none");
  console.log(`  ${pad(name, 10)} shared ${money(shared)}   gate-only (before) ${money(gateOnly)}   none ${money(none)}   saves ${money(gateOnly - shared)} a scan`);
}

console.log(`\n\nFULL COST PER SCAN: MODEL PLUS SEARCH (thinking ${think.toLocaleString()} per call)`);
rule();
console.log(`  Serper at $${SERPER_PER_CREDIT} a credit (a Lens search ${SERPER_LENS_CREDITS}, a Shopping search ${SERPER_SHOPPING_CREDITS}), SerpApi only as a backup and for the Lens escalation.`);
for (const name of Object.keys(SEQUENCES)) {
  const calls = SEARCH_CALLS[name];
  console.log(`  ${pad(name, 13)} model ${money(c(name))}  + search ${money(searchCost(name))} (${calls.serper} Serper credits, ${calls.serpapi} SerpApi)  = ${money(c(name) + searchCost(name))}`);
}
console.log(`  ${pad("result cache", 13)} $0.0000`);

// ── What the daily model budget bounds ───────────────────────────────────
// DAILY_MODEL_BUDGET_USD is a SOFT budget: once the day's measured model
// spend reaches it, scans keep running on the degraded path (Sonnet 5.5
// gate, enhancement layers dropped, "likely" at most). It never refuses a
// scan. What bounds the total is the number of uncached scans that can
// reach the models at all: GLOBAL_DAILY_SCAN_CAP for the free tier (budget
// mode default 50 a day; the 24-hour result cache does not count against
// it), and the 500-a-day fair-use ceiling per paid account.
const GLOBAL_DAILY_CAP = 50;
const DAILY_BUDGET = 2;
const FAIR_USE_CEILING = 500;
console.log(`\n\nBUDGET MODE: WHAT THE DEFAULTS BOUND (thinking ${think.toLocaleString()} per call)`);
rule();
console.log(`  DAILY_MODEL_BUDGET_USD $${DAILY_BUDGET} (soft: past it, scans degrade, they are not refused), GLOBAL_DAILY_SCAN_CAP ${GLOBAL_DAILY_CAP}`);
console.log("  uncached free scans (hard: past it, visitors get the \"free capacity full today\" paywall).");
{
  const full = Math.min(GLOBAL_DAILY_CAP, Math.floor(DAILY_BUDGET / c("cold")));
  const rest = GLOBAL_DAILY_CAP - full;
  const model = full * c("cold") + rest * c("degraded");
  const search = full * searchCost("cold") + rest * searchCost("degraded");
  console.log(`  Worst free day, ${GLOBAL_DAILY_CAP} distinct cold products: ${full} on the full path, ${rest} degraded,`);
  console.log(`  model ${money(model)} + Serper ${money(search)} = ${money(model + search)} a day, at most ${money((model + search) * 30)} a month.`);
}
console.log(`  ${pad("budget", 10)}${pad("full-path scans", 18)}then degraded, up to the cap of ${GLOBAL_DAILY_CAP}`);
for (const budget of [2, 5, 10, 25]) {
  const full = Math.min(GLOBAL_DAILY_CAP, Math.floor(budget / c("cold")));
  console.log(`  ${pad("$" + budget.toLocaleString(), 10)}${pad(full.toLocaleString(), 18)}${(GLOBAL_DAILY_CAP - full).toLocaleString()}`);
}
console.log(`  Paid accounts sit outside the free cap, at most ${FAIR_USE_CEILING} scans each a day: $${(FAIR_USE_CEILING * c("cold")).toFixed(2)} of model spend per account on the full path.`);

console.log(`\n\nPREPAID: WHAT A BALANCE BUYS (thinking ${think.toLocaleString()} per call)`);
rule();
console.log("  Anthropic is prepaid with auto-reload off: spend stops at the balance, and every scan fails");
console.log("  (credit_exhausted, loud in /api/diagnose and the log) until credit is added.");
for (const balance of [5, 25, 50]) {
  console.log(`  ${pad("$" + balance, 6)} ${pad(Math.floor(balance / c("cold")).toLocaleString(), 6)} cold scans, or ${Math.floor(balance / c("identity")).toLocaleString()} identity-cache hits`);
}
console.log(`  Serper's ${SERPER_FREE_CREDITS.toLocaleString()} free credits: ${Math.floor(SERPER_FREE_CREDITS / SEARCH_CALLS.cold.serper).toLocaleString()} cold scans, or ${Math.floor(SERPER_FREE_CREDITS / SEARCH_CALLS.identity.serper).toLocaleString()} identity-cache hits.`);

console.log(`\n\nA VIRAL DAY: 10,000 SCANS (thinking ${think.toLocaleString()} per call)`);
rule();
console.log("  Only if the caps are raised: at the defaults, a viral day is capped at 50 uncached free scans.");
console.log(`  ${pad("", 26)}${pad("model spend", 14)}per scan`);
for (const [label, cost] of [
  ["all cold", c("cold")],
  ["50% identity-cache hits", 0.5 * c("cold") + 0.5 * c("identity")],
  ["80% identity-cache hits", 0.2 * c("cold") + 0.8 * c("identity")],
  ["95% identity-cache hits", 0.05 * c("cold") + 0.95 * c("identity")],
  ["degraded, 80% hits", 0.2 * c("degraded") + 0.8 * c("identity")],
]) {
  console.log(`  ${pad(label, 26)}${pad("$" + Math.round(cost * 10000).toLocaleString(), 14)}${money(cost)}`);
}

console.log("\n\nBURN RATE: WHAT A WORKSPACE RATE LIMIT BUYS");
rule();
console.log("  The per-minute rate limit in the Claude Console is the only setting that caps dollars");
console.log("  per hour independently of this application. Output, thinking included, is assumed");
console.log("  at 50% of input tokens for this workload.");
for (const itpm of [50_000, 100_000, 200_000, 400_000]) {
  const perMinute = (itpm * MODELS.opus.input + itpm * 0.5 * MODELS.opus.output) / 1_000_000;
  console.log(`  Opus 5.5 input ${pad(itpm.toLocaleString() + "/min", 13)} -> ${pad("$" + perMinute.toFixed(2) + "/min", 12)} ${pad("$" + (perMinute * 60).toFixed(0) + "/hour", 13)} $${(perMinute * 60 * 24).toFixed(0)}/day fully saturated`);
}
console.log("");
