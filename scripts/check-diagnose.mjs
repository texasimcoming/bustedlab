/**
 * /api/diagnose: operator-only, reports every layer, and never echoes a
 * secret. The real value of the route is that it calls the real providers,
 * which no check can do; this pins down everything around those calls.
 *
 *   node --experimental-strip-types --no-warnings scripts/check-diagnose.mjs
 */
import { importSrc, env, reset, call, check, section, finish } from "./lib/harness.mjs";

const TOKEN = "diagnose-operator-token-0123456789";
const KEYS = { ANTHROPIC_API_KEY: "sk-ant-diagnose-check", SERPAPI_KEY: "serpapi-secret-key-123", SERPER_API_KEY: "serper-secret-key-456" };
const route = await importSrc("app/api/diagnose/route.ts");
const engine = await importSrc("lib/scan.ts");
const sharp = (await import("sharp")).default;

const sent = [];
const modelLookups = [];
let fableMissing = false;
// The documented cache: a repeat of the same model, effort and blocks up to
// the cache breakpoint reads what the first one wrote. `cacheWorks` turns it
// off to prove the "prompt cache" layer fails when nothing is read back.
let cacheWorks = true;
const cacheEntries = new Set();
const canonicalJson = (v) => Array.isArray(v) ? `[${v.map(canonicalJson).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`
  : JSON.stringify(v);
function cacheUsage(body) {
  const content = body.messages[0].content;
  const last = content.map((b, i) => (b.cache_control ? i : -1)).filter(i => i >= 0).pop();
  if (last === undefined) return { cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const key = canonicalJson({ model: body.model, effort: body.output_config?.effort, prefix: content.slice(0, last + 1) });
  if (cacheWorks && cacheEntries.has(key)) return { cache_read_input_tokens: 670, cache_creation_input_tokens: 0 };
  cacheEntries.add(key);
  return { cache_read_input_tokens: 0, cache_creation_input_tokens: 670 };
}
let serperLensBody = { organic: [] };
const harnessFetch = globalThis.fetch;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : String(input?.url || input);
  if (url === "https://api.anthropic.com/v1/messages") {
    const body = JSON.parse(init.body);
    sent.push(body);
    const prompt = JSON.stringify(body.messages[0].content);
    const text = prompt.includes("candidate product listing image")
      ? JSON.stringify([{ candidate: 1, match: "exact", tie: "photo", why: "same photo" }])
      : JSON.stringify({ productName: "whitening strips", brand: "", visiblePrice: null, currency: "", imageQuality: "good" });
    // As the 5.5 models answer: a thinking block first, then the text, with
    // output_tokens covering both.
    return json({
      stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 700 + Math.ceil(text.length / 4), ...cacheUsage(body) },
      content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text }],
    });
  }
  if (url.startsWith("https://serpapi.com/account.json")) {
    return json({ account_id: "a1", api_key: KEYS.SERPAPI_KEY, account_email: "owner@example.com", plan_name: "Developer",
      searches_per_month: 5000, plan_searches_left: 4100, total_searches_left: 4100, this_month_usage: 900, account_rate_limit_per_hour: 1000 });
  }
  if (url === "https://google.serper.dev/shopping") return json({ shopping: [{ title: "Lamp" }], credits: 1 });
  if (url === "https://google.serper.dev/account") return json({ balance: 2391, rateLimit: 50, email: "owner@example.com" });
  if (url === "https://google.serper.dev/lens") return json({ ...serperLensBody, credits: 3 });
  if (url.includes("currency-api")) return json({ date: "2026-10-01", usd: { eur: 0.9, gbp: 0.75, mad: 9.5, cad: 1.37 } });
  if (url.startsWith("https://api.anthropic.com/v1/models/")) {
    modelLookups.push(url);
    const id = decodeURIComponent(url.split("/").pop());
    return id === "claude-fable-5-1" && fableMissing
      ? json({ type: "error", error: { type: "not_found_error", message: "model not found" } }, 404)
      : json({ id, type: "model", display_name: id, max_tokens: 128000 });
  }
  return harnessFetch(input, init);
};

section("OPERATOR ONLY");
env({ ANALYTICS_TOKEN: TOKEN, ...KEYS }); reset();
check("no token: 401", (await call(route.GET, "/api/diagnose")).status === 401);
check("wrong token: 401", (await call(route.GET, "/api/diagnose", { headers: { authorization: "Bearer nope" } })).status === 401);

