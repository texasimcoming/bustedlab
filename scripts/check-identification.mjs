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

async function loadEngine(sourcePath, label) {
  let src = readFileSync(sourcePath, "utf8");
  const rewrites = [
    ['import { put, del } from "@vercel/blob";', BLOB_STUB],
    ['import { randomBytes } from "crypto";', 'import { randomBytes } from "node:crypto";'],
    ['import { LENS_BLOB_PREFIX } from "@/lib/constants";', 'const LENS_BLOB_PREFIX = "lens-scans/";'],
    ['import { calculateVerdict } from "@/lib/verdict";', `import { calculateVerdict } from "${VERDICT_URL}";`],
  ];
  for (const [from, to] of rewrites) {
    if (!src.includes(from)) throw new Error(`${label}: cannot rewrite missing import: ${from}`);
    src = src.replace(from, to);
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
// "VISUAL MATCH CONFIRMED" about something nobody confirmed. What changes
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
// SCENARIO 6 - nothing is confirmed, two things are merely plausible.
//
// The unconfirmed tier must not be decided on price. Google's best match is
// plausible but unconfirmable (a stock photo); a cheaper lookalike sits
// seven places below it. With identity unconfirmed, the engine's own
// ranking is the only real evidence, and a cheaper lookalike further down
// the list is not a better price - it is a likelier wrong product wearing a
// smaller number. The pre-fix engine takes the cheap one.
// ════════════════════════════════════════════════════════════════
const SCENARIO_SIMILAR_TIER = {
  name: "Unconfirmed tier is decided on rank, not price",
  intent: "finder",
  vision: {
    productName: "linen midi dress", brand: "", visiblePrice: null, currency: "USD",
    quantity: "", category: "fashion", platform: "instagram", storeName: "", visibleUrl: "",
    priceConfidence: "none", imageQuality: "good",
  },
  lens: [
    { title: "Sand-Washed Linen Midi Dress", source: "studiolinen.test", link: "https://studiolinen.test/midi", thumbnail: "https://img.test/dress-ranked", price: { value: "$60.00", extracted_value: 60.0, currency: "$" } },
    { title: "Cotton Poplin Shirt Dress", source: "a.test", link: "https://a.test/poplin", thumbnail: "https://img.test/dress-a", price: { value: "$48.00", extracted_value: 48.0, currency: "$" } },
    { title: "Pleated Satin Slip Dress", source: "b.test", link: "https://b.test/satin", thumbnail: "https://img.test/dress-b", price: { value: "$72.00", extracted_value: 72.0, currency: "$" } },
    { title: "Ribbed Knit Bodycon Dress", source: "c.test", link: "https://c.test/ribbed", thumbnail: "https://img.test/dress-c", price: { value: "$39.00", extracted_value: 39.0, currency: "$" } },
    { title: "Tiered Cotton Maxi Dress", source: "d.test", link: "https://d.test/tiered", thumbnail: "https://img.test/dress-d", price: { value: "$55.00", extracted_value: 55.0, currency: "$" } },
    { title: "Wrap Front Jersey Dress", source: "e.test", link: "https://e.test/wrap", thumbnail: "https://img.test/dress-e", price: { value: "$44.00", extracted_value: 44.0, currency: "$" } },
    { title: "Sleeveless Shift Dress", source: "f.test", link: "https://f.test/shift", thumbnail: "https://img.test/dress-f", price: { value: "$66.00", extracted_value: 66.0, currency: "$" } },
    // rank 7 - cheapest, and only a lookalike.
    { title: "Fast Fashion Linen Look Midi Dress", source: "g.test", link: "https://g.test/lookalike", thumbnail: "https://img.test/dress-cheap", price: { value: "$19.00", extracted_value: 19.0, currency: "$" } },
  ],
  shopping: () => [],
  amazon: () => [],
  verdicts: {
    "https://img.test/dress-ranked": "similar",
    "https://img.test/dress-cheap": "similar",
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
// The mocked internet.
// ════════════════════════════════════════════════════════════════
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

function installFetch(scenario, stats) {
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : String(input?.url || input);
    const body = init.body ? JSON.parse(init.body) : null;

    if (url.startsWith("https://img.test/")) {
      stats.imageFetches++;
      return imageResponse(url);
    }

    if (url.startsWith("https://api.anthropic.com/")) {
      const payload = JSON.parse(init.body);
      const blocks = payload.messages[0].content;
      const serialized = JSON.stringify(blocks);

      if (serialized.includes("Product intelligence scan")) {
        stats.visionCalls++;
        return jsonResponse({ content: [{ type: "text", text: JSON.stringify(scenario.vision) }] });
      }
      if (serialized.includes("IMAGE B")) {
        stats.verifyCalls++;
        const images = blocks.filter(b => b.type === "image");
        const decoded = Buffer.from(images[images.length - 1].source.data, "base64").toString("utf8");
        const candidateUrl = decoded.replace(/^IMG::/, "");
        const match = scenario.verdicts[candidateUrl];
        if (!match) throw new Error(`scenario "${scenario.name}" has no verification verdict for ${candidateUrl}`);
        stats.verified.push(`${match.padEnd(9)} ${candidateUrl.replace("https://img.test/", "")}`);
        return jsonResponse({ content: [{ type: "text", text: JSON.stringify({ match, reasoning: "mocked" }) }] });
      }
      // Query enrichment / page text extraction - unused by the image path.
      return jsonResponse({ content: [{ type: "text", text: "{}" }] });
    }

    if (url.startsWith("https://serpapi.com/search.json")) {
      const params = new URL(url).searchParams;
      const engine = params.get("engine");
      if (engine === "google_lens") {
        stats.lensCalls++;
        return jsonResponse({ visual_matches: scenario.lens });
      }
      if (engine === "google_shopping") {
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
      if (engine === "walmart" || engine === "ebay") {
        stats.retailerCalls++;
        return jsonResponse({ organic_results: [] });
      }
      if (engine === "google") return jsonResponse({ organic_results: [] });
      if (engine === "google_product") return jsonResponse({ sellers_results: { online_sellers: [] } });
      throw new Error(`unmocked SerpApi engine: ${engine}`);
    }

    if (url === "https://google.serper.dev/shopping") {
      const rows = scenario.shopping(body?.q || "");
      return jsonResponse({ shopping: rows });
    }
    if (url === "https://google.serper.dev/lens") return jsonResponse({ organic: [] });
    if (url === "https://google.serper.dev/search") return jsonResponse({ organic: [] });

    throw new Error(`unmocked fetch: ${url}`);
  };
}

// ════════════════════════════════════════════════════════════════
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.SERPAPI_KEY = "test-key";
process.env.SERPER_API_KEY = "test-key";
process.env.BLOB_READ_WRITE_TOKEN = "test-token";

const REFERENCE_PHOTO = Buffer.from("REFERENCE-PHOTO").toString("base64");

async function run(engine, scenario) {
  const stats = { visionCalls: 0, verifyCalls: 0, lensCalls: 0, retailerCalls: 0, imageFetches: 0, verified: [] };
  installFetch(scenario, stats);
  const result = await engine.scanProduct(REFERENCE_PHOTO, "image/jpeg", "us", scenario.intent);
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
];

for (const scenario of SCENARIOS) {
  line(`\n${"=".repeat(74)}`);
  line(scenario.name);
  line(`  intent: "${scenario.intent}"   lens matches: ${scenario.lens.length}` +
       `   unpriced: ${scenario.lens.filter(m => !m.price).length}`);
  line(`  the photo shows: ${scenario.expect.titleIncludes}`);
  line("=".repeat(74));

  const now = await run(current, scenario);
  const got = describe(now);
  const problems = checkExpected(got, scenario.expect);
  line(`\n  CURRENT ENGINE  ${problems.length === 0 ? "PASS" : "FAIL"}`);
  line(`    returned  : ${got.title}`);
  line(`    price     : $${got.price.toFixed(2)} at ${got.platform}`);
  line(`    label     : ${got.confidence} / ${got.mode}   engine: ${got.engine}`);
  if (got.mode === "VERDICT") line(`    verdict   : ${got.verdict}  retail $${got.retail.toFixed(2)}  savings $${got.savings.toFixed(2)}`);
  line(`    gate saw  : ${now.stats.verifyCalls} candidates checked`);
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
    line(`    gate saw  : ${before.stats.verifyCalls} candidates checked`);
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
