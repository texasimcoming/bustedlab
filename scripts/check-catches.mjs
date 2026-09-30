/**
 * "WHAT WE CATCH" CHECK. The landing page shows real ledger records in that
 * section only once there are enough of them, and only records that are
 * genuine, independent, verified measurements. Everything else keeps the
 * labelled illustrative set. This runs the real leaderboard route against the
 * emulated Upstash in scripts/lib/harness.mjs:
 *
 *   node --experimental-strip-types --no-warnings scripts/check-catches.mjs
 */
import { importSrc, env, reset, call, check, section, finish } from "./lib/harness.mjs";

const lib = await importSrc("lib/redis.ts");
const leaderboard = await importSrc("app/api/leaderboard/route.ts");
const { REAL_CATCHES_MINIMUM } = await importSrc("content/catches.ts");

let clock = Date.now() - 60 * 60 * 1000;
async function scan(n, { retail = 50 + n * 10, wholesale = 5, product = `p${n}`, cached = false, match = "exact", category = "beauty" } = {}) {
  const id = `r${n}-${Math.random().toString(16).slice(2, 8)}`;
  await lib.recordScan({
    id, ts: (clock += 1000), title: `Product ${product}`, category,
    retailPrice: retail, wholesalePrice: wholesale,
    markup: Math.round(((retail - wholesale) / wholesale) * 100), savings: retail - wholesale,
    verdict: "HIGH_MARKUP", confidence: "high", matchConfidence: match,
    platform: "shopify", sourceUrl: `https://shop.example/${product}`, imageUrl: `https://img.example/${product}.jpg`,
    productKey: product, cached,
  });
  return id;
}
const catches = async () => (await call(leaderboard.GET, "/api/leaderboard")).json.catches;

section("BELOW THE MINIMUM, THE PAGE KEEPS ITS ILLUSTRATIVE SET");
env(); reset();
check("the minimum is eight", REAL_CATCHES_MINIMUM === 8, String(REAL_CATCHES_MINIMUM));
let r = await catches();
check("an empty ledger sends no catches", Array.isArray(r) && r.length === 0, JSON.stringify(r));
for (let n = 1; n <= 7; n++) await scan(n);
r = await catches();
check("seven qualifying products send none, not seven", r.length === 0, `${r.length}`);

section("AT EIGHT, THE REAL RECORDS, BIGGEST SAVING FIRST");
const eighth = await scan(8, { retail: 20 });
r = await catches();
check("eight qualifying products send all eight", r.length === 8, `${r.length}`);
check("ranked by saving, largest first", r.every((c, i) => i === 0 || r[i - 1].savings >= c.savings),
      r.map(c => c.savings).join(", "));
check("the smallest saving is last", r.at(-1).id === eighth, r.at(-1).id);
check("each carries its record id, so it links to /scan/[id]",
      await Promise.all(r.map(c => lib.getScanRecord(c.id))).then(recs => recs.every(Boolean)));
check("and only the fields The Index already shows",
      r.every(c => Object.keys(c).sort().join() === "category,id,retailPrice,savings,title,wholesalePrice"),
      Object.keys(r[0]).join());
check("no source URL, image, platform or product key leaves the server",
      !JSON.stringify(r).match(/shop\.example|img\.example|shopify|"p\d+"/));

for (let n = 9; n <= 12; n++) await scan(n);
r = await catches();
check("more than eight still sends eight", r.length === 8, `${r.length}`);
check("the eight biggest", r.map(c => c.title).join() ===
      [12, 11, 10, 9, 7, 6, 5, 4].map(n => `Product p${n}`).join(), r.map(c => c.title).join());

section("WHAT NEVER COUNTS TOWARD THE EIGHT");
env(); reset();
for (let n = 1; n <= 7; n++) await scan(n);
await scan(8, { cached: true });
check("a cached repeat is not an independent measurement", (await catches()).length === 0);
await scan(8, { match: "unverified" });
check("a match the engine marked unverified does not count", (await catches()).length === 0);
await scan(8, { retail: 5, wholesale: 5 });
check("a record with no saving does not count", (await catches()).length === 0);
await scan(9, { product: "p1", retail: 900 });
r = await catches();
check("a second scan of a product already shown does not make it two products", r.length === 0, `${r.length}`);
await scan(8, { match: "likely" });
r = await catches();
check("a likely match does count, and completes the eight", r.length === 8, `${r.length}`);
check("a product scanned twice shows once, at its largest measured saving",
      r.filter(c => c.title === "Product p1").length === 1 && r[0].title === "Product p1" && r[0].savings === 895,
      JSON.stringify(r[0]));

section("A LEDGER OUTAGE FALLS BACK, IT DOES NOT BREAK THE PAGE");
const { redis } = await import("./lib/harness.mjs");
redis.down = true;
const down = await call(leaderboard.GET, "/api/leaderboard");
check("the board still answers, with no catches", down.status === 200 && Array.isArray(down.json.catches) &&
      down.json.catches.length === 0, `${down.status}`);
redis.down = false;

finish("what-we-catch");
