/**
 * DOES A CHEAPER MODEL IDENTIFY PRODUCTS AS WELL?
 *
 * The cost architecture in this engine rests on one unmeasured belief: that
 * the strong model's judgement on "is this listing the same physical product
 * as this photo" is worth what it costs, and that a cheaper model's is not.
 * Nothing in scripts/check-identification.mjs can settle that - it mocks the
 * model's verdicts, so it measures the engine's logic, not the model's eye.
 *
 * This script settles it, with real photographs and real API calls. It runs
 * the REAL gate prompt (imported from src/lib/gate-prompt.ts, not copied)
 * over a set of labelled cases, on two or more models, and reports the two
 * error classes that actually matter:
 *
 *   FALSE CONFIRMATION - said "exact" when the truth is "similar" or
 *     "different". This is the failure that ends up on a shareable card
 *     accusing a named seller of a markup on the wrong product. It is the
 *     expensive one.
 *   MISSED MATCH - said "similar" or "different" when the truth is "exact".
 *     This is the Ralph Lauren failure: the right answer was in the list and
 *     the gate did not take it.
 *
 * It also reports measured cost per model from the usage the API returns, so
 * the accuracy difference can be put next to the real price difference
 * rather than next to the headline per-token rates.
 *
 * WHAT YOU HAVE TO PROVIDE. Labelled cases, in evals/gate-cases.json:
 *
 *   [
 *     {
 *       "id": "polo-ph2083",
 *       "photo": "evals/photos/polo-glasses.jpg",
 *       "candidates": [
 *         { "image": "evals/candidates/polo-ph2083.jpg",  "expect": "exact" },
 *         { "image": "evals/candidates/polo-ph1117.jpg",  "expect": "similar" },
 *         { "image": "evals/candidates/zenni-4438821.jpg","expect": "different" }
 *       ]
 *     }
 *   ]
 *
 * The photo is what a user would scan (a phone photo or a screenshot, with
 * whatever background and crop that implies). Each candidate image is a
 * merchant listing photo. `expect` is your own judgement of the truth, and
 * the quality of the measurement is the quality of those labels - the cases
 * worth including are the hard ones: same brand different model, same shape
 * different brand, same model different colourway. Twenty well-chosen cases
 * tell you more than two hundred easy ones.
 *
 * THIS SPENDS REAL MONEY. It prints what it is about to cost and refuses to
 * run without --yes.
 *
 *   node --experimental-strip-types --no-warnings scripts/eval-gate.mjs --yes
 *   node ... scripts/eval-gate.mjs --models claude-opus-5,claude-haiku-4-5-20251001 --yes
 *
 * Raw fetch rather than the Anthropic SDK, because this project has no SDK
 * dependency and every model call in src/lib/scan.ts is raw fetch too. The
 * point of this script is to exercise the same request shape the engine
 * sends, so it sends it the same way.
 */
