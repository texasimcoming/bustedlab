/**
 * THE OPERATOR EVALUATION PATH SKIPS THE FREE ALLOWANCE AND NEVER REACHES
 * PUBLIC DATA.
 *
 * An evaluation scan (operator token plus x-bustedlab-eval: 1) may run past
 * the free allowance, because a labelled evaluation is forty scans from one
 * machine. Everything else that protects the budget must still apply to it:
 * the global daily cap, and the model spend governor. It never reaches
 * public data: no ledger record, no public counter or stats, no cached
 * result, no funnel event. Without the token, the header does nothing;
 * without the header, the token does nothing. Every use is logged. The
 * replay route (/api/eval) answers only the operator, names only models in
 * the rules table, stops while the engine is degraded and at its daily
 * limit, and logs every call. The purge route (/api/eval/purge) removes what
 * earlier runs wrote, once.
 *
 * Next's after() cannot run outside a request, so what the scan route
 * defers to it (countCompletedScan) is run here directly.
 *
 *   node --experimental-strip-types --no-warnings scripts/check-eval.mjs
 */
import { importSrc, env, reset, call, redis, logs, check, section, finish } from "./lib/harness.mjs";

const TOKEN = "eval-operator-token-0123456789";
const scanRoute = await importSrc("app/api/scan/route.ts");
const evalRoute = await importSrc("app/api/eval/route.ts");
const lib = await importSrc("lib/redis.ts");
const { EVAL_DAILY_REPLAYS } = await importSrc("lib/eval-log.ts");

const IP = "198.51.100.30";
const BROWSER = "cd".repeat(16);
const photo = () => {
  const form = new FormData();
  form.append("image", new Blob([Buffer.from("EVAL-CHECK-PHOTO")], { type: "image/jpeg" }), "photo.jpg");
  form.append("intent", "finder");
  return form;
};
const scan = (headers = {}) => call(scanRoute.POST, "/api/scan", {
  method: "POST", body: photo(), headers: { "x-forwarded-for": IP, ...headers }, cookies: { bl_bid: BROWSER },
});
const remaining = async () => (await call(scanRoute.GET, "/api/scan", { headers: { "x-forwarded-for": IP }, cookies: { bl_bid: BROWSER } })).json.remaining;
const spendAllowance = async () => {
  for (let i = 0; i < lib.FREE_SCANS_PER_DAY; i++) {
    await lib.incrementScanCount(IP);
    await lib.incrementScanCount(`browser:${BROWSER}`);
  }
};
const operator = { authorization: `Bearer ${TOKEN}` };
const evalHeaders = { ...operator, "x-bustedlab-eval": "1" };

// The engine fails at extraction here (no model key), which is the one scan
// outcome the route answers without after(): enough to see which gates a
// request passed, and the trace and log an evaluation scan carries.
section("THE FREE ALLOWANCE");
env({ ANALYTICS_TOKEN: TOKEN, ANTHROPIC_API_KEY: undefined }); reset();
await spendAllowance();
check("a visitor past the allowance is refused before any spend", (await scan()).json?.error === "scan_limit_reached");
check("the header alone does nothing", (await scan({ "x-bustedlab-eval": "1" })).json?.error === "scan_limit_reached");
check("the token alone does nothing", (await scan(operator)).json?.error === "scan_limit_reached");
const evaluated = await scan(evalHeaders);
check("token and header together run the scan past the allowance",
  evaluated.status === 502 && evaluated.json?.error === "scan_incomplete", `${evaluated.status} ${evaluated.text.slice(0, 160)}`);
check("and the answer carries the trace: the failure, the model call and the totals",
  evaluated.json?.evaluation?.failure?.reason === "extraction" &&
  Array.isArray(evaluated.json?.evaluation?.trace?.calls) && evaluated.json.evaluation.trace.calls.length >= 1 &&
  typeof evaluated.json.evaluation.trace.claudeUsd === "number",
  JSON.stringify(evaluated.json?.evaluation)?.slice(0, 300));
