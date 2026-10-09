/**
 * PRICES AS WRITTEN.
 *
 * Every price the engine compares starts as text someone else wrote: a
 * page's meta tags, microdata or JSON-LD, a search provider's price string,
 * a model's read of a screenshot. The page readers used to strip every
 * character but digits and ".", so Stanley's European store, which writes
 * "55,00", was read as 5,500 euros. This runs the shared parser
 * (parsePrice in src/lib/fx.ts) on the formats listings really use, the
 * engine's page readers and provider prices end to end, and the PLAUSIBLE
 * GAP rule in src/lib/scan.ts: two prices more than 50 times apart, either
 * way, never make a verdict.
 *
 *   node --experimental-strip-types --no-warnings scripts/check-prices.mjs
 */
import { loadEngine, localModule } from "./lib/engine.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `\n        ${detail}` : ""}`);
  if (!ok) failures++;
};
const attempt = (fn) => { try { return fn(); } catch (err) { return { error: String(err?.message || err) }; } };
const section = (t) => console.log(`\n── ${t} ──`);
const quiet = console.error;
console.error = () => {};

const fx = await import(localModule("fx"));

// ════════════════════════════════════════════════════════════════
// The parser on its own. "unreadable" is null: where a format could mean
// two things, nothing is read, because a missing price only costs a
// verdict and a wrong one accuses a seller.
// ════════════════════════════════════════════════════════════════
section("THE PARSER: EVERY FORMAT A LISTING WRITES");
const NBSP = " ";
const NNBSP = " ";
for (const [raw, amount, currency] of [
  ["55,00", 55, ""],
  ["€55,00", 55, "EUR"],
  ["55,5", 55.5, ""],
  ["0,99 €", 0.99, "EUR"],
  ["1.299,00 €", 1299, "EUR"],
  ["1,299.00", 1299, ""],
  ["1,299", 1299, ""],
  ["1.299 €", 1299, "EUR"],
  ["1 299,00 €", 1299, "EUR"],
  [`1${NBSP}299,00${NBSP}€`, 1299, "EUR"],
  [`1${NNBSP}299,00${NNBSP}€`, 1299, "EUR"],
  ["CHF 1'299.00", 1299, "CHF"],
  ["55.00", 55, ""],
  ["12.345.678", 12345678, ""],
  ["$1,299.00", 1299, "USD"],
  ["29.990000", 29.99, ""],
  ["IDR 650.000", 650000, "IDR"],
  ["₹1,29,999", 129999, "INR"],
  ["1.299,-", 1299, ""],
  ["$.99", 0.99, "USD"],
  ["Rs.1,299", 1299, ""],
]) {
  const got = attempt(() => fx.parsePrice(raw));
  check(`${JSON.stringify(raw)} reads as ${amount}${currency ? ` ${currency}` : ""}`,
    got.amount === amount && (got.currency || "") === currency, JSON.stringify(got));
}

section("THE PARSER: NOTHING TO READ, OR TWO WAYS TO READ IT");
for (const [raw, why] of [
  ["", "empty"],
  ["   ", "blank"],
  ["Free", "no number"],
  ["Price on request", "no number"],
  [null, "null"],
  [undefined, "missing"],
  ["$.1.299", "a leading separator before grouped digits"],
  ["1.299.00", "dots that neither group thousands nor mark one decimal"],
  ["1,299,00", "commas that neither group thousands nor mark one decimal"],
  ["1,2,3", "no grouping at all"],
  ["KWD 12.500", "three-decimal currency: twelve and a half, or twelve thousand five hundred"],
]) {
  const got = attempt(() => fx.parsePrice(raw));
  check(`${JSON.stringify(raw)} is unreadable (${why})`, got.amount === null, JSON.stringify(got));
}
{
  const got = attempt(() => fx.parsePrice("12.500", "KWD"));
  check("a page's own currency field counts: \"12.500\" stated in KWD is unreadable", got.amount === null, JSON.stringify(got));
  const plain = attempt(() => fx.parsePrice("12.500", "EUR"));
  check("and the same \"12.500\" stated in EUR is 12,500", plain.amount === 12500, JSON.stringify(plain));
  const number = attempt(() => fx.parsePrice(55.5));
  check("a number is taken as the number it is", number.amount === 55.5, JSON.stringify(number));
}

