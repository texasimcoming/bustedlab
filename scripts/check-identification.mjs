/**
 * IDENTIFICATION GUARD.
 *
 * Runs the REAL scan engine (src/lib/scan.ts, imports rewritten so it loads
 * outside Next) against mocked Google Lens, Shopping and direct-retailer
 * responses, and asserts that the product in the photo is the product that
 * comes back.
 *
 * Both scenarios below are the two failures reported from real use: a photo
 * of Ralph Lauren eyeglasses that came back as an unrelated brand, and a
 * photo of an Under Armour military-style bag that came back as a different
 * Under Armour bag. Google Lens identified both correctly and immediately.
 *
 * Each scenario runs twice: once against the current engine and once against
 * the pre-fix engine in scripts/fixtures/scan.pre-v10.ts.txt. The pre-fix run is
 * not decoration - a test that only passes on the new code cannot show that
 * the old code was broken, and "this would have failed before" is the claim
 * being made. The pre-fix engine is expected to FAIL both scenarios, and this
 * script fails if it ever starts passing them, because that would mean the
 * fixture no longer contains the bug it exists to document.
 *
 *   node --experimental-strip-types --no-warnings scripts/check-identification.mjs
 *
 * No network access and no API keys: every fetch the engine makes is served
 * from the tables below. Candidate images are served as bytes that encode
 * their own URL, so the mocked verification gate can answer deterministically
 * for a specific product photo rather than by position.
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = resolve(dirname(new URL(import.meta.url).pathname), "..");
const VERDICT_URL = pathToFileURL(join(REPO, "src/lib/verdict.ts")).href;

// ════════════════════════════════════════════════════════════════
// Loading the engine outside Next: three import specifiers Node cannot
// resolve on its own get rewritten. Nothing else about the file is touched,
// so what runs here is the shipped logic, not a copy of it.
// ════════════════════════════════════════════════════════════════
const BLOB_STUB = `const put = async (path) => ({ url: "https://blob.test/" + path });
const del = async () => {};`;

const localModule = (name) => pathToFileURL(join(REPO, `src/lib/${name}.ts`)).href;

async function loadEngine(sourcePath, label) {
  let src = readFileSync(sourcePath, "utf8");
  const required = [
    ['import { put, del } from "@vercel/blob";', BLOB_STUB],
    ['import { randomBytes } from "crypto";', 'import { randomBytes } from "node:crypto";'],
    ['import { LENS_BLOB_PREFIX } from "@/lib/constants";', 'const LENS_BLOB_PREFIX = "lens-scans/";'],
    ['import { calculateVerdict } from "@/lib/verdict";', `import { calculateVerdict } from "${VERDICT_URL}";`],
  ];
  for (const [from, to] of required) {
    if (!src.includes(from)) throw new Error(`${label}: cannot rewrite missing import: ${from}`);
    src = src.replace(from, to);
  }
  // Every remaining "@/lib/x" import is rewritten to the real file, rather
  // than each one being listed here by hand. The hand-written list was a
  // maintenance trap: adding a module to the engine broke this suite with a
  // "cannot find package @/lib" that has nothing to do with what changed.
  // The guard below is still worth keeping for alias forms this does not
  // cover, and it fires with the name of the offender rather than a stack
  // trace from the module loader.
  src = src.replace(
    /from "@\/lib\/([a-z0-9-]+)"/g,
    (_match, name) => `from "${localModule(name)}"`
  );
  const unresolved = src.match(/from "@\/[a-z0-9/-]+"/g);
  if (unresolved) {
    throw new Error(
      `${label}: these imports need a rewrite rule in loadEngine: ${[...new Set(unresolved)].join(", ")}`
    );
  }
  const dir = mkdtempSync(join(tmpdir(), "bustedlab-ident-"));
  const file = join(dir, `${label}.ts`);
  writeFileSync(file, src, "utf8");
  return import(pathToFileURL(file).href);
}

// ════════════════════════════════════════════════════════════════
// SCENARIO 1 - Ralph Lauren eyeglasses, "where is it cheapest?" intent.
//
// The correct product is the top visual match Google returned and it carries
// NO PRICE, which is routine: it is the brand's own product page. A plausible
// wrong product - same category, no brand marking, cheapest thing in the
// response - sits below it WITH a price. A correct, cheaper listing also
// exists at a major retailer.
// ════════════════════════════════════════════════════════════════
const POLO = "Polo Ralph Lauren PH2083 Eyeglasses";

const SCENARIO_GLASSES = {
  name: "Ralph Lauren eyeglasses (correct match unpriced)",
  intent: "finder",
  // With the Amazon/Walmart/eBay sweep switched on (RETAILER_SWEEP=1), which
  // is where the cheapest verified price comes from. The budget-mode default,
  // sweep off, is SCENARIO_GLASSES_NO_SWEEP.
  retailerSweep: true,
  vision: {
    productName: "eyeglasses", brand: "Ralph Lauren", visiblePrice: null, currency: "USD",
    quantity: "", category: "accessories", platform: "instagram", storeName: "", visibleUrl: "",
    priceConfidence: "none", imageQuality: "good",
  },
  // Google Lens visual_matches, in the order Google returned them.
  lens: [
    // rank 0 - THE CORRECT PRODUCT. No price: it is ralphlauren.com's own page.
    { title: `${POLO} - Shiny Black`, source: "ralphlauren.com", link: "https://www.ralphlauren.com/ph2083", thumbnail: "https://img.test/correct-polo" },
    { title: "Polo Ralph Lauren PH1117 Aviator", source: "eyewearblog.com", link: "https://eyewearblog.com/ph1117", thumbnail: "https://img.test/blog-polo" },
    { title: "Oakley Holbrook RX Eyeglasses", source: "oakley.com", link: "https://www.oakley.com/holbrook-rx", thumbnail: "https://img.test/oakley", price: { value: "$89.00", extracted_value: 89.0, currency: "$" } },
    // rank 3 - THE DECOY. Same category, cheapest priced row in the response.
    { title: "Zenni Optical Rectangle Frames 4438821", source: "zennioptical.com", link: "https://www.zennioptical.com/4438821", thumbnail: "https://img.test/zenni", price: { value: "$29.95", extracted_value: 29.95, currency: "$" } },
    { title: "Ray-Ban RX5154 Clubmaster", source: "ray-ban.com", link: "https://www.ray-ban.com/rx5154", thumbnail: "https://img.test/rayban", price: { value: "$149.00", extracted_value: 149.0, currency: "$" } },
    { title: "Warby Parker Percey Eyeglasses", source: "warbyparker.com", link: "https://www.warbyparker.com/percey", thumbnail: "https://img.test/warby", price: { value: "$95.00", extracted_value: 95.0, currency: "$" } },
  ],
  shopping: (q) => {
    const query = q.toLowerCase();
    if (query.includes("ph2083")) {
      return [
        { title: `${POLO} Shiny Black 5001`, source: "FramesDirect", link: "https://www.framesdirect.com/polo-ph2083", imageUrl: "https://img.test/correct-polo-priced", price: "$118.00" },
        { title: `${POLO} Shiny Black Frame`, source: "EyewearHut", link: "https://www.eyewearhut.com/ph2083", imageUrl: "https://img.test/correct-polo-priced2", price: "$135.00" },
      ];
    }
    // The rebrand layer's brand-stripped query. A cheap generic that is not
    // this product, which must not be able to displace a confirmed match.
    if (query.includes("eyeglasses")) {
      return [{ title: "Generic Reading Glasses Rectangle Eyeglasses accessories", source: "Cheapo", link: "https://cheapo.test/readers", imageUrl: "https://img.test/generic-readers", price: "$12.99" }];
    }
    return [];
  },
  amazon: (q) => {
    const query = q.toLowerCase();
    if (query.includes("ph2083") || query.includes("ralph lauren")) {
      return [{ title: `${POLO} Shiny Black Frame 54mm`, link: "https://www.amazon.com/dp/B07POLO", thumbnail: "https://img.test/correct-polo-amazon", extracted_price: 99.0, asin: "B07POLO" }];
    }
    return [];
  },
  verdicts: {
    "https://img.test/correct-polo": "exact",
    "https://img.test/correct-polo-priced": "exact",
    "https://img.test/correct-polo-priced2": "exact",
    "https://img.test/correct-polo-amazon": "exact",
    "https://img.test/blog-polo": "similar",
    "https://img.test/zenni": "similar",
    "https://img.test/oakley": "different",
    "https://img.test/rayban": "different",
    "https://img.test/warby": "different",
    "https://img.test/generic-readers": "different",
  },
  // What a correct engine must return: the product in the photo, at the
  // cheapest price anyone could verify for it.
  expect: { titleIncludes: "PH2083", price: 99.0, confidence: "exact", platform: "Amazon" },
  // What the pre-fix engine returns instead.
  expectPreFix: { titleIncludes: "Zenni", price: 29.95, confidence: "likely" },
};

// ════════════════════════════════════════════════════════════════
// SCENARIO 2 - Under Armour military-style bag, "where is it cheapest?".
//
// Here the correct product DOES carry a price, so the price filter is not
// what loses it. It is the eighth visual match, and it is not the cheapest:
// a different Under Armour bag is. Price-first ordering buries it outside the
// verification window, and the wrong bag - same brand, wrong model - wins.
// ════════════════════════════════════════════════════════════════
const UA_CORRECT = "Under Armour Tactical Range Bag 2.0 Military Duffle";
const UA_DECOY = "Under Armour Project Rock Regiment Backpack";

const SCENARIO_BAG = {
  name: "Under Armour bag (correct match priced, but not cheapest)",
  intent: "finder",
  vision: {
    productName: "military style duffle bag", brand: "Under Armour", visiblePrice: null,
    currency: "USD", quantity: "", category: "accessories", platform: "tiktok", storeName: "",
    visibleUrl: "", priceConfidence: "none", imageQuality: "good",
  },
  lens: [
    { title: UA_DECOY, source: "underarmour.com", link: "https://www.underarmour.com/project-rock-regiment", thumbnail: "https://img.test/ua-projectrock", price: { value: "$34.99", extracted_value: 34.99, currency: "$" } },
    { title: "Under Armour Hustle 5.0 Backpack", source: "underarmour.com", link: "https://www.underarmour.com/hustle-5", thumbnail: "https://img.test/ua-hustle", price: { value: "$54.99", extracted_value: 54.99, currency: "$" } },
    { title: "Under Armour Contain Duo Duffle", source: "dickssportinggoods.com", link: "https://www.dickssportinggoods.com/contain-duo", thumbnail: "https://img.test/ua-containduo", price: { value: "$79.99", extracted_value: 79.99, currency: "$" } },
    { title: "Under Armour Triumph Sport Backpack", source: "underarmour.com", link: "https://www.underarmour.com/triumph-sport", thumbnail: "https://img.test/ua-triumph", price: { value: "$64.99", extracted_value: 64.99, currency: "$" } },
    { title: "Under Armour Undeniable 5.0 Duffle Small", source: "academy.com", link: "https://www.academy.com/undeniable-5", thumbnail: "https://img.test/ua-undeniable", price: { value: "$44.99", extracted_value: 44.99, currency: "$" } },
    { title: "Under Armour Storm Tactical Patrol Pack", source: "underarmour.com", link: "https://www.underarmour.com/storm-patrol", thumbnail: "https://img.test/ua-storm", price: { value: "$129.99", extracted_value: 129.99, currency: "$" } },
    { title: "Under Armour Camo Duffle Bag", source: "walmart.com", link: "https://www.walmart.com/ua-camo-duffle", thumbnail: "https://img.test/ua-camo", price: { value: "$99.99", extracted_value: 99.99, currency: "$" } },
    // rank 7 - THE CORRECT PRODUCT. Priced, and the sixth-cheapest of eight.
    { title: UA_CORRECT, source: "underarmour.com", link: "https://www.underarmour.com/tactical-range-bag-2", thumbnail: "https://img.test/ua-correct", price: { value: "$89.99", extracted_value: 89.99, currency: "$" } },
  ],
  shopping: (q) => {
    if (q.toLowerCase().includes("duffle") || q.toLowerCase().includes("military")) {
      return [{ title: "Generic Military Style Duffle Bag accessories", source: "Cheapo", link: "https://cheapo.test/duffle", imageUrl: "https://img.test/generic-duffle", price: "$19.99" }];
    }
    return [];
  },
  amazon: () => [],
  verdicts: {
    "https://img.test/ua-correct": "exact",
    "https://img.test/ua-projectrock": "similar",
    "https://img.test/ua-hustle": "different",
    "https://img.test/ua-containduo": "different",
    "https://img.test/ua-triumph": "different",
    "https://img.test/ua-undeniable": "different",
    "https://img.test/ua-storm": "different",
    "https://img.test/ua-camo": "different",
    "https://img.test/generic-duffle": "different",
  },
  expect: { titleIncludes: "Tactical Range Bag", price: 89.99, confidence: "exact", platform: "underarmour.com" },
  expectPreFix: { titleIncludes: "Project Rock", price: 34.99, confidence: "likely" },
};

// ════════════════════════════════════════════════════════════════
// SCENARIO 3 - nothing in the response is the product in the photo.
//
// The honesty guard. A genuinely unidentified match must stay labeled
// unverified; it must never be quietly upgraded so the card can say
// "VISUAL MATCH" about something nobody matched. What changes
// with the fix is only WHICH candidate gets shown alongside that honest
// label: the engine's own best guess, rather than whatever happened to be
// cheapest. Vision reads nothing off this photo, so no identity hints are
// available and the engine's ordering stands on its own.
// ════════════════════════════════════════════════════════════════
const SCENARIO_NO_MATCH = {
  name: "Nothing verifies (honesty guard)",
  intent: "verdict",
  vision: {
    productName: "", brand: "", visiblePrice: null, currency: "USD", quantity: "",
    category: "other", platform: "unknown", storeName: "", visibleUrl: "",
    priceConfidence: "none", imageQuality: "poor",
  },
  lens: [
    { title: "Alpha Cordless Drill 18V", source: "alpha.test", link: "https://alpha.test/drill", thumbnail: "https://img.test/alpha", price: { value: "$75.00", extracted_value: 75.0, currency: "$" } },
    { title: "Beta Impact Driver", source: "beta.test", link: "https://beta.test/driver", thumbnail: "https://img.test/beta", price: { value: "$52.00", extracted_value: 52.0, currency: "$" } },
    { title: "Gamma Socket Set", source: "gamma.test", link: "https://gamma.test/sockets", thumbnail: "https://img.test/gamma", price: { value: "$31.00", extracted_value: 31.0, currency: "$" } },
    { title: "Zeta Novelty Keychain", source: "zeta.test", link: "https://zeta.test/keychain", thumbnail: "https://img.test/zeta", price: { value: "$9.99", extracted_value: 9.99, currency: "$" } },
  ],
  shopping: () => [],
  amazon: () => [],
  verdicts: {
    "https://img.test/alpha": "different",
    "https://img.test/beta": "different",
    "https://img.test/gamma": "different",
    "https://img.test/zeta": "different",
  },
  expect: { titleIncludes: "Alpha Cordless Drill", price: 75.0, confidence: "unverified", mode: "FINDER" },
  expectPreFix: { titleIncludes: "Zeta Novelty Keychain", price: 9.99, confidence: "unverified" },
};

// ════════════════════════════════════════════════════════════════
// SCENARIO 4 - the product is identified and has no price anywhere.
//
// Only reachable because unpriced visual matches now survive to the gate.
// The gate confirms the product, the pricing search finds nothing, and the
// correct outcome is no result - NOT a category-average estimate hung off
// a real merchant link. A fabricated number behind a real link is the one
// failure mode worse than admitting nothing was found.
// ════════════════════════════════════════════════════════════════
const SCENARIO_UNPRICEABLE = {
  name: "Identified, priceable nowhere (no-fabrication guard)",
  intent: "finder",
  guardOnly: true,
  vision: {
    productName: "handmade ceramic vase", brand: "", visiblePrice: null, currency: "USD",
    quantity: "", category: "home", platform: "instagram", storeName: "", visibleUrl: "",
    priceConfidence: "none", imageQuality: "good",
  },
  lens: [
    { title: "Handmade Ceramic Vase - studio piece", source: "studio.test", link: "https://studio.test/vase", thumbnail: "https://img.test/vase-correct" },
    { title: "Ceramic Vase Gallery Feature", source: "gallery.test", link: "https://gallery.test/feature", thumbnail: "https://img.test/vase-gallery" },
  ],
  shopping: () => [],
  amazon: () => [],
  verdicts: {
    "https://img.test/vase-correct": "exact",
    "https://img.test/vase-gallery": "similar",
  },
  expect: { titleIncludes: "not identified", price: 0, mode: "UNRESOLVED", found: false },
};

// ════════════════════════════════════════════════════════════════
// SCENARIO 5 - the same fix, on the "am I being overcharged?" intent.
//
// There must be no asymmetry between the two intents, because both rest on
// the same identification. Here a price is visible in the screenshot, so a
// confirmed VERDICT is possible. The correct product is Lens's top match
// and carries no price; a different, cheaper product sits below it WITH
// one. The pre-fix engine prices the wrong product: it reports a $20.99
// gap against a $59 massager that is not the item in the photo. The real
// product wholesales at $23.50 - a 240% markup and a $56.49 gap - so the
// pre-fix answer understates the overcharge by $35.50 while sounding just
// as certain about it.
// ════════════════════════════════════════════════════════════════
const SCENARIO_VERDICT = {
  name: "Verdict intent: correct product, correct markup",
  intent: "verdict",
  vision: {
    productName: "percussion massage gun", brand: "ProSculpt", visiblePrice: 79.99,
    currency: "USD", quantity: "", category: "fitness", platform: "tiktok", storeName: "",
    visibleUrl: "", priceConfidence: "visible", imageQuality: "good",
  },
  lens: [
    { title: "ProSculpt Percussion Massage Gun T5", source: "prosculpt.test", link: "https://prosculpt.test/t5", thumbnail: "https://img.test/gun-correct" },
    { title: "Rival Deep Tissue Muscle Massager", source: "rival.test", link: "https://rival.test/massager", thumbnail: "https://img.test/gun-rival", price: { value: "$59.00", extracted_value: 59.0, currency: "$" } },
    { title: "FitPro Mini Massage Ball", source: "fitpro.test", link: "https://fitpro.test/ball", thumbnail: "https://img.test/gun-ball", price: { value: "$14.00", extracted_value: 14.0, currency: "$" } },
  ],
  shopping: (q) => {
    if (q.toLowerCase().includes("prosculpt")) {
      return [{ title: "ProSculpt Percussion Massage Gun T5 handheld", source: "AliExpress", link: "https://www.aliexpress.com/item/t5", imageUrl: "https://img.test/gun-correct-priced", price: "$23.50" }];
    }
    return [];
  },
  amazon: () => [],
  verdicts: {
    "https://img.test/gun-correct": "exact",
    "https://img.test/gun-correct-priced": "exact",
    "https://img.test/gun-rival": "similar",
    "https://img.test/gun-ball": "different",
  },
  expect: { titleIncludes: "ProSculpt", price: 23.5, confidence: "exact", mode: "VERDICT", verdict: "HIGH_MARKUP", retail: 79.99 },
  expectPreFix: { titleIncludes: "Rival", price: 59.0, confidence: "likely", mode: "VERDICT", verdict: "OVERPRICED" },
};

// ════════════════════════════════════════════════════════════════
// SCENARIO 6 - nothing is confirmed, two things are plausibly it.
//
// The "likely" tier must not be decided on price. Google's best match is
// plausibly the product but unconfirmable (a stock photo); a cheaper one the
// gate also calls plausible sits seven places below it. With identity
// unconfirmed, the engine's own ranking is the only real evidence, and a
// cheaper candidate further down the list is not a better price - it is a
// likelier wrong product wearing a smaller number. The pre-fix engine takes
// the cheap one. (The gate's answer for "plausibly this product" was called
// "similar" until the four-level scale; see gate-prompt.ts.)
// ════════════════════════════════════════════════════════════════
const SCENARIO_SIMILAR_TIER = {
  name: "Unconfirmed tier is decided on rank, not price",
  intent: "finder",
  // A brand read off the photo, and carried by both plausible listings: with
  // no brand read, the match guards hold every "likely" to a lookalike (see
  // SCENARIO_ESCALATION), and this tier would not exist to be decided.
  vision: {
    productName: "linen midi dress", brand: "Linenworks", visiblePrice: null, currency: "USD",
    quantity: "", category: "fashion", platform: "instagram", storeName: "", visibleUrl: "",
    priceConfidence: "none", imageQuality: "good",
  },
  lens: [
    { title: "Linenworks Sand-Washed Linen Midi Dress", source: "studiolinen.test", link: "https://studiolinen.test/midi", thumbnail: "https://img.test/dress-ranked", price: { value: "$60.00", extracted_value: 60.0, currency: "$" } },
    { title: "Cotton Poplin Shirt Dress", source: "a.test", link: "https://a.test/poplin", thumbnail: "https://img.test/dress-a", price: { value: "$48.00", extracted_value: 48.0, currency: "$" } },
    { title: "Pleated Satin Slip Dress", source: "b.test", link: "https://b.test/satin", thumbnail: "https://img.test/dress-b", price: { value: "$72.00", extracted_value: 72.0, currency: "$" } },
    { title: "Ribbed Knit Bodycon Dress", source: "c.test", link: "https://c.test/ribbed", thumbnail: "https://img.test/dress-c", price: { value: "$39.00", extracted_value: 39.0, currency: "$" } },
    { title: "Tiered Cotton Maxi Dress", source: "d.test", link: "https://d.test/tiered", thumbnail: "https://img.test/dress-d", price: { value: "$55.00", extracted_value: 55.0, currency: "$" } },
    { title: "Wrap Front Jersey Dress", source: "e.test", link: "https://e.test/wrap", thumbnail: "https://img.test/dress-e", price: { value: "$44.00", extracted_value: 44.0, currency: "$" } },
    { title: "Sleeveless Shift Dress", source: "f.test", link: "https://f.test/shift", thumbnail: "https://img.test/dress-f", price: { value: "$66.00", extracted_value: 66.0, currency: "$" } },
    // rank 7 - cheapest, and only a lookalike.
    { title: "Linenworks Linen Look Midi Dress, Fast Fashion Copy", source: "g.test", link: "https://g.test/lookalike", thumbnail: "https://img.test/dress-cheap", price: { value: "$19.00", extracted_value: 19.0, currency: "$" } },
  ],
  shopping: () => [],
  amazon: () => [],
  verdicts: {
    "https://img.test/dress-ranked": "likely",
    "https://img.test/dress-cheap": "likely",
    "https://img.test/dress-a": "different",
    "https://img.test/dress-b": "different",
    "https://img.test/dress-c": "different",
    "https://img.test/dress-d": "different",
    "https://img.test/dress-e": "different",
    "https://img.test/dress-f": "different",
  },
  expect: { titleIncludes: "Sand-Washed Linen", price: 60.0, confidence: "likely", mode: "FINDER" },
  expectPreFix: { titleIncludes: "Fast Fashion", price: 19.0, confidence: "likely" },
};

// ════════════════════════════════════════════════════════════════
// SCENARIO 7 - the same product, photographed by a second person.
//
// The cost lever that matters during a viral spike. One product, two
// different photos, minutes apart. The first scan pays for a full
// identification; the second must reuse it - same answer, and not one call
// to the strong model. The two photos are different files, so the byte-keyed
// scan cache in redis.ts cannot help here; this is the Lens-fingerprint
// cache doing the work.
// ════════════════════════════════════════════════════════════════
const SCENARIO_SPIKE = {
  ...SCENARIO_GLASSES,
  name: "Second person photographs the same product (identity cache)",
  kind: "spike",
  expect: { titleIncludes: "PH2083", price: 99.0, confidence: "exact", platform: "Amazon" },
  expectPreFix: null,
  guardOnly: true,
  expectStats: (stats) => {
    const problems = [];
    if (stats.opusGateCalls !== 0) {
      problems.push(`the strong model ran ${stats.opusGateCalls} time(s); a reused identification must not need it`);
    }
    if (stats.gateCalls !== 1) {
      problems.push(`${stats.gateCalls} gate call(s); a reused identification takes exactly one confirmation`);
    }
    return problems;
  },
};

// ════════════════════════════════════════════════════════════════
// SCENARIO 8 - the day's model budget is gone.
//
// Degraded mode. The engine must still identify the product correctly and
// still answer, on the cheap model, without claiming the strongest label it
// no longer has the evidence for. It must never simply fail: a viral spike
// that exhausts the budget should cost the product its strongest claim, not
// its ability to answer.
// ════════════════════════════════════════════════════════════════
const SCENARIO_DEGRADED = {
  ...SCENARIO_GLASSES,
  name: "Budget spent: degraded mode still identifies correctly",
  spendToday: 10_000,
  // Correct product, priced by the identify-then-price search. "likely"
  // rather than "exact" because the cheap gate is not allowed to claim a
  // pixel match, and $118 rather than $99 because the direct-retailer sweep
  // is one of the enhancements degraded mode gives up.
  expect: { titleIncludes: "PH2083", price: 118.0, confidence: "likely", mode: "FINDER" },
  expectPreFix: null,
  guardOnly: true,
  expectStats: (stats) => {
    const problems = [];
    if (stats.opusGateCalls !== 0) {
      problems.push(`the strong model ran ${stats.opusGateCalls} time(s) after the budget was spent`);
    }
    if (stats.gateCalls === 0) problems.push("the gate never ran, so nothing was identified at all");
    return problems;
  },
};

// ════════════════════════════════════════════════════════════════
// SCENARIO 9 and 10 - the gate's answer arrives broken.
//
// These exist because batching moved the cost of a malformed answer. With
// one call per candidate, a truncated reply cost one candidate; with one
// call per wave it would cost six, and a correct identification would be
// lost to a formatting accident rather than to a judgement. Both scenarios
// use the glasses case, where the correct product is the first candidate in
// the wave, and both must still reach the same answer a clean run reaches.
// ════════════════════════════════════════════════════════════════
const SCENARIO_TRUNCATED = {
  ...SCENARIO_GLASSES,
  name: "Gate answer truncated mid-array (salvage guard)",
  fault: { kind: "truncate", calls: 1 },
  guardOnly: true,
  expect: { titleIncludes: "PH2083", price: 99.0, confidence: "exact", platform: "Amazon" },
  expectPreFix: null,
};

const SCENARIO_CALL_FAILS = {
  ...SCENARIO_GLASSES,
  name: "First gate call fails outright (retry guard)",
  fault: { kind: "fail", calls: 1 },
  guardOnly: true,
  expect: { titleIncludes: "PH2083", price: 99.0, confidence: "exact", platform: "Amazon" },
  expectPreFix: null,
  expectStats: (stats) => {
    // A clean run of this scenario takes three gate calls (wave one, the
    // pricing search, and the rebrand and retailer pools judged together).
    // The failed one must be retried, not absorbed as "different" verdicts.
    if (stats.gateCalls !== 4) {
      return [`${stats.gateCalls} gate call(s); expected 4 (three plus one retry)`];
    }
    return [];
  },
};


// ════════════════════════════════════════════════════════════════
// FROM THE PRODUCTION EVALUATION (evals/results/run-2.md). Each of these is
// a real failure the labelled set caught, reduced to the shape that caused
// it. guardOnly: the pre-v10 fixture predates them, so there is no recorded
// pre-fix behaviour to compare against.
// ════════════════════════════════════════════════════════════════

// A handmade raku pitcher that exists nowhere online came back as a LIKELY
// match to a different raku pitcher on eBay, because the gate's "same kind
// of product" answer was reported as likely. A lookalike is a lookalike.
const SCENARIO_LOOKALIKE = {
  name: "A lookalike is never a likely match",
  intent: "finder",
  guardOnly: true,
  vision: {
    productName: "raku fired ceramic pitcher with copper glaze", brand: "", visiblePrice: null, currency: "",
    quantity: "", category: "home", platform: "unknown", storeName: "", visibleUrl: "",
    priceConfidence: "none", imageQuality: "good",
  },
  lens: [
    { title: "Raku Pottery Pitcher - Iridescent Glaze Pottery Pitcher", source: "eBay", link: "https://www.ebay.test/itm/raku", thumbnail: "https://img.test/raku-other", price: { value: "$32.50", extracted_value: 32.5, currency: "$" } },
    { title: "Studio Art Pottery Jug", source: "etsy.test", link: "https://etsy.test/jug", thumbnail: "https://img.test/jug-other", price: { value: "$48.00", extracted_value: 48.0, currency: "$" } },
  ],
  shopping: () => [],
  amazon: () => [],
  verdicts: {
    "https://img.test/raku-other": "similar",
    "https://img.test/jug-other": "different",
  },
  expect: { titleIncludes: "Raku Pottery Pitcher", price: 32.5, confidence: "unverified", mode: "FINDER" },
  // Serper answers every text search here with nothing. SerpApi's Shopping
  // fallback is for when Serper FAILS, not a second opinion on an empty
  // answer: in production it timed out at 12 seconds on all 19 such calls.
  expectStats: (stats) => (stats.serpapiShoppingCalls > 0
    ? [`SerpApi Shopping was called ${stats.serpapiShoppingCalls} time(s) after Serper had answered`] : []),
};

// A photo of Crocs that news sites and Wikipedia had published: Lens
// answered with the articles, the gate called them "exact" (the same
// picture), and the engine searched for a price using a USA Today headline.
// Now a page on a host that never sells anything is not judged at all, the
// gate rules out an article by its title, and the vision read ("Crocs Baya
// clog") identifies the product by text.
const SCENARIO_REUSED_PHOTO = {
  name: "A photo reused by articles is identified by what it shows",
  intent: "finder",
  guardOnly: true,
  vision: {
    productName: "Crocs Baya clog with heel strap", brand: "Crocs", visiblePrice: null, currency: "",
    quantity: "", category: "fashion", platform: "unknown", storeName: "", visibleUrl: "",
    priceConfidence: "none", imageQuality: "good",
  },
  lens: [
    { title: "Crocs closing its last manufacturing plant, says it's still ...", source: "USA Today", link: "https://news.test/crocs-plant", thumbnail: "https://img.test/news-crocs" },
    { title: "Crocs - Wikipedia", source: "Wikipedia", link: "https://en.wikipedia.org/wiki/Crocs", thumbnail: "https://img.test/wiki-crocs" },
    { title: "Classic Clog", source: "crocs.test", link: "https://crocs.test/classic", thumbnail: "https://img.test/crocs-classic", price: { value: "$49.99", extracted_value: 49.99, currency: "$" } },
  ],
  shopping: (q) => (/baya/i.test(q)
    ? [{ title: "Crocs Adult Baya Clog", source: "Walmart", link: "https://walmart.test/baya", imageUrl: "https://img.test/crocs-baya", price: "$34.99" }]
    : []),
  amazon: () => [],
  verdicts: {
    "https://img.test/news-crocs": "different",
    "https://img.test/crocs-classic": "similar",
    "https://img.test/crocs-baya": "likely",
  },
  expect: { titleIncludes: "Baya", price: 34.99, confidence: "likely", mode: "FINDER" },
  expectStats: (stats) => [
    ...(stats.verified.some(v => v.includes("wiki-crocs"))
      ? ["the Wikipedia page was sent to the gate; a page on a host that sells nothing must not be"] : []),
  ],
};

// A Flowlife massage gun: Lens found the brand's own product page, the gate
// confirmed it, and Lens had no price for it, as is usual for a brand's
// store. The pricing search found nothing (the brand is barely in the US
// index), so the scan said "Product not identified" about a product it had
// identified. The page states its price in its structured data.
const SCENARIO_PRICED_FROM_PAGE = {
  name: "An identified listing without a price is priced from its own page",
  intent: "finder",
  guardOnly: true,
  vision: {
    productName: "black mini percussion massage gun", brand: "", visiblePrice: null, currency: "",
    quantity: "", category: "fitness", platform: "unknown", storeName: "", visibleUrl: "",
    priceConfidence: "none", imageQuality: "good",
  },
  lens: [
    { title: "Flowgun Air – Lightweight Percussive Massage Gun | Flowlife", source: "Flowlife", link: "https://flowlife.test/en-GB/product/flowgun-air", thumbnail: "https://img.test/flowgun-air" },
    { title: "Opove M3 Pro 2 Massage Gun", source: "Amazon.com", link: "https://amazon.test/opove", thumbnail: "https://img.test/opove", price: { value: "$69.99", extracted_value: 69.99, currency: "$" } },
  ],
  pages: {
    "https://flowlife.test/en-GB/product/flowgun-air":
      '<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Flowgun Air","offers":{"@type":"Offer","price":"99.00","priceCurrency":"GBP"}}</script></head><body></body></html>',
  },
  shopping: () => [],
  amazon: () => [],
  verdicts: {
    "https://img.test/flowgun-air": "exact",
    "https://img.test/opove": "different",
  },
  // 99 GBP at the mocked 0.75 GBP per USD.
  expect: { titleIncludes: "Flowgun Air", price: 132, confidence: "exact", mode: "FINDER" },
};

// A supermarket gua sha set, identified, then every search for a cheaper
// copy timed out: the scan answered "could not be completed" because a
// price search was treated as if it had been identifying the product.
const SCENARIO_PRICE_SEARCH_DOWN = {
  name: "A price search failing after identification does not fail the scan",
  intent: "verdict",
  guardOnly: true,
  vision: {
    productName: "jade roller and gua sha set", brand: "", visiblePrice: null, currency: "",
    quantity: "", category: "beauty", platform: "unknown", storeName: "", visibleUrl: "",
    priceConfidence: "none", imageQuality: "good",
  },
  lens: [
    { title: "Jade Roller & Gua Sha Set", source: "beauty.test", link: "https://beauty.test/set", thumbnail: "https://img.test/gua-sha" },
  ],
  shoppingDown: true,
  shopping: () => [],
  amazon: () => [],
  verdicts: { "https://img.test/gua-sha": "exact" },
  expect: { titleIncludes: "not identified", price: 0, mode: "UNRESOLVED", failure: false },
};


// The Flowlife gun again, from run 3: the confirmed record Lens returned was
// a store that will not be read (Galaxus), and the brand's own page, also
// confirmed exact, was never tried. Every confirmed listing in the tier is a
// candidate for the price, best-ranked first, and the one that prices
// becomes the record.
const SCENARIO_TIER_PAGE_PRICE = {
  name: "Any confirmed listing's own page can price the product",
  intent: "finder",
  guardOnly: true,
  vision: {
    productName: "black mini percussion massage gun", brand: "", visiblePrice: null, currency: "",
    quantity: "", category: "fitness", platform: "unknown", storeName: "", visibleUrl: "",
    priceConfidence: "none", imageQuality: "good",
  },
  lens: [
    { title: "Flowlife Flowgun Air - buy at Galaxus", source: "galaxus.test", link: "https://galaxus.test/flowgun-air", thumbnail: "https://img.test/galaxus" },
    { title: "Flowgun Air – Lightweight Percussive Massage Gun | Flowlife", source: "Flowlife", link: "https://flowlife.test/en-GB/product/flowgun-air", thumbnail: "https://img.test/flowgun-air" },
  ],
  pages: {
    "https://galaxus.test/flowgun-air": 403,
    "https://flowlife.test/en-GB/product/flowgun-air":
      '<html><head><script type="application/ld+json">{"@type":"Product","name":"Flowgun Air","offers":{"price":"99.00","priceCurrency":"GBP"}}</script></head></html>',
  },
  shopping: () => [],
  amazon: () => [],
  verdicts: { "https://img.test/galaxus": "exact", "https://img.test/flowgun-air": "exact" },
  expect: { titleIncludes: "Lightweight Percussive", price: 132, confidence: "exact", mode: "FINDER" },
};

// A Norpro basting brush, from run 3: confirmed exact on the maker's
// wholesale page, which states no price; the pricing search found the same
// model in blue, which the gate rightly called "likely". That used to be
// thrown away and the scan said "not identified". It is now shown as what
// it is: a likely match, at that listing's price.
const SCENARIO_LIKELY_PRICE = {
  name: "An exact identity only a likely listing can price is shown as likely",
  intent: "finder",
  guardOnly: true,
  vision: {
    productName: "red silicone basting brush with clear handle", brand: "Norpro", visiblePrice: null, currency: "",
    quantity: "", category: "home", platform: "unknown", storeName: "", visibleUrl: "",
    priceConfidence: "none", imageQuality: "good",
  },
  lens: [
    { title: "2018R SILICONE BASTING / PASTRY BRUSH-RED - Norpro, Inc.", source: "Norpro Wholesale", link: "https://norpro.test/2018r", thumbnail: "https://img.test/norpro-red" },
  ],
  shopping: (q) => (/basting/i.test(q)
    ? [{ title: "Norpro Silicone Basting/Pastry Brush 2018 Blue", source: "Target", link: "https://target.test/norpro-blue", imageUrl: "https://img.test/norpro-blue", price: "$4.99" }]
    : []),
  amazon: () => [],
  verdicts: { "https://img.test/norpro-red": "exact", "https://img.test/norpro-blue": "likely" },
  expect: { titleIncludes: "Norpro Silicone Basting/Pastry Brush 2018 Blue", price: 4.99, confidence: "likely", mode: "FINDER" },
};

// A windshield tablet holder, from run 3: the retailer sweep kept only the
// retailer whose cheapest row was cheapest (eBay, unrelated) and threw away
// the Amazon page that carried the product, before the gate saw either.
// The same eyeglasses with budget mode's default: no retailer sweep. The
// identification is the same; the price is the identified listing's own.
const SCENARIO_GLASSES_NO_SWEEP = {
  ...SCENARIO_GLASSES,
  name: "Ralph Lauren eyeglasses, budget mode: no retailer sweep, still identified exactly",
  guardOnly: true,
  retailerSweep: false,
  expect: { titleIncludes: "PH2083", price: 118.0, confidence: "exact", platform: "FramesDirect" },
  expectStats: (stats) => (stats.retailerCalls > 0
    ? [`the retailer sweep ran ${stats.retailerCalls} SerpApi search(es) with RETAILER_SWEEP unset`] : []),
};

const SCENARIO_RETAILER_POOLS = {
  name: "The retailer sweep is judged across retailers, not decided by the cheapest pool",
  intent: "finder",
  guardOnly: true,
  // The sweep is off by default (budget mode); this is the switched-on path.
  retailerSweep: true,
  vision: {
    productName: "windshield suction tablet holder with gooseneck arm", brand: "WAOCEO", visiblePrice: null, currency: "",
    quantity: "", category: "tech", platform: "unknown", storeName: "", visibleUrl: "",
    priceConfidence: "none", imageQuality: "good",
  },
  lens: [
    { title: "WAOCEO Tablet Holder Car Mount for Windshield", source: "Amazon.co.uk", link: "https://amazon.test/uk/waoceo", thumbnail: "https://img.test/waoceo-uk", price: { value: "$45.00", extracted_value: 45.0, currency: "$" } },
  ],
  shopping: () => [],
  amazon: () => [{ title: "WAOCEO Tablet Holder Car Mount for Windshield, Gooseneck", link: "https://amazon.test/waoceo", thumbnail: "https://img.test/waoceo-us", extracted_price: 27.99 }],
  ebay: () => [{ title: "WAOCEO windshield tablet holder car mount gooseneck", link: "https://ebay.test/cheap-mount", thumbnail: "https://img.test/cheap-mount", price: { extracted: 9.99 } }],
  verdicts: {
    "https://img.test/waoceo-uk": "exact",
    "https://img.test/waoceo-us": "exact",
    "https://img.test/cheap-mount": "different",
  },
  expect: { titleIncludes: "WAOCEO Tablet Holder Car Mount for Windshield, Gooseneck", price: 27.99, confidence: "exact", mode: "FINDER" },
};

// ════════════════════════════════════════════════════════════════
// MATCH GUARDS AND THE SERPAPI ESCALATION: the production evaluation's own
// failures (run 5). A Flowlife Flowgun Air whose photo shows no brand:
// Serper's Lens brought only other brands' guns, the gate called two of them
// "likely" and a Cult Flex gun "exact" on shape alone. The guards hold all
// three to lookalikes (no brand read: "likely" is not a match; no tie: not
// "exact" either), and with nothing verified, SerpApi's Lens is asked once:
// its exact-image match, the brand's own page, is the product.
// ════════════════════════════════════════════════════════════════
const FLOWGUN_LOOKALIKES = [
  { title: "MVPmini 5 in 1 Percussion Massager with Carrying Case", source: "Walmart", link: "https://walmart.test/mvpmini", thumbnail: "https://img.test/mvpmini", price: { value: "$39.99", extracted_value: 39.99, currency: "$" } },
  { title: "Playmakar MVP Mini Percussion Massage Gun MVP-500", source: "eBay", link: "https://ebay.test/playmakar", thumbnail: "https://img.test/playmakar", price: { value: "$29.99", extracted_value: 29.99, currency: "$" } },
  { title: "Cult Flex Portable Deep Tissue Massage Gun", source: "cultstore.test", link: "https://cultstore.test/flex", thumbnail: "https://img.test/cult-flex", price: { value: "$49.99", extracted_value: 49.99, currency: "$" } },
];
const SCENARIO_ESCALATION = {
  name: "No brand read and only lookalikes on Serper: the guards hold them, SerpApi's Lens finds the product",
  intent: "finder",
  guardOnly: true,
  vision: {
    productName: "black mini percussion massage gun with ball head", brand: "", visiblePrice: null, currency: "",
    quantity: "", category: "fitness", platform: "unknown", storeName: "", visibleUrl: "",
    priceConfidence: "none", imageQuality: "good",
  },
  lens: FLOWGUN_LOOKALIKES,
  // SerpApi returns the same lookalikes again (judged once, not twice) and
  // Google's exact-image match ahead of them.
  serpapiExact: [
    { title: "Flowgun Air – Lightweight Percussive Massage Gun | Flowlife", source: "Flowlife", link: "https://flowlife.test/flowgun-air", thumbnail: "https://img.test/flowgun-air", price: { value: "$89.00", extracted_value: 89.0, currency: "$" } },
  ],
  serpapiLens: FLOWGUN_LOOKALIKES,
  shopping: () => [],
  amazon: () => [],
  verdicts: {
    "https://img.test/mvpmini": "likely",
    "https://img.test/playmakar": "likely",
    "https://img.test/cult-flex": "exact",
    "https://img.test/flowgun-air": "exact",
  },
  ties: { "https://img.test/cult-flex": "none", "https://img.test/flowgun-air": "photo" },
  expect: { titleIncludes: "Flowgun Air", price: 89.0, confidence: "exact", mode: "FINDER", engineIncludes: "escalated_serpapi" },
  expectStats: (stats) => [
    ...(stats.serpapiLensCalls !== 1 ? [`SerpApi's Lens ran ${stats.serpapiLensCalls} time(s); the escalation asks it exactly once`] : []),
    ...(stats.verified.filter(v => v.includes("cult-flex")).length !== 1 ? ["a listing both providers returned was judged twice"] : []),
  ],
};

// The same scan with SerpApi at its reserve: no escalation, and the honest
// answer is the best-ranked lookalike (the engine ranks the listing sharing
// most words with the read first), labelled as one. Never the Cult Flex gun
// as "exact".
const SCENARIO_ESCALATION_HELD = {
  ...SCENARIO_ESCALATION,
  name: "The same scan with SerpApi at its reserve: no escalation, an honest lookalike",
  serpapiLeft: 20,
  expect: { titleIncludes: "Playmakar", price: 29.99, confidence: "unverified", mode: "FINDER" },
  expectStats: (stats) => (stats.serpapiLensCalls > 0 ? [`SerpApi's Lens ran ${stats.serpapiLensCalls} time(s) at its reserve`] : []),
};

// And with SerpApi's balance unknown (its account lookup failing): an
// unknown balance is not a balance above the reserve.
const SCENARIO_ESCALATION_UNKNOWN = {
  ...SCENARIO_ESCALATION_HELD,
  name: "The same scan with SerpApi's balance unknown: no escalation",
  serpapiLeft: null,
  expectStats: (stats) => [
    ...(stats.serpapiLensCalls > 0 ? [`SerpApi's Lens ran ${stats.serpapiLensCalls} time(s) with its balance unknown`] : []),
    ...(stats.serpapiAccountLookups === 0 ? ["the balance was never looked up"] : []),
  ],
};

// And on a degraded day (the model budget spent): no escalation either.
const SCENARIO_ESCALATION_DEGRADED = {
  ...SCENARIO_ESCALATION_HELD,
  name: "The same scan on a degraded day: no escalation, an honest lookalike",
  serpapiLeft: 200,
  spendToday: 10_000,
  expectStats: (stats) => (stats.serpapiLensCalls > 0 ? [`SerpApi's Lens ran ${stats.serpapiLensCalls} time(s) on a degraded day`] : []),
};

// A brand read off the photo vetoes another brand's listing, and a listing
// for one earbud is not the pair in the photo, whatever the gate answered.
// (Run 5: the gate called four "LEFT Side Only" AirPods listings "likely".)
const SCENARIO_BRAND_AND_PART = {
  name: "Another brand's listing and a single-earbud listing are never a match",
  intent: "finder",
  guardOnly: true,
  vision: {
    productName: "Apple AirPods Pro wireless earbuds", brand: "Apple", visiblePrice: null, currency: "",
    quantity: "", category: "tech", platform: "unknown", storeName: "", visibleUrl: "",
    priceConfidence: "none", imageQuality: "good",
  },
  lens: [
    { title: "Original Apple AirPods Pro - LEFT Side Only (A2084)", source: "eBay", link: "https://ebay.test/left-only", thumbnail: "https://img.test/left-only", price: { value: "$41.29", extracted_value: 41.29, currency: "$" } },
    { title: "TWS Pro Wireless Earbuds with Noise Cancelling", source: "Temu", link: "https://temu.test/tws-pro", thumbnail: "https://img.test/tws-pro", price: { value: "$12.99", extracted_value: 12.99, currency: "$" } },
    { title: "Apple AirPods Pro (2nd generation) with MagSafe Case", source: "Best Buy", link: "https://bestbuy.test/airpods-pro-2", thumbnail: "https://img.test/airpods-pro-2", price: { value: "$189.99", extracted_value: 189.99, currency: "$" } },
  ],
  shopping: () => [],
  amazon: () => [],
  verdicts: {
    "https://img.test/left-only": "exact",
    "https://img.test/tws-pro": "exact",
    "https://img.test/airpods-pro-2": "exact",
  },
  ties: { "https://img.test/left-only": "part", "https://img.test/tws-pro": "part", "https://img.test/airpods-pro-2": "logo" },
  expect: { titleIncludes: "AirPods Pro (2nd generation)", price: 189.99, confidence: "exact", mode: "FINDER" },
};

// The run 6 replay: shown a health-site article that reused the photo, the
// gate wrote "it's a health-site article, not a product listing" and still
// answered "exact". Its own reason holds the answer, and with SerpApi at its
// reserve the honest result is the real listing, as a lookalike.
const SCENARIO_ARTICLE_EXACT = {
  name: "An 'exact' whose own reason says the page is an article is held",
  intent: "finder",
  guardOnly: true,
  serpapiLeft: 20,
  vision: {
    productName: "windshield suction cup gooseneck phone holder", brand: "", visiblePrice: null, currency: "",
    quantity: "", category: "tech", platform: "unknown", storeName: "", visibleUrl: "",
    priceConfidence: "none", imageQuality: "good",
  },
  lens: [
    { title: "Suporte de celular para cama: como escolher um modelo ...", source: "Geriatria e Gerontologia", link: "https://geriatria.test/suporte", thumbnail: "https://img.test/article-holder" },
    { title: "Gooseneck Windshield Phone Mount", source: "Walmart", link: "https://walmart.test/gooseneck", thumbnail: "https://img.test/gooseneck", price: { value: "$15.99", extracted_value: 15.99, currency: "$" } },
  ],
  shopping: () => [],
  amazon: () => [],
  verdicts: { "https://img.test/article-holder": "exact", "https://img.test/gooseneck": "similar" },
  ties: { "https://img.test/article-holder": "photo" },
  whys: { "https://img.test/article-holder": "Identical photo of the holder under a frosted windshield, but it's a health-site article, not a product listing" },
  expect: { titleIncludes: "Gooseneck Windshield Phone Mount", price: 15.99, confidence: "unverified", mode: "FINDER" },
};

// ════════════════════════════════════════════════════════════════
// The mocked internet.
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// An in-memory Upstash. The identity cache and the spend governor are the
// point of this pass, so they run as written rather than being stubbed out:
// the emulator speaks enough of the REST protocol for the client the
// project actually uses, including its base64 response encoding.
// ════════════════════════════════════════════════════════════════
const store = new Map();
export function resetStore() { store.clear(); }

function runRedisCommand(args) {
  const [rawCmd, key, ...rest] = args;
  const cmd = String(rawCmd).toUpperCase();
  switch (cmd) {
    case "GET": return store.has(key) ? store.get(key) : null;
    case "SET": store.set(key, String(rest[0])); return "OK";
    case "INCRBYFLOAT": {
      const next = (Number(store.get(key)) || 0) + Number(rest[0]);
      store.set(key, String(next));
      return String(next);
    }
    case "DEL": return store.delete(key) ? 1 : 0;
    case "EXPIREAT":
    case "EXPIRE": return 1;
    default: return null;
  }
}

// The client sends `Upstash-Encoding: base64` and base64-decodes what comes
// back, so a plain string here would arrive as binary noise. This bit has
// bitten this project before.
const encode = (value) =>
  typeof value === "string" ? Buffer.from(value, "utf8").toString("base64") : value;

function redisResponse(body) {
  const isPipeline = Array.isArray(body) && Array.isArray(body[0]);
  const result = isPipeline
    ? body.map(args => ({ result: encode(runRedisCommand(args)) }))
    : { result: encode(runRedisCommand(body)) };
  return {
    ok: true, status: 200,
    headers: { get: () => "application/json" },
    json: async () => result,
    text: async () => JSON.stringify(result),
  };
}

function jsonResponse(obj) {
  return {
    ok: true, status: 200,
    headers: { get: () => "application/json" },
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  };
}

function imageResponse(url) {
  // The bytes ARE the identity. fetchImageAsBase64 base64-encodes whatever it
  // gets and hands it to the model, so the mocked gate can decode the URL
  // back out and answer for that specific product photo.
  const buf = Buffer.from(`IMG::${url}`);
  return {
    ok: true, status: 200,
    headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? "image/jpeg" : null) },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    json: async () => ({}),
    text: async () => "",
  };
}

// What the mocked gate names as the tie: a scenario can set one per
// candidate; otherwise a match is tied by a distinctive part and anything
// else by nothing, the way a gate following its prompt answers.
function tieFor(scenario, candidateUrl, match) {
  if (scenario.ties && candidateUrl in scenario.ties) return scenario.ties[candidateUrl];
  return match === "exact" || match === "likely" ? "part" : "none";
}

function installFetch(scenario, stats) {
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : String(input?.url || input);
    const body = init.body ? JSON.parse(init.body) : null;

    if (url.startsWith("https://img.test/")) {
      stats.imageFetches++;
      return imageResponse(url);
    }

    if (scenario.pages?.[url] === 403) {
      return { ok: false, status: 403, headers: { get: () => "text/html" }, text: async () => "blocked", json: async () => ({}) };
    }
    if (scenario.pages?.[url]) {
      const html = scenario.pages[url];
      return { ok: true, status: 200, headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? "text/html" : null) },
               text: async () => html, json: async () => ({}) };
    }
    if (url.includes("currency-api")) return jsonResponse({ date: "2026-10-01", usd: { eur: 0.9, gbp: 0.75, mad: 9.7 } });
    const shoppingDown = () => ({ ok: false, status: 503, headers: { get: () => "application/json" },
                                   json: async () => ({ error: "down" }), text: async () => "down" });

    if (url.startsWith("https://api.anthropic.com/")) {
      const payload = JSON.parse(init.body);
      const blocks = payload.messages[0].content;
      const serialized = typeof blocks === "string" ? blocks : JSON.stringify(blocks);
      const usage = { input_tokens: 2000, output_tokens: 120 };

      if (serialized.includes("Product intelligence scan")) {
        stats.visionCalls++;
        stats.models.push(`extract:${payload.model}`);
        return jsonResponse({ usage, content: [{ type: "text", text: JSON.stringify(scenario.vision) }] });
      }

      if (serialized.includes("IMAGE B")) {
        // The pre-fix engine's shape: one candidate per call.
        const images = blocks.filter(b => b.type === "image");
        const candidateUrl = Buffer.from(images[images.length - 1].source.data, "base64")
          .toString("utf8").replace(/^IMG::/, "");
        stats.gateCalls++;
        stats.candidatesJudged++;
        // The pre-v10 engine spoke a three-level scale, in which "similar"
        // was its word for what the gate now calls "likely".
        const scenarioMatch = scenario.verdicts[candidateUrl];
        const match = scenarioMatch === "likely" ? "similar" : scenarioMatch;
        if (!match) throw new Error(`scenario "${scenario.name}" has no verification verdict for ${candidateUrl}`);
        return jsonResponse({ usage, content: [{ type: "text", text: JSON.stringify({ match, reasoning: "mocked" }) }] });
      }

      if (serialized.includes("candidate product listing image")) {
        // The gate now judges a whole wave in one call. IMAGE A is the
        // reference; every image after it is a candidate, in order, and the
        // bytes of each one name the listing it came from.
        const images = blocks.filter(b => b.type === "image");
        const candidateUrls = images.slice(1).map(b =>
          Buffer.from(b.source.data, "base64").toString("utf8").replace(/^IMG::/, "")
        );
        stats.gateCalls++;
        stats.models.push(`gate:${payload.model}(${candidateUrls.length})`);
        if (payload.model.includes("opus")) stats.opusGateCalls++;

        // Injected faults, applied to the first N gate calls only.
        if (scenario.fault && stats.gateCalls <= scenario.fault.calls) {
          if (scenario.fault.kind === "fail") {
            stats.faultsInjected++;
            return { ok: false, status: 500, headers: { get: () => "application/json" },
                     json: async () => ({ error: "injected" }), text: async () => "injected" };
          }
          if (scenario.fault.kind === "truncate") {
            stats.faultsInjected++;
            const full = JSON.stringify(candidateUrls.map((candidateUrl, i) => ({
              candidate: i + 1,
              match: scenario.verdicts[candidateUrl],
              tie: tieFor(scenario, candidateUrl, scenario.verdicts[candidateUrl]),
              why: "mocked",
            })));
            // Cut mid-array, the way a max_tokens ceiling would.
            const cut = full.slice(0, Math.floor(full.length * 0.55));
            return jsonResponse({ usage, content: [{ type: "text", text: cut }] });
          }
        }

        stats.candidatesJudged += candidateUrls.length;
        const verdicts = candidateUrls.map((candidateUrl, i) => {
          const match = scenario.verdicts[candidateUrl];
          if (!match) throw new Error(`scenario "${scenario.name}" has no verification verdict for ${candidateUrl}`);
          stats.verified.push(`${match.padEnd(9)} ${candidateUrl.replace("https://img.test/", "")}`);
          return { candidate: i + 1, match, tie: tieFor(scenario, candidateUrl, match), why: scenario.whys?.[candidateUrl] || "mocked" };
        });
        return jsonResponse({ usage, content: [{ type: "text", text: JSON.stringify(verdicts) }] });
      }

      // Query enrichment / page text extraction - unused by the image path.
      return jsonResponse({ usage, content: [{ type: "text", text: "{}" }] });
    }

    if (url.startsWith("https://redis.test")) {
      stats.redisCalls++;
      return redisResponse(body);
    }

    // The SerpApi backup's free balance lookup (SEARCH PROVIDERS in scan.ts).
    // A scenario can hold it at a number, or make the lookup fail (null).
    if (url.startsWith("https://serpapi.com/account.json")) {
      stats.serpapiAccountLookups++;
      if (scenario.serpapiLeft === null) return { ok: false, status: 503, headers: { get: () => "application/json" }, json: async () => ({}), text: async () => "down" };
      return jsonResponse({ total_searches_left: scenario.serpapiLeft ?? 200 });
    }

    if (url.startsWith("https://serpapi.com/search.json")) {
      const params = new URL(url).searchParams;
      const engine = params.get("engine");
      if (engine === "google_lens") {
        stats.lensCalls++;
        stats.serpapiLensCalls++;
        // SerpApi's own Lens can differ from Serper's: Google's exact-image
        // matches come first, which is what the escalation asks it for.
        return jsonResponse({ exact_matches: scenario.serpapiExact || [], visual_matches: scenario.serpapiLens || scenario.lens });
      }
      if (engine === "google_shopping") {
        stats.serpapiShoppingCalls++;
        if (scenario.shoppingDown) return shoppingDown();
        const rows = scenario.shopping(params.get("q") || "");
        return jsonResponse({
          shopping_results: rows.map(r => ({
            title: r.title, source: r.source, link: r.link,
            thumbnail: r.imageUrl, extracted_price: parseFloat(r.price.replace(/[^0-9.]/g, "")),
          })),
        });
      }
      if (engine === "amazon") {
        stats.retailerCalls++;
        return jsonResponse({ organic_results: scenario.amazon(params.get("k") || "") });
      }
      if (engine === "ebay") {
        stats.retailerCalls++;
        return jsonResponse({ organic_results: scenario.ebay ? scenario.ebay(params.get("_nkw") || "") : [] });
      }
      if (engine === "walmart") {
        stats.retailerCalls++;
        return jsonResponse({ organic_results: [] });
      }
      if (engine === "google") return jsonResponse({ organic_results: [] });
      if (engine === "google_product") return jsonResponse({ sellers_results: { online_sellers: [] } });
      throw new Error(`unmocked SerpApi engine: ${engine}`);
    }

    if (url === "https://google.serper.dev/shopping") {
      if (scenario.shoppingDown) return shoppingDown();
      const rows = scenario.shopping(body?.q || "");
      return jsonResponse({ shopping: rows });
    }
    // Lens on Serper, the primary: the scenario's visual matches in the
    // shape Serper sends (a list of rows with a thumbnail URL and a price
    // string), so the current engine reads the same matches the pre-fix
    // engine reads from SerpApi.
    if (url === "https://google.serper.dev/lens") {
      stats.lensCalls++;
      return jsonResponse({
        organic: scenario.lens.map(m => ({
          title: m.title, source: m.source, link: m.link, thumbnailUrl: m.thumbnail,
          ...(m.price ? { price: m.price.value || `$${m.price.extracted_value}`, extractedPrice: m.price.extracted_value } : {}),
        })),
        credits: 3,
      });
    }
    if (url === "https://google.serper.dev/search") return jsonResponse({ organic: [] });
    // Any other page an identified listing links to: no structured price.
    if (/^https:\/\/[^/]*\.test\//.test(url)) {
      return { ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => "<html></html>", json: async () => ({}) };
    }

    throw new Error(`unmocked fetch: ${url}`);
  };
}

// ════════════════════════════════════════════════════════════════
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.SERPAPI_KEY = "test-key";
process.env.SERPER_API_KEY = "test-key";
process.env.BLOB_READ_WRITE_TOKEN = "test-token";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

// Two different photos of one product. Different bytes, so the byte-keyed
// cache in redis.ts treats them as unrelated - which is the whole point.
const REFERENCE_PHOTO = Buffer.from("REFERENCE-PHOTO-A").toString("base64");
const SECOND_PHOTO = Buffer.from("REFERENCE-PHOTO-B").toString("base64");

// The engine checks every page address with DNS before fetching it
// (fetchPublic in src/lib/net-guard.ts). These hosts are made up and served by
// the stubbed fetch, so they resolve to a public documentation address here.
(await import(localModule("net-guard"))).setResolverForChecks(async () => [{ address: "93.184.216.34" }]);
const { resetSpendModeCache } = await import(localModule("model-budget"));

function freshStats() {
  return {
    visionCalls: 0, gateCalls: 0, opusGateCalls: 0, candidatesJudged: 0, faultsInjected: 0,
    lensCalls: 0, retailerCalls: 0, imageFetches: 0, redisCalls: 0, serpapiShoppingCalls: 0,
    serpapiLensCalls: 0, serpapiAccountLookups: 0,
    verified: [], models: [],
  };
}

async function run(engine, scenario, opts = {}) {
  const stats = freshStats();
  process.env.RETAILER_SWEEP = scenario.retailerSweep ? "1" : "";
  installFetch(scenario, stats);
  if (!opts.keepStore) resetStore();
  if (opts.spendToday) {
    // Straight into the counter the governor reads, so the real threshold
    // logic decides the mode rather than a flag the test sets.
    const day = new Date().toISOString().slice(0, 10);
    store.set(`spend:model:${day}`, String(opts.spendToday));
  }
  resetSpendModeCache();
  // The SerpApi balance is cached for ten minutes per instance; every
  // scenario starts from its own.
  engine.resetSerpApiBalance?.();
  const photo = opts.photo || REFERENCE_PHOTO;
  const result = await engine.scanProduct(photo, "image/jpeg", "us", scenario.intent);
  return { result, stats };
}

function describe({ result }) {
  return {
    title: result.sourceProduct.title,
    price: result.sourceProduct.price,
    platform: result.sourceProduct.platform,
    confidence: result.matchConfidence,
    mode: result.mode,
    engine: result.engineUsed,
    found: result.found,
    verdict: result.analysis.verdict,
    retail: result.analysis.retailEstimate,
    savings: result.analysis.savings,
    failure: result.failure ? result.failure.reason : null,
  };
}

function checkExpected(got, expected) {
  const problems = [];
  if (!got.title.toLowerCase().includes(expected.titleIncludes.toLowerCase())) {
    problems.push(`title "${got.title}" does not contain "${expected.titleIncludes}"`);
  }
  if (Math.abs(got.price - expected.price) > 0.001) problems.push(`price ${got.price} is not ${expected.price}`);
  if (expected.confidence && got.confidence !== expected.confidence) problems.push(`confidence "${got.confidence}" is not "${expected.confidence}"`);
  if (expected.platform && got.platform !== expected.platform) problems.push(`platform "${got.platform}" is not "${expected.platform}"`);
  if (expected.mode && got.mode !== expected.mode) problems.push(`mode "${got.mode}" is not "${expected.mode}"`);
  if (expected.verdict && got.verdict !== expected.verdict) problems.push(`verdict "${got.verdict}" is not "${expected.verdict}"`);
  if (typeof expected.retail === "number" && Math.abs(got.retail - expected.retail) > 0.001) {
    problems.push(`retail ${got.retail} is not ${expected.retail}`);
  }
  if (typeof expected.found === "boolean" && got.found !== expected.found) problems.push(`found ${got.found} is not ${expected.found}`);
  if (expected.failure === false && got.failure) problems.push(`the scan failed (${got.failure}); it should have stood`);
  if (expected.engineIncludes && !String(got.engine || "").includes(expected.engineIncludes)) {
    problems.push(`engine "${got.engine}" does not include "${expected.engineIncludes}"`);
  }
  return problems;
}

const FIXTURE = join(REPO, "scripts/fixtures/scan.pre-v10.ts.txt");
const current = await loadEngine(join(REPO, "src/lib/scan.ts"), "current");
const preFix = existsSync(FIXTURE) ? await loadEngine(FIXTURE, "prefix") : null;

let failures = 0;
const line = (s = "") => console.log(s);

const SCENARIOS = [
  SCENARIO_GLASSES, SCENARIO_BAG, SCENARIO_NO_MATCH,
  SCENARIO_UNPRICEABLE, SCENARIO_VERDICT, SCENARIO_SIMILAR_TIER,
  SCENARIO_SPIKE, SCENARIO_DEGRADED, SCENARIO_TRUNCATED, SCENARIO_CALL_FAILS,
  SCENARIO_LOOKALIKE, SCENARIO_REUSED_PHOTO, SCENARIO_PRICED_FROM_PAGE, SCENARIO_PRICE_SEARCH_DOWN,
  SCENARIO_TIER_PAGE_PRICE, SCENARIO_LIKELY_PRICE, SCENARIO_RETAILER_POOLS, SCENARIO_GLASSES_NO_SWEEP,
  SCENARIO_ESCALATION, SCENARIO_ESCALATION_HELD, SCENARIO_ESCALATION_UNKNOWN, SCENARIO_ESCALATION_DEGRADED, SCENARIO_BRAND_AND_PART, SCENARIO_ARTICLE_EXACT,
];

for (const scenario of SCENARIOS) {
  line(`\n${"=".repeat(74)}`);
  line(scenario.name);
  line(`  intent: "${scenario.intent}"   lens matches: ${scenario.lens.length}` +
       `   unpriced: ${scenario.lens.filter(m => !m.price).length}`);
  line(`  the photo shows: ${scenario.expect.titleIncludes}`);
  line("=".repeat(74));

  // A spike scenario is two scans: one to pay for the identification, then
  // a DIFFERENT photo of the same product, which is the one measured.
  if (scenario.kind === "spike") {
    const first = await run(current, scenario, { photo: REFERENCE_PHOTO });
    line(`\n  FIRST SCAN (pays for the identification)`);
    line(`    returned  : ${first.result.sourceProduct.title}`);
    line(`    gate      : ${first.stats.gateCalls} call(s), ${first.stats.candidatesJudged} candidates, ` +
         `${first.stats.opusGateCalls} on the strong model`);
  }

  const now = await run(current, scenario, {
    keepStore: scenario.kind === "spike",
    photo: scenario.kind === "spike" ? SECOND_PHOTO : undefined,
    spendToday: scenario.spendToday,
  });
  const got = describe(now);
  const problems = checkExpected(got, scenario.expect);
  if (scenario.expectStats) problems.push(...scenario.expectStats(now.stats));
  line(`\n  CURRENT ENGINE  ${problems.length === 0 ? "PASS" : "FAIL"}`);
  line(`    returned  : ${got.title}`);
  line(`    price     : $${got.price.toFixed(2)} at ${got.platform}`);
  line(`    label     : ${got.confidence} / ${got.mode}   engine: ${got.engine}`);
  if (got.mode === "VERDICT") line(`    verdict   : ${got.verdict}  retail $${got.retail.toFixed(2)}  savings $${got.savings.toFixed(2)}`);
  line(`    gate      : ${now.stats.gateCalls} call(s), ${now.stats.candidatesJudged} candidates judged, ` +
       `${now.stats.opusGateCalls} on the strong model`);
  line(`    models    : ${now.stats.models.join("  ")}`);
  if (now.stats.faultsInjected > 0) line(`    faults    : ${now.stats.faultsInjected} injected`);
  for (const v of now.stats.verified) line(`                ${v}`);
  for (const p of problems) line(`    PROBLEM   : ${p}`);
  if (problems.length > 0) failures++;

  if (preFix && !scenario.guardOnly) {
    const before = await run(preFix, scenario);
    const gotBefore = describe(before);
    const stillBroken = checkExpected(gotBefore, scenario.expect).length > 0;
    const matchesRecordedBug = checkExpected(gotBefore, scenario.expectPreFix).length === 0;
    line(`\n  PRE-FIX ENGINE  ${stillBroken && matchesRecordedBug ? "FAILS AS RECORDED" : "UNEXPECTED"}`);
    line(`    returned  : ${gotBefore.title}`);
    line(`    price     : $${gotBefore.price.toFixed(2)} at ${gotBefore.platform}`);
    line(`    label     : ${gotBefore.confidence} / ${gotBefore.mode}   engine: ${gotBefore.engine}`);
    if (gotBefore.mode === "VERDICT") line(`    verdict   : ${gotBefore.verdict}  retail $${gotBefore.retail.toFixed(2)}  savings $${gotBefore.savings.toFixed(2)}`);
    line(`    gate      : ${before.stats.candidatesJudged || before.stats.gateCalls} candidates checked`);
    if (!stillBroken) {
      line("    PROBLEM   : the pre-fix engine passed this scenario, so the scenario does not");
      line("                reproduce the bug it exists to document.");
      failures++;
    } else if (!matchesRecordedBug) {
      line(`    PROBLEM   : expected the recorded failure (${scenario.expectPreFix.titleIncludes} at $${scenario.expectPreFix.price}).`);
      failures++;
    }
  }
}

// ── Listing titles as queries, and pages that sell nothing ──
const TITLE_SOURCES = { "Flowlife Flowgun Go! Massagepistol – Ongoal": "Ongoal" };
const sourceFor = (raw) => TITLE_SOURCES[raw] || "";
line(`\n${"=".repeat(74)}`);
line("Listing titles and non-listing pages");
line("=".repeat(74));
for (const [raw, want] of [
  ["Amazon.com: Silicone Basting Brush 9\" Kitchen Cooking ...", "Silicone Basting Brush 9\" Kitchen Cooking"],
  ["Flowgun Air – Lightweight Percussive Massage Gun | Flowlife", "Flowgun Air – Lightweight Percussive Massage Gun"],
  ["Nintendo Switch With Docking Station, Charger, HDMI 55GB | eBay", "Nintendo Switch With Docking Station, Charger, HDMI 55GB"],
  ["Owala FreeSip 24oz - Walmart.com", "Owala FreeSip 24oz"],
  ["Stanley Quencher H2.0 FlowState Tumbler 40 oz", "Stanley Quencher H2.0 FlowState Tumbler 40 oz"],
  ["Ray-Ban - New Wayfarer Classic", "Ray-Ban - New Wayfarer Classic"],
  ["Apple AirPods Pro - 2nd Generation", "Apple AirPods Pro - 2nd Generation"],
  ["Flowlife Flowgun Go! Massagepistol – Ongoal", "Flowlife Flowgun Go! Massagepistol", "Ongoal"],
  ["Nintendo Switch OLED Model - 64GB", "Nintendo Switch OLED Model - 64GB"],
]) {
  const got = current.cleanListingTitle(raw, sourceFor(raw));
  const ok = got === want;
  line(`  ${ok ? "PASS" : "FAIL"}  "${raw}" -> "${got}"`);
  if (!ok) failures++;
}
for (const [url, listing] of [
  ["https://en.wikipedia.org/wiki/Crocs", false],
  ["https://commons.wikimedia.org/wiki/File:Crocs.JPG", false],
  ["https://www.reddit.com/r/crocs/comments/x", false],
  ["https://www.pinterest.co.uk/pin/123", false],
  ["https://www.facebook.com/groups/x/posts/1", false],
  ["https://www.facebook.com/marketplace/item/123", true],
  ["https://www.ebay.com/itm/406332220524", true],
  ["https://flowlife.com/en-GB/product/flowgun-air", true],
  ["https://www.usatoday.com/story/money/crocs", true], // the gate rules articles out by title
]) {
  const ok = current.isListingCandidate({ productUrl: url }) === listing;
  line(`  ${ok ? "PASS" : "FAIL"}  ${url} ${listing ? "can be a listing" : "is never a listing"}`);
  if (!ok) failures++;
}

line(`\n${"=".repeat(74)}`);
if (!preFix) {
  line("NOTE: scripts/fixtures/scan.pre-v10.ts.txt is missing, so the old-vs-new");
  line("comparison did not run. Only the current engine was checked.");
}
if (failures > 0) {
  console.error(`${failures} identification check(s) failed.`);
  process.exit(1);
}
line("All identification checks passed.");
