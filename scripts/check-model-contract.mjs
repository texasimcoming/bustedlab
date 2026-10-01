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
 * why none of them could see it. This one stubs it with a server that applies
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
 * The owner's rules on top of the documented ones. The cost model assumes no
 * thinking tokens, so the two models that can turn thinking off must; Opus 5.5
 * cannot, so it runs at low effort with room for the thinking it will do;
 * Haiku keeps temperature 0; a model nobody has written rules for gets none of
 * the optional fields, because a guess is how the original 400 happened.
 */
function policyViolations(body) {
  const out = [];
  const model = canonical(body.model);
  const known = !!DOCUMENTED[model];
  const sampling = ["temperature", "top_p", "top_k"].filter(p => p in body);
  if (model !== "claude-haiku-4-5" && sampling.length) out.push(`policy: no sampling parameters on ${body.model} (sent ${sampling.join(", ")})`);
  if (model === "claude-haiku-4-5" && body.temperature !== 0) out.push("policy: Haiku 4.5 keeps temperature 0");
  if ((model === "claude-opus-5" || model === "claude-sonnet-5") && body.thinking?.type !== "disabled") {
    out.push(`policy: ${body.model} must send thinking {type:"disabled"} (the cost model assumes no thinking tokens)`);
  }
  if (model === "claude-opus-5-5") {
    if (body.output_config?.effort !== "low") out.push("policy: Opus 5.5 runs at effort low");
    if (!(body.max_tokens >= 4000)) out.push("policy: Opus 5.5 needs max_tokens raised for its thinking");
  }
  if (!known && (sampling.length || body.thinking || body.output_config?.effort)) {
    out.push(`policy: unknown model ${body.model} must carry no sampling, thinking or effort fields`);
  }
  if (!(Number.isInteger(body.max_tokens) && body.max_tokens > 0)) out.push("max_tokens missing");
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

function textOf(body) {
  const content = body.messages?.[0]?.content;
  return typeof content === "string" ? content : JSON.stringify(content);
}

function simulatedReply(body, text) {
  const rules = DOCUMENTED[canonical(body.model)];
  // What the real API does: a model that thinks by default thinks unless the
  // request turned it off, and its reply then opens with a thinking block
  // whose text is empty under the default display.
  const thinks = scenario.thinkingFirst ||
    (rules?.thinksByDefault && (!body.thinking || body.thinking.type === "adaptive"));
  const content = [];
  if (thinks) content.push({ type: "thinking", thinking: "", signature: "c2lnbmF0dXJl" });
  content.push({ type: "text", text });
  return json({
    id: "msg_contract", type: "message", role: "assistant", model: body.model,
    content, stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 1800, output_tokens: thinks ? 600 : 90 },
  });
}

function anthropic(body) {
  anthropicBodies.push(body);
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
  if (url.startsWith("https://serpapi.com/search.json")) {
    const engine = new URL(url).searchParams.get("engine");
    if (scenario.serpApiDown) return json({ error: "Your account has run out of searches." }, 429);
    if (engine === "google_lens") return json({ visual_matches: LENS });
    if (engine === "google_product") return json({ sellers_results: { online_sellers: [] } });
    return json({ organic_results: [], shopping_results: [] });
  }
  if (url === "https://google.serper.dev/lens" && scenario.serperLens) {
    return json({ organic: LENS.map(m => ({ title: m.title, link: m.link, imageUrl: m.thumbnail, source: m.source, price: `$${m.price.extracted_value}.00` })) });
  }
  if (url.startsWith("https://google.serper.dev/")) return json({ organic: [], shopping: [] });
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
  errorLog.length = 0;
  store.clear();
  if (next.spendToday) store.set(`spend:model:${new Date().toISOString().slice(0, 10)}`, String(next.spendToday));
  resetSpendModeCache();
  const result = await (run ? run() : engine.scanProduct(PHOTO, "image/jpeg", "us", next.intent || "verdict"));
  return { result, bodies: anthropicBodies.slice(), errors: errorLog.slice() };
}

const summary = (r) => `${r.mode} / ${r.matchConfidence} / $${r.sourceProduct?.price} "${r.sourceProduct?.title}"` +
  (r.failure ? ` / failure: ${JSON.stringify(r.failure)}` : "");
const models = (bodies) => [...new Set(bodies.map(b => b.model))].join(", ") || "none";

function auditBodies(label, bodies) {
  const problems = [];
  for (const body of bodies) {
    for (const v of [...documentedViolations(body), ...policyViolations(body)]) problems.push(`${body.model}: ${v}`);
  }
  check(`${label}: every request body follows the rules (${bodies.length} calls: ${models(bodies)})`,
    problems.length === 0, [...new Set(problems)].join("\n        "));
}

// 1. A clean image scan: extraction on Haiku, the gate on Opus 5.
section("IMAGE SCAN, FULL MODE");
{
  const { result, bodies } = await scan({});
  auditBodies("image scan", bodies);
  check("the gate ran on Opus 5", bodies.some(b => canonical(b.model) === "claude-opus-5" && textOf(b).includes("candidate product listing image")));
  check("the photo is identified: exact match, the olive cap at $20, a verdict", result.matchConfidence === "exact" && result.sourceProduct.price === 20 && result.mode === "VERDICT", summary(result));
}