import { readFileSync, existsSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { buildBatchPrompt, coerceVerdict, salvageVerdictObjects } from "../src/lib/gate-prompt.ts";

const REPO = resolve(dirname(new URL(import.meta.url).pathname), "..");

// ── arguments ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const MANIFEST = resolve(REPO, flag("manifest", "evals/gate-cases.json"));
const MODELS = flag("models", "claude-opus-5,claude-haiku-4-5-20251001").split(",").map(s => s.trim());
const BATCH = Number(flag("batch", "6"));
const OUT = flag("out", null);
const CONFIRMED = args.includes("--yes");

// Published rates, USD per million tokens. Same table as scripts/cost-model.mjs.
const PRICING = {
  "claude-opus-5": { input: 5.0, output: 25.0 },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
};

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
const VALID = new Set(["exact", "similar", "different"]);

function die(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

// ── input ────────────────────────────────────────────────────────────────
if (!existsSync(MANIFEST)) {
  die(
    `No labelled cases at ${MANIFEST}.\n\n` +
    `This script cannot invent them: the answer it produces is only as good as\n` +
    `your labels. Create that file in the shape documented at the top of this\n` +
    `script, put the photos beside it, and run again. evals/README.md has the\n` +
    `same instructions and advice on which cases are worth including.`
  );
}
if (!process.env.ANTHROPIC_API_KEY) die("ANTHROPIC_API_KEY is not set. This script makes real API calls.");

let cases;
try {
  cases = JSON.parse(readFileSync(MANIFEST, "utf8"));
} catch (error) {
  die(`${MANIFEST} is not valid JSON: ${error.message}`);
}
if (!Array.isArray(cases) || cases.length === 0) die(`${MANIFEST} holds no cases.`);

// Validate everything before spending anything.
const problems = [];
let candidateCount = 0;
for (const [i, testCase] of cases.entries()) {
  const where = `case ${i}${testCase?.id ? ` (${testCase.id})` : ""}`;
  if (!testCase?.photo) problems.push(`${where}: no "photo"`);
  else if (!existsSync(resolve(REPO, testCase.photo))) problems.push(`${where}: photo not found: ${testCase.photo}`);
  if (!Array.isArray(testCase?.candidates) || testCase.candidates.length === 0) {
    problems.push(`${where}: no "candidates"`);
    continue;
  }
  for (const [j, candidate] of testCase.candidates.entries()) {
    candidateCount++;
    if (!candidate?.image) problems.push(`${where} candidate ${j}: no "image"`);
    else if (!existsSync(resolve(REPO, candidate.image))) problems.push(`${where} candidate ${j}: image not found: ${candidate.image}`);
    if (!VALID.has(candidate?.expect)) {
      problems.push(`${where} candidate ${j}: "expect" must be exact | similar | different`);
    }
  }
}
if (problems.length > 0) die(`The manifest has problems:\n  ${problems.join("\n  ")}`);

// ── cost preflight ───────────────────────────────────────────────────────
// Image tokens are about (width x height) / 750 after the long edge is
// capped at 1568px. Without decoding the images, file size is the honest
// proxy available here, so this is explicitly an estimate and the real
// figure is reported from usage after the run.
const estimateImageTokens = (path) => {
  const bytes = statSync(resolve(REPO, path)).size;
  return Math.min(2400, Math.max(200, Math.round(bytes / 400)));
};

let estimatedCost = 0;
const batchesPerCase = [];
for (const testCase of cases) {
  const photoTokens = estimateImageTokens(testCase.photo);
  const batches = Math.ceil(testCase.candidates.length / BATCH);
  batchesPerCase.push(batches);
  for (let b = 0; b < batches; b++) {
    const slice = testCase.candidates.slice(b * BATCH, (b + 1) * BATCH);
    const input = photoTokens + slice.reduce((n, c) => n + estimateImageTokens(c.image), 0) + 700;
    const output = 30 + slice.length * 30;
    for (const model of MODELS) {
      const rate = PRICING[model] || { input: 5, output: 25 };
      estimatedCost += (input * rate.input + output * rate.output) / 1_000_000;
    }
  }
}
const totalCalls = batchesPerCase.reduce((a, b) => a + b, 0) * MODELS.length;

console.log(`\nGATE JUDGEMENT EVAL`);
console.log("-".repeat(78));
console.log(`  cases            ${cases.length}`);
console.log(`  candidates       ${candidateCount}`);
console.log(`  models           ${MODELS.join(", ")}`);
console.log(`  batch size       ${BATCH} candidates per call (the engine's own shape)`);
console.log(`  API calls        ${totalCalls}`);
console.log(`  estimated cost   ~$${estimatedCost.toFixed(4)} (rough: image tokens estimated from file size)`);

if (!CONFIRMED) {
  console.log(`\n  Not running. This spends real money - re-run with --yes to proceed.\n`);
  process.exit(0);
}

// ── the run ──────────────────────────────────────────────────────────────
const asBase64 = (path) => {
  const full = resolve(REPO, path);
  const mime = MIME[extname(full).toLowerCase()];
  if (!mime) die(`Unsupported image type: ${path}`);
  return { data: readFileSync(full).toString("base64"), mimeType: mime };
};

async function judge(model, photo, candidates) {
  const content = [
    { type: "text", text: "IMAGE A (the photo being scanned):" },
    { type: "image", source: { type: "base64", media_type: photo.mimeType, data: photo.data } },
  ];
  candidates.forEach((candidate, slot) => {
    content.push({ type: "text", text: `CANDIDATE ${slot + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: candidate.image.mimeType, data: candidate.image.data } });
  });
  content.push({ type: "text", text: buildBatchPrompt(candidates.length) });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 250 + candidates.length * 90,
      temperature: 0,
      messages: [{ role: "user", content }],
    }),
  });

  if (!res.ok) {
    return { verdicts: candidates.map(() => null), usage: null, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  let list;
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.verdicts) ? parsed.verdicts : [];
  } catch {
    list = [];
  }
  if (list.length === 0) list = salvageVerdictObjects(text);

  const verdicts = candidates.map(() => null);
  list.forEach((raw, position) => {
    const verdict = coerceVerdict(raw);
    if (!verdict) return;
    const stated = raw?.candidate;
    const slot = typeof stated === "number" && stated >= 1 && stated <= candidates.length ? stated - 1 : position;
    if (slot >= 0 && slot < candidates.length) verdicts[slot] = verdict;
  });
  return { verdicts, usage: data.usage, error: null };
}

const score = {};
for (const model of MODELS) {
  score[model] = {
    judged: 0, agreed: 0, falseConfirmations: 0, missedMatches: 0,
    otherDisagreements: 0, unparsed: 0, cost: 0, errors: [],
    perCase: [],
  };
}

for (const testCase of cases) {
  const photo = asBase64(testCase.photo);
  const candidates = testCase.candidates.map(c => ({ ...c, image: asBase64(c.image) }));

  for (const model of MODELS) {
    const s = score[model];
    const got = [];
    for (let b = 0; b * BATCH < candidates.length; b++) {
      const slice = candidates.slice(b * BATCH, (b + 1) * BATCH);
      const { verdicts, usage, error } = await judge(model, photo, slice);
      if (error) s.errors.push(`${testCase.id}: ${error}`);
      if (usage) {
        const rate = PRICING[model] || { input: 5, output: 25 };
        s.cost +=
          ((usage.input_tokens || 0) * rate.input + (usage.output_tokens || 0) * rate.output) / 1_000_000;
      }
      got.push(...verdicts);
    }

    const caseRow = { id: testCase.id, results: [] };
    candidates.forEach((candidate, i) => {
      const verdict = got[i];
      s.judged++;
      if (!verdict) {
        s.unparsed++;
        caseRow.results.push({ expect: candidate.expect, got: null });
        return;
      }
      caseRow.results.push({ expect: candidate.expect, got: verdict.match, why: verdict.reasoning });
      if (verdict.match === candidate.expect) s.agreed++;
      else if (verdict.match === "exact") s.falseConfirmations++;
      else if (candidate.expect === "exact") s.missedMatches++;
      else s.otherDisagreements++;
    });
    s.perCase.push(caseRow);
  }
}

// ── report ───────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "-");

console.log(`\n\nRESULTS`);
console.log("-".repeat(78));
console.log(
  `  ${pad("model", 30)} ${pad("agree", 9)} ${pad("false conf", 12)} ${pad("missed", 9)} ${pad("cost", 10)}`
);
for (const model of MODELS) {
  const s = score[model];
  console.log(
    `  ${pad(model, 30)} ${pad(pct(s.agreed, s.judged), 9)} ` +
    `${pad(`${s.falseConfirmations} (${pct(s.falseConfirmations, s.judged)})`, 12)} ` +
    `${pad(`${s.missedMatches}`, 9)} $${s.cost.toFixed(4)}`
  );
  if (s.unparsed > 0) console.log(`  ${pad("", 30)} ${s.unparsed} unparsed answer(s)`);
  for (const error of s.errors.slice(0, 5)) console.log(`  ${pad("", 30)} error: ${error}`);
}

// The question that decides the architecture: on the cases where the strong
// model and the labels agree, how often does the cheap model agree too? That
// fraction is what a cheap-first screen would get right with no escalation.
if (MODELS.length >= 2) {
  const [strong, cheap] = MODELS;
  let both = 0, comparable = 0, cheapWrongWhereStrongRight = 0;
  cases.forEach((testCase, caseIndex) => {
    const strongRow = score[strong].perCase[caseIndex];
    const cheapRow = score[cheap].perCase[caseIndex];
    strongRow.results.forEach((strongResult, i) => {
      const cheapResult = cheapRow.results[i];
      if (!strongResult.got || !cheapResult?.got) return;
      if (strongResult.got !== strongResult.expect) return;
      comparable++;
      if (cheapResult.got === strongResult.expect) both++;
      else cheapWrongWhereStrongRight++;
    });
  });
  console.log(`\n  Where ${strong} was right, ${cheap} agreed on ${both}/${comparable} (${pct(both, comparable)}).`);
  console.log(`  ${cheapWrongWhereStrongRight} case(s) would need escalation or would be decided wrongly.`);
  console.log(`\n  A cheap-first gate is only defensible if that agreement is very high AND`);
  console.log(`  the disagreements are missed matches rather than false confirmations - a`);
  console.log(`  missed match costs a scan, a false confirmation costs a wrong accusation.`);
}

if (OUT) {
  writeFileSync(resolve(REPO, OUT), JSON.stringify({ models: MODELS, batch: BATCH, score }, null, 2));
  console.log(`\n  Full per-candidate results written to ${OUT}`);
}
console.log("");
