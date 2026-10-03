/**
 * MODEL REQUEST CONTRACT.
 *
 * Two live scans went wrong in the same way: a wrong-colour hat shown as a
 * closest match, and "no match found" on a real product. Both came from the
 * request the engine sends to the Claude API, not from the search or the
 * prompt:
 *
 *   - temperature: 0 went to every model, and Opus 5 answers any
 *     non-default sampling parameter with HTTP 400. The verification gate
 *     and the extraction escalation both run on Opus 5, so neither ever ran.
 *   - Replies were read as content[0].text. Opus 5 thinks by default, so the
 *     first block can be a thinking block with no text at all.
 *
 * Both failures were swallowed and looked like "nothing verified". The other
 * checks stub api.anthropic.com with a server that accepts anything, which is
 * why none of them could see it.
 *
 * The models are Claude Opus 5.5 and Claude Sonnet 5.5, nothing else, in
 * every path that identifies or verifies a product, with each role's model
 * chosen by the production evaluation (Sonnet 5.5 judges, Opus 5.5 backs it
 * up; see MODELS in src/lib/scan.ts). Both always think, and max_tokens covers thinking plus the
 * answer, so this check also proves that the thinking room on every call
 * leaves the JSON answer intact, and that a call whose thinking used the
 * whole budget is handed to the next model rather than read as "no match". This one stubs it with a server that applies
 * Anthropic's DOCUMENTED request rules and answers a violation the way the
 * real API does, with a 400. The rules below are written out here from the
 * documentation, not imported from the engine, so the engine cannot pass by
 * agreeing with itself.
 *
 *   node --experimental-strip-types --no-warnings scripts/check-model-contract.mjs
 */
import { loadEngine, localModule } from "./lib/engine.mjs";

// ════════════════════════════════════════════════════════════════
// THE DOCUMENTED RULES. Verified 2026-10-01 against:
//   https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting
//     (per-model table: thinking types accepted, default, rejected with 400)
//   https://platform.claude.com/docs/en/build-with-claude/effort
//     (supportedModels: Haiku 4.5 is not listed; disabled thinking on Opus 5
//      only at effort high or below)
//   https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5
//   and the Opus 4.7, Opus 5, Sonnet 5, Opus 5.5, Sonnet 5.5 and Fable 5.1
//   migration guides (sampling parameters rejected; prefill rejected).
// ════════════════════════════════════════════════════════════════
const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"];
const DOCUMENTED = {
  "claude-haiku-4-5":  { sampling: "allowed",          thinking: ["enabled", "disabled"],      effort: false },
  "claude-opus-4-7":   { sampling: "rejected",         thinking: ["adaptive", "disabled"],     effort: true },
  "claude-opus-4-8":   { sampling: "rejected",         thinking: ["adaptive", "disabled"],     effort: true },
  "claude-opus-5":     { sampling: "rejected",         thinking: ["adaptive", "disabled"],     effort: true, thinksByDefault: true, disabledMaxEffort: "high" },
  "claude-sonnet-5":   { sampling: "rejected",         thinking: ["adaptive", "disabled"],     effort: true, thinksByDefault: true },
  "claude-opus-5-5":   { sampling: "rejected",         thinking: ["adaptive"],                 effort: true, thinksByDefault: true },
  "claude-sonnet-5-5": { sampling: "rejected",         thinking: ["adaptive", "between_tools"], effort: true, thinksByDefault: true, betweenToolsMaxEffort: "high" },
  "claude-fable-5":    { sampling: "rejected",         thinking: ["adaptive"],                 effort: true, thinksByDefault: true },
  "claude-fable-5-1":  { sampling: "rejected",         thinking: ["adaptive"],                 effort: true, thinksByDefault: true },
};
const canonical = (model) => String(model || "").replace(/-\d{8}$/, "");

/** Violations the real API answers with a 400. */
function documentedViolations(body) {
  const out = [];
  const rules = DOCUMENTED[canonical(body.model)];
  if (!rules) return out;
  const effort = body.output_config?.effort;
  for (const p of ["temperature", "top_p", "top_k"]) {
    if (p in body && rules.sampling === "rejected") out.push(`${p} is not accepted on ${body.model}`);
  }
  if (body.thinking) {
    const type = body.thinking.type;
    if (!rules.thinking.includes(type)) out.push(`"thinking.type.${type}" is not supported for this model`);
    if (type === "disabled" && rules.disabledMaxEffort && effort &&
        EFFORT_ORDER.indexOf(effort) > EFFORT_ORDER.indexOf(rules.disabledMaxEffort)) {
      out.push(`thinking disabled is not accepted with effort ${effort} on ${body.model}`);
    }
    if (type === "between_tools" && rules.betweenToolsMaxEffort && effort &&
        EFFORT_ORDER.indexOf(effort) > EFFORT_ORDER.indexOf(rules.betweenToolsMaxEffort)) {
      out.push(`output_config.effort '${effort}' is not supported when thinking is disabled on this model`);
    }
  }
  if (effort !== undefined && !rules.effort) out.push(`output_config.effort is not supported on ${body.model}`);
  if (effort !== undefined && !EFFORT_ORDER.includes(effort)) out.push(`unknown effort ${effort}`);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length && messages[messages.length - 1].role === "assistant") {
    out.push("assistant prefill is not supported");
  }
  return out;
}

