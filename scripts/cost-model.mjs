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
 *
 * The product runs on two models, Claude Opus 5.5 and Claude Sonnet 5.5,
 * and both think on every call: adaptive thinking cannot be turned off, and
 * effort (set to low) is the only control. Thinking is billed as output, so
 * it is the term that decides what a scan costs, and it cannot be known from
 * here: /api/diagnose reports each probe's output tokens from a real call.
 * Until that number exists, every figure is shown at three thinking levels.
 */

// ── Published rates, USD per million tokens, as of 2026-10-01 ────────────
// https://platform.claude.com/docs/en/about-claude/pricing
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
  referenceImage: 1600,
  // Lens and Shopping thumbnails are small, typically 200-300px square.
  candidateThumbnail: 150,
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
// The level the budget and viral-day sections are worked at.
const HEADLINE_THINKING = MEASURED !== null && Number.isFinite(MEASURED) ? MEASURED : 1000;

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

/** The vision extraction: one photo, one prompt, a small JSON answer, plus thinking. */
const extract = (tier, thinking) =>
  price(tier, { input: T.referenceImage + T.extractPrompt, output: T.extractOutput + thinking });

/**
 * One gate call covering `candidates` candidates. The reference photo is a
 * cache breakpoint: the first call on a model in a scan writes it, later
 * calls on that model read it.
 */
function gateCall(tier, candidates, cacheState, thinking) {
  const rest = T.gatePromptBase + candidates * (T.candidateThumbnail + T.gateLabelPerCandidate);
  const output = T.gateOutputOverhead + candidates * T.gateOutputPerCandidate + thinking;
  if (!photoCaches(tier)) return price(tier, { input: T.referenceImage + rest, output });
  if (cacheState[tier]) return price(tier, { cacheRead: T.referenceImage, input: rest, output });
  cacheState[tier] = true;
  return price(tier, { cacheWrite: T.referenceImage, input: rest, output });
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
    gate: [["opus", 6], ["opus", 2], ["opus", 2]],
  },
  hard: {
    label: "hard scan: nothing confirms in wave one, every layer fires",
    extract: "sonnet",
    gate: [["opus", 6], ["opus", 6], ["opus", 4], ["opus", 8]],
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
    label: "Opus 5.5 refusing every call (400s are not billed): Sonnet 5.5 judges",
    extract: "sonnet",
    gate: [["sonnet", 6], ["sonnet", 2], ["sonnet", 2]],
  },
};

function scanCost(name, thinking) {
  const seq = SEQUENCES[name];
  const cacheState = {};
  let total = extract(seq.extract, thinking);
  for (const [tier, n] of seq.gate) total += gateCall(tier, n, cacheState, thinking);
  return total;
}

// ── Search, per provider, from the public price lists as of 2026-10-01 ───
//   SerpApi: $25/1,000, $75/5,000, $150/15,000, $275/30,000 searches a month
//            ($0.025 to $0.009 a search). Lens, the three direct retailers
//            (Amazon, Walmart, eBay) and merchant-link resolution run here.
//   Serper:  prepaid credits, $50 for 50,000 down to about $0.30 per 1,000.
//            Shopping and organic search run here first.
const SERPAPI_PER_SEARCH = 0.01;   // the $150 / 15,000 plan
const SERPER_PER_SEARCH = 0.001;   // the smallest credit pack
const SEARCH_CALLS = {
  cold: { serpapi: 4, serper: 3 },
  hard: { serpapi: 4, serper: 5 },
  identity: { serpapi: 1, serper: 0 },
  degraded: { serpapi: 1, serper: 2 },
  fallback: { serpapi: 4, serper: 3 },
};
const searchCost = (name) => SEARCH_CALLS[name].serpapi * SERPAPI_PER_SEARCH + SEARCH_CALLS[name].serper * SERPER_PER_SEARCH;

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
console.log("  result cache: the same photo or link again within 24 hours; nothing runs");

const think = HEADLINE_THINKING;
const c = (name) => scanCost(name, think);
const thinkingShare = (c("cold") - scanCost("cold", 0)) / c("cold");
console.log(`\n  At ${think.toLocaleString()} thinking tokens per call, thinking is ${(thinkingShare * 100).toFixed(0)}% of a cold scan's model spend.`);

console.log(`\n\nFULL COST PER SCAN: MODEL PLUS SEARCH (thinking ${think.toLocaleString()} per call)`);
rule();
console.log(`  SerpApi at $${SERPAPI_PER_SEARCH} a search, Serper at $${SERPER_PER_SEARCH}.`);
for (const name of Object.keys(SEQUENCES)) {
  const calls = SEARCH_CALLS[name];
  console.log(`  ${pad(name, 13)} model ${money(c(name))}  + search ${money(searchCost(name))} (${calls.serpapi} SerpApi, ${calls.serper} Serper)  = ${money(c(name) + searchCost(name))}`);
}
console.log(`  ${pad("result cache", 13)} $0.0000`);