section("A RUN");
const res = await call(route.GET, "/api/diagnose", { headers: { authorization: `Bearer ${TOKEN}` } });
const layers = res.json?.layers || [];
const layer = (prefix) => layers.find(l => l.layer.startsWith(prefix));
check("answers 200 with a layer list", res.status === 200 && layers.length >= 7, `${res.status} ${layers.map(l => l.layer).join(" | ")}`);
check("every layer says pass or fail, latency, status and detail",
  layers.every(l => typeof l.pass === "boolean" && typeof l.latencyMs === "number" && typeof l.status === "number" && typeof l.detail === "string"));
for (const model of ["claude-opus-5-5", "claude-sonnet-5-5"]) {
  const probe = layer(`claude ${model}`);
  check(`${model} probed and passing`, probe?.pass === true, JSON.stringify(probe));
}
check("every Claude call went to Opus 5.5 or Sonnet 5.5, nothing else", sent.length === 3 && sent.every(b => ["claude-opus-5-5", "claude-sonnet-5-5"].includes(b.model)),
  sent.map(b => b.model).join(", "));
const opus = sent.find(b => b.model === "claude-opus-5-5");
check("the Opus 5.5 call has the engine's shape: no sampling, no thinking field, effort low, room for thinking",
  opus && !("temperature" in opus) && !("thinking" in opus) && opus.output_config?.effort === "low" && opus.max_tokens >= 15_000 && opus.max_tokens <= 16_000,
  JSON.stringify(opus && { ...opus, messages: undefined }));
check("and that shape is shown in the answer", layer("claude claude-opus-5-5")?.request?.output_config?.effort === "low");
check("thinking tokens are estimated per call and averaged for the cost model",
  layer("claude claude-opus-5-5")?.thinkingTokensApprox === 700 && res.json?.thinking?.perCallApprox === 700, JSON.stringify(res.json?.thinking));
check("the gate probe compares the sample with itself (two images)",
  (opus?.messages?.[0]?.content || []).filter(b => b.type === "image").length === 2);
check("Claude cost is measured and reported", res.json?.cost?.claudeUsd > 0, JSON.stringify(res.json?.cost));
const account = layer("serpapi account");
check("SerpApi, the backup, reported with its reserve and not searched",
  account?.pass === true && account?.totalSearchesLeft === 4100 && account?.backupAvailable === true && typeof account?.reserve === "number", JSON.stringify(account));
check("Serper Shopping probed with the engine's request, its credits reported",
  layer("serper shopping")?.pass === true && layer("serper shopping")?.creditsUsed === 1, JSON.stringify(layer("serper shopping")));
check("Serper's remaining credits reported, numbers only", res.json?.serperCredits?.creditsLeft === 2391, JSON.stringify(res.json?.serperCredits));
check("the budget-mode limits in force are reported",
  res.json?.limits?.dailyModelBudgetUsd === 2 && res.json?.limits?.globalDailyFreeScanCap === 50 && res.json?.limits?.retailerSweep === false,
  JSON.stringify(res.json?.limits));
check("exchange rates probed", layer("exchange rates")?.pass === true, JSON.stringify(layer("exchange rates")));
check("the 1568px photo cap is proven where it runs", layer("photo cap")?.pass === true && /725x1568/.test(layer("photo cap")?.detail || ""), JSON.stringify(layer("photo cap")));
check("Blob without a token fails loudly, with the reason", layer("blob")?.pass === false && /BLOB_READ_WRITE_TOKEN/.test(layer("blob")?.detail || ""));
check("overall pass is false while any layer fails, and names it", res.json?.pass === false && res.json?.failing?.includes("blob"), JSON.stringify(res.json?.failing));
const models = layer("models api");
check("the Models API is asked about every model the engine and the rules table name, free of charge",
  models?.pass === true && ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"].every(id => modelLookups.some(u => u.endsWith(id))) && sent.length === 3,
  JSON.stringify(models));
check("the answering build is named, so a run can tell an old deploy from a new one",
  "deployment" in (res.json || {}) && "commit" in (res.json?.deployment || {}), JSON.stringify(res.json?.deployment));