check("a visitor's failed scan carries no trace", !("evaluation" in ((await scan()).json || {})));
check("the evaluation scan is logged", redis.peek(`eval:scan:${new Date().toISOString().slice(0, 10)}`) === "1" &&
  (redis.peek("eval:recent") || []).some(e => String(e).includes('"kind":"scan"')), JSON.stringify(redis.peek("eval:recent")));
check("the allowance itself is untouched by it", (await remaining()) === 0);

section("THE GLOBAL CAP STILL APPLIES");
env({ ANALYTICS_TOKEN: TOKEN, ANTHROPIC_API_KEY: undefined }); reset();
// The day's counter at the cap, written straight into the emulated Upstash.
await fetch("https://redis.test", {
  method: "POST", body: JSON.stringify(["SET", `scan:global:${new Date().toISOString().slice(0, 10)}`, String(lib.GLOBAL_DAILY_CAP)]),
});
check("the counter reads at the cap", (await lib.getGlobalScansToday()) === lib.GLOBAL_DAILY_CAP);
const atCap = await scan(evalHeaders);
check("an evaluation scan at the global daily cap is refused like anyone's", atCap.status === 503 && atCap.json?.error === "high_demand",
  `${atCap.status} ${atCap.text.slice(0, 120)}`);

section("THE SPEND GOVERNOR STILL APPLIES");
{
  // The governor lives in the engine, which an evaluation scan runs
  // unchanged: the route passes nothing that could switch it off.
  const source = (await import("node:fs")).readFileSync(new URL("../src/app/api/scan/route.ts", import.meta.url), "utf8");
  const evalLines = source.split("\n").filter(l => /evaluation/.test(l));
  check("no evaluation branch names the spend mode, the budget or the global cap",
    !evalLines.some(l => /SpendMode|spendMode|currentSpendMode|DAILY_MODEL_BUDGET|GLOBAL_DAILY_CAP|getGlobalScansToday/.test(l)), evalLines.join("\n"));
}

section("WHAT A FINISHED SCAN COUNTS");
{
  const { countCompletedScan } = await importSrc("lib/scan-counters.ts");
  const day = new Date().toISOString().slice(0, 10);
  const verdict = {
    mode: "VERDICT", found: true, shippingNote: "",
    analysis: { verdict: "HIGH_MARKUP", savings: 40, markup: 300 },
    sourceProduct: { title: "Lamp", price: 10, productUrl: "https://shop.example/lamp", imageUrl: "" },
  };
  const finished = { result: verdict, isPaid: false, email: null, ip: IP, browserId: BROWSER, servedFromCache: false, cacheKey: "img:check:verdict" };
  env({ ANALYTICS_TOKEN: TOKEN }); reset();
  await countCompletedScan({ ...finished, evaluation: false });
  const visitorKeys = redis.keys();
  check("a visitor's verdict counts everywhere: lifetime counter, verdict stats, savings, cache, funnel, allowance, cap",
    ["scan:total:global", "scan:verdicts:total", "scan:savings:global", "scan:cache:img:check:verdict", "stat:scan_completed:total", `scan:global:${day}`, `scan:global:hist:${day}`]
      .every(k => visitorKeys.includes(k)), visitorKeys.join(", "));
  reset();
  await countCompletedScan({ ...finished, evaluation: true });
  // The cap's counter and its 400-day history (operator data, for cost per
  // scan; an evaluation scan spends real money too). Nothing public.
  check("an evaluation scan's verdict counts against the global free cap and nothing else",
    JSON.stringify(redis.keys().sort()) === JSON.stringify([`scan:global:${day}`, `scan:global:hist:${day}`]), redis.keys().join(", "));
  reset();
  await countCompletedScan({ ...finished, evaluation: true, servedFromCache: true });
  check("and a cached evaluation scan counts nowhere at all", redis.keys().length === 0, redis.keys().join(", "));
}

