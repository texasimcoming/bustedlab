/**
 * COST MODEL for the scan engine's Claude API spend.
 *
 * Not an estimate written in prose and then trusted. The call sequences
 * below are the ones scripts/check-identification.mjs OBSERVES the engine
 * making on its scenarios - it prints them as "gate: N call(s), M candidates
 * judged" and a model-by-model list - and this script prices exactly those
 * shapes from the published per-token rates. Every assumption is a named
 * constant so it can be argued with, corrected, and re-run:
 *
 *   node --experimental-strip-types --no-warnings scripts/cost-model.mjs
 *
 * The two measurements that shaped the design:
 *
 * 1. Opus 5's minimum cacheable prefix is 512 tokens; Haiku 4.5's is 4,096.
 *    A scanned photo is ~1,600 tokens, and an image capped at 1568px on its
 *    long edge tops out near 2,400 - so the photo caches on the strong model
 *    and can NEVER cache on the cheap one. Per candidate compared, the cheap
 *    model is therefore about 4x cheaper, not the ~25x the headline token
 *    prices suggest. That is most of the case for a cheap-first screen gone.
 *
 * 2. Verification input is image-dominated and the photo is the dominant
 *    image, so sending it ONCE with six candidate thumbnails costs about
 *    what six cheap-model pairwise calls cost and roughly half what six
 *    strong-model pairwise calls cost. Batching beats downgrading, and
 *    unlike downgrading it costs nothing in accuracy: the strong model still
 *    judges every candidate.
 */

// ── Published rates, USD per million tokens ──────────────────────────────
// https://platform.claude.com/docs/en/about-claude/pricing
const MODELS = {
  opus: { id: "claude-opus-5", input: 5.0, output: 25.0, cacheMinimum: 512 },
  haiku: { id: "claude-haiku-4-5", input: 1.0, output: 5.0, cacheMinimum: 4096 },
};
const CACHE_WRITE_MULTIPLIER = 1.25; // 5-minute TTL
const CACHE_READ_MULTIPLIER = 0.1;