// ════════════════════════════════════════════════════════════════
// The engine, end to end. Lens finds one listing; the page behind it, or
// the page a link scan reads, writes its price the way European stores do.
// ════════════════════════════════════════════════════════════════
Object.assign(process.env, {
  ANTHROPIC_API_KEY: "test", SERPAPI_KEY: "test", SERPER_API_KEY: "test", BLOB_READ_WRITE_TOKEN: "test",
  UPSTASH_REDIS_REST_URL: "https://redis.test", UPSTASH_REDIS_REST_TOKEN: "test",
});
const RATES = { date: "2026-10-01", usd: { usd: 1, eur: 0.9, gbp: 0.75, mad: 9.5, chf: 0.8 } };
const store = new Map();
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const html = (body) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const encode = (v) => (typeof v === "string" ? Buffer.from(v, "utf8").toString("base64") : v);
function redisCommand([cmd, key, ...rest]) {
  switch (String(cmd).toUpperCase()) {
    case "GET": return store.get(key) ?? null;
    case "SET": store.set(key, String(rest[0])); return "OK";
    case "INCRBYFLOAT": { const n = (Number(store.get(key)) || 0) + Number(rest[0]); store.set(key, String(n)); return String(n); }
    default: return 1;
  }
}

/** A product page: its price written in meta tags, microdata or JSON-LD. */
function page({ via = "meta", price, currency, title = "Lumo Ceramic Table Lamp" }) {
  const head = [`<title>${title}</title>`, `<meta property="og:title" content="${title}">`, `<meta property="og:image" content="https://img.test/lamp-page">`];
  let body = "";
  if (price !== undefined && via === "meta") head.push(`<meta property="og:price:amount" content="${price}">`, `<meta property="og:price:currency" content="${currency}">`);
  if (price !== undefined && via === "microdata") body = `<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">${title}</span><meta itemprop="price" content="${price}"><meta itemprop="priceCurrency" content="${currency}"></div>`;
  if (price !== undefined && via === "jsonld") head.push(`<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: title, offers: { "@type": "Offer", price, priceCurrency: currency } })}</script>`);
  return `<!doctype html><html><head>${head.join("")}</head><body><h1>${title}</h1>${body}<p>A ceramic table lamp.</p></body></html>`;
}