/**
 * The owner's rules on top of the documented ones: only the two 5.5 models;
 * no sampling parameters; adaptive thinking left on (no thinking field, or
 * "adaptive"); effort at its lowest unless GATE_EFFORT raises the gate; and
 * max_tokens big enough that thinking cannot eat the answer, without going
 * past the 16K that a non-streamed call should stay under.
 */
const ENGINE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"];
const THINKING_ROOM = 15_000;
const MAX_TOKENS_CEILING = 16_000;

/** What the answer itself needs, by the kind of call: the engine's own budgets. */
function answerBudget(body) {
  const prompt = textOf(body);
  if (prompt.includes("candidate product listing image")) {
    const candidates = body.messages[0].content.filter(b => b.type === "image").length - 1;
    return 250 + candidates * 90;
  }
  if (prompt.includes("Product intelligence scan")) return 350;
  if (prompt.includes("Extract the product name and price")) return 200;
  return 120;
}

function policyViolations(body, { gateEffort = "low" } = {}) {
  const out = [];
  const model = canonical(body.model);
  if (!ENGINE_MODELS.includes(model)) out.push(`policy: ${body.model} is not one of the product's models (${ENGINE_MODELS.join(", ")})`);
  const sampling = ["temperature", "top_p", "top_k"].filter(p => p in body);
  if (sampling.length) out.push(`policy: no sampling parameters (sent ${sampling.join(", ")})`);
  if (body.thinking && body.thinking.type !== "adaptive") out.push(`policy: thinking stays adaptive (sent ${body.thinking.type})`);
  const isGate = textOf(body).includes("candidate product listing image");
  const expected = isGate ? gateEffort : "low";
  if (body.output_config?.effort !== expected) out.push(`policy: effort ${expected} on ${isGate ? "the gate" : "this call"} (sent ${body.output_config?.effort})`);
  if (!(Number.isInteger(body.max_tokens) && body.max_tokens > 0)) out.push("max_tokens missing");
  const room = body.max_tokens - answerBudget(body);
  if (room < THINKING_ROOM) out.push(`policy: only ${room} tokens of thinking room above a ${answerBudget(body)}-token answer (need ${THINKING_ROOM})`);
  if (body.max_tokens > MAX_TOKENS_CEILING) out.push(`policy: max_tokens ${body.max_tokens} is above ${MAX_TOKENS_CEILING} for a non-streamed call`);
  return out;
}