// ── Token assumptions. Image tokens are about (width x height) / 750, with
//    the long edge capped at 1568px before that arithmetic. ──────────────
const T = {
  // A phone screenshot at 1170x2532 scales to 725x1568 -> ~1,516 tokens.
  // A landscape camera photo at 1568x1176 -> ~2,459. 1,600 is a fair middle.
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

function price(tier, { input = 0, cacheWrite = 0, cacheRead = 0, output = 0 }) {
  const m = MODELS[tier];
  return (
    (input * m.input +
      cacheWrite * m.input * CACHE_WRITE_MULTIPLIER +
      cacheRead * m.input * CACHE_READ_MULTIPLIER +
      output * m.output) /
    1_000_000
  );
}

const photoCaches = (tier) => T.referenceImage >= MODELS[tier].cacheMinimum;

/** The vision extraction: one photo, one prompt, one small JSON answer. */
const extract = (tier) =>
  price(tier, { input: T.referenceImage + T.extractPrompt, output: T.extractOutput });

/**
 * One gate call covering `candidates` candidates. `warm` says whether the
 * reference photo is already in the cache from an earlier call in the same
 * scan - only possible on a model whose cache minimum the photo clears.
 */
function gateCall(tier, candidates, cacheState) {
  const rest = T.gatePromptBase + candidates * (T.candidateThumbnail + T.gateLabelPerCandidate);
  const output = T.gateOutputOverhead + candidates * T.gateOutputPerCandidate;
  if (!photoCaches(tier)) {
    return price(tier, { input: T.referenceImage + rest, output });
  }
  if (cacheState[tier]) {
    return price(tier, { cacheRead: T.referenceImage, input: rest, output });
  }
  cacheState[tier] = true;
  return price(tier, { cacheWrite: T.referenceImage, input: rest, output });
}

/** The pre-fix shape, for comparison: one candidate per call. */
function pairwiseCalls(tier, candidates, cacheState) {
  let total = 0;
  for (let i = 0; i < candidates; i++) total += gateCall(tier, 1, cacheState);
  return total;
}

// ── The call sequences the engine actually makes ─────────────────────────
// Each entry is [tier, candidates-in-this-call]. Taken from the gate and
// model lines check-identification.mjs prints for each scenario.
const SEQUENCES = {
  typical: {
    label: "cold scan, Lens hits, top wave confirms (glasses scenario)",
    extractTier: "haiku",
    // wave 1 of 6, then the pricing search, the rebrand sweep and the
    // retailer sweep, each on the narrow pricing window.
    calls: [["opus", 6], ["opus", 2], ["opus", 1], ["opus", 1]],
  },
  hard: {
    label: "cold scan, nothing confirms in wave 1, every fallback fires",
    extractTier: "haiku",
    calls: [["opus", 6], ["opus", 6], ["opus", 4], ["opus", 4], ["opus", 4]],
  },
  spike: {
    label: "second person photographs the same product (identity cache hit)",
    extractTier: "haiku",
    calls: [["haiku", 1]],
  },
  degraded: {
    label: "day's budget spent: cheap gate, no enhancement layers",
    extractTier: "haiku",
    calls: [["haiku", 6], ["haiku", 2]],
  },
};

// ── Configurations, for the comparison the decision needs ────────────────
const CONFIGS = {
  "pre-session": {
    label: "Before this session: Haiku throughout, 5 candidates, one per call",
    run(seq) {
      const cacheState = {};
      const candidates = seq.calls.reduce((n, [, c]) => n + c, 0);
      return extract("haiku") + pairwiseCalls("haiku", Math.min(candidates, 5), cacheState);
    },
  },
  "opus-pairwise": {
    label: "Last pass as shipped: Opus throughout, one call per candidate",
    run(seq) {
      const cacheState = {};
      let total = extract("opus");
      for (const [, candidates] of seq.calls) total += pairwiseCalls("opus", candidates, cacheState);
      return total;
    },
  },
  "opus-batched": {
    label: "This pass: Haiku extract, batched Opus gate, identity cache",
    run(seq) {
      const cacheState = {};
      let total = extract(seq.extractTier);
      for (const [tier, candidates] of seq.calls) total += gateCall(tier, candidates, cacheState);
      return total;
    },
  },
};

// ── Report ───────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
const money = (n) => `$${n.toFixed(4)}`;

console.log("\nASSUMPTIONS");
console.log("-".repeat(78));
console.log(`  reference photo        ${T.referenceImage} tokens  (1568px-capped image, ~w*h/750)`);
console.log(`  candidate thumbnail    ${T.candidateThumbnail} tokens`);
console.log(`  cache write / read     ${CACHE_WRITE_MULTIPLIER}x / ${CACHE_READ_MULTIPLIER}x of the input rate`);
for (const [tier, m] of Object.entries(MODELS)) {
  console.log(
    `  ${pad(m.id, 22)} $${m.input}/$${m.output} per Mtok, cache minimum ${pad(m.cacheMinimum, 5)} ` +
    `-> photo ${photoCaches(tier) ? "CACHES" : "cannot cache"}`
  );
}

console.log("\n\nPER SCAN");
console.log("-".repeat(78));
const results = {};
for (const [name, seq] of Object.entries(SEQUENCES)) {
  const candidates = seq.calls.reduce((n, [, c]) => n + c, 0);
  console.log(`\n  ${name.toUpperCase()}: ${seq.label}`);
  console.log(`  ${seq.calls.length} gate call(s), ${candidates} candidates judged`);
  results[name] = {};
  for (const [configName, config] of Object.entries(CONFIGS)) {
    if (name === "spike" && configName !== "opus-batched") continue;
    if (name === "degraded" && configName !== "opus-batched") continue;
    const cost = config.run(seq);
    results[name][configName] = cost;
    console.log(`    ${pad(configName, 16)} ${pad(money(cost), 11)} ${config.label}`);
  }
}

console.log("\n\nA VIRAL DAY: 10,000 SCANS, OVERWHELMINGLY FREE TIER");
console.log("-".repeat(78));
console.log("  A spike is concentrated by definition - thousands of people scanning the");
console.log("  same thing - so the cache hit rate during one is the number that decides");
console.log("  whether the day is survivable.");
console.log("");
const cold = results.typical["opus-batched"];
const spike = results.spike["opus-batched"];
const degraded = results.degraded["opus-batched"];
console.log(`  ${pad("", 26)} ${pad("model spend", 14)} per scan`);
for (const [label, cost] of [
  ["all cold, pre-session", results.typical["pre-session"]],
  ["all cold, opus pairwise", results.typical["opus-pairwise"]],
  ["all cold, this pass", cold],
  ["50% cache hit", 0.5 * cold + 0.5 * spike],
  ["80% cache hit", 0.2 * cold + 0.8 * spike],
  ["95% cache hit", 0.05 * cold + 0.95 * spike],
  ["degraded, 80% cache hit", 0.2 * degraded + 0.8 * spike],
]) {
  console.log(`  ${pad(label, 26)} ${pad("$" + (cost * 10000).toFixed(0), 14)} ${money(cost)}`);
}

// ── What one abused paid session can spend in a day ──────────────────────
// Paid accounts are unlimited by design: they bypass the free daily
// allowance and GLOBAL_DAILY_SCAN_CAP. The only thing still applying to them
// is the per-IP burst limiter, so this is the ceiling that design accepts.
const BURST_PER_MINUTE = 12;   // SCAN_BURST_PER_MINUTE default
const DAILY_BUDGET = 250;      // DAILY_MODEL_BUDGET_USD default
const FAIR_USE_CEILING = 500;  // PAID_DAILY_SCAN_CEILING default
// What the burst limiter alone allowed, before the fair-use ceiling existed.
const BURST_ONLY_SCANS_PER_DAY = BURST_PER_MINUTE * 60 * 24;
const MAX_SCANS_PER_DAY = Math.min(FAIR_USE_CEILING, BURST_ONLY_SCANS_PER_DAY);

// Search spend per scan, which the model budget does NOT govern. A cold scan
// makes a Lens call, up to two shopping tiers, three direct-retailer calls
// and a link resolution; degraded mode drops the retailer and rebrand
// layers. Priced at $0.0075 per search, mid-range for SerpApi's plans.
const PER_SEARCH = 0.0075;
const SEARCHES_COLD = 5;
const SEARCHES_DEGRADED = 2.5;

console.log("\n\nONE ABUSED PAID SESSION, ONE DAY");
console.log("-".repeat(78));
console.log(`  Paid accounts bypass the free allowance and the global scan cap. The`);
console.log(`  per-IP burst limiter (${BURST_PER_MINUTE}/min) allowed ${BURST_ONLY_SCANS_PER_DAY.toLocaleString()} scans a day on its`);
console.log(`  own; PAID_DAILY_SCAN_CEILING now caps it at ${FAIR_USE_CEILING} per account per UTC day.`);
console.log(`  Figures below assume every scan is a distinct product - repeats hit the`);
console.log(`  identity cache and cost a fraction of this.`);
console.log("");

const coldScan = results.typical["opus-batched"];
const degradedScan = results.degraded["opus-batched"];
const scansBeforeBudget = Math.min(MAX_SCANS_PER_DAY, Math.floor(DAILY_BUDGET / coldScan));
const scansAfterBudget = MAX_SCANS_PER_DAY - scansBeforeBudget;

const uncappedModel = MAX_SCANS_PER_DAY * coldScan;
const cappedModel = scansBeforeBudget * coldScan + scansAfterBudget * degradedScan;
const searchCost = scansBeforeBudget * SEARCHES_COLD * PER_SEARCH + scansAfterBudget * SEARCHES_DEGRADED * PER_SEARCH;

const burstOnlyModel = BURST_ONLY_SCANS_PER_DAY * coldScan;
const burstOnlySearch = BURST_ONLY_SCANS_PER_DAY * SEARCHES_COLD * PER_SEARCH;
console.log(`  BEFORE the ceiling, burst limiter only $${(burstOnlyModel + burstOnlySearch).toFixed(0).padStart(5)}   ` +
            `(${BURST_ONLY_SCANS_PER_DAY.toLocaleString()} scans: $${burstOnlyModel.toFixed(0)} model + $${burstOnlySearch.toFixed(0)} search)`);
console.log("");
console.log(`  Model spend, no budget configured    $${uncappedModel.toFixed(0).padStart(6)}`);
console.log(`  Model spend, budget at $${DAILY_BUDGET}          $${cappedModel.toFixed(0).padStart(6)}   ` +
            `(${scansBeforeBudget.toLocaleString()} cold, then ${scansAfterBudget.toLocaleString()} degraded)`);
console.log(`  Search spend (SerpApi/Serper)        $${searchCost.toFixed(0).padStart(6)}   capped by the scan ceiling`);
console.log(`  ------------------------------------------------`);
console.log(`  Total accepted worst case             $${(cappedModel + searchCost).toFixed(0).padStart(6)} per day, per abused session`);
console.log("");
console.log(`  Both halves are now bounded by the same thing: the scan ceiling. Before`);
console.log(`  it, the model half was bounded by the daily budget and the search half`);
console.log(`  was bounded by nothing at all, because GLOBAL_DAILY_SCAN_CAP does not`);
console.log(`  apply to paid accounts.`);

console.log("\n\nBURN RATE: WHAT A WORKSPACE RATE LIMIT BUYS");
console.log("-".repeat(78));
console.log("  A monthly spend limit does not stop a bad day, it stops the month. The");
console.log("  per-minute rate limit is the only setting that caps dollars per hour.");
console.log("  Output is assumed at 8% of input tokens for this workload.");
console.log("");
for (const itpm of [50_000, 100_000, 200_000, 400_000]) {
  const perMinute = (itpm * MODELS.opus.input + itpm * 0.08 * MODELS.opus.output) / 1_000_000;
  console.log(
    `  Opus input ${pad(itpm.toLocaleString() + "/min", 13)} -> ` +
    `${pad("$" + perMinute.toFixed(2) + "/min", 12)} ${pad("$" + (perMinute * 60).toFixed(0) + "/hour", 13)} ` +
    `$${(perMinute * 60 * 24).toFixed(0)}/day fully saturated`
  );
}
console.log("");