section("A VERDICT REACHES THE LEDGER ONLY FROM A VISITOR");
{
  // A whole scan to a verdict, through the real engine: the first read sees
  // a $60 asking price, Serper Shopping finds the lamp at $20, the gate
  // confirms it. No Blob token, so no Lens: the shopping path identifies it.
  const harness = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : String(input?.url || input);
    const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
    if (url === "https://api.anthropic.com/v1/messages") {
      const prompt = JSON.stringify(JSON.parse(init.body).messages[0].content);
      const text = prompt.includes("Product intelligence scan")
        ? JSON.stringify({ productName: "ceramic table lamp", brand: "Lumo", visiblePrice: 60, currency: "USD", quantity: "", category: "home",
          platform: "instagram", storeName: "", visibleUrl: "", priceConfidence: "visible", imageQuality: "good" })
        : prompt.includes("candidate product listing image")
          ? JSON.stringify([{ candidate: 1, match: "exact", why: "same lamp" }])
          : "lumo ceramic table lamp";
      return reply({ stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200 }, content: [{ type: "text", text }] });
    }
    if (url === "https://google.serper.dev/shopping") {
      return reply({ shopping: [{ title: "Lumo Ceramic Table Lamp", source: "Shop", link: "https://shop.example/lamp", imageUrl: "https://images.example/lamp.jpg", price: "$20.00" }], credits: 1 });
    }
    if (url.startsWith("https://google.serper.dev/")) return reply({ organic: [], credits: 1 });
    if (url.startsWith("https://images.example/")) return new Response(Buffer.from("lamp"), { status: 200, headers: { "content-type": "image/jpeg" } });
    if (url.startsWith("https://shop.example/")) return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
    if (url.includes("currency-api")) return reply({ date: "2026-10-01", usd: { usd: 1, eur: 0.9 } });
    return harness(input, init);
  };
  const run = async (headers) => {
    const form = new FormData();
    form.append("image", new Blob([Buffer.from(`LEDGER-PHOTO-${Math.random()}`)], { type: "image/jpeg" }), "photo.jpg");
    form.append("intent", "verdict");
    return call(scanRoute.POST, "/api/scan", { method: "POST", body: form, headers: { "x-forwarded-for": IP, ...headers }, cookies: { bl_bid: BROWSER } });
  };
  env({ ANALYTICS_TOKEN: TOKEN, ANTHROPIC_API_KEY: "sk-ant-eval-check", SERPER_API_KEY: "serper-eval-check", SERPAPI_KEY: undefined, BLOB_READ_WRITE_TOKEN: undefined });
  reset();
  await run({});
  const ledger = () => redis.peek("scan:ledger");
  check("control: a visitor's verdict is written to the ledger", ledger()?.size === 1, `${ledger()?.size ?? 0} record(s); keys: ${redis.keys().join(", ")}`);
  reset();
  await run(evalHeaders);
  check("an evaluation scan's verdict is not: no record, no board entry, no permanent page",
    !ledger()?.size && !redis.keys().some(k => k.startsWith("scan:rec:") || k.startsWith("scan:ledger") || k.startsWith("scan:trending:")),
    redis.keys().join(", "));
  check("and it was logged as an evaluation scan", (redis.peek("eval:recent") || []).some(e => String(e).includes('"kind":"scan"')));
  check("and nothing about it reached the funnel in /api/stats, not even a failure", !redis.keys().some(k => k.startsWith("stat:")), redis.keys().join(", "));
  globalThis.fetch = harness;
}