// ════════════════════════════════════════════════════════════════
// Harness: one result line per assertion, non-zero exit on any failure.
// ════════════════════════════════════════════════════════════════
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `\n        ${detail}` : ""}`);
  if (!ok) failures++;
};
const section = (title) => console.log(`\n── ${title} ──`);

const errorLog = [];
const realError = console.error;
console.error = (...args) => { errorLog.push(args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")); };

// ════════════════════════════════════════════════════════════════
// The world. Candidate images are bytes that name their own URL, so the
// simulated gate answers for a specific listing rather than by position.
// ════════════════════════════════════════════════════════════════
const API_KEY = "sk-ant-contract-test-key-0000";
const PHOTO = Buffer.from("CONTRACT-REFERENCE-PHOTO").toString("base64");
Object.assign(process.env, {
  ANTHROPIC_API_KEY: API_KEY, SERPAPI_KEY: "serp-test", SERPER_API_KEY: "serper-test",
  BLOB_READ_WRITE_TOKEN: "blob-test", UPSTASH_REDIS_REST_URL: "https://redis.test",
  UPSTASH_REDIS_REST_TOKEN: "redis-test",
});

const store = new Map();
function redisCommand([rawCmd, key, ...rest]) {
  switch (String(rawCmd).toUpperCase()) {
    case "GET": return store.has(key) ? store.get(key) : null;
    case "SET": store.set(key, String(rest[0])); return "OK";
    case "INCR": { const n = (Number(store.get(key)) || 0) + 1; store.set(key, String(n)); return n; }
    case "INCRBYFLOAT": { const n = (Number(store.get(key)) || 0) + Number(rest[0]); store.set(key, String(n)); return String(n); }
    case "DEL": return store.delete(key) ? 1 : 0;
    case "LPUSH": { const l = JSON.parse(store.get(key) || "[]"); l.unshift(...rest.map(String)); store.set(key, JSON.stringify(l)); return l.length; }
    case "LTRIM": return "OK";
    case "EXPIRE": case "EXPIREAT": return 1;
    default: return null;
  }
}
const encode = (v) => (typeof v === "string" ? Buffer.from(v, "utf8").toString("base64") : v);
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

const LENS = [
  { title: "Acme Trail Cap, Olive", link: "https://shop.test/olive", thumbnail: "https://img.test/olive", source: "Shop", price: { extracted_value: 20 } },
  { title: "Acme Trail Cap, Black", link: "https://shop.test/black", thumbnail: "https://img.test/black", source: "Shop", price: { extracted_value: 14 } },
  { title: "Generic Cap", link: "https://other.test/cap", thumbnail: "https://img.test/generic", source: "Other", price: { extracted_value: 6 } },
];
const VERDICTS = { "https://img.test/olive": "exact", "https://img.test/black": "similar", "https://img.test/generic": "different" };
const READ = {
  productName: "trail cap", brand: "Acme", visiblePrice: 60, currency: "USD", quantity: "",
  category: "fashion", platform: "tiktok", storeName: "", visibleUrl: "", priceConfidence: "visible", imageQuality: "good",
};
const PAGE_HTML = `<html><head><title>Acme Trail Cap</title>
<meta property="og:title" content="Acme Trail Cap, Olive">
<meta property="og:image" content="https://img.test/page-photo">
</head><body><h1>Acme Trail Cap, Olive</h1><p>Our best cap. Now only 60 dollars while it lasts. Breathable olive cotton.</p></body></html>`;

let scenario = {};
let anthropicBodies = [];
// What each request read from or wrote to the simulated prompt cache, in
// order: { model, kind: "extract" | "gate" | "other", read, write }.
let cacheLog = [];
let serpApiSearches = [];

// ════════════════════════════════════════════════════════════════
// A PROMPT CACHE THAT BEHAVES LIKE THE DOCUMENTED ONE. Verified 2026-10-03
// against https://platform.claude.com/docs/en/build-with-claude/prompt-caching:
// a hit needs an identical prefix (tools, system, then message blocks up to
// and including the block marked cache_control), on the same model, with the
// same thinking and effort settings (an effort change invalidates message
// caches), and at least 512 tokens on Opus 5.5 and Sonnet 5.5. Entries are
// per model. The photo here is a stand-in, so its size is taken as 1,500.
// ════════════════════════════════════════════════════════════════
const PHOTO_TOKENS = 1500;
const cacheEntries = new Set();
const canonicalJson = (v) => Array.isArray(v) ? `[${v.map(canonicalJson).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`
  : JSON.stringify(v);
function simulatedCache(body) {
  const content = Array.isArray(body.messages?.[0]?.content) ? body.messages[0].content : [];
  const marks = content.map((b, i) => (b.cache_control ? i : -1)).filter(i => i >= 0);
  if (marks.length === 0) return { read: 0, write: 0 };
  const last = marks[marks.length - 1];
  const key = canonicalJson({
    model: canonical(body.model), thinking: body.thinking ?? null, effort: body.output_config?.effort ?? null,
    tools: body.tools ?? null, system: body.system ?? null, prefix: content.slice(0, last + 1),
  });
  if (cacheEntries.has(key)) return { read: PHOTO_TOKENS, write: 0 };
  cacheEntries.add(key);
  return { read: 0, write: PHOTO_TOKENS };
}

function textOf(body) {
  const content = body.messages?.[0]?.content;
  return typeof content === "string" ? content : JSON.stringify(content);
}

function simulatedReply(body, text) {
  const rules = DOCUMENTED[canonical(body.model)];
  // Thinking that used the whole output budget: a thinking block and
  // nothing else, stopped at max_tokens.
  if (scenario.thinkingEatsBudget?.[canonical(body.model)] && text.startsWith("[")) {
    return json({
      id: "msg_contract", type: "message", role: "assistant", model: body.model,
      content: [{ type: "thinking", thinking: "", signature: "c2lnbmF0dXJl" }],
      stop_reason: "max_tokens", stop_sequence: null,
      usage: { input_tokens: 1800, output_tokens: body.max_tokens },
    });
  }
  // What the real API does: a model that thinks by default thinks unless the
  // request turned it off, and its reply then opens with a thinking block
  // whose text is empty under the default display.
  const thinks = scenario.thinkingFirst ||
    (rules?.thinksByDefault && (!body.thinking || body.thinking.type === "adaptive"));
  const content = [];
  if (thinks) content.push({ type: "thinking", thinking: "", signature: "c2lnbmF0dXJl" });
  content.push({ type: "text", text });
  const cached = simulatedCache(body);
  const prompt = textOf(body);
  cacheLog.push({
    model: canonical(body.model), read: cached.read, write: cached.write,
    kind: prompt.includes("Product intelligence scan") ? "extract" : prompt.includes("candidate product listing image") ? "gate" : "other",
  });
  return json({
    id: "msg_contract", type: "message", role: "assistant", model: body.model,
    content, stop_reason: "end_turn", stop_sequence: null,
    usage: {
      input_tokens: 1800 - cached.read - cached.write, output_tokens: thinks ? 600 : 90,
      cache_read_input_tokens: cached.read, cache_creation_input_tokens: cached.write,
    },
  });
}

const allModelsSeen = new Set();
function anthropic(body) {
  anthropicBodies.push(body);
  allModelsSeen.add(body.model);
  const broken = documentedViolations(body);
  if (broken.length) {
    return json({ type: "error", error: { type: "invalid_request_error", message: broken[0] } }, 400);
  }
  const prompt = textOf(body);
  const model = canonical(body.model);
  if (prompt.includes("Product intelligence scan")) {
    const read = scenario.extract?.[model] ?? READ;
    return simulatedReply(body, JSON.stringify(read));
  }
  if (prompt.includes("candidate product listing image")) {
    const fault = scenario.gateFault?.[model];
    if (fault) return json({ type: "error", error: { type: fault.type || "api_error", message: fault.message } }, fault.status);
    const images = body.messages[0].content.filter(b => b.type === "image");
    const verdicts = images.slice(1).map((img, i) => {
      const url = Buffer.from(img.source.data, "base64").toString("utf8").replace(/^IMG::/, "");
      return { candidate: i + 1, match: VERDICTS[url] || "different", why: "contract" };
    });
    return simulatedReply(body, JSON.stringify(verdicts));
  }
  if (prompt.includes("Extract the product name and price")) {
    return simulatedReply(body, JSON.stringify({ title: "Acme Trail Cap, Olive", price: 60, currency: "USD" }));
  }
  return simulatedReply(body, "acme trail cap olive");
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : String(input?.url || input);
  if (url === "https://api.anthropic.com/v1/messages") return anthropic(JSON.parse(init.body));
  if (url.startsWith("https://redis.test")) {
    const body = JSON.parse(init.body || "[]");
    const result = Array.isArray(body[0]) ? body.map(a => ({ result: encode(redisCommand(a)) })) : { result: encode(redisCommand(body)) };
    return json(result);
  }
  if (url.startsWith("https://img.test/")) {
    return new Response(Buffer.from(`IMG::${url}`), { status: 200, headers: { "content-type": "image/jpeg" } });
  }
  if (url.startsWith("https://shop.test/")) {
    return new Response(PAGE_HTML, { status: 200, headers: { "content-type": "text/html" } });
  }
  if (url.startsWith("https://serpapi.com/account.json")) return json({ total_searches_left: scenario.serpApiLeft ?? 200 });
  if (url.startsWith("https://serpapi.com/search.json")) {
    const engine = new URL(url).searchParams.get("engine");
    serpApiSearches.push(engine);
    if (scenario.serpApiDown) return json({ error: "Your account has run out of searches." }, 429);
    if (engine === "google_lens") return json({ visual_matches: LENS });
    if (engine === "google_product") return json({ sellers_results: { online_sellers: [] } });
    return json({ organic_results: [], shopping_results: [] });
  }
  if (url.startsWith("https://google.serper.dev/") && scenario.serperDown) return json({ message: "Service unavailable" }, 503);
  if (url === "https://google.serper.dev/lens") {
    if (scenario.serperLensEmpty) return json({ organic: [], credits: 3 });
    // Rows in a shape this engine does not know: must fail loudly, not read as "no matches".
    if (scenario.serperLensUnreadable) return json({ organic: LENS.map(m => ({ name: m.title, href: m.link })), credits: 3 });
    return json({ organic: LENS.map(m => ({ title: m.title, link: m.link, thumbnailUrl: m.thumbnail, imageUrl: `${m.thumbnail}/full`, source: m.source, price: `$${m.price.extracted_value}.00` })), credits: 3 });
  }
  if (url.startsWith("https://google.serper.dev/")) return json({ organic: [], shopping: [], credits: 1 });
  if (url.includes("currency-api")) return json({ date: "2026-10-01", usd: { usd: 1, eur: 0.9, gbp: 0.75, mad: 9.5 } });
  throw new Error(`unmocked fetch: ${url}`);
};

// ════════════════════════════════════════════════════════════════
// Run.
// ════════════════════════════════════════════════════════════════
const engine = await loadEngine();
const { resetSpendModeCache } = await import(localModule("model-budget"));

async function scan(next, run) {
  scenario = next;
  anthropicBodies = [];
  cacheLog = [];
  serpApiSearches = [];
  cacheEntries.clear();
  engine.resetSerpApiBalance();
  errorLog.length = 0;
  store.clear();
  if (next.spendToday) store.set(`spend:model:${new Date().toISOString().slice(0, 10)}`, String(next.spendToday));
  resetSpendModeCache();
  const result = await (run ? run() : engine.scanProduct(PHOTO, "image/jpeg", "us", next.intent || "verdict"));
  return { result, bodies: anthropicBodies.slice(), errors: errorLog.slice(), cache: cacheLog.slice(), serpApi: serpApiSearches.slice() };
}

const summary = (r) => `${r.mode} / ${r.matchConfidence} / $${r.sourceProduct?.price} "${r.sourceProduct?.title}"` +
  (r.failure ? ` / failure: ${JSON.stringify(r.failure)}` : "");
const models = (bodies) => [...new Set(bodies.map(b => b.model))].join(", ") || "none";

function auditBodies(label, bodies, options = {}) {
  const problems = [];
  for (const body of bodies) {
    for (const v of [...documentedViolations(body), ...policyViolations(body, options)]) problems.push(`${body.model}: ${v}`);
  }
  check(`${label}: every request body follows the rules (${bodies.length} calls: ${models(bodies)})`,
    problems.length === 0, [...new Set(problems)].join("\n        "));
}

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const isGateBody = (b) => textOf(b).includes("candidate product listing image");
const isExtractBody = (b) => textOf(b).includes("Product intelligence scan");

// 1. A clean image scan: extraction on Sonnet 5.5, the gate on Opus 5.5.
section("IMAGE SCAN, FULL MODE");
{
  const { result, bodies } = await scan({});
  auditBodies("image scan", bodies);
  check("the first read ran on Sonnet 5.5", bodies.some(b => canonical(b.model) === SONNET && isExtractBody(b)), models(bodies));
  check("the gate ran on Sonnet 5.5, the model the evaluation chose for it", bodies.some(b => canonical(b.model) === SONNET && isGateBody(b)) &&
    !bodies.some(b => canonical(b.model) === OPUS && isGateBody(b)), models(bodies));
  check("the photo is identified: exact match, the olive cap at $20, a verdict", result.matchConfidence === "exact" && result.sourceProduct.price === 20 && result.mode === "VERDICT", summary(result));
}

// 2. A weak first read escalates extraction to Opus 5.5.
section("EXTRACTION ESCALATION");
{
  const { result, bodies } = await scan({ extract: { [SONNET]: { ...READ, productName: "", brand: "" } } });
  auditBodies("escalated scan", bodies);
  check("the escalation call went to Opus 5.5", bodies.some(b => canonical(b.model) === OPUS && isExtractBody(b)));
  check("and its read was used: a verdict on the olive cap", result.mode === "VERDICT" && result.sourceProduct.price === 20, summary(result));
}

// 3. Budget spent: the degraded gate on Sonnet 5.5, capped at "likely".
section("DEGRADED MODE (DAILY BUDGET SPENT)");
{
  const { result, bodies } = await scan({ spendToday: 1_000_000 });
  auditBodies("degraded scan", bodies);
  check("no Opus 5.5 call once the budget is spent", !bodies.some(b => canonical(b.model) === OPUS), models(bodies));
  check("the gate ran on Sonnet 5.5", bodies.some(b => canonical(b.model) === SONNET && isGateBody(b)), models(bodies));
  check("the scan still answers: a match, at most likely, never a failure",
    !result.failure && result.found && result.matchConfidence === "likely", summary(result));
}

section("DEGRADED MODE, SONNET 5.5 DOWN");
{
  const down = { status: 529, type: "overloaded_error", message: "simulated: overloaded" };
  const { result, bodies } = await scan({ spendToday: 1_000_000, gateFault: { [SONNET]: down } });
  check("a budget-spent day with Sonnet 5.5 down still answers: Opus 5.5 backs it up",
    !result.failure && result.found && bodies.some(b => canonical(b.model) === OPUS && isGateBody(b)), summary(result));
  check("and the degraded cap still holds: likely, never exact", result.matchConfidence === "likely", summary(result));
}

// 4. A pasted link: page text and query on Sonnet 5.5, the gate on Opus 5.5.
section("URL SCAN");
{
  const { result, bodies } = await scan({}, () => engine.scanProductUrl("https://shop.test/acme-trail-cap", "us", "verdict"));
  auditBodies("url scan", bodies);
  check("page text read on Sonnet 5.5", bodies.some(b => canonical(b.model) === SONNET && textOf(b).includes("Extract the product name and price")), models(bodies));
  check("the url scan identified the cap", result.matchConfidence === "exact", summary(result));
}

// 5. Every reply opens with a thinking block, as the 5.5 models' do.
section("REPLIES THAT OPEN WITH A THINKING BLOCK");
{
  const { result } = await scan({ thinkingFirst: true });
  check("a reply whose first block is thinking is still read: same verdict as a clean scan",
    result.matchConfidence === "exact" && result.mode === "VERDICT" && result.sourceProduct.price === 20, summary(result));
}

// 6. Thinking eats the whole output budget on the gate model.
section("THINKING THAT EATS THE OUTPUT BUDGET");
{
  const { result, bodies, errors } = await scan({ thinkingEatsBudget: { [SONNET]: true } });
  const sonnetGateCalls = bodies.filter(b => canonical(b.model) === SONNET && isGateBody(b)).length;
  check("a gate reply that is all thinking (stop_reason max_tokens, no text) is not read as no match",
    result.matchConfidence === "exact" && !result.failure, summary(result));
  check("it is handed to Opus 5.5, not repeated on Sonnet 5.5 where it would stop in the same place",
    bodies.some(b => canonical(b.model) === OPUS && isGateBody(b)) && sonnetGateCalls === 1, `${sonnetGateCalls} Sonnet gate call(s); ${models(bodies)}`);
  check("and logged as truncated", errors.some(e => e.includes("kind=truncated")), errors.join(" | "));
}

// 7. The gate model refuses the request shape: fall back, loudly.
section("GATE FALLBACK");
{
  const fault = { status: 400, type: "invalid_request_error", message: "simulated: model rejected the request" };
  const { result, bodies, errors } = await scan({ gateFault: { [SONNET]: fault } });
  auditBodies("fallback scan", bodies);
  check("a 400 from Sonnet 5.5 falls back to Opus 5.5", bodies.some(b => canonical(b.model) === OPUS && isGateBody(b)), models(bodies));
  check("which is a full-strength gate: the cap is still an exact match and a verdict", result.matchConfidence === "exact" && result.mode === "VERDICT", summary(result));
  const logged = errors.find(e => e.includes(SONNET) && e.includes("400"));
  check("the failure is logged with layer, model, status and the error body", !!logged && /gate/.test(logged) && logged.includes("simulated"), errors.join(" | ") || "nothing logged");
  check("the log never carries the API key or the photo",
    !errors.some(e => e.includes(API_KEY) || e.includes(PHOTO)), "a secret or the image reached the log");
}

section("EVERY GATE MODEL FAILS");
{
  const down = { status: 500, type: "api_error", message: "simulated outage" };
  const { result, errors } = await scan({ gateFault: { [OPUS]: down, [SONNET]: down } });
  check("verification is never skipped silently: the scan reports it could not be completed",
    !!result.failure && result.mode !== "VERDICT", summary(result));
  check("and the reason names the gate", JSON.stringify(result.failure || {}).includes("gate"), summary(result));
  check("both models were tried and logged", [OPUS, SONNET].every(m => errors.some(e => e.includes(`model=${m}`))), errors.join(" | "));
}

section("ANTHROPIC SPEND CAP REACHED");
{
  const capped = { status: 429, type: "rate_limit_error", message: "You have reached your API usage limits (enforced_spend_limit_reached)" };
  const { result, errors } = await scan({ gateFault: { [OPUS]: capped, [SONNET]: capped } });
  check("the account's monthly spend cap is named as such in the log, not as a rate limit",
    errors.some(e => e.includes("kind=spend_cap")), errors.join(" | "));
  check("and the scan says it could not be completed, never a silent no-match", !!result.failure, summary(result));
}

section("ANTHROPIC CREDIT BALANCE EXHAUSTED");
{
  const broke = { status: 400, type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." };
  const { result, errors } = await scan({ gateFault: { [OPUS]: broke, [SONNET]: broke } });
  check("a prepaid account with no credit left is named as such in the log",
    errors.some(e => e.includes("kind=credit_exhausted")), errors.join(" | "));
  check("the failure record says so too, for /api/stats", (result.failure?.layers || []).some(l => l.endsWith(":credit_exhausted")), summary(result));
  check("and the gate does not walk the chain: the account refuses every model alike",
    !errors.some(e => e.includes(`model=${OPUS}`) && e.includes("layer=gate")), errors.join(" | "));
}

// 8. A second photo of a product identified in the last hour.
section("CACHED IDENTITY, RE-CONFIRMED ON SONNET 5.5");
{
  await scan({}, async () => {
    await engine.scanProduct(PHOTO, "image/jpeg", "us", "verdict");
    anthropicBodies.length = 0;
    return engine.scanProduct(Buffer.from("A-SECOND-PHOTO-OF-THE-CAP").toString("base64"), "image/jpeg", "us", "verdict");
  }).then(({ result, bodies }) => {
    const gateBodies = bodies.filter(isGateBody);
    check("the reuse is confirmed by one Sonnet 5.5 call, and the full gate does not run",
      gateBodies.length === 1 && canonical(gateBodies[0].model) === SONNET &&
      gateBodies[0].messages[0].content.filter(b => b.type === "image").length === 2, models(bodies));
    check("and keeps full confidence", result.matchConfidence === "exact", summary(result));
    auditBodies("cached-identity scan", bodies);
  });
}

// 9. GATE_EFFORT raises the gate, and only the gate.
section("GATE EFFORT OVERRIDE");
{
  process.env.GATE_EFFORT = "medium";
  const { bodies } = await scan({});
  delete process.env.GATE_EFFORT;
  auditBodies("GATE_EFFORT=medium", bodies, { gateEffort: "medium" });
  process.env.GATE_EFFORT = "ludicrous";
  const { bodies: invalid } = await scan({});
  delete process.env.GATE_EFFORT;
  auditBodies("an invalid GATE_EFFORT falls back to low", invalid);
}

section("NO OTHER MODEL, ANYWHERE");
check("every request in every scenario above went to Opus 5.5 or Sonnet 5.5",
  allModelsSeen.size > 0 && [...allModelsSeen].every(m => [OPUS, SONNET].includes(canonical(m))), [...allModelsSeen].join(", "));

section("NOTHING FOUND IS NOT AN ERROR");
{
  const { result } = await scan({}, async () => {
    const saved = LENS.splice(0, LENS.length);
    try { return await engine.scanProduct(PHOTO, "image/jpeg", "us", "verdict"); } finally { LENS.push(...saved); }
  });
  check("a scan where Lens finds nothing and nothing errored is a genuine no-match, not a failure",
    !result.failure, summary(result));
}

section("BUDGET MODE: SERPER FIRST, SERPAPI ONLY AS A BACKUP ABOVE ITS RESERVE");
{
  const { result, serpApi } = await scan({});
  check("a clean scan identifies the cap through Serper's Lens", result.matchConfidence === "exact" && /lens_serper/.test(result.engineUsed), `${summary(result)} via ${result.engineUsed}`);
  check("and spends no SerpApi search at all (no Lens, no Shopping, no retailer sweep)", serpApi.length === 0, serpApi.join(", "));
}
{
  const { result, errors, serpApi } = await scan({ serperDown: true });
  check("Serper down, SerpApi above its reserve: the backup serves Lens and the cap is still identified",
    result.matchConfidence === "exact" && !result.failure && serpApi.includes("google_lens"), `${summary(result)}; SerpApi: ${serpApi.join(", ")}`);
  check("and the Serper failure is logged", errors.some(e => e.includes("provider=serper") && e.includes("status=503")), errors.join(" | "));
}
{
  const { result, errors, serpApi } = await scan({ serperDown: true, serpApiLeft: 20 });
  check("Serper down and SerpApi at its reserve (20 left): SerpApi is not searched", serpApi.length === 0, serpApi.join(", "));
  check("the hold is logged, and the scan says it could not be completed rather than 'no match'",
    errors.some(e => /serpapi held at its reserve/.test(e)) && result.failure?.reason === "lens", `${summary(result)} | ${errors.join(" | ")}`);
}
{
  const { result, serpApi } = await scan({ serperLensEmpty: true });
  check("Serper answers 'no visual matches': that is an answer, SerpApi's Lens is not asked", !serpApi.includes("google_lens"), serpApi.join(", "));
  check("and it is an honest no-match, not a failure", !result.failure && result.mode === "UNRESOLVED", summary(result));
}
{
  const { result, errors, serpApi } = await scan({ serperLensUnreadable: true });
  check("Serper answers rows this engine cannot read: logged with the field names it sent",
    errors.some(e => e.includes("provider=serper") && /unreadable Lens answer/.test(e) && /name,href/.test(e)), errors.join(" | "));
  check("and treated as a failure, so the SerpApi backup answers and the cap is identified",
    serpApi.includes("google_lens") && result.matchConfidence === "exact", `${summary(result)}; SerpApi: ${serpApi.join(", ")}`);
}
{
  const { result } = await scan({ serperDown: true, serpApiDown: true });
  check("both providers down: the scan could not be completed (never a silent no-match)", result.failure?.reason === "lens", summary(result));
}

// Prompt caching. Every call that looks at the photo opens with the same
// two blocks (THE PHOTO, ONCE PER SCAN in scan.ts), so the first read
// writes the photo to Sonnet 5.5's cache and every Sonnet gate call reads it.
section("PROMPT CACHING: THE PHOTO IS PAID FOR ONCE PER SCAN");
{
  const { bodies, cache } = await scan({});
  const photoBlocks = (b) => (Array.isArray(b.messages?.[0]?.content) ? b.messages[0].content.slice(0, 2) : []);
  const extractBody = bodies.find(isExtractBody);
  const gateBodies = bodies.filter(isGateBody);
  const prefix = extractBody ? canonicalJson(photoBlocks(extractBody)) : "";
  check("the first read and every gate call open with the same two blocks: the label, then the photo",
    !!extractBody && gateBodies.length > 0 && gateBodies.every(b => canonicalJson(photoBlocks(b)) === prefix) &&
    photoBlocks(extractBody)[0]?.type === "text" && photoBlocks(extractBody)[1]?.type === "image", `${gateBodies.length} gate call(s)`);
  check("the photo block is the cache breakpoint (ephemeral, the 5-minute TTL)",
    [extractBody, ...gateBodies].every(b => b && b.messages[0].content[1]?.cache_control?.type === "ephemeral" && !b.messages[0].content[1]?.cache_control?.ttl));
  check("no request carries a system prompt or tools that would sit ahead of the photo in the prefix",
    bodies.every(b => !("system" in b) && !("tools" in b)));
  check("at most four cache breakpoints per request (the API's limit)",
    bodies.every(b => (Array.isArray(b.messages?.[0]?.content) ? b.messages[0].content : []).filter(x => x.cache_control).length <= 4));
  const sonnetEfforts = new Set(bodies.filter(b => canonical(b.model) === SONNET).map(b => b.output_config?.effort));
  check("every Sonnet 5.5 call in the scan runs at the same effort (a different effort invalidates the cache)",
    sonnetEfforts.size === 1, [...sonnetEfforts].join(", "));
  const firstRead = cache.find(c => c.kind === "extract");
  const gateCalls = cache.filter(c => c.kind === "gate" && c.model === SONNET);
  check("the first read writes the photo to the cache", (firstRead?.write || 0) > 0, JSON.stringify(cache));
  check("and every Sonnet 5.5 gate call in the scan reads it back instead of paying for it again",
    gateCalls.length > 0 && gateCalls.every(c => c.read > 0 && c.write === 0), JSON.stringify(cache));
}
{
  const { cache } = await scan({}, async () => {
    await engine.scanProduct(PHOTO, "image/jpeg", "us", "verdict");
    cacheLog.length = 0;
    return engine.scanProduct(Buffer.from("A-SECOND-PHOTO-OF-THE-CAP").toString("base64"), "image/jpeg", "us", "verdict");
  });
  const confirm = cache.filter(c => c.kind === "gate");
  check("a cached identity's re-confirmation reads the second photo from the cache its first read wrote",
    confirm.length === 1 && confirm[0].read > 0, JSON.stringify(cache));
}
{
  process.env.GATE_EFFORT = "medium";
  const { cache } = await scan({});
  delete process.env.GATE_EFFORT;
  check("the simulated cache is not a rubber stamp: GATE_EFFORT=medium costs the first gate wave its read (documented)",
    cache.filter(c => c.kind === "gate").some(c => c.read === 0), JSON.stringify(cache));
}

// 7. The reply reader and the request builder, directly.
section("REPLY READER AND REQUEST BUILDER");
let rules = null;
try { rules = await import(localModule("model-rules")); } catch (e) { check("src/lib/model-rules.ts exists", false, String(e.message).split("\n")[0]); }
if (rules) {
  const thinkingFirst = rules.readClaudeReply({
    stop_reason: "end_turn",
    content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: "{\"ok\":true}" }],
  });
  check("thinking-first fixture: the text block is read", thinkingFirst.text === "{\"ok\":true}", JSON.stringify(thinkingFirst));
  const refusal = rules.readClaudeReply({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] });
  check("a refusal is reported as one, with its category", refusal.text === null && refusal.refusal === "cyber", JSON.stringify(refusal));
  const cut = rules.readClaudeReply({ stop_reason: "max_tokens", content: [{ type: "text", text: "[{\"candidate\":1" }] });
  check("a max_tokens stop is flagged as truncated, text kept for salvage", cut.truncated === true && cut.text.startsWith("[{"), JSON.stringify(cut));
  const none = rules.readClaudeReply({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }] });
  check("a reply with no text block reads as no text", none.text === null, JSON.stringify(none));

  for (const model of [OPUS, SONNET]) {
    const body = rules.buildClaudeRequest(model, { max_tokens: 350, messages: [{ role: "user", content: "Product intelligence scan" }] });
    const problems = [...documentedViolations(body), ...policyViolations(body)];
    check(`request built for ${model} follows the documented and the owner's rules`, problems.length === 0, problems.join("; "));
    check(`${model}: no thinking field (adaptive, always on), no sampling, effort low`,
      !("thinking" in body) && !["temperature", "top_p", "top_k"].some(k => k in body) && body.output_config?.effort === "low", JSON.stringify({ ...body, messages: undefined }));
  }
  // Every model the rules table can build a request for, including the ones
  // only the evaluation route (/api/eval) calls, at every effort level.
  const tableProblems = [];
  for (const model of Object.keys(rules.MODEL_RULES)) {
    if (!DOCUMENTED[model]) { tableProblems.push(`${model}: not covered by the documented rules`); continue; }
    for (const effort of EFFORT_ORDER) {
      const body = rules.buildClaudeRequest(model, { max_tokens: 610, messages: [{ role: "user", content: "x" }] }, { effort });
      for (const p of documentedViolations(body)) tableProblems.push(`${model}@${effort}: ${p}`);
      if (body.output_config?.effort !== effort) tableProblems.push(`${model}@${effort}: sent ${body.output_config?.effort}`);
      if ("thinking" in body || ["temperature", "top_p", "top_k"].some(k => k in body)) tableProblems.push(`${model}@${effort}: sampling or thinking field sent`);
    }
  }
  check("every model in the rules table, at every effort level, gets a request the documented rules accept",
    tableProblems.length === 0, tableProblems.join("; "));

  // The batched gate's output limit, for every batch size the engine sends
  // (one to eight candidates): thinking room of at least 15,000 tokens above
  // the JSON answer's own budget, and never more than 16,000 in total.
  const short = [];
  for (let n = 1; n <= 8; n++) {
    const answer = 250 + n * 90;
    const body = rules.buildClaudeRequest(OPUS, { max_tokens: answer, messages: [{ role: "user", content: "x" }] });
    if (body.max_tokens - answer < THINKING_ROOM || body.max_tokens > MAX_TOKENS_CEILING) short.push(`${n}: ${body.max_tokens}`);
  }
  check("the batched gate's thinking can never eat its answer: >= 15,000 tokens of room for 1 to 8 candidates, <= 16,000 total",
    short.length === 0, short.join(", "));
  const unknown = rules.buildClaudeRequest("claude-some-future-model", { max_tokens: 300, messages: [{ role: "user", content: "hi" }] });
  check("a model outside the table gets no sampling, thinking or effort fields",
    !["temperature", "top_p", "top_k", "thinking", "output_config"].some(k => k in unknown), JSON.stringify(unknown));
}

console.error = realError;
console.log(`\n${failures === 0 ? "All model contract checks passed." : `${failures} model contract check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
