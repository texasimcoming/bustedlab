/**
 * CURRENCY.
 *
 * The listings the engine compares against are in US dollars. The asking
 * price is in whatever the seller charges. Before src/lib/fx.ts the two were
 * compared as raw numbers, so a 299 dirham asking price against a $30
 * listing printed as "$299 asking, 897% markup" when it is roughly the same
 * price. This runs the real engine on screenshots priced in USD, EUR, GBP
 * and MAD and asserts the comparison happens in one currency, with the
 * original shown, and that no verdict is printed when no rate is available,
 * nor when the source listing is priced in another currency than the
 * screenshot (SAME-MARKET VERDICTS in src/lib/scan.ts).
 *
 *   node --experimental-strip-types --no-warnings scripts/check-currency.mjs
 */
import { loadEngine, localModule } from "./lib/engine.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `\n        ${detail}` : ""}`);
  if (!ok) failures++;
};
const section = (t) => console.log(`\n── ${t} ──`);
const quiet = console.error;
console.error = () => {};

const fx = await import(localModule("fx"));

section("READING PRICES AS LISTINGS WRITE THEM");
for (const [raw, amount, currency] of [
  ["$1,299.00", 1299, "USD"], ["€25,99", 25.99, "EUR"], ["1.299,00 €", 1299, "EUR"], ["£8.50", 8.5, "GBP"],
  ["MAD 299", 299, "MAD"], ["299 DH", 299, "MAD"], ["299 درهم", 299, "MAD"], ["US$ 12.50", 12.5, "USD"],
  ["CA$15", 15, "CAD"], ["R$ 40,00", 40, "BRL"], ["1,299", 1299, ""],
]) {
  const got = fx.parsePrice(raw);
  check(`${JSON.stringify(raw)} reads as ${amount} ${currency || "(no currency)"}`, got.amount === amount && got.currency === currency, JSON.stringify(got));
}
check("the old parser's mistake is gone: €25,99 is not 2,599", fx.parsePrice("€25,99").amount < 100);

section("THE RATE TABLE");
const SAMPLE = { date: "2026-10-01", usd: { eur: 0.9, gbp: 0.75, mad: 9.5, jpy: 150 } };
check("a well-formed table is accepted", fx.readRateTable(SAMPLE)?.rates.mad === 9.5);
check("a table missing the majors is refused", fx.readRateTable({ date: "2026-10-01", usd: { mad: 9.5 } }) === null);
check("an implausible table is refused", fx.readRateTable({ date: "2026-10-01", usd: { eur: 90, gbp: 0.75 } }) === null);
check("a table with no date is refused", fx.readRateTable({ usd: SAMPLE.usd }) === null);

// ════════════════════════════════════════════════════════════════
// The engine, end to end. One Lens match, confirmed by the gate, listed at
// $30. The screenshot's asking price and currency change per case.
// ════════════════════════════════════════════════════════════════
Object.assign(process.env, {
  ANTHROPIC_API_KEY: "test", SERPAPI_KEY: "test", SERPER_API_KEY: "test", BLOB_READ_WRITE_TOKEN: "test",
  UPSTASH_REDIS_REST_URL: "https://redis.test", UPSTASH_REDIS_REST_TOKEN: "test",
});
const store = new Map();
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const encode = (v) => (typeof v === "string" ? Buffer.from(v, "utf8").toString("base64") : v);
function redisCommand([cmd, key, ...rest]) {
  switch (String(cmd).toUpperCase()) {
    case "GET": return store.get(key) ?? null;
    case "SET": store.set(key, String(rest[0])); return "OK";
    case "INCRBYFLOAT": { const n = (Number(store.get(key)) || 0) + Number(rest[0]); store.set(key, String(n)); return String(n); }
    default: return 1;
  }
}

let screenshot = { amount: 120, currency: "USD" };
let ratesUp = true;
let lensCurrency = "$";
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : String(input?.url || input);
  if (url.startsWith("https://redis.test")) {
    const body = JSON.parse(init.body || "[]");
    return json(Array.isArray(body[0]) ? body.map(a => ({ result: encode(redisCommand(a)) })) : { result: encode(redisCommand(body)) });
  }
  if (url.includes("currency-api")) return ratesUp ? json(SAMPLE) : json({ error: "down" }, 503);
  if (url.startsWith("https://img.test/")) return new Response(Buffer.from(url), { headers: { "content-type": "image/jpeg" } });
  if (url === "https://api.anthropic.com/v1/messages") {
    const body = JSON.parse(init.body);
    const prompt = JSON.stringify(body.messages[0].content);
    if (prompt.includes("Product intelligence scan")) {
      return json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({
        productName: "ceramic table lamp", brand: "Lumo", visiblePrice: screenshot.amount, currency: screenshot.currency,
        quantity: "", category: "home", platform: "instagram", storeName: "", visibleUrl: "", priceConfidence: "visible", imageQuality: "good",
      }) }] });
    }
    const count = body.messages[0].content.filter(b => b.type === "image").length - 1;
    return json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(
      Array.from({ length: count }, (_, i) => ({ candidate: i + 1, match: "exact", tie: "logo", why: "same lamp" }))) }] });
  }
  // Lens on Serper, the primary (SEARCH PROVIDERS in scan.ts): one match,
  // its price a string in the listing's own currency.
  if (url === "https://google.serper.dev/lens") {
    return json({ organic: [{
      title: "Lumo Ceramic Table Lamp", link: "https://shop.test/lamp", thumbnailUrl: "https://img.test/lamp", source: "Shop",
      price: `${lensCurrency}30.00`,
    }], credits: 3 });
  }
  if (url.startsWith("https://google.serper.dev/")) return json({ organic: [], shopping: [], credits: 1 });
  if (url.startsWith("https://serpapi.com/account.json")) return json({ total_searches_left: 200 });
  if (url.startsWith("https://serpapi.com/search.json")) {
    const engine = new URL(url).searchParams.get("engine");
    if (engine === "google_lens") {
      return json({ visual_matches: [{
        title: "Lumo Ceramic Table Lamp", link: "https://shop.test/lamp", thumbnail: "https://img.test/lamp", source: "Shop",
        price: { value: `${lensCurrency}30.00`, extracted_value: 30, currency: lensCurrency },
      }] });
    }
    return json({ organic_results: [], shopping_results: [] });
  }
  throw new Error(`unmocked fetch: ${url}`);
};