// 2. A weak cheap read escalates extraction to Opus 5.
section("EXTRACTION ESCALATION");
{
  const { result, bodies } = await scan({ extract: { "claude-haiku-4-5": { ...READ, productName: "", brand: "" } } });
  auditBodies("escalated scan", bodies);
  check("the escalation call went to Opus 5", bodies.some(b => canonical(b.model) === "claude-opus-5" && textOf(b).includes("Product intelligence scan")));
  check("and its read was used: a verdict on the olive cap", result.mode === "VERDICT" && result.sourceProduct.price === 20, summary(result));
}

// 3. Budget spent: the degraded gate on Haiku, capped at "likely".
section("DEGRADED MODE");
{
  const { result, bodies } = await scan({ spendToday: 1_000_000 });
  auditBodies("degraded scan", bodies);
  check("no Opus call once the budget is spent", !bodies.some(b => canonical(b.model).startsWith("claude-opus")), models(bodies));
  check("the cheap gate's best label is likely, never exact", result.matchConfidence !== "exact", summary(result));
}

// 4. A pasted link: text extraction and query writing on Haiku, the gate on Opus 5.
section("URL SCAN");
{
  const { result, bodies } = await scan({}, () => engine.scanProductUrl("https://shop.test/acme-trail-cap", "us", "verdict"));
  auditBodies("url scan", bodies);
  check("the url scan identified the cap", result.matchConfidence === "exact", summary(result));
}

// 5. The thinking-first reply, on every call.
section("REPLIES THAT OPEN WITH A THINKING BLOCK");
{
  const { result } = await scan({ thinkingFirst: true });
  check("a reply whose first block is thinking is still read: same verdict as a clean scan",
    result.matchConfidence === "exact" && result.mode === "VERDICT" && result.sourceProduct.price === 20, summary(result));
}

// 6. The gate model refuses the request shape: fall back, loudly.
section("GATE FALLBACK");
{
  const fault = { status: 400, type: "invalid_request_error", message: "simulated: model rejected the request" };
  const { result, bodies, errors } = await scan({ gateFault: { "claude-opus-5": fault } });
  auditBodies("fallback scan", bodies);
  check("a 400 from the gate model falls back to Sonnet 5", bodies.some(b => canonical(b.model) === "claude-sonnet-5"), models(bodies));
  check("and the scan still identifies the cap", result.matchConfidence === "exact" && result.mode === "VERDICT", summary(result));
  const logged = errors.find(e => e.includes("claude-opus-5") && e.includes("400"));
  check("the failure is logged with layer, model, status and the error body", !!logged && /gate/.test(logged) && logged.includes("simulated"), errors.join(" | ") || "nothing logged");
  check("the log never carries the API key or the photo",
    !errors.some(e => e.includes(API_KEY) || e.includes(PHOTO)), "a secret or the image reached the log");
}

section("EVERY GATE MODEL FAILS");
{
  const down = { status: 500, type: "api_error", message: "simulated outage" };
  const { result, errors } = await scan({ gateFault: { "claude-opus-5": down, "claude-sonnet-5": down, "claude-haiku-4-5": down } });
  check("verification is never skipped silently: the scan reports it could not be completed",
    !!result.failure && result.mode !== "VERDICT", summary(result));
  check("and the reason names the gate", JSON.stringify(result.failure || {}).includes("gate"), summary(result));
  check("each failed model was logged", ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"].every(m => errors.some(e => e.includes(m))), errors.join(" | "));
}

section("NOTHING FOUND IS NOT AN ERROR");
{
  const { result } = await scan({}, async () => {
    const saved = LENS.splice(0, LENS.length);
    try { return await engine.scanProduct(PHOTO, "image/jpeg", "us", "verdict"); } finally { LENS.push(...saved); }
  });
  check("a scan where Lens finds nothing and nothing errored is a genuine no-match, not a failure",
    !result.failure, summary(result));
}

section("A BACKUP PROVIDER ANSWERS");
{
  const { result, errors } = await scan({ serpApiDown: true, serperLens: true });
  check("SerpApi out of searches, Serper serves Lens: the cap is still identified", result.matchConfidence === "exact" && !result.failure, summary(result));
  check("and the SerpApi failure is still logged", errors.some(e => e.includes("provider=serpapi") && e.includes("status=429")), errors.join(" | "));
}
{
  const { result } = await scan({ serpApiDown: true });
  check("SerpApi down and Serper finds nothing: an honest no-match, not a failure", !result.failure && result.mode === "UNRESOLVED", summary(result));
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

  const sample = { max_tokens: 300, messages: [{ role: "user", content: "hi" }] };
  for (const model of ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001", "claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-opus-4-7", "claude-some-future-model"]) {
    const body = rules.buildClaudeRequest(model, sample);
    const problems = [...documentedViolations(body), ...policyViolations(body)];
    check(`request built for ${model} follows the rules`, problems.length === 0, problems.join("; "));
  }
}

console.error = realError;
console.log(`\n${failures === 0 ? "All model contract checks passed." : `${failures} model contract check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
