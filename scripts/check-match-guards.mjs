/**
 * MATCH GUARDS, AGAINST EVERY STORED LABELLED RESULT. $0: reads files only.
 *
 *   node --experimental-strip-types --no-warnings scripts/check-match-guards.mjs
 *
 * Runs the shipped guards (src/lib/match-guards.ts) over every "exact" and
 * "likely" the gate gave in the production evaluation's stored runs
 * (evals/results/run-*.json), judges each listing by the case's identity
 * (evals/cases.json, through scripts/lib/labels.mjs), and prints which guard
 * holds each wrong answer and which right answers each guard costs.
 *
 * What it can and cannot settle offline. Runs 2 to 5 recorded the gate's
 * answer and its reason but no tie (the gate began naming one with this
 * change), so the no_tie guard cannot be applied to them. A wrong answer
 * that the brand, no-brand and part guards (and the listing-host filter) do
 * not hold is PENDING: it is settled only by a replay of the same candidates
 * on the current gate (a run that records replay.answers). Once any replay
 * is stored, every pending answer must be covered by one and held by it;
 * until then the pending ones are listed, and their number may not grow.
 *
 * Also: unit cases for each guard, and the listing-host list must match the
 * one in src/lib/scan.ts.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { carriesBrand, isPartListing, readTie, guardMatch, missingModelWords, reasonSaysNotForSale } from "../src/lib/match-guards.ts";
import { isRightProduct, isListing, NON_LISTING_HOSTS, storedAnswers } from "./lib/labels.mjs";

const REPO = resolve(dirname(new URL(import.meta.url).pathname), "..");
const RESULTS = resolve(REPO, "evals/results");
const CASES = JSON.parse(readFileSync(resolve(REPO, "evals/cases.json"), "utf8")).cases;
// Retired: its Commons "photo" turned out to be a digital painting that is
// sold as a print, so "exact" on the print was right and the stored WRONG
// labels are void (see mary-rose-spoon in evals/cases.json).
const RETIRED = new Set(["carved-spoon"]);
// The gate's prompt by run: run 2 spoke three answers (exact / similar /
// different, "similar" shown as likely); PR #6 brought the four answers runs
// 3 and 5 used; replays from run 6 name a tie.
const era = (row) => (row.source === "replay" ? "tie" : row.run <= 2 ? "old" : "four");
// How many wrong answers no offline guard holds, per era, when this check was
// written: the Cult Flex gun in run 5, and run 2's answers on pages that sell
// nothing. These may only shrink.
const PENDING_BASELINE = { old: 0, four: 0 };

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `\n      ${detail}` : ""}`);
  if (!ok) failures++;
};

// ── The guards on their own ────────────────────────────────────────────────
console.log("GUARDS");
for (const [brand, listing, want] of [
  ["Ray-Ban", { title: "Rayban RB2140 Original Wayfarer" }, true],
  ["Ray-Ban", { title: "ray ban new wayfarer classic" }, true],
  ["Stanley 1913", { title: "STANLEY QUENCHER 40OZ - Tooth of Time Traders" }, true],
  ["Stanley", { title: "Quencher Tumbler 40oz", link: "https://www.stanley1913.com/products/quencher" }, true],
  ["Apple", { title: "AirPods Pro (2nd generation)", source: "Apple" }, true],
  ["LG", { title: "LG OLED C3 65 inch TV" }, true],
  ["LG", { title: "Bulgaria travel adapter" }, false],
  ["Flowlife", { title: "TOLOCO Massage Gun Deep Tissue" }, false],
  ["Peach Beauty", { title: "Jade Roller & Gua Sha Set", source: "Bol.com" }, false],
]) {
  check(`brand "${brand}" ${want ? "is" : "is not"} carried by "${listing.title}"${listing.link ? ` (${listing.link})` : ""}`, carriesBrand(brand, listing) === want);
}
const PAIR = { brand: "Apple", productName: "Apple AirPods Pro wireless earbuds with silicone ear tips" };
for (const [title, read, want] of [
  ["Original Apple AirPods Pro - LEFT Side AirPods Only (A2084) OEM", PAIR, true],
  ["Apple Airpods Pro Earbud 1st Gen. Left Ear Only A2084 Untested As-is", PAIR, true],
  ["Apple AirPods Pro 1st Gen Replacement – Left, Right or Charging Case", PAIR, true],
  ["Charging Case Only for AirPods Pro", PAIR, true],
  ["Apple AirPods Pro (2nd generation) with MagSafe Charging Case", PAIR, false],
  ["Original Apple AirPods Pro - LEFT Side Only (A2084)", { brand: "Apple", productName: "a single left AirPods Pro earbud" }, false],
  ["Charging Case Only for AirPods Pro", { brand: "Apple", productName: "charging case for AirPods Pro" }, false],
  ["Replacement Brush Head for Sonicare, 4 pack", { brand: "Philips", productName: "replacement brush heads for Sonicare" }, false],
  ["Silicone Basting Brush 9\" Kitchen Cooking", { brand: "", productName: "red silicone basting brush" }, false],
  ["Nintendo Switch OLED Model with Neon Red & Neon Blue Joy-Con", { brand: "Nintendo", productName: "Nintendo Switch OLED Model console" }, false],
]) {
  check(`"${title}" ${want ? "is" : "is not"} a part listing for "${read.productName}"`, isPartListing({ title }, read) === want);
}
for (const [title, read, want] of [
  ["Nintendo Switch With Docking Station, Charger, HDMI 55GB | eBay", { brand: "Nintendo", productName: "Nintendo Switch OLED Model console" }, ["oled"]],
  ["Nintendo Switch OLED Model with Neon Red & Neon Blue Joy-Con", { brand: "Nintendo", productName: "Nintendo Switch OLED Model console" }, []],
  ["STANLEY QUENCHER 40OZ - Tooth of Time Traders", { brand: "Stanley", productName: "Quencher H2.0 FlowState Tumbler | 1.18L" }, []],
  ["Ray Ban New Wayfarer RB 2132 Black", { brand: "Ray-Ban", productName: "Ray-Ban New Wayfarer sunglasses (RB2132)" }, []],
  ["Apple AirPods (3rd generation)", { brand: "Apple", productName: "Apple AirPods Pro wireless earbuds" }, ["pro"]],
  ["Silicone Basting Brush 9\" Kitchen", { brand: "", productName: "mini silicone basting brush" }, []],
]) {
  const got = missingModelWords({ title }, read);
  check(`"${title}" for "${read.productName}" lacks ${want.length ? want.join(", ") : "no model word"}`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
}
check("the gate's own words that a page sells nothing are read as such",
  reasonSaysNotForSale("Identical photo of the holder, but it's a health-site article, not a product listing") &&
  reasonSaysNotForSale("Review page, not a product listing") && reasonSaysNotForSale("blog post, not for sale") &&
  !reasonSaysNotForSale("Same compact T-shaped black gun: round ball head, side panel with dot indicators") &&
  !reasonSaysNotForSale("Cult Flex gun: same black body, round head and side control panel; title doesn't contradict"));
check("a tie is read as one of its kinds, anything else as none",
  readTie("logo") === "logo" && readTie(" Photo ") === "photo" && readTie("shape") === "none" && readTie(undefined) === "none");
{
  const listing = { title: "Generic Mini Massage Gun", source: "Walmart" };
  const noBrand = { brand: "", productName: "black mini massage gun" };
  check("no brand read: a likely is held as no_brand_likely", guardMatch({ match: "likely", tie: "part" }, listing, noBrand).guard === "no_brand_likely");
  check("no brand read: an exact with a tie stands", guardMatch({ match: "exact", tie: "photo" }, listing, noBrand).match === "exact");
  check("an exact with tie none is held as no_tie", guardMatch({ match: "exact", tie: "none" }, listing, noBrand).guard === "no_tie");
  check("a brand read and not carried: held as brand_veto", guardMatch({ match: "exact", tie: "logo" }, listing, { brand: "Flowlife", productName: "" }).guard === "brand_veto");
  check("an exact whose own reason calls the page an article: held as not_for_sale",
    guardMatch({ match: "exact", tie: "photo", why: "Identical photo, but it's a health-site article, not a product listing" }, listing, noBrand).guard === "not_for_sale");
  check("a listing without the model the photo names: held as model_missing",
    guardMatch({ match: "likely", tie: "part" }, { title: "Nintendo Switch With Docking Station" }, { brand: "Nintendo", productName: "Nintendo Switch OLED Model" }).guard === "model_missing");
  check("no first read at all (a link scan): the brand rules do not apply", guardMatch({ match: "likely", tie: "part" }, listing, { productName: "mini massage gun" }).match === "likely");
  check("an answer recorded before ties existed is not held for lacking one", guardMatch({ match: "exact" }, listing, noBrand).match === "exact");
  check("similar and different are never changed",
    guardMatch({ match: "similar", tie: "none" }, listing, noBrand).match === "similar" && guardMatch({ match: "different" }, listing, noBrand).match === "different");
}
{
  const scan = readFileSync(resolve(REPO, "src/lib/scan.ts"), "utf8");
  const block = scan.match(/const NON_LISTING_HOSTS = \[([\s\S]*?)\];/);
  const engineHosts = block ? [...block[1].matchAll(/"([^"]+)"/g)].map(m => m[1]) : [];
  check("the labels' listing-host list is the engine's", JSON.stringify(engineHosts) === JSON.stringify(NON_LISTING_HOSTS),
    `engine: ${engineHosts.join(", ")}`);
}

// ── Every stored answer ───────────────────────────────────────────────────
const runs = readdirSync(RESULTS).map(f => f.match(/^run-(\d+)\.json$/)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
const claims = (m) => m === "exact" || m === "likely";
const answered = storedAnswers(RESULTS, runs)
  .filter(r => !RETIRED.has(r.caseId))
  .map(r => ({ ...r, c: CASES.find(c => c.id === r.caseId) }))
  .filter(r => r.c && r.read);
const keyOf = (r) => `${r.caseId} ${String(r.listing.link || r.listing.title).toLowerCase()}`;
for (const r of answered) {
  r.right = isRightProduct(r.c, r.listing);
  r.host = !isListing(r.listing.link);
  r.a = !!r.read.brand && !carriesBrand(r.read.brand, r.listing);
  r.b = !r.read.brand && r.gate === "likely";
  r.d = isPartListing(r.listing, r.read);
  // What the engine now does with this answer. For a replay, recomputed from
  // the gate's own answer and tie, and compared with what was recorded.
  r.after = guardMatch({ match: r.gate, tie: r.source === "replay" ? r.tie : undefined, why: r.why }, r.listing, r.read);
  r.held = r.host || !claims(r.after.match);
}
const rows = answered.filter(r => claims(r.gate));
const replays = rows.filter(r => r.source === "replay");
// Every candidate the current gate judged again, whatever it answered: a
// replay that now says "similar" settles a stored wrong "exact" as surely as
// a guard does. A call that failed (unjudged) settles nothing.
const replayed = new Map(answered
  .filter(r => r.source === "replay" && ["exact", "likely", "similar", "different"].includes(r.gate))
  .map(r => [keyOf(r), r]));
const LATER = { not_for_sale: "not-for-sale", model_missing: "model", no_tie: "tie" };
const caughtBy = (r) => [r.host && "host", r.a && "brand", r.b && "no-brand", r.d && "part", LATER[r.after.guard]].filter(Boolean).join("+") || "none";
const fmt = (r) => `${era(r).padEnd(4)} r${r.run} ${`${r.caseId}/${r.intent || "-"}`.padEnd(32)} ${r.purpose.padEnd(16)} ${r.gate.toUpperCase().padEnd(6)} ` +
  `"${r.listing.title.slice(0, 64)}" | brand read "${r.read.brand}" | held by: ${caughtBy(r)}`;

console.log("\nWRONG PRODUCTS THE GATE CALLED EXACT OR LIKELY");
const wrong = rows.filter(r => !r.right && r.source === "scan");
const pending = { old: [], four: [] };
for (const r of wrong) {
  let status = r.held ? "held" : "PENDING";
  if (!r.held) {
    const rep = replayed.get(keyOf(r));
    if (rep) status = !rep.held ? "NOT HELD ON REPLAY" : claims(rep.gate) ? `held on replay (${caughtBy(rep)})` : `the gate now says ${rep.gate}`;
    else pending[era(r)].push(r);
  }
  console.log(`  [${status}] ${fmt(r)}`);
}
for (const r of replays.filter(r => !r.right)) console.log(`  [replay ${r.held ? "held" : "NOT HELD"}] ${fmt(r)}`);

console.log("\nRIGHT PRODUCTS A GUARD WOULD HOLD (what the tighter rules cost)");
const lost = rows.filter(r => r.right && r.held && !r.host);
for (const r of lost) console.log(`  ${fmt(r)}`);
if (lost.length === 0) console.log("  none");

// Case by case, for every case a replay covered: did any right listing come
// back as a match before (the stored scans, the gate's own answers), and does
// one now (the replay, after the shipped guards)?
if (replays.length > 0) {
  console.log("\nRECALL, CASE BY CASE (replayed cases): a right listing claimed before -> now");
  const best = (list) => (list.some(r => r.right && r.gate === "exact") ? "exact" : list.some(r => r.right && r.gate === "likely") ? "likely" : "none");
  const bestNow = (list) => (list.some(r => r.right && r.after.match === "exact" && !r.host) ? "exact" : list.some(r => r.right && r.after.match === "likely" && !r.host) ? "likely" : "none");
  for (const caseId of [...new Set(replays.map(r => r.caseId).concat(answered.filter(r => r.source === "replay").map(r => r.caseId)))]) {
    const before = best(rows.filter(r => r.caseId === caseId && r.source === "scan" && !r.host));
    const now = bestNow(rows.filter(r => r.caseId === caseId && r.source === "replay"));
    console.log(`  ${caseId.padEnd(24)} ${before.padEnd(7)} -> ${now}${before !== "none" && now === "none" ? "   (lost)" : ""}`);
  }
}

console.log("");
check("every wrong answer on the current gate is held, or pending a replay",
  wrong.filter(r => era(r) === "four" && !r.held).every(r => !replayed.has(keyOf(r)) || replayed.get(keyOf(r)).held));
for (const e of ["old", "four"]) {
  check(`pending wrong answers (${e} prompt) did not grow: ${pending[e].length} <= ${PENDING_BASELINE[e]}`, pending[e].length <= PENDING_BASELINE[e]);
}
check("no wrong answer survives a replay", replays.filter(r => !r.right).every(r => r.held),
  replays.filter(r => !r.right && !r.held).map(fmt).join("\n      "));
// A replay recorded what the guards of its day decided; the shipped guards
// may only be stricter since, never laxer.
check("no replay answer the guards held then passes the shipped guards now", replays.every(r => claims(r.match) || !claims(r.after.match)),
  replays.filter(r => !claims(r.match) && claims(r.after.match)).map(r => `${fmt(r)}: recorded ${r.match}, guards say ${r.after.match}`).join("\n      "));
if (replays.length > 0) {
  const uncovered = [...pending.old, ...pending.four];
  check("once replays are stored, every pending wrong answer has been replayed", uncovered.length === 0, uncovered.map(fmt).join("\n      "));
} else {
  console.log(`NOTE  ${pending.old.length + pending.four.length} wrong answer(s) are pending a replay on the current gate; no replay is stored yet.`);
}

console.log(`\n${rows.filter(r => r.source === "scan").length} stored exact/likely answers, ${wrong.length} wrong; ${replays.length} replayed; ${lost.length} right answer(s) held.`);
if (failures > 0) {
  console.error(`${failures} match guard check(s) failed.`);
  process.exit(1);
}
console.log("All match guard checks passed.");