section("THE PURGE: /api/eval/purge");
{
  const purgeRoute = await importSrc("app/api/eval/purge/route.ts");
  const purge = (body, headers = operator) => call(purgeRoute.POST, "/api/eval/purge", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers },
  });
  env({ ANALYTICS_TOKEN: TOKEN }); reset();
  // A record an earlier evaluation run wrote, and one a visitor wrote.
  const ts = Date.now();
  const record = (id, title, productKey) => ({
    id, ts, title, category: "home", retailPrice: 62.24, wholesalePrice: 40, markup: 56, savings: 22.24,
    verdict: "OVERPRICED", confidence: "high", matchConfidence: "exact", platform: "Shop",
    sourceUrl: "https://shop.example/x", imageUrl: "", productKey, cached: false,
  });
  await lib.recordScan(record("muq0qsdh30e5c684a68a1959f81360e3", "Stanley Quencher (evaluation)", "img:eval:verdict"));
  await lib.recordScan(record("mvisitor0000000000000000000000ab", "A visitor's lamp", "img:visitor:verdict"));
  for (let i = 0; i < 50; i++) await lib.incrementTotalScans();
  await lib.recordVerdict(false); await lib.recordVerdict(false);
  await lib.incrementTotalSavings(22.24); await lib.incrementTotalSavings(10);
  const body = { purgeId: "eval-runs-1-4", scanIds: ["muq0qsdh30e5c684a68a1959f81360e3"], counters: { scans: 48, verdicts: 1, busted: 0, savingsUsd: 22.24 } };

  check("no token: 401", (await purge(body, {})).status === 401);
  check("an id that is not a ledger id: 400", (await purge({ ...body, scanIds: ["../../etc"] })).status === 400);
  check("negative counters: 400", (await purge({ ...body, counters: { ...body.counters, scans: -1 } })).status === 400);
  const dry = await purge({ ...body, dryRun: true });
  check("a dry run names what would go and changes nothing",
    dry.json?.wouldRemove?.length === 1 && (await lib.getLedgerSize()) === 2 && (await lib.getTotalScans()) === 50, dry.text.slice(0, 300));
  const done = await purge(body);
  check("the purge removes the evaluation record, and only it",
    done.status === 200 && done.json?.result?.removed?.length === 1 && (await lib.getLedgerSize()) === 1 &&
    (await lib.getScanRecord("muq0qsdh30e5c684a68a1959f81360e3")) === null && (await lib.getScanRecord("mvisitor0000000000000000000000ab")) !== null,
    done.text.slice(0, 400));
  check("its board entries go with it: markup board, trending, category average, product aggregate",
    !redis.peek("scan:ledger:markup")?.has("muq0qsdh30e5c684a68a1959f81360e3") &&
    !redis.peek(`scan:trending:${lib.isoWeek()}`)?.has("img:eval:verdict") &&
    redis.peek("scan:cat:home")?.get("count") === "1" && redis.peek("scan:product:img:eval:verdict") === undefined,
    JSON.stringify({ cat: [...(redis.peek("scan:cat:home") || new Map())], trending: [...(redis.peek(`scan:trending:${lib.isoWeek()}`) || new Map())] }));
  check("the public counters lose exactly what the evaluation scans added",
    (await lib.getTotalScans()) === 2 && (await lib.getBustedRate()).total === 1 && Math.abs((await lib.getTotalSavingsExposed()) - 10) < 1e-9,
    JSON.stringify(done.json?.result?.counters));
  const again = await purge(body);
  check("a second run with the same purgeId changes nothing", again.json?.alreadyApplied === true && (await lib.getTotalScans()) === 2, again.text.slice(0, 200));
  check("the purge is logged", (redis.peek("eval:recent") || []).some(e => String(e).includes('"kind":"purge"')));
}

section("REPLAYS: /api/eval");
const harnessFetch = globalThis.fetch;
const sent = [];
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : String(input?.url || input);
  if (url === "https://api.anthropic.com/v1/messages") {
    const body = JSON.parse(init.body);
    sent.push(body);
    const isGate = JSON.stringify(body.messages[0].content).includes("candidate product listing image");
    const text = isGate
      ? JSON.stringify([{ candidate: 1, match: "exact", why: "same" }, { candidate: 2, match: "different", why: "other" }])
      : JSON.stringify({ productName: "ceramic table lamp", brand: "", visiblePrice: 49.99, currency: "EUR", imageQuality: "good" });
    return new Response(JSON.stringify({
      stop_reason: "end_turn", usage: { input_tokens: 2000, output_tokens: 400 },
      content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.startsWith("https://images.example/")) {
    return new Response(Buffer.from("candidate-image"), { status: 200, headers: { "content-type": "image/jpeg" } });
  }
  return harnessFetch(input, init);
};
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const replay = (body, headers = operator) => call(evalRoute.POST, "/api/eval", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers },
});
const image = { data: PNG_1PX, mimeType: "image/png" };
env({ ANALYTICS_TOKEN: TOKEN, ANTHROPIC_API_KEY: "sk-ant-eval-check" }); reset();