let scenario = {};
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : String(input?.url || input);
  if (url.startsWith("https://redis.test")) {
    const body = JSON.parse(init.body || "[]");
    return json(Array.isArray(body[0]) ? body.map(a => ({ result: encode(redisCommand(a)) })) : { result: encode(redisCommand(body)) });
  }
  if (url.includes("currency-api")) return json(RATES);
  if (url.startsWith("https://img.test/")) return new Response(Buffer.from(url), { headers: { "content-type": "image/jpeg" } });
  // The page a link scan reads, and the source listing's own page.
  if (url.startsWith("https://shop.test/")) return html(scenario.scannedPage || page({}));
  if (url.startsWith("https://source.test/")) return html(scenario.sourcePage || page({}));
  if (url === "https://api.anthropic.com/v1/messages") {
    const body = JSON.parse(init.body);
    const prompt = JSON.stringify(body.messages[0].content);
    if (prompt.includes("Product intelligence scan")) {
      return json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({
        productName: "ceramic table lamp", brand: "Lumo", visiblePrice: scenario.shot?.amount ?? null, currency: scenario.shot?.currency ?? "",
        quantity: "", category: "home", platform: "instagram", storeName: "", visibleUrl: "", priceConfidence: "visible", imageQuality: "good",
      }) }] });
    }
    if (prompt.includes("Extract the product name and price")) {
      return json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ title: "Lumo Ceramic Table Lamp", price: null, currency: "" }) }] });
    }
    if (prompt.includes("candidate product listing image")) {
      const count = body.messages[0].content.filter(b => b.type === "image").length - 1;
      return json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(
        Array.from({ length: count }, (_, i) => ({ candidate: i + 1, match: "exact", tie: "logo", why: "same lamp" }))) }] });
    }
    return json({ stop_reason: "end_turn", content: [{ type: "text", text: "lumo ceramic table lamp" }] });
  }
  // Lens on Serper: one listing, the Lumo lamp. Its price is a string, or
  // absent so the engine reads the listing's own page (page_price).
  if (url === "https://google.serper.dev/lens") {
    const row = { title: "Lumo Ceramic Table Lamp", link: scenario.lensLink || "https://source.test/lamp", thumbnailUrl: "https://img.test/lamp", source: "Lumo Store" };
    if (scenario.lensPrice) row.price = scenario.lensPrice;
    return json({ organic: [row], credits: 3 });
  }
  if (url.startsWith("https://google.serper.dev/")) return json({ organic: [], shopping: [], credits: 1 });
  if (url.startsWith("https://serpapi.com/account.json")) return json({ total_searches_left: 200 });
  if (url.startsWith("https://serpapi.com/search.json")) return json({ visual_matches: [], organic_results: [], shopping_results: [] });
  throw new Error(`unmocked fetch: ${url}`);
};

// The engine checks every page address with DNS before fetching it
// (fetchPublic in src/lib/net-guard.ts). These hosts are made up and served by
// the stubbed fetch, so they resolve to a public documentation address here.
(await import(localModule("net-guard"))).setResolverForChecks(async () => [{ address: "93.184.216.34" }]);
const engine = await loadEngine(undefined, "prices");
const { resetSpendModeCache } = await import(localModule("model-budget"));
async function run(next, how = "photo") {
  scenario = next;
  store.clear(); fx.resetRatesMemo(); resetSpendModeCache();
  try {
    return how === "link"
      ? await engine.scanProductUrl("https://shop.test/lumo-lamp", "us", "verdict")
      : await engine.scanProduct(Buffer.from("LAMP").toString("base64"), "image/jpeg", "us", "verdict");
  } catch (err) {
    return { mode: "ERROR", analysis: {}, sourceProduct: {}, error: String(err?.message || err) };
  }
}
const describe = (r) => r.error ? `threw: ${r.error}` :
  `${r.mode} ${r.analysis.verdict} asking $${r.analysis.retailEstimate} (${r.analysis.retailSource}, original ${JSON.stringify(r.analysis.retailOriginal || null)}) ` +
  `vs source $${r.sourceProduct.price} markup ${r.analysis.markup}% note ${JSON.stringify(r.priceNote || null)}`;
const usd = (eur) => Math.round((eur / 0.9) * 100) / 100;

section("PAGE READERS: A SOURCE LISTING'S OWN PAGE, AS STANLEY'S EUROPEAN STORE WRITES IT");
for (const via of ["meta", "microdata", "jsonld"]) {
  for (const [written, euros] of [["55,00", 55], ["1.299,00", 1299]]) {
    const shot = { amount: Math.round(euros * 1.5), currency: "EUR" };
    const r = await run({ shot, sourcePage: page({ via, price: written, currency: "EUR" }) });
    check(`${via} price "${written}" EUR is €${euros} ($${usd(euros)}), and €${shot.amount} against it is a verdict`,
      r.sourceProduct.price === usd(euros) && r.mode === "VERDICT", describe(r));
  }
}

