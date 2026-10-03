/**
 * "WRONG PRODUCT? TELL US". One tap under a result records, against the scan
 * it was shown for, the scan id, the result's mode and match confidence and
 * the time: nothing about the person. One report per scan counts, the route
 * is rate limited, the list is bounded, and /api/stats counts them. The link
 * sits outside the card, so it never appears in a saved or shared image.
 *
 *   node --experimental-strip-types --no-warnings scripts/check-wrong-product.mjs
 */
import { readFileSync } from "node:fs";
import { importSrc, env, reset, call, redis, check, section, finish } from "./lib/harness.mjs";

const TOKEN = "wrong-product-operator-token-0123";
const route = await importSrc("app/api/wrong-product/route.ts");
const stats = await importSrc("app/api/stats/route.ts");
const BROWSER = "ab".repeat(16);
const report = (body, { ip = "203.0.113.7", browser = BROWSER } = {}) => call(route.POST, "/api/wrong-product", {
  method: "POST", body: JSON.stringify(body),
  headers: { "content-type": "application/json", "x-forwarded-for": ip }, cookies: browser ? { bl_bid: browser } : {},
});
const total = () => Number(redis.peek("stat:wrong_product:total") || 0);
const recent = () => (redis.peek("stat:wrong_product:recent") || []).map(e => JSON.parse(e));

section("A REPORT");
env({ ANALYTICS_TOKEN: TOKEN }); reset();
const first = await report({ scanId: "muq0qsdh30e5c684a68a1959f81360e3", mode: "FINDER", confidence: "exact" });
check("answers 204", first.status === 204);
check("is counted once, by mode and confidence", total() === 1 && redis.peek("stat:wrong_product:by:FINDER:exact") === "1");
const [entry] = recent();
check("records only the scan id, mode, confidence and time",
  JSON.stringify(Object.keys(entry).sort()) === JSON.stringify(["at", "confidence", "mode", "scanId"]), JSON.stringify(entry));
check("no address, browser id or hash of either is in what is recorded",
  !JSON.stringify(redis.peek("stat:wrong_product:recent")).includes("203.0.113.7") && !JSON.stringify(redis.peek("stat:wrong_product:recent")).includes(BROWSER));
await report({ scanId: "muq0qsdh30e5c684a68a1959f81360e3", mode: "FINDER", confidence: "exact" });
check("a second report for the same scan does not count again", total() === 1);

section("WHAT IS REFUSED");
for (const [label, body] of [
  ["an unknown mode", { scanId: "abcdefgh12345678", mode: "SOMETHING", confidence: "exact" }],
  ["an unknown confidence", { scanId: "abcdefgh12345679", mode: "VERDICT", confidence: "certain" }],
  ["a scan id that is not one", { scanId: "../../etc/passwd", mode: "VERDICT", confidence: "exact" }],
  ["no body", null],
]) {
  const before = total();
  const res = await report(body);
  check(`${label}: 204, nothing recorded`, res.status === 204 && total() === before);
}
reset();
for (let i = 0; i < 14; i++) await report({ scanId: `ratelimit${String(i).padStart(4, "0")}`, mode: "VERDICT", confidence: "likely" });
check("past ten reports an hour from one browser, the rest are dropped", total() === 10, String(total()));
await report({ scanId: "otherbrowser0001", mode: "VERDICT", confidence: "likely" }, { browser: "cd".repeat(16) });
check("another browser on the same address still counts", total() === 11, String(total()));
for (let i = 0; i < 520; i++) await report({ scanId: `bounded${String(i).padStart(5, "0")}`, mode: "UNRESOLVED", confidence: "unverified" }, { ip: `198.51.100.${i % 250}`, browser: null });
check("the list of reports is bounded at 500, newest kept", recent().length === 500 && recent()[0].scanId === "bounded00519", String(recent().length));

section("COUNTED IN /api/stats");
{
  const res = await call(stats.GET, "/api/stats", { headers: { authorization: `Bearer ${TOKEN}` } });
  const wp = res.json?.wrongProduct;
  check("/api/stats reports the window and lifetime counts and the split by result",
    res.status === 200 && wp?.total === total() && wp?.windowTotal === total() && wp?.byResult?.["VERDICT likely"] === 11 && wp?.byResult?.["UNRESOLVED unverified"] === 520, JSON.stringify(wp)?.slice(0, 300));
}

section("WHERE THE LINK IS");
{
  const page = readFileSync(new URL("../src/components/ResultsPage.tsx", import.meta.url), "utf8");
  const card = readFileSync(new URL("../src/components/VerdictCard.tsx", import.meta.url), "utf8");
  const scan = readFileSync(new URL("../src/app/api/scan/route.ts", import.meta.url), "utf8");
  const link = page.lastIndexOf("Wrong product? Tell us");
  const cardEnd = page.indexOf("cardRef={cardRef} sound />");
  check("the results page carries the link, after the card element", link > 0 && cardEnd > 0 && link > cardEnd);
  check("the card itself (what is saved and shared) does not", !card.includes("Wrong product"));
  check("it is shown for every result type: not inside the unresolved/resolved branch", link < page.indexOf("{isUnresolved ? ("));
  check("every completed scan answer carries a reference to report against", /scanRef: scanId \|\| newScanId\(\)/.test(scan));
}

finish("wrong-product");