check("no token: 401", (await replay({ op: "extract", model: "claude-opus-5-5", image }, {})).status === 401);
check("a model outside the rules table: 400", (await replay({ op: "extract", model: "claude-haiku-4-5", image })).status === 400);
check("an unknown effort: 400", (await replay({ op: "extract", model: "claude-opus-5-5", effort: "extreme", image })).status === 400);
check("a gate replay with no candidates: 400", (await replay({ op: "gate", model: "claude-opus-5-5", image, candidates: [] })).status === 400);
check("a candidate on a private address: 400",
  (await replay({ op: "gate", model: "claude-opus-5-5", image, candidates: ["https://127.0.0.1/x.jpg"] })).status === 400);
check("nothing was sent to a model for any refused request", sent.length === 0);

for (const model of ["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]) {
  const before = sent.length;
  const res = await replay({ op: "extract", model, effort: "medium", image });
  const body = sent[before];
  check(`extraction replay on ${model}: read returned, measured, sent with the engine's request shape`,
    res.status === 200 && res.json?.ok === true && res.json?.read?.productName === "ceramic table lamp" && res.json?.read?.currency === "EUR" &&
    res.json?.call?.costUsd > 0 && res.json?.call?.model === model &&
    body?.model === model && body?.output_config?.effort === "medium" && !("temperature" in body) && !("thinking" in body) && body?.max_tokens >= 15_000,
    `${res.status} ${res.text.slice(0, 200)}`);
}
{
  const res = await replay({ op: "gate", model: "claude-opus-5-5", image, candidates: ["https://images.example/1.jpg", "https://images.example/2.jpg"] });
  check("gate replay: one verdict per candidate, in order",
    res.status === 200 && res.json?.ok && res.json?.verdicts?.[0]?.match === "exact" && res.json?.verdicts?.[1]?.match === "different" && res.json?.loaded === 2,
    res.text.slice(0, 200));
  const last = sent[sent.length - 1];
  check("with the default effort when none is named", last?.output_config?.effort === "low");
}
{
  const fable = (await importSrc("lib/model-budget.ts")).priceUsage("claude-fable-5-1", { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 });
  check("Fable 5.1 is priced at $10 in, $50 out, cache reads 0.025x", Math.abs(fable - 60.25) < 1e-9, String(fable));
}
check("every replay is logged", Number(redis.peek(`eval:replay:${new Date().toISOString().slice(0, 10)}`)) === 4);

section("REPLAYS STOP WHEN THEY SHOULD");
{
  const { recordModelSpend, resetSpendModeCache, DAILY_MODEL_BUDGET_USD } = await importSrc("lib/model-budget.ts");
  await recordModelSpend(DAILY_MODEL_BUDGET_USD + 1);
  resetSpendModeCache();
  const before = sent.length;
  const res = await replay({ op: "extract", model: "claude-opus-5-5", image });
  check("while the engine is degraded: 409, and no model call", res.status === 409 && sent.length === before, `${res.status}`);
}
reset();
(await importSrc("lib/model-budget.ts")).resetSpendModeCache();
{
  const { replayAllowed } = await importSrc("lib/eval-log.ts");
  for (let i = 0; i < EVAL_DAILY_REPLAYS; i++) await replayAllowed();
  const before = sent.length;
  const res = await replay({ op: "extract", model: "claude-opus-5-5", image });
  check("past the daily replay limit: 429, and no model call", res.status === 429 && sent.length === before, `${res.status}`);
}
check("no key in any log line", !logs.errors.some(e => e.includes("sk-ant-eval-check") || e.includes(TOKEN)));

finish("eval");