section("PAGE READERS: THE PAGE A LINK SCAN READS");
for (const via of ["meta", "microdata", "jsonld"]) {
  const r = await run({ scannedPage: page({ via, price: "55,00", currency: "EUR" }), lensPrice: "€40,00" }, "link");
  check(`a ${via} asking price of "55,00" EUR is €55, not €5,500, so €55 against €40 is a 38% markup`,
    r.analysis.retailOriginal?.amount === 55 && r.analysis.retailOriginal?.currency === "EUR" && r.mode === "VERDICT" && r.analysis.markup === 38, describe(r));
}
{
  const r = await run({ scannedPage: page({ via: "meta", price: "12.500", currency: "KWD" }), lensPrice: "$30.00" }, "link");
  check("an ambiguous asking price (\"12.500\" in dinars) is not read, so there is no verdict",
    r.mode !== "VERDICT" && r.analysis.retailSource !== "screenshot", describe(r));
}

section("PROVIDER PRICES: THE TEXT AND THE PROVIDER'S OWN NUMBER MUST AGREE");
const listed = (text, extracted) => attempt(() => engine.listedPrice(text, extracted)).amount;
check("\"29,99 €\" with 29.99 extracted is 29.99", listed("29,99 €", 29.99) === 29.99);
check("\"$1,299.00\" with 1299 extracted is 1299", listed("$1,299.00", 1299) === 1299);
check("\"1.299,00 €\" with nothing extracted is 1299", listed("1.299,00 €", undefined) === 1299);
check("a number with no text is taken as given", listed(undefined, 12.5) === 12.5);
check("text and number that disagree (\"2 for $10\", 10) are no price", listed("2 for $10", 10) === 0);
check("\"55,00 €\" read by a provider as 5500 is no price", listed("55,00 €", 5500) === 0);
{
  const r = await run({ shot: { amount: 80, currency: "EUR" }, lensPrice: "55,00 €" });
  check(`a Lens price written "55,00 €" is €55 ($${usd(55)})`, r.sourceProduct.price === usd(55), describe(r));
}

// ════════════════════════════════════════════════════════════════
// PLAUSIBLE GAP. A misread price is off by a factor of 100 or 1,000, not
// by a few percent, so a gap of more than 50 times either way withholds the
// verdict and returns the cheapest-link card with a short note.
// ════════════════════════════════════════════════════════════════
section("PLAUSIBLE GAP: MORE THAN 50 TIMES APART, EITHER WAY, IS NO VERDICT");
const gap = (a, b) => attempt(() => engine.implausibleGap(a, b));
check("51 times higher asking is implausible", gap(5100, 100) === true);
check("51 times higher source is implausible", gap(100, 5100) === true);
check("exactly 50 times is still compared", gap(5000, 100) === false && gap(100, 5000) === false);
check("a missing price is not a gap", gap(100, 0) === false && gap(0, 100) === false);
const noted = (r) => r.mode === "FINDER" && r.analysis.verdict === "UNVERIFIED" && /too far apart/i.test(r.priceNote || "") && r.sourceProduct.price > 0;
for (const [label, run_] of [
  ["photo: $3,000 asking against a $30 listing (100 times)", () => run({ shot: { amount: 3000, currency: "USD" }, lensPrice: "$30.00" })],
  ["photo: $0.50 asking against a $30 listing (60 times the other way)", () => run({ shot: { amount: 0.5, currency: "USD" }, lensPrice: "$30.00" })],
  ["link: a $3,000 page against a $30 listing", () => run({ scannedPage: page({ price: "3000.00", currency: "USD" }), lensPrice: "$30.00" }, "link")],
  ["link: a $0.50 page against a $30 listing", () => run({ scannedPage: page({ price: "0.50", currency: "USD" }), lensPrice: "$30.00" }, "link")],
]) {
  const r = await run_();
  check(`${label}: the cheapest-link card with the note, no verdict`, noted(r), describe(r));
}
{
  const r = await run({ shot: { amount: 120, currency: "USD" }, lensPrice: "$30.00" });
  check("control: $120 against $30 (4 times) is still a verdict, with no note", r.mode === "VERDICT" && !r.priceNote, describe(r));
}

console.error = quiet;
console.log(`\n${failures === 0 ? "All price checks passed." : `${failures} price check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