check("today's uses of the evaluation path are reported", typeof res.json?.evaluation?.today?.scans === "number" && Array.isArray(res.json?.evaluation?.recent),
  JSON.stringify(res.json?.evaluation));
section("PROMPT CACHE");
{
  const cache = layer("prompt cache");
  check("the Sonnet 5.5 gate read the photo back from the cache the first read wrote", cache?.pass === true && cache?.gateReadTokens > 0, JSON.stringify(cache));
  const sonnet = sent.filter(b => b.model === "claude-sonnet-5-5");
  const firstRead = sonnet.findIndex(b => JSON.stringify(b.messages[0].content).includes("Product intelligence scan"));
  const gate = sonnet.findIndex(b => JSON.stringify(b.messages[0].content).includes("candidate product listing image"));
  check("the first read was sent before the Sonnet gate, so there is something to read", firstRead >= 0 && gate > firstRead, `${firstRead} ${gate}`);
  const photo = sonnet[firstRead]?.messages[0].content.find(b => b.type === "image");
  const meta = photo ? await sharp(Buffer.from(photo.source.data, "base64")).metadata() : {};
  const tokens = Math.round(((meta.width || 0) * (meta.height || 0)) / 750);
  check("the probe photo is large enough to cache (over 512 tokens; the 320px sample alone is about 137)",
    tokens > 512, `${meta.width}x${meta.height}, about ${tokens} tokens`);
}
cacheWorks = false; cacheEntries.clear(); sent.length = 0;
{
  const again = await call(route.GET, "/api/diagnose", { headers: { authorization: `Bearer ${TOKEN}` } });
  const cache = (again.json?.layers || []).find(l => l.layer === "prompt cache");
  check("when the gate reads nothing back, the layer fails and says what to check",
    cache?.pass === false && /read nothing from the cache/.test(cache?.detail || "") && again.json?.failing?.includes("prompt cache"), JSON.stringify(cache));
}
cacheWorks = true;

section("LENS ON SERPER");
env({ ANALYTICS_TOKEN: TOKEN, ...KEYS });
serperLensBody = { organic: [
  { title: "Whitening Strips 28ct", source: "Shop", link: "https://shop.example/strips", thumbnailUrl: "https://encrypted-tbn0.gstatic.com/a", imageUrl: "https://shop.example/a.jpg", price: "$22.99" },
  { title: "Strips", source: "Blog", link: "https://blog.example/strips", thumbnailUrl: "https://encrypted-tbn0.gstatic.com/b" },
] };
{
  const probe = await engine.probeSerperLens("https://blob.example/sample.jpg");
  check("usable matches are counted (image and link), priced ones too, and the credits Serper reported",
    probe.pass && probe.matches === 2 && probe.usable === 2 && probe.priced === 1 && probe.creditsUsed === 3, JSON.stringify(probe));
  check("the live response shape is reported: the list used and a row's field names",
    probe.responseShape?.list === "organic" && probe.responseShape?.rowFields?.includes("thumbnailUrl"), JSON.stringify(probe.responseShape));
  check("the gate is handed Google's thumbnail, not the merchant's full-size photo", probe.sample?.[0]?.imageHost === "encrypted-tbn0.gstatic.com", JSON.stringify(probe.sample));
}
serperLensBody = { organic: [{ name: "Whitening Strips", href: "https://shop.example/strips" }] };
{
  const probe = await engine.probeSerperLens("https://blob.example/sample.jpg");
  check("rows in a shape the engine cannot read fail the layer, naming the fields Serper sent",
    probe.pass === false && /^unparseable: unreadable Lens answer/.test(probe.detail) && /name,href/.test(probe.detail), JSON.stringify(probe));
}

check("no key, no account email and no image in the answer",
  !Object.values(KEYS).some(k => res.text.includes(k)) && !res.text.includes("owner@example.com") && !res.text.includes("/9j/"));

section("A MODEL ONLY THE EVALUATION ROUTE USES IS MISSING");
fableMissing = true;
{
  const again = await call(route.GET, "/api/diagnose", { headers: { authorization: `Bearer ${TOKEN}` } });
  const probe = (again.json?.layers || []).find(l => l.layer === "models api");
  check("the models layer still passes: no role uses it", probe?.pass === true && probe?.models?.["claude-fable-5-1"]?.status === 404, JSON.stringify(probe));
}

finish("diagnose");