const engine = await loadEngine(undefined, "currency");
const { resetSpendModeCache } = await import(localModule("model-budget"));
const run = async () => {
  store.clear(); fx.resetRatesMemo(); resetSpendModeCache();
  return engine.scanProduct(Buffer.from("LAMP").toString("base64"), "image/jpeg", "us", "verdict");
};
const describe = (r) => `${r.mode} ${r.analysis.verdict} retail $${r.analysis.retailEstimate} vs $${r.sourceProduct.price} markup ${r.analysis.markup}% ` +
  `original ${JSON.stringify(r.analysis.retailOriginal || null)} currency ${r.sourceProduct.currency}`;

section("A DOLLAR SCREENSHOT IS UNCHANGED");
screenshot = { amount: 120, currency: "USD" };
{
  const r = await run();
  check("$120 against $30 is a verdict on $120, with no conversion note", r.mode === "VERDICT" && r.analysis.retailEstimate === 120 && !r.analysis.retailOriginal, describe(r));
}

section("A DIRHAM SCREENSHOT IS CONVERTED BEFORE IT IS COMPARED");
screenshot = { amount: 299, currency: "MAD" };
{
  const r = await run();
  const expected = Math.round((299 / 9.5) * 100) / 100;
  check(`299 MAD becomes $${expected}, not $299`, r.analysis.retailEstimate === expected, describe(r));
  check("so the markup is about 5%, not 897%", r.analysis.markup < 10, describe(r));
  check("and the card is given the original to show", r.analysis.retailOriginal?.currency === "MAD" && r.analysis.retailOriginal?.amount === 299 && r.analysis.retailOriginal?.asOf === "2026-10-01", describe(r));
  check("the listing price is labelled as the dollars it is", r.sourceProduct.currency === "USD", describe(r));
}

section("EUROS AND POUNDS");
for (const [amount, currency, rate] of [[90, "EUR", 0.9], [60, "GBP", 0.75]]) {
  screenshot = { amount, currency };
  const r = await run();
  const expected = Math.round((amount / rate) * 100) / 100;
  check(`${amount} ${currency} is compared as $${expected}`, r.analysis.retailEstimate === expected && r.analysis.retailOriginal?.currency === currency, describe(r));
}

section("NO RATE, NO VERDICT");
screenshot = { amount: 299, currency: "MAD" };
ratesUp = false;
{
  const r = await run();
  check("with the rate source down and nothing cached, no markup is printed", r.mode !== "VERDICT" && r.analysis.verdict === "UNVERIFIED", describe(r));
  check("but the cheapest verified listing is still shown, not a failure", !r.failure && r.found && r.sourceProduct.price === 30, describe(r));
}
ratesUp = true;

section("A LISTING PRICED IN ANOTHER CURRENCY");
screenshot = { amount: 120, currency: "USD" };
lensCurrency = "€";
{
  const r = await run();
  const expected = Math.round((30 / 0.9) * 100) / 100;
  check(`a Lens match listed at €30 is compared as $${expected}`, r.sourceProduct.price === expected, describe(r));
}

section("SAME-MARKET VERDICTS: A VERDICT ONLY WHEN BOTH PRICES ARE IN ONE CURRENCY");
check("the rule itself: same currency or not, and an unknown source is not the same market",
  engine.sameMarket("EUR", "eur") && !engine.sameMarket("EUR", "IDR") && !engine.sameMarket("MAD", "USD") && !engine.sameMarket("EUR", null) && !engine.sameMarket("", "USD"));
for (const [label, shot, listing, verdict] of [
  ["a euro screenshot against a listing priced in euros", { amount: 90, currency: "EUR" }, "€", true],
  ["a euro screenshot against a listing priced in dollars", { amount: 90, currency: "EUR" }, "$", false],
  ["a dirham screenshot against a US listing", { amount: 599, currency: "MAD" }, "$", false],
  ["a dollar screenshot against a listing priced in euros", { amount: 120, currency: "USD" }, "€", false],
]) {
  screenshot = shot;
  lensCurrency = listing;
  const r = await run();
  if (verdict) {
    check(`${label}: a verdict`, r.mode === "VERDICT" && r.analysis.verdict !== "UNVERIFIED", describe(r));
  } else {
    check(`${label}: the cheapest-link card, no verdict, with the regional-shipping note`,
      r.mode === "FINDER" && r.analysis.verdict === "UNVERIFIED" && r.found && /shipping/i.test(r.shippingNote || ""), `${describe(r)} note ${r.shippingNote}`);
    check("  and both prices still converted for display", r.sourceProduct.currency === "USD" && r.analysis.retailEstimate > 0 && r.sourceProduct.price > 0, describe(r));
  }
}
screenshot = { amount: 120, currency: "USD" };
lensCurrency = "$";

console.error = quiet;
console.log(`\n${failures === 0 ? "All currency checks passed." : `${failures} currency check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
