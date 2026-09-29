/**
 * CONTENT CHECK. Words the product cannot back must not reach a card, a
 * caption or a toast, and a name from the illustrative quotes must never turn
 * up as "live" activity. These are combined at random per scan or per toast,
 * so one bad line in a pool is eventually printed on somebody's card.
 *
 *   node --experimental-strip-types --no-warnings scripts/check-content.mjs
 */
import { importSrc, check, section, finish } from "./lib/harness.mjs";

const { TOAST_FIRST_NAMES } = await importSrc("content/toast-names.ts");
const { REACTIONS } = await importSrc("content/reactions.ts");
const copy = await importSrc("lib/verdict-copy.ts");

// ════════════════════════════════════════════════════════════════
section("TOAST NAMES ARE NOT THE QUOTE NAMES");

const quoteNames = REACTIONS.quotes.map(q => q.name.split(" ")[0].toLowerCase());
const clash = TOAST_FIRST_NAMES.filter(n => quoteNames.includes(n.toLowerCase()));
check("no toast first name is a first name from the reactions", clash.length === 0, clash.join(", "));
check("the pool is still large enough to feel random", TOAST_FIRST_NAMES.length >= 35, String(TOAST_FIRST_NAMES.length));

// ════════════════════════════════════════════════════════════════
section("THE CLOSEST-MATCH LINE CLAIMS ONLY WHAT WAS FOUND");

// A closest match is not confirmed identical (the card says so under the line),
// so none of these can be backed: verified, confirmed, the floor, the lowest
// available, in stock, a measurement rather than an estimate.
const UNBACKED = /verif|confirm|floor|not a guess|target|locked|in stock|real (figure|number)|guesswork|will not find|as low as|not an estimate|measurement/i;
const pools = copy.finderPools("11.49", "temu.com");
const lines = [...pools.openers, ...pools.connectors, ...pools.closers];
const bad = lines.filter(l => UNBACKED.test(l));
check("no line in any of the three pools makes an unbacked claim", bad.length === 0, bad.join(" | "));
check("pools keep their size (8 x 6 x 6 = 288 combinations)",
      pools.openers.length === 8 && pools.connectors.length === 6 && pools.closers.length === 6);

let combos = 0, missing = 0;
for (let cents = 100; cents < 100 + 8; cents++) {
  for (const title of ["a", "ab", "abc", "abcd", "abcde", "abcdef"]) {
    for (const platform of ["a.com", "ab.com", "abc.com", "abcd.com", "abcde.com", "abcdef.com"]) {
      const line = copy.buildFinderMessage({ verdict: "UNVERIFIED", retailPrice: 0, wholesalePrice: cents / 100, markup: 0, savings: 0, productTitle: title, platform });
      combos++;
      if (!line.includes(`$${(cents / 100).toFixed(2)}`) || !line.includes(platform) || UNBACKED.test(line)) missing++;
    }
  }
}
check("every assembled line carries the real price and platform and nothing unbacked", missing === 0, `${missing} of ${combos}`);

// ════════════════════════════════════════════════════════════════
section("THE EVIDENCE STRIP AGREES WITH THE LINE UNDER IT");

for (const confidence of ["likely", "unverified"]) {
  const plate = copy.plateLabel("FINDER", confidence);
  const note = copy.evidenceNote("FINDER", confidence);
  check(`closest match (${confidence}): the label says neither confirmed nor verified`, !/confirm|verif/i.test(plate), plate);
  check(`closest match (${confidence}): the line under it still says the item is not confirmed`, /Exact item not confirmed/.test(note), note);
}
check("closest match that is an exact match says so on both lines",
      copy.plateLabel("FINDER", "exact") === "EXACT MATCH" && !/not confirmed/.test(copy.evidenceNote("FINDER", "exact")),
      copy.evidenceNote("FINDER", "exact"));
check("verdict card, exact match: EXACT MATCH", copy.plateLabel("VERDICT", "exact") === "EXACT MATCH");
check("no label anywhere says PIXEL-MATCH VERIFIED",
      ["VERDICT", "FINDER"].every(m => ["exact", "likely", "unverified"].every(c => !/PIXEL-MATCH VERIFIED/.test(copy.plateLabel(m, c)))));

// ════════════════════════════════════════════════════════════════
section("VERDICT LINES DO NOT ASSERT COSTS OR SHIPPING");

// Every line of every verdict pool: idx = (savings*100 + retail*7 + markup*3) % 20,
// so stepping savings by a cent walks through all twenty.
const verdictLines = new Set();
for (const verdict of ["HIGH_MARKUP", "OVERPRICED", "FAIR"]) {
  for (let cents = 1000; cents < 1020; cents++) {
    verdictLines.add(copy.buildMessage({ verdict, retailPrice: 50, wholesalePrice: 5, markup: 900, savings: cents / 100, productTitle: "x" }));
  }
}
const asserts = [...verdictLines].filter(l => /actually costs|ships from|warehouse/i.test(l));
check("all 60 verdict lines reached", verdictLines.size === 60, String(verdictLines.size));
check("none says what the item actually costs or where it ships from", asserts.length === 0, asserts.join(" | "));

// ════════════════════════════════════════════════════════════════
section("THE SHARE CAPTION");

const busted = copy.shareCaption({ mode: "VERDICT", savings: 64.88, markup: 2079, wholesalePrice: 3.12, hasPermalink: true });
check("does not call the result verified", !/verif/i.test(busted), busted);
check("leads with the dollar gap, then the markup", busted.startsWith("$64.88 above market") && busted.includes("2079% markup"), busted);
check("introduces the permanent link when there is one", busted.endsWith("Receipts:"), busted);
const noLink = copy.shareCaption({ mode: "VERDICT", savings: 64.88, markup: 2079, wholesalePrice: 3.12, hasPermalink: false });
check("and does not promise receipts when there is no permanent record", !noLink.includes("Receipts"), noLink);
const finder = copy.shareCaption({ mode: "FINDER", savings: 0, markup: 0, wholesalePrice: 11.49, hasPermalink: true });
check("a closest match is captioned as the closest listing", finder.includes("Closest listing found: $11.49"), finder);

finish("content");