// ── What the daily model budget bounds ───────────────────────────────────
// DAILY_MODEL_BUDGET_USD is a SOFT budget: once the day's measured model
// spend reaches it, scans keep running on the degraded path (Sonnet 5.5
// gate, enhancement layers dropped, "likely" at most). It never refuses a
// scan. What bounds the total is the number of uncached scans that can
// reach the models at all: GLOBAL_DAILY_SCAN_CAP for the free tier (default
// 25,000 a day; the 24-hour result cache does not count against it), and
// the 500-a-day fair-use ceiling per paid account.
const GLOBAL_DAILY_CAP = 25_000;
const FAIR_USE_CEILING = 500;
console.log(`\n\nWHAT DAILY_MODEL_BUDGET_USD BOUNDS (thinking ${think.toLocaleString()} per call)`);
rule();
console.log("  The budget is soft: past it, scans continue on the degraded path. Free-tier model");
console.log(`  spend in a day is at most  budget + (cap - budget / cold) x degraded,  with`);
console.log(`  cap = ${GLOBAL_DAILY_CAP.toLocaleString()} uncached free scans, cold = ${money(c("cold"))}, degraded = ${money(c("degraded"))}.`);
console.log("");
console.log(`  ${pad("budget", 10)}${pad("full-path scans", 18)}${pad("then degraded", 16)}${pad("model, worst day", 18)}model + search`);
for (const budget of [100, 250, 500, 1000, 2000]) {
  const full = Math.min(GLOBAL_DAILY_CAP, Math.floor(budget / c("cold")));
  const rest = GLOBAL_DAILY_CAP - full;
  const model = full * c("cold") + rest * c("degraded");
  const total = model + full * searchCost("cold") + rest * searchCost("degraded");
  console.log(`  ${pad("$" + budget.toLocaleString(), 10)}${pad(full.toLocaleString(), 18)}${pad(rest.toLocaleString(), 16)}${pad("$" + Math.round(model).toLocaleString(), 18)}$${Math.round(total).toLocaleString()}`);
}
console.log(`\n  Worst case means every one of the ${GLOBAL_DAILY_CAP.toLocaleString()} free scans is a distinct, uncached product.`);
console.log("  A viral day is the opposite: thousands of photos of a few products, most served by");
console.log("  the identity cache or the result cache. Paid accounts sit outside the free cap, at");
console.log(`  most ${FAIR_USE_CEILING} scans each a day: $${(FAIR_USE_CEILING * c("cold")).toFixed(2)} of model spend per account on the full path.`);

console.log(`\n\nA VIRAL DAY: 10,000 SCANS (thinking ${think.toLocaleString()} per call)`);
rule();
console.log("  The share served from cache decides whether the day is survivable.");
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

// The Anthropic account's tier carries a MONTHLY spend cap (Start $500,
// Build $1,000, Scale $200,000 as of 2026-10-01). At the cap every request
// answers 429 until the 1st of the next month, whatever this application's
// own budget says, and every scan fails. Raise the tier before traffic.
console.log(`\n\nANTHROPIC MONTHLY SPEND CAP BY ACCOUNT TIER (thinking ${think.toLocaleString()} per call)`);
rule();
console.log("  At the cap, every model call answers 429 until the 1st of next month: all scans fail.");
for (const [tier, cap] of [["Start", 500], ["Build", 1000], ["Scale", 200000]]) {
  console.log(`  ${pad(tier, 8)} $${pad(cap.toLocaleString(), 9)} ${pad(Math.floor(cap / c("cold")).toLocaleString(), 10)} cold scans a month, or ${Math.floor(cap / c("identity")).toLocaleString()} identity-cache hits`);
}
console.log(`  DAILY_MODEL_BUDGET_USD of $250 allows up to $${(250 * 30).toLocaleString()} a month on the full path alone.`);

console.log("\n\nSERPAPI CAPACITY: SCANS A MONTH PER PLAN");
rule();
console.log("  The monthly search allowance, not the bill, is the first wall a viral week hits.");
for (const [plan, searches] of [["$75 / 5,000", 5000], ["$150 / 15,000", 15000], ["$275 / 30,000", 30000]]) {
  console.log(`  ${pad(plan, 16)} ${pad(Math.floor(searches / SEARCH_CALLS.cold.serpapi).toLocaleString(), 8)} cold scans, or ${Math.floor(searches / SEARCH_CALLS.identity.serpapi).toLocaleString()} identity-cache hits`);
}
console.log("  When the allowance runs out, Lens falls back to Serper and the retailer sweep is skipped (logged).");

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
