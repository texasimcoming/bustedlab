/**
 * BustedLab Scan Engine v10 - identify first, price second. Lens-first,
 * verified against the real photo, price/link always from the same record,
 * and honest about locality without sacrificing search depth for it.
 *
 * v10 — IDENTIFICATION IS NEVER SUBORDINATED TO PRICE. This is the
 * accuracy rewrite, and it is worth stating plainly what was wrong,
 * because the failure was not one bug but one mistaken idea repeated in
 * five places: that a candidate's price is a reasonable thing to rank and
 * filter by BEFORE anyone has established what the candidate is.
 *
 *   1. Both Lens readers deleted every visual match that carried no price,
 *      as their first operation. Lens returns visual matches whether or
 *      not Google parsed a price from them, and the single most visually
 *      identical result very often has none (a brand's own product page,
 *      an editorial piece, a marketplace listing with the price behind a
 *      script). Those were thrown away before anything looked at them.
 *   2. Every candidate producer then sorted what survived cheapest-first,
 *      which destroyed Lens's best-match-first ordering — the one
 *      identification signal in the whole response.
 *   3. The verification gate checked the first five candidates, which
 *      after (2) meant the five CHEAPEST, never the five most similar.
 *   4. When none of those five matched, the gate returned candidates[0] —
 *      the cheapest arbitrary row in the list — as the "closest match".
 *   5. The rebrand and direct-retailer layers replaced the chosen product
 *      on price alone, so a cheaper "maybe" could evict a confirmed match.
 *
 * Together those produced exactly the reported failures: a photo of Ralph
 * Lauren eyeglasses answered with an unrelated brand (correct match
 * unpriced, deleted at step 1; nothing else matched; step 4 returned the
 * cheapest row), and a photo of one Under Armour bag answered with a
 * different, cheaper Under Armour bag (correct match priced but not
 * cheapest, buried by step 2, outside the window at step 3).
 *
 * What replaces it, which is the same two-step Google itself runs:
 *   - Every visual match with an image is kept, in the engine's own order.
 *     A missing image disqualifies a candidate (the gate has nothing to
 *     compare); a missing price never does.
 *   - Candidates are reordered only by identity evidence — engine rank,
 *     plus a boost for carrying the brand the vision pass read off the
 *     photo — and that reordering can never remove a candidate.
 *   - The gate checks a wide window in two waves, the second spent only
 *     when the first confirmed nothing, so a correct match sitting at rank
 *     seven is reachable.
 *   - Within the best confidence tier it found, the CHEAPEST record wins.
 *     Identity first, price second. That single rule serves "am I being
 *     overcharged?" and "where is it cheapest?" identically, which is why
 *     there is no longer any asymmetry between the two intents: both need
 *     the real floor price for the object in the photo, and neither is
 *     served by a cheap price for a different object.
 *   - A confirmed product with no price of its own is then PRICED by a
 *     second search against its now-accurate name, whose results go back
 *     through the same visual gate before any of their prices are
 *     believed.
 *   - Nothing verified at all still returns the engine's best-ranked
 *     candidate, labeled unverified, never the cheapest arbitrary one.
 *   - A challenger from a later layer only displaces the chosen product if
 *     it is at least as well identified (shouldReplace).
 *   - If a confirmed product has no price anywhere, the scan resolves to
 *     UNRESOLVED rather than hanging a category-average estimate off a
 *     real merchant link.
 *
 * v9.1 — locality is a DISCLOSURE, not a search filter. Every Serper/SerpApi
 * shopping, Lens, organic-search, and merchant-link-resolution call is
 * hardcoded to the US index (`gl: "us"`) regardless of where the requester
 * is. The US Shopping/Lens index is by far the deepest and is where the
 * real wholesale floor price for dropshipped products (AliExpress/Temu/
 * Wish-style cross-border listings) reliably surfaces — restricting search
 * to the requester's own country doesn't make the verdict more accurate,
 * it just degrades result depth for anyone outside a handful of major
 * markets, which is the opposite of what a global, price-conscious
 * audience needs. The markup exposed is real regardless of which country's
 * index found the floor price.
 * The requester's country is still accepted as an optional parameter on
 * scanProduct()/scanProductUrl(), but it now does exactly one thing: builds
 * an honest `shippingNote` disclosure ("Ships internationally — check
 * delivery time to your region") on the result when the requester isn't in
 * the US, rather than silently filtering what gets found. It does NOT
 * convert currency — amounts stay in USD, since faking a currency label on
 * an unconverted number would be a wrong number wearing a formatting
 * costume, not an improvement.
 *
 * Image-upload pipeline:
 * Layer 1: Claude Haiku Vision → product identity, visible price, visible
 *          store/seller handle, and any URL literally visible in the shot
 * Layer 2: Reverse image search (Google Lens via SerpApi, primary) → exact-pixel candidates
 * Layer 3: Reverse image search (Google Lens via Serper, backup)
 * Layer 3.5: Product-page discovery — if a store name/handle or a visible
 *          URL was captured, find and READ the actual product page (same
 *          JSON-LD/meta/description extraction a pasted URL gets) before
 *          falling back to a keyword guess.
 * Layer 4: Store-name-targeted Shopping text search (Serper → SerpApi) —
 *          fallback if discovery above found nothing usable
 * Layer 5: Generic brand/product Shopping text search (Serper → SerpApi)
 * Layer 6: Visual verification gate — every non-Lens candidate gets checked
 *          against a real reference image before it's allowed to drive a
 *          confident verdict.
 * Layer 7: Category-average estimate — last resort, always labeled as an
 *          estimate, never rendered as a confident BUSTED verdict.
 *
 * URL pipeline:
 * 1. Fetch the real page HTML.
 * 2. Extract real price/title/image/description from JSON-LD, microdata,
 *    and Open Graph meta tags (AggregateOffer ranges deliberately NOT
 *    treated as a single price). Claude TEXT fallback only when structured
 *    data is absent.
 * 3. Full page content builds one highly specific search query via Claude.
 * 4. A real product photo runs through the same Lens + verification gate
 *    the image-upload flow uses.
 * 5. A multi-tier query fallback (enriched → title → top words) means a
 *    valid, readable product page should essentially always produce at
 *    least a FINDER result.
 *
 * Price/link consistency: once a candidate is chosen (Lens matching or
 * visual verification), EVERY downstream field — price, image, url, title
 * — comes from that exact same candidate record via applyVerifiedCandidate().
 * No separate price recalculation can pull a number from a different
 * listing than the one that gets linked.
 *
 * Shopping links: SerpApi/Serper shopping results sometimes link to a
 * Google search/product page rather than the actual merchant. Every final
 * result link is checked and, where possible, resolved to a real merchant
 * URL before it's shown as "view listing" — never a Google redirect.
 *
 * Shopping search relevance: results are filtered so a candidate's title
 * must share the query's actual distinguishing words (not just an
 * overlapping generic category term) — this is what stops a "jade roller"
 * search from accepting a "needle roller" result.
 *
 * Cost per scan. The gate keeps the strongest model - a confident wrong
 * identification is the one failure this product cannot survive, and a
 * cheap one that goes viral is the worst version of it. What makes that
 * affordable is not a weaker model, it is three structural things, all
 * priced in scripts/cost-model.mjs from the published rates:
 *
 *   - The gate compares a whole wave of candidates in ONE call rather than
 *     one call per candidate. Verification input is image-dominated and the
 *     photo is the dominant image, so sending it once with six thumbnails
 *     costs about what six cheap-model calls would and roughly half what
 *     six strong-model calls would.
 *   - The photo is a cached prompt prefix, so later waves and later passes
 *     read it at a tenth of the price. This only works on the strong model
 *     (512-token cache minimum against the cheap model's 4,096, which no
 *     image reaches) - the reason batching beats downgrading here.
 *   - An identification is published for the next person to scan the same
 *     product, so a viral spike pays for identification once rather than
 *     ten thousand times. See reuseIdentification().
 *
 * Against roughly $0.009 of model spend for the pre-v10 Haiku-only engine:
 * about $0.035 for a cold typical scan, about $0.09 for a cold hard scan
 * where nothing confirms in the first wave and every fallback fires, and
 * under $0.01 for a scan of a product already identified in the last hour -
 * which is most scans during the traffic this product exists to create.
 * Search calls (Lens/Shopping/retailer/link resolution) remain ~$0.004-0.01
 * and are skipped entirely on a reused identification.
 *
 * Spend is measured from the usage the API reports, counted against a daily
 * budget, and when that budget is gone the engine degrades instead of either
 * failing or spending without a ceiling: cheap gate, cache-first, the
 * enhancement layers dropped, and the gate's strongest label withheld (it
 * can no longer return "exact", so no card can say PIXEL-MATCH VERIFIED on
 * a cheap judgement). A reused identification keeps full confidence even
 * then, because the strong model made it. See model-budget.ts.
 */

import { put, del } from "@vercel/blob";
import { randomBytes } from "crypto";
import { LENS_BLOB_PREFIX } from "@/lib/constants";
// Classification lives in its own dependency-free module so the landing page
// can publish the same thresholds the engine applies, and so the calibration
// check can execute the real function rather than a copy of it.
import { calculateVerdict } from "@/lib/verdict";
import {
  currentSpendMode, priceUsage, recordModelSpend, reportModelFailure,
  type SpendMode,
} from "@/lib/model-budget";
import {
  lensFingerprint, lookupIdentity, storeIdentity, normalizeListingUrl,
  type CachedIdentity, type Fingerprint,
} from "@/lib/identity-cache";

// ════════════════════════════════════════════════════════════════
// MODELS, AND WHY THE EXPENSIVE ONE IS STILL ON THE GATE.
//
// One decision in this file matters more than everything else in the
// repository: whether a candidate listing is the same physical object as
// the photo. Every number on the card is downstream of it. A weaker model
// there does not produce a slightly less polished answer, it produces a
// confident answer about the wrong object, and a confident wrong answer
// that goes viral is worse than no answer at all. So the gate keeps the
// strongest model.
//
// Paying for that without a runaway bill came from two measurements, not
// from moving the gate down a tier. Both are in scripts/cost-model.mjs,
// which prices real call shapes from the published rates:
//
//   1. THE CHEAP MODEL CANNOT AMORTISE THE PHOTO. Opus 5 will cache a
//      prefix from 512 tokens; Haiku 4.5 needs 4,096. A scanned photo is
//      about 1,600 tokens and an image can never reach 4,096 at the sizes
//      the API accepts. So the reference photo is a cached prefix on the
//      strong model and can never be one on the cheap model. Per candidate
//      compared, the cheap model is therefore only about four times
//      cheaper, not twenty-five times - the gap that makes a cheap-first
//      screen look attractive mostly is not there.
//
//   2. BATCHING BEATS DOWNGRADING. Verification input is image-dominated
//      and the photo is the dominant image. Sending it ONCE with six
//      candidate thumbnails costs roughly what six separate cheap-model
//      calls cost, and about half what six separate strong-model calls
//      cost - while the strong model still judges every candidate. So the
//      gate now compares a whole wave in a single call. Cheaper than a
//      cheap-model screen, and it gives up nothing.
//
// What did move to the cheap model is the vision EXTRACTION, which reads
// the brand, product name and any visible price off the photo. That is a
// transcription task, its output only ranks candidates and builds queries
// rather than deciding identity, and it escalates to the strong model by
// itself when the read comes back structurally suspect (see
// extractFromImage). Everything stays pinned at temperature 0 so the same
// photo always resolves the same way.
const EXTRACT_MODEL = "claude-haiku-4-5-20251001";
const EXTRACT_ESCALATION_MODEL = "claude-opus-5";
const GATE_MODEL = "claude-opus-5";
// Used only when the spend governor has degraded the engine. See
// model-budget.ts, and DEGRADED CONFIDENCE in verifyCandidates.
const GATE_MODEL_DEGRADED = "claude-haiku-4-5-20251001";
// Text-only extractions: reading a price off page text, writing a search
// query. Wrong output costs a retry, not a wrong product.
const TEXT_MODEL = "claude-haiku-4-5-20251001";

// ════════════════════════════════════════════════════════════════
// The one entry point to the model. Centralised so that every call is
// measured: the cost is taken from the `usage` the API itself reports, not
// estimated, and added to the day's total before the call returns. The
// spend is awaited rather than fired and forgotten because a floating
// promise on a serverless runtime can be killed when the response goes
// out, and a budget that loses writes is not a budget.
//
// API backpressure (429 from a rate limit, 402 from billing, 529 from an
// overloaded API) trips the breaker rather than being retried, so the next
// scan takes the cheap path instead of hammering a limit that is already
// saying no.
// ════════════════════════════════════════════════════════════════
async function callClaude(
  model: string,
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<Record<string, unknown> | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, temperature: 0, ...payload }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      await reportModelFailure(res.status);
      return null;
    }
    const data = await res.json();
    await recordModelSpend(priceUsage(model, data?.usage));
    return data;
  } catch {
    return null;
  }
}

function parseModelJson(data: Record<string, unknown> | null): unknown {
  const content = (data?.content as { text?: string }[] | undefined) || [];
  const text = content[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// TIME BUDGET.
//
// The API route this runs behind has a hard ceiling, and a response that
// never arrives is not a more accurate response - it is no result at all,
// which is strictly the worst outcome available. So the layers that ADD
// to an answer already established (the second verification wave, the
// pricing search for a confirmed-but-unpriced product, the rebrand and
// direct-retailer sweeps) check the clock before they start and are
// skipped when there is not enough time left to finish them honestly.
//
// Nothing that establishes identity is ever skipped for time: the Lens
// call and the first verification wave always run.
const SCAN_BUDGET_MS = 47_000;
const VERIFY_WAVE_COST_MS = 13_000;
const PRICING_SEARCH_COST_MS = 22_000;
const ALTERNATIVE_LAYER_COST_MS = 24_000;

function createBudget(totalMs = SCAN_BUDGET_MS) {
  const startedAt = Date.now();
  return {
    remaining: () => totalMs - (Date.now() - startedAt),
    allows: (costMs: number) => totalMs - (Date.now() - startedAt) >= costMs,
  };
}
type Budget = ReturnType<typeof createBudget>;

const CONFIDENCE_RANK = { unverified: 0, likely: 1, exact: 2 } as const;
function rankConfidence(confidence: "exact" | "likely" | "unverified"): number {
  return CONFIDENCE_RANK[confidence];
}

export interface ScanResult {
  found: boolean;
  mode: "VERDICT" | "FINDER" | "UNRESOLVED";
  priceSource: "screenshot" | "estimated" | "shopping";
  engineUsed?: string;
  matchConfidence: "exact" | "likely" | "unverified";
  // Product category. Present on every result so the scan ledger can be
  // sliced by category later: "average markup by category" is one of the few
  // genuinely new things a dataset of this shape can say, and it is
  // impossible to reconstruct after the fact from a title alone.
  category: string;
  // Locality disclosure — NOT a search filter. The search itself always
  // targets the US index (see sanitizeCountry usage below); this is purely
  // an honest heads-up when the requester isn't in that market, so the
  // real markup can still be shown without implying "this ships to you
  // tomorrow." undefined when the requester is in the US (search already
  // matches their own market) or when there's no linked source to caveat.
  shippingNote?: string;
  sourceProduct: {
    title: string;
    price: number;
    currency: string;
    imageUrl: string;
    productUrl: string;
    affiliateUrl: string;
    // False when affiliateUrl could only be resolved to a Google-hosted
    // fallback rather than a genuine direct merchant page. The UI must
    // never label a non-direct link as if it goes straight to the
    // product — that mismatch is exactly what a real scan surfaced.
    linkIsDirect?: boolean;
    platform: string;
    rating?: number;
    reviews?: number;
  };
  analysis: {
    retailEstimate: number;
    retailSource: "screenshot" | "estimated" | "shopping";
    markup: number;
    verdict: "HIGH_MARKUP" | "OVERPRICED" | "FAIR" | "UNVERIFIED";
    savings: number;
    savingsPercent: number;
    confidence: "high" | "medium" | "low";
  };
}

interface VisionExtraction {
  productName: string;
  brand: string;
  visiblePrice: number | null;
  currency: string;
  quantity: string;         // pack/bundle size if stated, e.g. "3-pack" — keeps comparisons apples-to-apples
  category: string;
  platform: string;
  storeName: string;        // seller handle / watermark / caption store name, if visible
  visibleUrl: string;       // an actual URL visible in the screenshot (browser bar, caption link, etc.) — empty if none
  priceConfidence: "visible" | "inferred" | "none";
  imageQuality: "good" | "poor";
}

interface ShoppingCandidate {
  // 0 means this record publishes no price. That is a normal, common state
  // for a Google Lens visual match (a brand's own page, an editorial
  // write-up, a marketplace listing Google parsed no price from) and it is
  // NOT a reason to discard the record: it is frequently the most visually
  // identical result in the whole response. A price for it gets found
  // separately, after identification (see priceVerifiedIdentity).
  price: number;
  imageUrl: string;
  productUrl: string;
  source: string;
  title: string;
  productId?: string; // SerpApi product_id, when present — enables merchant-link resolution
  // Position in the ENGINE's own ordering, 0 being its best match. Google
  // Lens returns visual matches best-match-first, and that ordering is the
  // identification signal — it is the part of the response that says "this
  // is the same object". It used to be destroyed by a price sort before
  // anything had looked at it, which is how price became a precondition
  // for being identified at all.
  rank: number;
}

// What an earlier layer already read about the product, used to ORDER
// candidates for the identification gate. Never used to filter them.
interface IdentityHints {
  brand?: string;
  productName?: string;
}

interface ShoppingMatch {
  title: string;
  lowestPrice: number;
  highestPrice: number;
  imageUrl: string;
  productUrl: string;
  source: string;
  productId?: string;
  rating?: number;
  reviews?: number;
  candidates: ShoppingCandidate[];
}

interface VerificationResult {
  match: "exact" | "similar" | "different";
  reasoning: string;
}

interface PageProductData {
  title: string;
  price: number | null;
  currency: string;
  imageUrl: string;
  description: string;   // full product description text, when available — feeds query enrichment
  searchQuery: string;   // specific search query built from title + description + page content
}

// ════════════════════════════════════════════════════════════════
// Region handling (v9) — validated ISO 3166-1 alpha-2 code, defaulting to
// "us" for anything missing/malformed. Threaded through as `gl` on every
// Lens/Shopping/organic search call below.
// ════════════════════════════════════════════════════════════════
function sanitizeCountry(country?: string): string {
  const c = (country || "").trim().toLowerCase();
  return /^[a-z]{2}$/.test(c) ? c : "us";
}

// v9.1: locality is a disclosure, not a filter. The search always targets
// the US index regardless of where the requester is (see file header) — so
// when the requester ISN'T in the US, the linked source may or may not ship
// to them, and that's worth an honest heads-up rather than silently
// omitting it OR silently filtering search results down to "guaranteed
// local" at the cost of finding the real floor price. This never claims a
// specific verified shipping fact — it's a general prompt to check, sized
// to whether the source is a known cross-border platform.
const KNOWN_CROSS_BORDER_PLATFORMS = [
  "aliexpress.com", "temu.com", "dhgate.com", "wish.com", "banggood.com", "1688.com",
];

export function buildShippingNote(sourceUrl: string, country: string): string | undefined {
  if (country === "us" || !sourceUrl) return undefined;
  try {
    const host = new URL(sourceUrl).hostname;
    const isKnownCrossBorder = KNOWN_CROSS_BORDER_PLATFORMS.some(d => host.includes(d));
    return isKnownCrossBorder
      ? "Ships internationally. Check delivery time to your region."
      : "Check shipping availability to your region before ordering";
  } catch {
    return "Check shipping availability to your region before ordering";
  }
}

// ════════════════════════════════════════════════════════════════
// LAYER 1: Claude Haiku Vision — extraction
// ════════════════════════════════════════════════════════════════
async function extractFromImage(
  imageBase64: string,
  mimeType: string,
  mode: SpendMode = "full"
): Promise<VisionExtraction> {
  const defaults: VisionExtraction = {
    productName: "", brand: "", visiblePrice: null,
    currency: "USD", quantity: "", category: "other", platform: "unknown",
    storeName: "", visibleUrl: "", priceConfidence: "none", imageQuality: "poor",
  };

  if (!process.env.ANTHROPIC_API_KEY) return defaults;

  const body = {
    max_tokens: 350,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
        {
          type: "text",
          text: `Product intelligence scan. Return ONLY JSON:
{
  "productName": "exact product name, generic type if brand unknown",
  "brand": "brand or empty",
  "visiblePrice": null or number (ONLY if a price is clearly visible on screen),
  "currency": "USD",
  "quantity": "pack/bundle size if stated anywhere, e.g. '3-pack', '1 unit', '2-in-1'. Empty string if not specified. Comparing a 3-pack retail price against a single-unit wholesale listing produces a false markup, so this matters as much as the product name.",
  "category": "beauty|fitness|tech|fashion|home|pet|skincare|accessories|food|other",
  "platform": "tiktok|instagram|amazon|shopify|facebook|aliexpress|website|unknown",
  "storeName": "the seller/shop/store name or @handle if visible anywhere in the screenshot (watermark, caption, URL bar, product page header, checkout logo). Empty string if none is visible",
  "visibleUrl": "an actual URL/website address/domain visibly written or shown anywhere in the screenshot (browser address bar, a link in a caption or bio, a 'shop at ___' text overlay). Empty string if no URL text is actually visible. Do not construct or guess a URL. Only report one if it is literally shown as text.",
  "priceConfidence": "visible|inferred|none",
  "imageQuality": "good|poor"
}
CRITICAL: visiblePrice must be null unless a price number is clearly visible. Never guess.
CRITICAL: check every part of the image for a price, not just near the product. Video screenshots (TikTok/Reels) often show the price in a caption, a corner overlay, or a graphic banner rather than next to the item itself. Scan the full frame, all four corners and any text overlay, before concluding no price is visible.
CRITICAL: storeName must be read directly from visible text/logos/handles/URLs in the image. Never guess or infer a store name that isn't actually shown.
CRITICAL: visibleUrl must be an actual URL string visible as text in the image. Never invent one from a store name or brand guess.
CRITICAL: productName must include the defining material/type descriptor whenever visible or inferable. Use "jade roller" not "roller", "rose quartz gua sha" not "gua sha tool", "copper straightening brush" not "hair brush". A bare generic category word causes wrong-product matches against visually similar but materially different items (e.g. jade rollers vs needle/derma rollers both being "rollers"). Never drop a visible distinguishing word to make the name shorter.`,
        },
      ],
    }],
  };

  const first = parseModelJson(await callClaude(EXTRACT_MODEL, body, 20000)) as Partial<VisionExtraction> | null;
  const read: VisionExtraction = { ...defaults, ...(first || {}) };
  if (mode === "degraded" || !readFailed(read)) return read;

  // Escalation. The brand and the product words this pass returns are what
  // order candidates for the gate, and a missed brand is how a listing that
  // actually carries the logo on the photo fails to reach the front of the
  // queue. When the read comes back weak on an image the model itself called
  // good, the one call is worth spending on the strong model - it is a
  // single call per scan, and only on the scans where the cheap read
  // visibly underperformed.
  const second = parseModelJson(await callClaude(EXTRACT_ESCALATION_MODEL, body, 25000)) as Partial<VisionExtraction> | null;
  return second ? { ...defaults, ...second } : read;
}

/**
 * Worth a second, stronger look? The trigger is deliberately narrow: an
 * INTERNALLY INCONSISTENT read, where the model called the photo good and
 * then returned no product name at all. That is a read that plainly failed,
 * as opposed to a photo that genuinely has little to read.
 *
 * The wider triggers are tempting and wrong. "No brand" is the obvious one -
 * the brand feeds the ranking boost that pulls a matching listing forward -
 * but plenty of photos genuinely show no brand at all, and a stronger model
 * will not invent one, so escalating there pays full price for the same
 * empty field. It also is not load-bearing: the boost changes the ORDER
 * candidates are judged in, while the thing that guarantees a buried match
 * is still reached is the twelve-wide window, and that runs either way. Same
 * for a one-word product name next to a brand that did read: "Ralph Lauren"
 * plus "eyeglasses" is a perfectly usable hint.
 *
 * Getting this wrong is expensive rather than harmful, and the first version
 * of it got it wrong: it escalated on nearly every scan in the test suite,
 * which is how a cheap extraction quietly becomes an expensive one.
 */
function readFailed(read: VisionExtraction): boolean {
  return read.imageQuality === "good" && !(read.productName || "").trim();
}

// ════════════════════════════════════════════════════════════════
// LAYER 6: the visual verification gate.
//
// ONE CALL PER WAVE, NOT ONE CALL PER CANDIDATE. The reference photo is
// roughly 1,600 tokens and a candidate thumbnail roughly 150, so a
// pairwise call spends nearly all of its input re-sending the same photo.
// Sending that photo once alongside six candidates costs about half what
// six pairwise calls cost even with the photo cached, and roughly what six
// calls to a cheap model would cost without it - which is how the strong
// model stays on every candidate. Numbers in scripts/cost-model.mjs.
//
// The risk this shape introduces is real and is handled in the prompt: a
// model shown six candidates at once can slide from judging each one
// absolutely into ranking them against each other, and "the closest of
// these six" is exactly the wrong answer. The instruction says so
// explicitly, and says that every candidate being "different" is a normal
// outcome. Comparative context also cuts the other way and helps: a
// different colourway is easier to spot next to the right colourway than
// alone.
//
// A candidate whose image will not load cannot be judged and stays
// "different". An unjudgeable candidate is not given the benefit of the
// doubt.
// ════════════════════════════════════════════════════════════════
const VERIFY_BATCH_MAX = 6;

function buildBatchPrompt(count: number): string {
  return `You are shown IMAGE A (one photo) and ${count} candidate product listing image${count === 1 ? "" : "s"}, numbered 1 to ${count}.

For EACH candidate, decide whether it is the exact same physical product as IMAGE A — same model, same design, same distinguishing features — or merely a similar item of the same kind.

Judge the product only. IMAGE A is usually a photo or a screenshot, so ignore background, cropping, lighting, viewing angle, scale, watermarks, captions, on-screen text and app interface elements. A candidate is usually a catalogue photo of the same class of object on a plain background.

Weigh these in order, for every candidate:
1. Brand markings. If IMAGE A and a candidate both show a logo, wordmark or label and they belong to DIFFERENT brands, that candidate is "different" no matter how alike the shapes are.
2. Model-defining structure: silhouette, proportions, panel and seam layout, hardware, closures, frame and lens shape, control layout, and the number and placement of parts.
3. Colourway and finish. A different colour of the same model is "similar", not "exact".

Judge each candidate INDEPENDENTLY, in absolute terms, not against the other candidates. Do not rank them, and do not assume one of them must be the match: it is normal and expected for every candidate to be "different", and being the closest of the ones shown is never a reason to call something "exact".

Return ONLY a JSON array, one entry per candidate, in order:
[{"candidate": 1, "match": "exact" | "similar" | "different", "why": "a few words naming the feature that decided it"}]
"exact" = the same specific product and the same model, high confidence.
"similar" = same category, or same brand, but you cannot confirm it is the identical model.
"different" = clearly not the same product.
Be strict. Default to "similar" or "different" when uncertain. Never guess "exact".`;
}

function coerceVerdict(raw: unknown): VerificationResult | null {
  const entry = raw as { match?: unknown; why?: unknown; reasoning?: unknown } | null;
  const match = entry?.match;
  if (match !== "exact" && match !== "similar" && match !== "different") return null;
  const why = typeof entry?.why === "string" ? entry.why
    : typeof entry?.reasoning === "string" ? entry.reasoning
    : "";
  return { match, reasoning: why };
}

async function verifyVisualMatchBatch(
  reference: { data: string; mimeType: string },
  candidateImageUrls: string[],
  model: string
): Promise<VerificationResult[]> {
  const unavailable = (): VerificationResult => ({ match: "different", reasoning: "verification unavailable" });
  const results: VerificationResult[] = candidateImageUrls.map(unavailable);
  if (!process.env.ANTHROPIC_API_KEY || candidateImageUrls.length === 0) return results;

  const images = await Promise.all(
    candidateImageUrls.map(url => (url ? fetchImageAsBase64(url) : Promise.resolve(null)))
  );
  const present: { index: number; image: { data: string; mimeType: string } }[] = [];
  images.forEach((image, index) => { if (image) present.push({ index, image }); });
  if (present.length === 0) return results;

  const content: Record<string, unknown>[] = [
    { type: "text", text: "IMAGE A (the photo being scanned):" },
    {
      type: "image",
      source: { type: "base64", media_type: reference.mimeType, data: reference.data },
      // The reference photo is byte-identical for every wave and every pass
      // in a scan, so it is marked as a cache breakpoint: the first wave
      // writes it and every later one reads it back at a tenth of the
      // price. Note this only works on the strong model — its minimum
      // cacheable prefix is 512 tokens, while the cheap model's is 4,096,
      // which no image can reach. That asymmetry is the reason the gate
      // batches rather than downgrades.
      cache_control: { type: "ephemeral" },
    },
  ];
  present.forEach((_, slot) => {
    content.push({ type: "text", text: `CANDIDATE ${slot + 1}:` });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: present[slot].image.mimeType,
        data: present[slot].image.data,
      },
    });
  });
  content.push({ type: "text", text: buildBatchPrompt(present.length) });

  const data = await callClaude(model, {
    max_tokens: 120 + present.length * 60,
    messages: [{ role: "user", content }],
  }, 30000);

  const parsed = parseModelJson(data);
  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { verdicts?: unknown[] } | null)?.verdicts)
      ? (parsed as { verdicts: unknown[] }).verdicts
      : [];
  if (list.length === 0) return results;

  // Read the candidate number the model echoed back rather than trusting
  // position, and fall back to position when it omitted one. A verdict that
  // cannot be tied to a candidate is dropped, leaving that candidate
  // unjudged rather than mislabeled.
  list.forEach((raw, position) => {
    const verdict = coerceVerdict(raw);
    if (!verdict) return;
    const stated = (raw as { candidate?: unknown }).candidate;
    const slot = typeof stated === "number" && stated >= 1 && stated <= present.length
      ? stated - 1
      : position;
    if (slot < 0 || slot >= present.length) return;
    results[present[slot].index] = verdict;
  });

  return results;
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type") || "image/jpeg";
    if (!mimeType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 4_500_000) return null;
    return { data: buf.toString("base64"), mimeType };
  } catch {
    return null;
  }
}

// Google Lens can only be handed a URL, so the uploaded photo has to be
// publicly reachable for the few seconds the reverse-image call takes. The
// URL is unguessable (128 bits of randomness in the filename) and the blob
// is deleted by discardLensUpload() the moment the search returns, with the
// daily cron as a backstop for anything a crashed request left behind.
// The privacy policy describes exactly this, because it has to.
async function uploadForLensSearch(imageBase64: string, mimeType: string): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const ext = mimeType.split("/")[1]?.split("+")[0] || "jpg";
    const buf = Buffer.from(imageBase64, "base64");
    const secret = randomBytes(16).toString("hex");
    const blob = await put(`${LENS_BLOB_PREFIX}${Date.now()}-${secret}.${ext}`, buf, {
      access: "public",
      contentType: mimeType,
      addRandomSuffix: false,
    });
    return blob.url;
  } catch {
    return null;
  }
}

// Deleted as soon as the reverse-image search that needed it has returned.
// A scan should not leave a copy of someone's screenshot sitting on a public
// URL for up to a day waiting on a cron job.
async function discardLensUpload(url: string | null): Promise<void> {
  if (!url || !process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await del(url);
  } catch { /* the daily cleanup cron is the backstop */ }
}

// ════════════════════════════════════════════════════════════════
// LAYER 2: Google Lens reverse image search via SerpApi (primary)
// ════════════════════════════════════════════════════════════════
// v9.1: hardcoded to the US index regardless of the requester's location.
// The US Shopping/Lens index is by far the deepest and is where the actual
// wholesale floor price for dropshipped products (AliExpress/Temu/Wish-style
// cross-border listings) reliably surfaces. Restricting to the user's own
// country degrades search depth without making the verdict more accurate —
// the markup is real regardless of which country's index found the floor
// price. Locality is handled separately via the shippingNote disclosure.
async function searchLensViaSerpApi(imageUrl: string): Promise<ShoppingMatch | null> {
  if (!process.env.SERPAPI_KEY) return null;

  try {
    const params = new URLSearchParams({
      engine: "google_lens",
      url: imageUrl,
      api_key: process.env.SERPAPI_KEY,
      hl: "en",
      country: "us",
    });

    const res = await fetch(`https://serpapi.com/search.json?${params}`, {
      signal: AbortSignal.timeout(14000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    // ── THE IDENTIFICATION FIX ──
    // Lens answers "what is this object". It only sometimes also answers
    // "what does it cost", and those are two different questions.
    //
    // What used to happen here: every match without a price was deleted as
    // the very first operation, and what survived was then sorted
    // cheapest-first. Both halves of that destroyed identification. The
    // filter threw away the most visually identical result in the response
    // whenever Google had no price for it — routine for a brand's own
    // product page — and the sort replaced Lens's best-match-first
    // ordering, the one real identification signal in the payload, with an
    // ordering that knows nothing about what the photo shows. The
    // verification gate downstream then saw the five CHEAPEST rows instead
    // of the five most similar ones, and when none of them matched it
    // presented the cheapest row as the "closest match". That is the exact
    // mechanism by which a photo of Ralph Lauren eyeglasses came back as an
    // unrelated brand, and by which a photo of one Under Armour bag came
    // back as a different, cheaper Under Armour bag.
    //
    // Now: every match Google returned is kept in the order Google returned
    // it, with `exact_matches` (its own "this is the same image" set, when
    // present) ahead of `visual_matches`. Price is recorded when there is
    // one and left at 0 when there is not. Nothing is ranked, filtered or
    // discarded by price before the gate has had a chance to check it.
    //
    // (The exact_matches shape is SerpApi-documented but not verified
    // against a live response from here, so it is parsed defensively: a
    // missing or differently-shaped field simply contributes nothing.)
    const ordered = [
      ...(Array.isArray(data.exact_matches) ? data.exact_matches : []),
      ...(Array.isArray(data.visual_matches) ? data.visual_matches : []),
    ] as Record<string, unknown>[];

    const candidates: ShoppingCandidate[] = [];
    const seen = new Set<string>();
    for (const m of ordered) {
      // A thumbnail is the ONE genuinely required field. The gate compares
      // images, so a candidate with no image cannot be checked, and an
      // uncheckable candidate is not a candidate. Everything else,
      // including the price, is optional.
      const imageUrl = String(m.thumbnail || "");
      if (!imageUrl) continue;

      const productUrl = String(m.link || "");
      const dedupeKey = productUrl || imageUrl;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const price = m.price as { extracted_value?: number } | undefined;
      const extracted = typeof price?.extracted_value === "number" ? price.extracted_value : 0;
      candidates.push({
        price: extracted > 0.5 ? extracted : 0,
        title: String(m.title || ""),
        imageUrl,
        productUrl,
        source: String(m.source || ""),
        productId: m.product_id ? String(m.product_id) : undefined,
        rank: candidates.length,
      });
      // Far more than the gate will ever check. Bounded only so a
      // hundred-row response does not get carried around for no reason.
      if (candidates.length >= 40) break;
    }

    return buildShoppingMatch(candidates);
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// LAYER 3: Google Lens reverse image search via Serper (backup)
// NOTE: verify exact response field names against a live Serper
// /lens response before shipping — schema below is best-effort and
// defensively parsed so a mismatch degrades to null, not a crash.
// ════════════════════════════════════════════════════════════════
async function searchLensViaSerper(imageUrl: string): Promise<ShoppingMatch | null> {
  if (!process.env.SERPER_API_KEY) return null;

  try {
    const res = await fetch("https://google.serper.dev/lens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": process.env.SERPER_API_KEY,
      },
      body: JSON.stringify({ url: imageUrl, gl: "us", hl: "en" }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    // Same two fixes as the SerpApi path above: an unpriced visual match
    // is kept (it is often the best match), and the engine's own
    // best-match-first order is preserved instead of being replaced with a
    // price sort. A missing image is still disqualifying, because the
    // verification gate has nothing to compare without one.
    const raw: Record<string, unknown>[] = data.organic || data.visualMatches || data.matches || [];
    const candidates: ShoppingCandidate[] = [];
    for (const m of raw) {
      const imageUrl = String(m.imageUrl || m.thumbnail || "");
      if (!imageUrl) continue;
      const priceRaw = m.price ?? m.extractedPrice;
      const parsedPrice = parseFloat(String(priceRaw ?? "").replace(/[^0-9.]/g, "")) || 0;
      candidates.push({
        price: parsedPrice > 0.5 ? parsedPrice : 0,
        title: String(m.title || ""),
        imageUrl,
        productUrl: String(m.link || m.url || ""),
        source: String(m.source || m.domain || ""),
        rank: candidates.length,
      });
      if (candidates.length >= 40) break;
    }

    return buildShoppingMatch(candidates);
  } catch {
    return null;
  }
}

const STOPWORDS = new Set([
  "the", "a", "an", "for", "with", "and", "or", "of", "to", "in", "on", "at",
  "new", "best", "pro", "set", "kit", "pack", "piece", "pcs", "premium",
]);

function significantWords(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

// Keeps a shopping-search candidate only if its title shares enough of the
// query's SIGNIFICANT words — not just an overlapping generic category term.
// Short queries (2-3 significant words) require ALL of them; longer queries
// (full page titles, which carry marketing filler) only need a majority.
// If filtering would wipe out every result, returns the original list
// unfiltered — a loose match plus the downstream visual verification gate
// is better than no result at all.
function filterRelevantCandidates(candidates: ShoppingCandidate[], query: string): ShoppingCandidate[] {
  const queryWords = significantWords(query);
  if (queryWords.length <= 1) return candidates;

  const required = queryWords.length <= 3 ? queryWords.length : Math.ceil(queryWords.length * 0.6);
  const filtered = candidates.filter(c => {
    const titleWords = new Set(significantWords(c.title));
    const overlap = queryWords.filter(w => titleWords.has(w)).length;
    return overlap >= required;
  });

  return filtered.length > 0 ? filtered : candidates;
}

// A shorter, blunter fallback query — top N significant words only. Used
// when a rich/specific query returns nothing: sometimes "most specific
// possible" is too narrow for what's actually listed elsewhere online.
function simplifyQuery(text: string, maxWords = 4): string {
  return significantWords(text).slice(0, maxWords).join(" ");
}

// ════════════════════════════════════════════════════════════════
// LAYER 4 + 5: Shopping text search (store-targeted, then generic)
// ════════════════════════════════════════════════════════════════
async function searchShoppingViaSerper(query: string): Promise<ShoppingMatch | null> {
  if (!process.env.SERPER_API_KEY) return null;
  try {
    const res = await fetch("https://google.serper.dev/shopping", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": process.env.SERPER_API_KEY },
      body: JSON.stringify({ q: query, gl: "us", hl: "en", num: 10 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    // A text shopping search is a PRICE source, so a row with no price
    // contributes nothing here — unlike a Lens visual match, which is an
    // IDENTIFICATION source and is kept whether it carries a price or not.
    // What is no longer done is the price sort: the engine's own relevance
    // order is what decides which rows the verification gate looks at, and
    // sorting by price meant a correct match could only be identified if
    // it also happened to be the cheapest thing in the response. The
    // cheapest CONFIRMED row is still what wins — chosen after
    // identification, in verifyCandidates, rather than before it.
    const priced = ((data.shopping || []) as Record<string, unknown>[])
      .map((r) => ({
        price: parseFloat(String(r.price || "0").replace(/[^0-9.]/g, "")) || 0,
        title: String(r.title || ""),
        imageUrl: String(r.imageUrl || r.thumbnailUrl || ""),
        productUrl: String(r.link || ""),
        source: String(r.source || ""),
      }))
      .filter((r) => r.price > 0.5 && r.imageUrl);
    const results: ShoppingCandidate[] = priced.map((r, i) => ({ ...r, rank: i }));

    return buildShoppingMatch(filterRelevantCandidates(results, query));
  } catch {
    return null;
  }
}

async function searchShoppingViaSerpApi(query: string): Promise<ShoppingMatch | null> {
  if (!process.env.SERPAPI_KEY) return null;
  try {
    const params = new URLSearchParams({
      engine: "google_shopping", q: query, api_key: process.env.SERPAPI_KEY,
      num: "10", gl: "us", hl: "en",
    });
    const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const data = await res.json();

    // Relevance order preserved, price sort removed — same reasoning as
    // the Serper shopping path above.
    const results: ShoppingCandidate[] = ((data.shopping_results || []) as Record<string, unknown>[])
      .filter((r) => typeof r.extracted_price === "number" && (r.extracted_price as number) > 0.5 && r.thumbnail)
      .map((r, i) => ({
        price: r.extracted_price as number,
        title: String(r.title || ""),
        imageUrl: String(r.thumbnail || ""),
        productUrl: String(r.product_link || r.link || ""),
        source: String(r.source || ""),
        productId: r.product_id ? String(r.product_id) : undefined,
        rank: i,
      }));

    return buildShoppingMatch(filterRelevantCandidates(results, query));
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// DIRECT-RETAILER LAYER — the general fix, not an Amazon special case.
//
// Google's Shopping graph is not a neutral index of the whole internet.
// Several of the largest retailers deliberately limit how much of their
// catalog surfaces there, because each wants searches happening on their
// own site, not leaking traffic through Google. For a mainstream product
// enough secondary indexing usually exists that a listing leaks through
// anyway. For a smaller or less-searched product, it frequently does not
// — the only thing the generic search sees is whatever the brand itself
// is paying to promote, while a genuinely cheaper listing on a major
// retailer sits completely invisible to that search. That is exactly
// backwards for a tool that exists to catch inflated direct pricing.
//
// The correct fix is not attempting to out-engineer anti-bot systems on
// arbitrary sites — that is a losing, constantly-breaking arms race, and
// on many sites amounts to circumventing access controls the site put up
// on purpose, which is not something to build. SerpApi's job is exactly
// this: legally, reliably retrieving structured data from these
// retailers' own search systems, maintaining that infrastructure so this
// product does not have to. This is a list of direct-retailer engines
// run in parallel on every scan, generalized so adding a fourth or fifth
// retailer later is one array entry, not a new function.
// ════════════════════════════════════════════════════════════════

interface RetailerProvider {
  name: string;
  engine: string;
  extraParams: Record<string, string>;
  parse: (data: Record<string, unknown>) => Array<{ price: number; title: string; imageUrl: string; productUrl: string; productId?: string }>;
}

const DIRECT_RETAILERS: RetailerProvider[] = [
  {
    name: "Amazon",
    engine: "amazon",
    extraParams: { amazon_domain: "amazon.com" },
    parse: (data) => {
      const results = (data.organic_results as Record<string, unknown>[]) || [];
      return results
        .filter(r => typeof r.extracted_price === "number" && (r.extracted_price as number) > 0.5 && r.thumbnail)
        .map(r => ({
          price: r.extracted_price as number,
          title: String(r.title || ""),
          imageUrl: String(r.thumbnail || ""),
          productUrl: String(r.link || r.link_clean || ""),
          productId: r.asin ? String(r.asin) : undefined,
        }));
    },
  },
  {
    name: "Walmart",
    engine: "walmart",
    extraParams: {},
    parse: (data) => {
      const results = (data.organic_results as Record<string, unknown>[]) || [];
      return results
        .filter(r => typeof r.primary_offer === "object" && r.primary_offer !== null)
        .map(r => {
          const offer = r.primary_offer as Record<string, unknown>;
          return {
            price: typeof offer.offer_price === "number" ? offer.offer_price : 0,
            title: String(r.title || ""),
            imageUrl: String(r.thumbnail || ""),
            productUrl: String(r.product_page_url || ""),
            productId: r.us_item_id ? String(r.us_item_id) : undefined,
          };
        })
        .filter(r => r.price > 0.5 && r.imageUrl);
    },
  },
  {
    name: "eBay",
    engine: "ebay",
    extraParams: { _nkw: "" }, // overwritten with the real query at call time
    parse: (data) => {
      const results = (data.organic_results as Record<string, unknown>[]) || [];
      return results
        .filter(r => typeof r.price === "object" && r.price !== null)
        .map(r => {
          const price = r.price as Record<string, unknown>;
          return {
            price: typeof price.extracted === "number" ? price.extracted : 0,
            title: String(r.title || ""),
            imageUrl: String(r.thumbnail || ""),
            productUrl: String(r.link || ""),
            productId: r.epid ? String(r.epid) : undefined,
          };
        })
        .filter(r => r.price > 0.5 && r.imageUrl);
    },
  },
];

async function searchDirectRetailer(provider: RetailerProvider, query: string): Promise<ShoppingMatch | null> {
  if (!process.env.SERPAPI_KEY) return null;
  try {
    const baseParams: Record<string, string> = {
      engine: provider.engine,
      api_key: process.env.SERPAPI_KEY,
      ...provider.extraParams,
    };
    // Each engine names its query parameter differently.
    if (provider.engine === "amazon") baseParams.k = query;
    else if (provider.engine === "ebay") baseParams._nkw = query;
    else baseParams.query = query;

    const params = new URLSearchParams(baseParams);
    const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const data = await res.json();

    // The retailer's own relevance ranking is a better first guess at
    // WHICH product this is than its price is, so that order is kept and
    // the cheapest verified listing is picked downstream, after the gate.
    const results: ShoppingCandidate[] = provider.parse(data)
      .map((r, i) => ({ ...r, source: provider.name, rank: i }));

    return buildShoppingMatch(filterRelevantCandidates(results, query));
  } catch {
    return null;
  }
}

// Runs every direct-retailer provider in parallel and returns the single
// cheapest one — visual verification against the actual scanned photo
// happens after this, one level up, exactly like every other candidate.
async function searchAllDirectRetailers(query: string): Promise<{ match: ShoppingMatch; source: string } | null> {
  const attempts = await Promise.all(
    DIRECT_RETAILERS.map(async provider => {
      const match = await searchDirectRetailer(provider, query);
      return match ? { match, source: provider.name } : null;
    })
  );
  const found = attempts.filter((a): a is { match: ShoppingMatch; source: string } => a !== null);
  if (found.length === 0) return null;
  return found.reduce((cheapest, current) =>
    current.match.lowestPrice < cheapest.match.lowestPrice ? current : cheapest
  );
}

// v9: tries progressively simpler queries instead of giving up after one.
// A highly specific enriched query is great when it works, but "most
// specific possible" can mean "matches nothing" for a niche product. This
// is the core fix for a valid product URL/screenshot coming back with no
// match at all — retry with the plain title, then a blunt top-words query,
// before conceding nothing can be found.
async function searchShoppingWithFallbacks(
  queries: string[]
): Promise<{ match: ShoppingMatch; engineUsed: string } | null> {
  const seen = new Set<string>();
  for (const raw of queries) {
    const q = (raw || "").trim();
    if (!q || q.length < 3 || seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());

    let match = await searchShoppingViaSerper(q);
    if (match) return { match, engineUsed: "serper" };
    match = await searchShoppingViaSerpApi(q);
    if (match) return { match, engineUsed: "serpapi" };
  }
  return null;
}

// ════════════════════════════════════════════════════════════════
// Candidate lists are no longer price-ordered, so nothing here may be read
// positionally. `candidates` arrives in the engine's own best-match-first
// order and stays that way, because that order is what the identification
// gate needs; the price range is computed across the whole list instead of
// being taken from its two ends, and the list may legitimately contain
// records with no price at all.
//
// The pre-verification lead is still the cheapest priced record — what it
// has always been — and lowestPrice is still that same record's own price
// rather than a minimum borrowed from a different row, because price and
// link have to come from one record (see applyVerifiedCandidate). Every
// path that has a reference image overwrites this lead with the verified
// winner. The one path that does not is a URL scan of a page with no
// usable product photo, where there is no visual identification signal to
// prefer and "cheapest relevant listing" is the honest answer.
// ════════════════════════════════════════════════════════════════
function buildShoppingMatch(candidates: ShoppingCandidate[]): ShoppingMatch | null {
  if (candidates.length === 0) return null;
  const priced = candidates.filter(c => c.price > 0);
  const lead = priced.length > 0
    ? priced.reduce((best, c) => (c.price < best.price ? c : best), priced[0])
    : candidates[0];
  return {
    title: lead.title,
    lowestPrice: lead.price,
    highestPrice: priced.length > 0 ? Math.max(...priced.map(c => c.price)) : 0,
    imageUrl: lead.imageUrl,
    productUrl: lead.productUrl,
    source: lead.source,
    productId: lead.productId,
    candidates,
  };
}

// ════════════════════════════════════════════════════════════════
// v9 FIX 1 — price/link consistency.
// Once verifyCandidates() picks a "best" candidate, EVERY field shown to
// the person — price, image, url, title, source — must come from that
// SAME candidate record. The previous version spread the verified
// candidate's fields onto the match but then separately recalculated
// lowestPrice as the minimum across ALL original candidates, which could
// be a DIFFERENT candidate than the one whose link/image was kept. That's
// exactly "price from one listing, link to a different listing."
// highestPrice is left as the original range's top end deliberately — it
// only ever feeds a retail ESTIMATE, which carries no link, so it isn't
// subject to the same must-match-the-link constraint.
//
// v10 FIX — the verified candidate is not necessarily the cheapest one in
// the list. Overwriting lowestPrice with a candidate priced above the
// original range's top end produced an inverted range (lowest > highest),
// which downstream reads as a negative markup and a negative "savings"
// number on a FINDER card. The range is re-widened so it always contains
// the price actually being shown.
// ════════════════════════════════════════════════════════════════
function applyVerifiedCandidate(
  match: ShoppingMatch,
  verified: { best: ShoppingCandidate; confidence: "exact" | "likely" | "unverified" }
): ShoppingMatch {
  return {
    ...match,
    title: verified.best.title,
    imageUrl: verified.best.imageUrl,
    productUrl: verified.best.productUrl,
    source: verified.best.source,
    productId: verified.best.productId,
    lowestPrice: verified.best.price,
    highestPrice: Math.max(match.highestPrice, verified.best.price),
  };
}

// ════════════════════════════════════════════════════════════════
// Merchant-link resolution — SerpApi/Serper shopping results sometimes
// link to a Google search/product page rather than the actual merchant.
// ════════════════════════════════════════════════════════════════
function isGoogleDomain(url: string): boolean {
  if (!url) return true;
  try {
    return new URL(url).hostname.includes("google.");
  } catch {
    return true;
  }
}

// NOTE: response shape (sellers_results.online_sellers[].link) is SerpApi's
// documented Google Product API pattern — not verified against a live
// response from here, so it degrades to null rather than throwing.
async function resolveSerpApiMerchantLink(productId: string): Promise<string | null> {
  if (!process.env.SERPAPI_KEY || !productId) return null;
  try {
    const params = new URLSearchParams({
      engine: "google_product",
      product_id: productId,
      api_key: process.env.SERPAPI_KEY,
      gl: "us", hl: "en",
    });
    const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const sellers: Record<string, unknown>[] = data.sellers_results?.online_sellers || [];
    const direct = sellers.find(s => typeof s.link === "string" && !isGoogleDomain(String(s.link)));
    return direct ? String(direct.link) : null;
  } catch {
    return null;
  }
}

async function resolveMerchantLink(url: string, productId?: string): Promise<{ url: string; isDirect: boolean }> {
  if (url && !isGoogleDomain(url)) return { url, isDirect: true };
  if (productId) {
    const resolved = await resolveSerpApiMerchantLink(productId);
    if (resolved) return { url: resolved, isDirect: true };
  }
  // No genuine direct merchant link could be resolved. Returning the raw
  // Google-hosted URL as a last resort is still better than no link at all,
  // but it must never be labeled as if it goes straight to the product —
  // that is exactly the "it just searched it in Google" complaint a real
  // user hit. isDirect: false lets the UI be honest about which kind of
  // link this actually is.
  return { url: url || "", isDirect: false };
}

// ════════════════════════════════════════════════════════════════
// PRODUCT-PAGE DISCOVERY — when a screenshot shows a store name, seller
// handle, or a visible URL, try to find and read the ACTUAL product page
// before falling back to a generic text search.
// ════════════════════════════════════════════════════════════════
const SEARCH_EXCLUDED_DOMAINS = [
  "google.", "facebook.com", "instagram.com", "tiktok.com", "pinterest.com",
  "youtube.com", "twitter.com", "x.com", "reddit.com", "linkedin.com",
];

function isExcludedSearchDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return SEARCH_EXCLUDED_DOMAINS.some(d => host.includes(d));
  } catch {
    return true;
  }
}

function normalizeUrlCandidate(raw: string): string | null {
  const candidate = raw.trim();
  if (!candidate) return null;
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  try {
    const parsed = new URL(withScheme);
    return parsed.hostname.includes(".") ? withScheme : null;
  } catch {
    return null;
  }
}

async function searchOrganicViaSerper(query: string): Promise<string[]> {
  if (!process.env.SERPER_API_KEY) return [];
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": process.env.SERPER_API_KEY },
      body: JSON.stringify({ q: query, gl: "us", hl: "en", num: 5 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const organic: Record<string, unknown>[] = data.organic || [];
    return organic.map(r => String(r.link || "")).filter(Boolean);
  } catch {
    return [];
  }
}

async function searchOrganicViaSerpApi(query: string): Promise<string[]> {
  if (!process.env.SERPAPI_KEY) return [];
  try {
    const params = new URLSearchParams({
      engine: "google", q: query, api_key: process.env.SERPAPI_KEY, num: "5", gl: "us", hl: "en",
    });
    const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json();
    const organic: Record<string, unknown>[] = data.organic_results || [];
    return organic.map(r => String(r.link || "")).filter(Boolean);
  } catch {
    return [];
  }
}

async function findStoreProductUrl(storeName: string, brand: string, productName: string): Promise<string | null> {
  const bareStoreName = storeName.replace(/^@/, "").trim();
  const looksLikeDomain = /\.[a-z]{2,}$/i.test(bareStoreName) && !bareStoreName.includes(" ");
  const query = looksLikeDomain
    ? `site:${bareStoreName.replace(/^https?:\/\//i, "").replace(/^www\./i, "")} ${productName}`
    : `${bareStoreName} ${brand} ${productName}`.trim();

  let links = await searchOrganicViaSerper(query);
  if (links.length === 0) links = await searchOrganicViaSerpApi(query);

  const candidate = links.find(l => !isExcludedSearchDomain(l));
  return candidate || null;
}

// Social-platform redirect links (Instagram's /s/ swipe-up shortlinks,
// TikTok's t.tiktok.com shortlinks, generic link-in-bio shorteners) resolve
// to a JS-rendered interstitial, not real product HTML — fetching them
// wastes a round trip and never produces usable data. When a visible URL
// matches one of these, treat it as a signal (platform confirmed) rather
// than a fetchable page, and go straight to store-name search discovery.
const REDIRECT_ONLY_DOMAINS = ["instagram.com/s/", "t.tiktok.com", "vm.tiktok.com", "lnk.bio", "linktr.ee"];

function isRedirectOnlyUrl(url: string): boolean {
  return REDIRECT_ONLY_DOMAINS.some(d => url.includes(d));
}

async function discoverAndFetchProductPage(vision: VisionExtraction): Promise<PageProductData | null> {
  let targetUrl: string | null = null;

  if (vision.visibleUrl && !isRedirectOnlyUrl(vision.visibleUrl)) {
    targetUrl = normalizeUrlCandidate(vision.visibleUrl);
  }
  if (!targetUrl && vision.storeName) {
    targetUrl = await findStoreProductUrl(vision.storeName, vision.brand, vision.productName);
  }
  if (!targetUrl) return null;

  const html = await fetchProductPageHtml(targetUrl);
  if (!html) return null;

  const pageData = await extractPageProductData(html);
  if (!pageData.title && !pageData.price) return null;

  return pageData;
}

// ════════════════════════════════════════════════════════════════
// LAYER 7: Category-average fallback — always an explicit estimate
// ════════════════════════════════════════════════════════════════
const CATEGORY_DATA: Record<string, { wholesaleRatio: number; avgRetail: number }> = {
  beauty:      { wholesaleRatio: 0.11, avgRetail: 48 },
  skincare:    { wholesaleRatio: 0.09, avgRetail: 68 },
  fitness:     { wholesaleRatio: 0.13, avgRetail: 58 },
  tech:        { wholesaleRatio: 0.15, avgRetail: 85 },
  fashion:     { wholesaleRatio: 0.17, avgRetail: 62 },
  accessories: { wholesaleRatio: 0.12, avgRetail: 48 },
  home:        { wholesaleRatio: 0.14, avgRetail: 52 },
  pet:         { wholesaleRatio: 0.15, avgRetail: 42 },
  food:        { wholesaleRatio: 0.28, avgRetail: 28 },
  other:       { wholesaleRatio: 0.14, avgRetail: 52 },
};

// The image pipeline gets its category from the vision model. The URL
// pipeline has no vision step, so rather than spend another paid call on a
// field that only feeds analytics, it is inferred from the text the page
// already gave us. Deterministic, free, and using the exact same vocabulary
// the vision prompt uses so the two halves of the ledger stay comparable.
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  skincare: ["serum", "moisturis", "moisturiz", "cleanser", "skincare", "retinol", "hyaluronic", "gua sha", "jade roller", "spf", "sunscreen", "toner"],
  beauty: ["makeup", "lipstick", "mascara", "foundation", "whitening", "lash", "nail", "hair", "shampoo", "perfume", "fragrance", "brush"],
  fitness: ["workout", "fitness", "gym", "dumbbell", "resistance band", "yoga", "massage gun", "treadmill", "protein"],
  tech: ["charger", "earbud", "headphone", "bluetooth", "usb", "laptop", "phone case", "camera", "speaker", "smart watch", "led", "projector"],
  fashion: ["dress", "shirt", "hoodie", "jacket", "jeans", "shoes", "sneaker", "skirt", "coat", "sweater"],
  accessories: ["watch", "bag", "wallet", "sunglasses", "jewelry", "jewellery", "necklace", "bracelet", "ring", "belt", "earring"],
  home: ["diffuser", "lamp", "cushion", "kitchen", "blanket", "organiser", "organizer", "storage", "candle", "vacuum", "decor"],
  pet: ["dog", "cat", "pet", "puppy", "kitten", "leash", "litter", "aquarium"],
  food: ["snack", "coffee", "tea", "supplement", "vitamin", "powder", "gummies", "protein bar"],
};

function inferCategory(...parts: string[]): string {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  if (!text) return "other";
  let best = "other";
  let bestHits = 0;
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    const hits = words.reduce((n, w) => (text.includes(w) ? n + 1 : n), 0);
    if (hits > bestHits) {
      bestHits = hits;
      best = category;
    }
  }
  return best;
}

function proxyImage(url: string): string {
  if (!url) return "";
  return `/api/proxy-image?url=${encodeURIComponent(url)}`;
}

// Titles arrive from merchant listings and product pages, so they carry
// whatever punctuation and boilerplate the seller typed. Two things get
// normalized before the card renders one: em/en dashes (BustedLab renders
// none anywhere, and a stray one from a scraped title breaks the typographic
// signature the card is built on), and runaway length, since the evidence
// strip is a single ellipsized line and a 200-character SEO title tells the
// reader nothing the first 90 characters didn't.
function cleanTitle(raw: string): string {
  const normalized = (raw || "")
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= 90) return normalized;
  return normalized.slice(0, 89).replace(/[\s,;:|-]+$/, "") + "\u2026";
}

// ════════════════════════════════════════════════════════════════
// THE IDENTIFICATION GATE.
//
// This function decides what the photo shows. Everything on the card —
// the price, the link, the markup, the verdict — is downstream of it, so
// it is the single most accuracy-critical function in the codebase. Four
// things about it are deliberate:
//
// 1. It reads candidates in the ENGINE's relevance order, not in price
//    order. Price order used to decide which five candidates got checked
//    at all, which made being cheap a precondition for being identified.
// 2. It reorders that list by the identity hints an earlier layer already
//    read off the photo — the brand, the product words — as a ranking
//    boost that never deletes anything. This is what puts a listing that
//    actually carries the brand on the photo ahead of an unrelated brand
//    with a similar shape.
// 3. It checks a WIDE window, in two waves. The first wave covers the
//    engine's top few; the second only runs when nothing in the first
//    came back "exact", which is exactly the case where the right answer
//    is sitting further down the list. A correct match at rank seven used
//    to be unreachable.
// 4. Within the best confidence tier it found, it picks the CHEAPEST
//    record. That one rule serves both questions this product answers:
//    "am I being overcharged" needs the real floor price for the thing in
//    the photo, and "where is it cheapest" needs the same floor price for
//    the same thing. Neither is served by a cheap listing for a different
//    object, which is what price-first ordering produced.
//
// When nothing verifies at all, it returns the engine's own best-ranked
// candidate and the caller labels it unverified. The old fallback returned
// candidates[0] of a price-sorted list: an arbitrary cheap item, presented
// as "closest match". That is how a clear photo of Ralph Lauren glasses
// came back as a completely unrelated brand.
// ════════════════════════════════════════════════════════════════
// How wide the gate looks. Two different numbers, because two different
// things are at stake.
//
// When IDENTITY is being established, the window is wide: this is where a
// correct match sitting at rank seven has to be reachable, and it is the
// whole reason the narrow window was a bug. Batching makes the width nearly
// free - two calls cover twelve candidates.
//
// When identity is already established and only a PRICE REPLACEMENT is at
// stake - the pricing search for a confirmed-but-unpriced product, the
// rebrand sweep, the direct-retailer sweep - the window is narrow. Those
// pools are searched with a name the gate has already confirmed, and the
// worst case for missing an entry is that the incumbent listing (already
// confirmed, already priced) is kept. Failing to find a cheaper copy of the
// right product is a smaller harm than naming the wrong product, and it is
// the only place in this engine where that asymmetry is used to save money.
const VERIFY_WAVE_ONE = 6;
const VERIFY_WINDOW = 12;
const VERIFY_WINDOW_PRICING = 4;

interface GateOptions {
  hints?: IdentityHints;
  budget?: Budget;
  /** Defaults to the wide identification window. */
  window?: number;
  /** "degraded" moves the gate to the cheap model and caps what it may claim. */
  mode?: SpendMode;
}

/**
 * Does this candidate carry the brand the vision pass read off the photo?
 * Used twice: to pull such candidates forward in the queue, and - when the
 * gate has been degraded to the cheap model - as the second, independent
 * signal without which a cheap "exact" is not allowed to claim anything.
 */
function brandConsistent(candidate: ShoppingCandidate, hints?: IdentityHints): boolean {
  const brandWords = significantWords(hints?.brand || "");
  if (brandWords.length === 0) return false;
  const titleWords = new Set(significantWords(candidate.title));
  const sourceWords = new Set(significantWords(candidate.source));
  return brandWords.every(w => titleWords.has(w) || sourceWords.has(w));
}

// A free relevance boost, applied to the ORDER candidates are checked in
// and never used to remove any of them. The vision pass has already read
// the brand and the product words off the photo, so a candidate whose
// title or merchant carries that brand is likelier to be the same object
// than one that does not, and it deserves to be looked at first. It cannot
// manufacture a false positive on its own: every candidate it promotes
// still has to pass the visual gate to count for anything.
function rankForVerification(candidates: ShoppingCandidate[], hints?: IdentityHints): ShoppingCandidate[] {
  const brandWords = significantWords(hints?.brand || "");
  const nameWords = significantWords(hints?.productName || "");
  if (brandWords.length === 0 && nameWords.length === 0) return candidates;

  const scored = candidates.map((candidate, index) => {
    const titleWords = new Set(significantWords(candidate.title));
    const nameHits = nameWords.filter(w => titleWords.has(w)).length;
    // Engine rank stays the primary signal. A full brand match is worth
    // four places and each matching product word half a place: enough to
    // pull the right candidate into the first wave, never enough to bury a
    // strong visual match under keyword noise.
    const score = candidate.rank - (brandConsistent(candidate, hints) ? 4 : 0) - nameHits * 0.5;
    return { candidate, index, score };
  });

  scored.sort((a, b) => (a.score === b.score ? a.index - b.index : a.score - b.score));
  return scored.map(s => s.candidate);
}

async function verifyCandidates(
  match: ShoppingMatch,
  reference: { data: string; mimeType: string },
  options: GateOptions = {}
): Promise<{ best: ShoppingCandidate; confidence: "exact" | "likely" | "unverified" }> {
  const window = options.window ?? VERIFY_WINDOW;
  const degraded = options.mode === "degraded";
  const model = degraded ? GATE_MODEL_DEGRADED : GATE_MODEL;

  const ordered = rankForVerification(match.candidates, options.hints).slice(0, window);
  if (ordered.length === 0) return { best: match.candidates[0], confidence: "unverified" };

  const checked: { candidate: ShoppingCandidate; result: VerificationResult }[] = [];
  const runWave = async (wave: ShoppingCandidate[]) => {
    for (let i = 0; i < wave.length; i += VERIFY_BATCH_MAX) {
      const slice = wave.slice(i, i + VERIFY_BATCH_MAX);
      const results = await verifyVisualMatchBatch(reference, slice.map(c => c.imageUrl), model);
      slice.forEach((candidate, j) => checked.push({ candidate, result: results[j] }));
    }
  };

  await runWave(ordered.slice(0, VERIFY_WAVE_ONE));

  // Second wave, only when the first produced no confirmed identity. A
  // buried correct match is precisely what a narrow window misses, and it
  // is worth the extra call. When the top of the list has already
  // confirmed, spending it would only be hunting for a cheaper copy of
  // something the direct-retailer layer downstream already hunts for.
  const secondWave = ordered.slice(VERIFY_WAVE_ONE);
  const confirmed = () => checked.some(c => c.result.match === "exact");
  if (!confirmed() && secondWave.length > 0 && (!options.budget || options.budget.allows(VERIFY_WAVE_COST_MS))) {
    await runWave(secondWave);
  }

  // The two tiers are not the same decision, and treating them as one
  // would smuggle the original bug back in a smaller form.
  //
  // "exact" means identity is CONFIRMED, so the cheapest confirmed record
  // wins: identity first, price second. Every record in that tier is the
  // same object, so choosing the cheapest is choosing a better price for
  // the thing in the photo, which is what both intents want.
  //
  // "similar" means identity is NOT confirmed — same category, or same
  // brand, nothing more. In that tier the engine's own ranking is the
  // strongest evidence available, and price must not override it: a
  // cheaper lookalike eight places down is not a better price, it is a
  // likelier wrong product wearing a smaller number. So the best-ranked
  // record wins there, preferring one that publishes a price because a
  // record without one cannot carry the figure on the card.
  //
  // In both tiers, when the chosen record has no price at all — normal for
  // Lens, where the best match is often a brand's own page — the caller
  // prices it with a second, now-accurate search (priceVerifiedIdentity).
  const pick = (tier: "exact" | "similar", rule: "cheapest" | "best-ranked"): ShoppingCandidate | null => {
    // `checked` is in ranked order (wave one, then wave two), so index 0 of
    // a tier is its best-ranked member.
    const inTier = checked.filter(c => c.result.match === tier).map(c => c.candidate);
    if (inTier.length === 0) return null;
    const priced = inTier.filter(c => c.price > 0);
    if (rule === "best-ranked") return priced[0] || inTier[0];
    if (priced.length === 0) return inTier[0];
    return priced.reduce((best, c) => (c.price < best.price ? c : best), priced[0]);
  };

  // DEGRADED CONFIDENCE. When the spend governor has taken the gate down to
  // the cheap model, the gate is no longer allowed to say "exact" — the
  // card's strongest label has to mean what it says, and what produced it
  // was not the judge that label was calibrated on. Its best available
  // answer becomes "likely", and only for a candidate that ALSO carries the
  // brand read off the photo, which is a second signal the model did not
  // produce. Anything less corroborated is "unverified", which still
  // returns a full FINDER result and simply never carries a markup
  // accusation. That is the honest shape of "we are running cheap right
  // now", and it is why degrading is survivable: the product keeps
  // answering, it just stops making its strongest claim.
  const settle = (
    candidate: ShoppingCandidate,
    confidence: "exact" | "likely"
  ): { best: ShoppingCandidate; confidence: "exact" | "likely" | "unverified" } => {
    if (!degraded) return { best: candidate, confidence };
    if (brandConsistent(candidate, options.hints)) return { best: candidate, confidence: "likely" };
    return { best: candidate, confidence: "unverified" };
  };

  const exact = pick("exact", "cheapest");
  if (exact) return settle(exact, "exact");
  const similar = pick("similar", "best-ranked");
  if (similar) return settle(similar, "likely");

  // Nothing verified. The honest answer is the engine's own top-ranked
  // candidate, labeled unverified — not the cheapest thing in the list.
  // The highest-ranked PRICED candidate is preferred only because a record
  // with no price cannot carry the one number this product exists to show;
  // if none of them has a price, the top-ranked one is returned and the
  // caller refuses to invent a number for it.
  return { best: ordered.find(c => c.price > 0) || ordered[0], confidence: "unverified" };
}

// ════════════════════════════════════════════════════════════════
// IDENTIFY, THEN PRICE.
//
// Google Lens answers "what is this". It answers "what does it cost" only
// when a merchant happened to publish a price Google could parse, which
// for the single most visually identical result is often not the case.
// Deleting those results was the original bug. Finding their price is the
// fix, and it is the same two-step Google itself runs: once the gate has
// CONFIRMED which product the photo shows, the confirmed product's own
// title is a far better search string than anything a vision pass could
// guess, so it drives a precise pricing search — and every listing that
// search returns goes back through the same visual gate before a single
// one of its prices is believed.
//
// The price is only adopted from a listing verified at no less confidence
// than the identification it is pricing, and price, link, image and title
// then all come from that one record. A title search can drift onto a
// different variant, and an unverified price hung off a verified identity
// would be exactly the "price from one listing, link to another" failure
// this engine is built to refuse.
// ════════════════════════════════════════════════════════════════
function queryFromTitle(title: string): string {
  const cleaned = (title || "").replace(/\s+/g, " ").trim();
  return cleaned.length <= 110 ? cleaned : cleaned.slice(0, 110).replace(/\s+\S*$/, "");
}

async function priceVerifiedIdentity(
  identified: ShoppingMatch,
  confidence: "exact" | "likely",
  reference: { data: string; mimeType: string },
  gate: GateOptions
): Promise<{ match: ShoppingMatch; engineUsed: string } | null> {
  const title = queryFromTitle(identified.title);
  if (title.length < 3) return null;
  if (gate.budget && !gate.budget.allows(PRICING_SEARCH_COST_MS)) return null;

  const queries = [title, simplifyQuery(title, 6)];
  const hinted = `${gate.hints?.brand || ""} ${gate.hints?.productName || ""}`.trim();
  if (hinted.length >= 3) queries.push(hinted);

  const found = await searchShoppingWithFallbacks(queries);
  if (!found || found.match.lowestPrice <= 0) return null;

  // Identity is already settled; this pool exists only to attach a price to
  // it, so the narrow window applies.
  const verified = await verifyCandidates(found.match, reference, { ...gate, window: VERIFY_WINDOW_PRICING });
  if (rankConfidence(verified.confidence) < rankConfidence(confidence)) return null;
  if (verified.best.price <= 0) return null;

  return { match: applyVerifiedCandidate(found.match, verified), engineUsed: found.engineUsed };
}

// ════════════════════════════════════════════════════════════════
// REUSING AN IDENTIFICATION SOMEONE ELSE ALREADY PAID FOR.
//
// The traffic pattern this product is built to create is thousands of
// people photographing ONE product within a few hours. Every one of those
// photos is a different file, so the byte-keyed scan cache in redis.ts
// misses on all of them, and each one paid for a fresh identification.
// That is the largest avoidable cost in exactly the moment that matters.
//
// What makes reuse safe here is that a cache hit is a HYPOTHESIS, not a
// conclusion, and it is checked against this specific photo before it is
// used:
//
//   1. The fingerprint has to match (see identity-cache.ts - it is derived
//      from Google's own answer, not from the pixels, so no client can
//      forge it).
//   2. The cached listing has to appear in THIS scan's candidate set too,
//      which means Google, looking at this photo, returned the same listing
//      it returned for the earlier one.
//   3. The brand read off THIS photo has to be consistent with the cached
//      title.
//   4. One visual comparison has to come back "exact".
//
// That fourth check runs on the cheap model on purpose, and it is the one
// place in this engine where the cheap model touches identification. It is
// safe because of what it is allowed to do: it can only ACCEPT an
// identification the strong model already made for a photo that
// fingerprinted the same way, and anything short of "exact" falls straight
// through to the full gate. It cannot produce a new identification, and a
// wrong answer from it costs a wasted call, not a wrong product.
//
// A hit keeps full confidence even when the engine is degraded, because the
// identification being reused was not made by the cheap model. That is what
// keeps a viral product producing full-strength verdicts during exactly the
// spike that would otherwise have spent the budget.
// ════════════════════════════════════════════════════════════════
async function reuseIdentification(
  pool: ShoppingMatch,
  fingerprint: Fingerprint | null,
  reference: { data: string; mimeType: string },
  gate: GateOptions
): Promise<ShoppingMatch | null> {
  if (!fingerprint) return null;

  const present = new Set(
    pool.candidates.map(c => normalizeListingUrl(c.productUrl)).filter(Boolean)
  );
  const hit = await lookupIdentity(fingerprint, (entry: CachedIdentity, via) => {
    // Overlap is measured against the LENS LISTINGS the entry was
    // identified from, not against the winning record's own URL - the
    // winner usually comes from a downstream pricing layer and is not in
    // any Lens pool. See CachedIdentity.anchors.
    const overlap = (entry.anchors || []).filter(url => present.has(url)).length;
    // The two lookup paths do not carry the same weight. A "set" hit means
    // the whole top-of-response listing set was identical, which is already
    // a strong same-product signal, so one confirming listing is enough. A
    // "listing" hit means only ONE listing matched - and one shared listing
    // can happen between two different products of the same brand, which is
    // exactly the confusion this engine exists to avoid - so that path has
    // to show at least two.
    if (overlap < (via === "set" ? 1 : 2)) return false;
    const brandWords = significantWords(gate.hints?.brand || "");
    if (brandWords.length === 0) return true;
    const titleWords = new Set(significantWords(entry.title));
    return brandWords.every(w => titleWords.has(w));
  });
  if (!hit) return null;

  const [confirmation] = await verifyVisualMatchBatch(
    reference, [hit.entry.imageUrl], GATE_MODEL_DEGRADED
  );
  if (confirmation.match !== "exact") return null;

  return {
    title: hit.entry.title,
    lowestPrice: hit.entry.price,
    highestPrice: Math.max(hit.entry.highestPrice, hit.entry.price),
    imageUrl: hit.entry.imageUrl,
    productUrl: hit.entry.productUrl,
    source: hit.entry.source,
    productId: hit.entry.productId,
    candidates: pool.candidates,
  };
}

// A challenger from a later layer only displaces the incumbent if it is at
// least as well identified. Price alone used to be enough, which meant a
// cheaper "likely" match could evict a confirmed "exact" one — trading the
// thing in the photo for something that merely resembles it. A strictly
// better identification wins even at a higher price, because a price for
// the wrong product is not a cheaper price, it is a wrong answer.
function shouldReplace(
  incumbentConfidence: "exact" | "likely" | "unverified",
  incumbentPrice: number,
  challengerConfidence: "exact" | "likely" | "unverified",
  challengerPrice: number
): boolean {
  if (challengerConfidence === "unverified" || challengerPrice <= 0) return false;
  const incumbentRank = rankConfidence(incumbentConfidence);
  const challengerRank = rankConfidence(challengerConfidence);
  if (challengerRank !== incumbentRank) return challengerRank > incumbentRank;
  return challengerPrice < (incumbentPrice > 0 ? incumbentPrice : Infinity);
}

// ════════════════════════════════════════════════════════════════
// URL PAGE FETCHING + STRUCTURED EXTRACTION
// ════════════════════════════════════════════════════════════════
async function fetchProductPageHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("xml")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractMetaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

function extractJsonLdProduct(html: string): Partial<PageProductData> {
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const block of blocks) {
    const inner = block.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!inner) continue;
    try {
      const parsed = JSON.parse(inner[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : (parsed["@graph"] || [parsed]);
      for (const node of nodes) {
        const type = node?.["@type"];
        const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
        if (!isProduct) continue;

        const price = extractCanonicalOfferPrice(node.offers);
        const rawImage = node.image;
        const imageUrl = Array.isArray(rawImage) ? rawImage[0] : (typeof rawImage === "object" && rawImage ? rawImage.url : rawImage);
        const offersForCurrency = Array.isArray(node.offers) ? node.offers[0] : node.offers;

        return {
          title: typeof node.name === "string" ? node.name : undefined,
          price: price,
          currency: typeof offersForCurrency?.priceCurrency === "string" ? offersForCurrency.priceCurrency : undefined,
          imageUrl: typeof imageUrl === "string" ? imageUrl : undefined,
          description: typeof node.description === "string" ? node.description : undefined,
        };
      }
    } catch {
      continue;
    }
  }
  return {};
}

function extractCanonicalOfferPrice(offers: unknown): number | null {
  if (!offers) return null;

  if (Array.isArray(offers)) {
    const SUBSCRIPTION_HINTS = /subscri|installment|per\s*month|\/mo\b|autoship|klarna|afterpay|affirm/i;
    const candidates = offers.filter((o: Record<string, unknown>) => {
      const text = `${o?.name || ""} ${o?.description || ""}`;
      return typeof o?.price !== "undefined" && !SUBSCRIPTION_HINTS.test(String(text));
    });
    const pool = candidates.length > 0 ? candidates : offers;
    const prices = pool
      .map((o: Record<string, unknown>) => parseFloat(String(o?.price ?? "")))
      .filter((p: number) => !isNaN(p) && p > 0);
    return prices.length > 0 ? Math.max(...prices) : null;
  }

  const single = offers as Record<string, unknown>;
  if (typeof single.price !== "undefined") {
    const p = parseFloat(String(single.price));
    return !isNaN(p) && p > 0 ? p : null;
  }

  return null;
}

function extractMicrodataPrice(html: string): { price: number | null; currency: string | null } {
  const priceMatch =
    html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["'][^>]*itemprop=["']price["']/i);
  const currencyMatch =
    html.match(/itemprop=["']priceCurrency["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["'][^>]*itemprop=["']priceCurrency["']/i);

  const price = priceMatch ? parseFloat(priceMatch[1].replace(/[^0-9.]/g, "")) : null;
  return {
    price: price && price > 0 ? price : null,
    currency: currencyMatch ? currencyMatch[1] : null,
  };
}

function extractMetaProduct(html: string): Partial<PageProductData> {
  const priceRaw = extractMetaContent(html, "product:price:amount") || extractMetaContent(html, "og:price:amount");
  return {
    title: extractMetaContent(html, "og:title") || undefined,
    price: priceRaw ? parseFloat(priceRaw.replace(/[^0-9.]/g, "")) : null,
    currency: extractMetaContent(html, "product:price:currency") || extractMetaContent(html, "og:price:currency") || undefined,
    imageUrl: extractMetaContent(html, "og:image") || undefined,
    description: extractMetaContent(html, "og:description") || extractMetaContent(html, "description") || undefined,
  };
}

function stripHtmlForText(html: string, maxLength = 6000): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const text = withoutScripts.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, maxLength);
}

async function extractProductViaClaudeText(html: string): Promise<Partial<PageProductData>> {
  if (!process.env.ANTHROPIC_API_KEY) return {};
  const text = stripHtmlForText(html);
  if (text.length < 50) return {};

  const data = await callClaude(TEXT_MODEL, {
    max_tokens: 200,
    messages: [{
      role: "user",
      content: `Extract the product name and price from this product page text. Return ONLY JSON:
{"title": "product name or empty string", "price": null or number, "currency": "USD"}
CRITICAL: price must be the main one-time purchase price of this exact product as currently displayed by default. Never a per-installment amount ("4 payments of $X"), a subscription/subscribe-and-save price, a shipping cost, or a price for a different variant/bundle than the one shown by default. If several prices appear and it's unclear which is the main displayed price, return null rather than guessing.
CRITICAL: title must include defining material/type descriptors, not a bare generic category word. Use "jade roller" not "roller".

PAGE TEXT:
${text}`,
    }],
  }, 12000);

  const parsed = parseModelJson(data) as { title?: unknown; price?: unknown; currency?: unknown } | null;
  if (!parsed) return {};
  return {
    title: typeof parsed.title === "string" && parsed.title ? parsed.title : undefined,
    price: typeof parsed.price === "number" ? parsed.price : null,
    currency: typeof parsed.currency === "string" ? parsed.currency : undefined,
  };
}

async function buildEnrichedSearchQuery(title: string, description: string, rawText: string): Promise<string> {
  const fallback = title;
  if (!process.env.ANTHROPIC_API_KEY) return fallback;

  const context = [title, description, rawText].filter(Boolean).join("\n\n").slice(0, 8000);
  if (context.length < 20) return fallback;

  const data = await callClaude(TEXT_MODEL, {
    max_tokens: 120,
    messages: [{
      role: "user",
      content: `Based on this product page content, write the single most specific shopping search query for finding this exact product (or the closest possible match) elsewhere online.

Include distinguishing descriptors the content actually mentions: material, specific type or variant, notable features (e.g. "dual-head", "2-in-1", number of pieces, mechanism, size). Do not include the brand or store name. Do not include marketing filler words ("premium", "best-selling", "amazing"). Do not invent details the text doesn't support.

Return ONLY the search query text. No quotes, no JSON, no explanation, nothing else.

PRODUCT TITLE: ${title || "(none given)"}

PAGE CONTENT:
${context}`,
    }],
  }, 12000);

  const content = (data?.content as { text?: string }[] | undefined) || [];
  const query = String(content[0]?.text || "").trim().replace(/^["']|["']$/g, "");
  return query.length >= 3 ? query : fallback;
}

async function extractPageProductData(html: string): Promise<PageProductData> {
  const jsonLd = extractJsonLdProduct(html);
  const microdata = extractMicrodataPrice(html);
  const meta = extractMetaProduct(html);

  let title = jsonLd.title || meta.title || "";
  let price = jsonLd.price ?? microdata.price ?? meta.price ?? null;
  let currency = jsonLd.currency || microdata.currency || meta.currency || "USD";
  const imageUrl = jsonLd.imageUrl || meta.imageUrl || "";
  const description = jsonLd.description || meta.description || "";

  if (!price) {
    const viaClaude = await extractProductViaClaudeText(html);
    title = title || viaClaude.title || "";
    price = price ?? viaClaude.price ?? null;
    currency = currency !== "USD" ? currency : (viaClaude.currency || currency);
  }

  const rawText = stripHtmlForText(html, 9000);
  const searchQuery = await buildEnrichedSearchQuery(title, description, rawText);

  return { title, price, currency, imageUrl, description, searchQuery: searchQuery || title };
}

// ════════════════════════════════════════════════════════════════
// MAIN SCAN — image upload
//
// `country` is used ONLY for the shippingNote disclosure below — it does
// NOT affect what gets searched (see file header: search is always
// targeted at the US index). Should be a 2-letter ISO code detected from
// the requester's IP. On Vercel, the API route can read this directly from
// a header Vercel sets automatically — no separate geo-IP service needed:
//
//   const country = req.headers.get("x-vercel-ip-country") || "us";
//   const result = await scanProduct(imageBase64, mimeType, country);
//
// If omitted, defaults to "us" (no shipping note shown).
// ════════════════════════════════════════════════════════════════
export async function scanProduct(imageBase64: string, mimeType: string, country?: string, intent?: "verdict" | "finder"): Promise<ScanResult> {
  const requesterCountry = sanitizeCountry(country);
  const budget = createBudget();
  // Read once, applied for the whole scan. "degraded" means the day's model
  // budget is spent or the API is pushing back: the gate moves to the cheap
  // model, caps what it is allowed to claim, and the enhancement layers are
  // skipped. See model-budget.ts.
  const spendMode = await currentSpendMode();
  const vision = await extractFromImage(imageBase64, mimeType, spendMode);
  // What the vision pass read off the photo. Used to ORDER candidates for
  // the identification gate and to build fallback queries — never to
  // filter a candidate out. See rankForVerification.
  const hints: IdentityHints = { brand: vision.brand, productName: vision.productName };

  let shopping: ShoppingMatch | null = null;
  let engineUsed = "none";
  let confidence: "exact" | "likely" | "unverified" = "unverified";
  // The image every candidate is compared against. It is the scanned photo,
  // unless identification ends up running off a product photo found on the
  // seller's own page, in which case the whole verification chain stays
  // consistent with the image that actually established the identity.
  let reference = { data: imageBase64, mimeType };
  const gate: GateOptions = { hints, budget, mode: spendMode };

  // ── Try Lens first: match on pixels, not words ──
  const lensImageUrl = await uploadForLensSearch(imageBase64, mimeType);
  if (lensImageUrl) {
    shopping = await searchLensViaSerpApi(lensImageUrl);
    if (shopping) engineUsed = "lens_serpapi";
    if (!shopping) {
      shopping = await searchLensViaSerper(lensImageUrl);
      if (shopping) engineUsed = "lens_serper";
    }
    // The temporary public copy exists only for the duration of the Lens
    // call. It goes as soon as that call is done.
    await discardLensUpload(lensImageUrl);
  }

  // ── Has someone already identified this product? ──
  //    Checked before the gate runs, because a hit replaces the entire gate
  //    with one cheap confirmation. Only the image pipeline does this: a URL
  //    scan of the same page already collapses onto one entry in the
  //    route's own cache, so there is nothing here for it to win.
  let fingerprint: Fingerprint | null = null;
  let servedFromIdentityCache = false;
  if (shopping) {
    fingerprint = lensFingerprint(shopping.candidates.map(c => c.productUrl));
    const reused = await reuseIdentification(shopping, fingerprint, reference, gate);
    if (reused) {
      shopping = reused;
      confidence = "exact";
      engineUsed = `${engineUsed}+reused`;
      servedFromIdentityCache = true;
    }
  }

  if (shopping && !servedFromIdentityCache) {
    const verified = await verifyCandidates(shopping, reference, gate);
    // Honest pass-through: a genuinely unverified visual match stays
    // unverified. It used to be silently upgraded to "likely" here, which
    // rendered as "VISUAL MATCH CONFIRMED" on a product that was never
    // actually confirmed - the exact mismatch a real scan surfaced (a
    // different colorway of the same shoe, badged as confirmed).
    confidence = verified.confidence;
    shopping = applyVerifiedCandidate(shopping, verified);
  }

  // ── Product-page discovery: if Lens found nothing and vision saw a store
  //    name or a visible URL, find and READ the actual product page before
  //    falling back to a generic text search. ──
  let discoveredPage: PageProductData | null = null;
  if (!shopping && (vision.storeName || vision.visibleUrl)) {
    discoveredPage = await discoverAndFetchProductPage(vision);

    if (discoveredPage) {
      if (discoveredPage.imageUrl) {
        const pageImage = await fetchImageAsBase64(discoveredPage.imageUrl);
        if (pageImage) {
          const lensUrl = await uploadForLensSearch(pageImage.data, pageImage.mimeType);
          if (lensUrl) {
            shopping = await searchLensViaSerpApi(lensUrl);
            if (shopping) engineUsed = "store_page_lens_serpapi";
            if (!shopping) {
              shopping = await searchLensViaSerper(lensUrl);
              if (shopping) engineUsed = "store_page_lens_serper";
            }
            await discardLensUpload(lensUrl);
          }
          if (shopping) {
            // Identity is being established from the photo on the seller's
            // own product page, so that photo becomes the reference every
            // later check in this scan compares against.
            reference = { data: pageImage.data, mimeType: pageImage.mimeType };
            const verified = await verifyCandidates(shopping, reference, gate);
            // Same honesty fix as above - no artificial upgrade of a
            // genuinely unverified match.
            confidence = verified.confidence;
            shopping = applyVerifiedCandidate(shopping, verified);
          }
        }
      }

      if (!shopping && discoveredPage.searchQuery) {
        const found = await searchShoppingWithFallbacks(
          [discoveredPage.searchQuery, discoveredPage.title, simplifyQuery(discoveredPage.searchQuery)]
        );
        if (found) {
          shopping = found.match;
          engineUsed = `store_page_${found.engineUsed}`;
          const verified = await verifyCandidates(shopping, reference, gate);
          confidence = verified.confidence;
          shopping = applyVerifiedCandidate(shopping, verified);
        }
      }
    }
  }

  // ── Store-name-targeted text search — fallback if discovery above found
  //    nothing usable, or wasn't attempted. ──
  if (!shopping && vision.storeName) {
    const storeQuery = `${vision.storeName} ${vision.brand} ${vision.productName} ${vision.quantity}`.trim();
    const found = await searchShoppingWithFallbacks([storeQuery, `${vision.brand} ${vision.productName} ${vision.quantity}`.trim()]);
    if (found) {
      shopping = found.match;
      engineUsed = `store_${found.engineUsed}`;
      const verified = await verifyCandidates(shopping, reference, gate);
      confidence = verified.confidence;
      shopping = applyVerifiedCandidate(shopping, verified);
    }
  }

  // ── Generic brand/product text search, last resort before category guess ──
  if (!shopping) {
    const base = vision.brand ? `${vision.brand} ${vision.productName}` : (vision.productName || "");
    const genericQuery = `${base} ${vision.quantity}`.trim();
    if (base) {
      const found = await searchShoppingWithFallbacks([genericQuery, base, vision.productName]);
      if (found) {
        shopping = found.match;
        engineUsed = `generic_${found.engineUsed}`;
        const verified = await verifyCandidates(shopping, reference, gate);
        confidence = verified.confidence;
        shopping = applyVerifiedCandidate(shopping, verified);
      }
    }
  }

  // ── Identify, then price. The gate has confirmed WHAT this is; if the
  //    record it confirmed publishes no price of its own, the confirmed
  //    name now drives a precise pricing search whose results go back
  //    through the same gate. This is what makes keeping unpriced visual
  //    matches safe, and it is the half of the flow Google performs
  //    separately too. ──
  if (shopping && !servedFromIdentityCache && confidence !== "unverified" && shopping.lowestPrice <= 0) {
    const priced = await priceVerifiedIdentity(shopping, confidence, reference, gate);
    if (priced) {
      shopping = priced.match;
      engineUsed = `${engineUsed}+priced_${priced.engineUsed}`;
    }
  }

  // ── Rebrand check + direct-retailer check, run as one step.
  //
  //    Rebrand: many products sold under a brand name are the same
  //    unbranded item from the original manufacturer with a label added,
  //    so the product gets searched once more with the brand stripped and
  //    described only by its generic features.
  //
  //    Direct retailer: Google's Shopping graph structurally
  //    under-represents several major retailers' own catalogs — a niche or
  //    smaller-brand product frequently shows up there only via the
  //    brand's own paid listing, with a genuinely cheaper Amazon, Walmart
  //    or eBay listing entirely invisible to that search. Now that the
  //    product has been identified, the CONFIRMED title drives that query
  //    instead of the vision pass's guess at a name, which is a better
  //    search string for the same reason it is a better pricing query.
  //
  //    Both are independent searches for a cheaper source of the same
  //    product, both verified against the same reference image, and
  //    neither depends on the other's result — running them sequentially
  //    only spent a clock this scan does not have. Both apply to every
  //    scan regardless of which intent the visitor chose: they happen
  //    before the VERDICT/FINDER branch below, not after it.
  //
  //    Adoption goes through shouldReplace(), so a cheaper challenger can
  //    no longer evict a better-identified incumbent. ──
  //    Skipped on two conditions beyond the clock. On a reused
  //    identification, because the cached record is what the SAME layers
  //    produced for this product within the last hour - the stored price is
  //    already the cheapest verified one, so re-running them buys a
  //    re-measurement of the same answer. And in degraded mode, because
  //    these layers only ever improve a price that already exists, which is
  //    the first thing worth giving up when the budget is gone. ──
  if (shopping && !servedFromIdentityCache && spendMode === "full" && budget.allows(ALTERNATIVE_LAYER_COST_MS)) {
    const identifiedTitle = confidence !== "unverified" ? queryFromTitle(shopping.title) : "";
    const visionQuery = (vision.brand ? `${vision.brand} ${vision.productName}` : (vision.productName || "")).trim();
    const retailerQuery = identifiedTitle.length >= 3 ? identifiedTitle : visionQuery;
    const unbrandedQuery = `${vision.productName} ${vision.category} ${vision.quantity}`.trim();
    const canRebrand = !!(vision.brand && vision.productName);

    const [unbrandedFound, retailerFound] = await Promise.all([
      canRebrand
        ? searchShoppingWithFallbacks([unbrandedQuery, vision.productName])
        : Promise.resolve(null),
      retailerQuery.length >= 3
        ? searchAllDirectRetailers(retailerQuery)
        : Promise.resolve(null),
    ]);

    if (unbrandedFound && unbrandedFound.match.lowestPrice > 0) {
      const unbrandedVerified = await verifyCandidates(
        unbrandedFound.match, reference, { ...gate, window: VERIFY_WINDOW_PRICING }
      );
      if (shouldReplace(confidence, shopping.lowestPrice, unbrandedVerified.confidence, unbrandedVerified.best.price)) {
        shopping = applyVerifiedCandidate(unbrandedFound.match, unbrandedVerified);
        engineUsed = `unbranded_${unbrandedFound.engineUsed}`;
        confidence = unbrandedVerified.confidence;
      }
    }

    if (retailerFound && retailerFound.match.lowestPrice > 0 && budget.allows(VERIFY_WAVE_COST_MS)) {
      const retailerVerified = await verifyCandidates(
        retailerFound.match, reference, { ...gate, window: VERIFY_WINDOW_PRICING }
      );
      if (shouldReplace(confidence, shopping.lowestPrice, retailerVerified.confidence, retailerVerified.best.price)) {
        shopping = applyVerifiedCandidate(retailerFound.match, retailerVerified);
        engineUsed = `direct_${retailerFound.source.toLowerCase()}`;
        confidence = retailerVerified.confidence;
      }
    }
  }

  // ── Identified, but unpriceable.
  //    Every layer above has run, including a pricing search against the
  //    confirmed product name, and nothing anywhere published a price for
  //    this item. There is no honest card to render: the whole result is
  //    built around a real number attached to a real link, and pulling a
  //    number out of a category average while linking to a listing that
  //    never stated a price is precisely the fabrication this engine
  //    refuses to commit. Same outcome the URL pipeline has always
  //    produced in this situation. Only reachable now that unpriced
  //    candidates survive to the gate at all. ──
  const hasSourcePrice = !!shopping && shopping.lowestPrice > 0;
  if (shopping && !hasSourcePrice) return getUnresolvedResult();

  // ── Publish the identification for the next person to scan this product.
  //    Written here, at the end, so what gets stored is the answer AFTER
  //    every pricing layer has run - which is why a later scan can reuse it
  //    and skip those layers rather than having to redo them. Only a
  //    confirmed, priced identification is worth storing, and never one the
  //    cache itself supplied: refreshing an entry on every hit would let an
  //    hour-old price live forever. ──
  if (shopping && !servedFromIdentityCache && confidence === "exact" && hasSourcePrice) {
    await storeIdentity(fingerprint, {
      title: shopping.title,
      price: shopping.lowestPrice,
      highestPrice: shopping.highestPrice,
      imageUrl: shopping.imageUrl,
      productUrl: shopping.productUrl,
      source: shopping.source,
      productId: shopping.productId,
      engineUsed,
      confidence: "exact",
      anchors: fingerprint?.listings || [],
      at: Date.now(),
    });
  }

  // ── Determine retail price ──
  let retailPrice: number;
  let retailSource: "screenshot" | "estimated";
  if (vision.visiblePrice && vision.visiblePrice > 0) {
    retailPrice = vision.visiblePrice;
    retailSource = "screenshot";
  } else if (discoveredPage?.price && discoveredPage.price > 0) {
    retailPrice = discoveredPage.price;
    retailSource = "screenshot";
  } else if (shopping && shopping.highestPrice > 0) {
    retailPrice = shopping.highestPrice;
    retailSource = "estimated";
  } else {
    const cat = CATEGORY_DATA[vision.category] || CATEGORY_DATA.other;
    retailPrice = cat.avgRetail;
    retailSource = "estimated";
  }

  // ── Determine wholesale price ──
  // v9: no longer silently invents a number when the found price isn't
  // actually cheaper than retail (the old `retailPrice * 0.35` fabrication
  // — a fake number with no real link behind it, the same bug class as
  // Fix 1, just self-inflicted instead of from a mismatched candidate).
  // If the real found price doesn't support a markup claim, that's handled
  // honestly below by downgrading to FINDER instead of faking a VERDICT.
  const wholesalePrice = shopping && shopping.lowestPrice > 0
    ? shopping.lowestPrice
    : retailPrice * (CATEGORY_DATA[vision.category] || CATEGORY_DATA.other).wholesaleRatio;

  const { markup, savings, savingsPercent, verdict } = calculateVerdict(retailPrice, wholesalePrice);

  // ── Gate: a confident VERDICT requires THREE things, not two.
  //    1. a visually verified match,
  //    2. pricing that actually supports a markup claim (wholesale really
  //       is cheaper than retail), and
  //    3. an OBSERVED retail price — one read off the screenshot itself or
  //       off the seller's own product page.
  //
  //    (3) is the accuracy fix that matters most. Without it, a scan with
  //    no visible price fell back to `shopping.highestPrice`: the most
  //    expensive listing found on some third merchant. The card would then
  //    print "Retail asking $X" and accuse a seller of a markup using a
  //    price that seller never charged, which is both wrong and the one
  //    kind of wrong that is trivially disprovable by anyone who opens the
  //    listing. An estimated retail figure still produces a full FINDER
  //    result with the real source price attached; it just never carries a
  //    confident BUSTED. ──
  const engineHadRealMatch = !!shopping;
  // hasSourcePrice is stated explicitly rather than inferred: a wholesale
  // figure derived from a category ratio is an estimate, and an estimate
  // can never be the basis of a markup accusation against a named seller.
  const pricingSupportsVerdict = hasSourcePrice && wholesalePrice > 0 && wholesalePrice < retailPrice;
  const retailPriceWasObserved = retailSource === "screenshot";
  // "Where is it cheapest?" is an explicit request to skip the markup
  // framing entirely, even when a confirmed verdict would otherwise be
  // possible. It is a display choice the visitor made, not an accuracy
  // fallback, so it overrides VERDICT unconditionally rather than only
  // applying when something else already failed.
  const mode: ScanResult["mode"] =
    intent === "finder" ? (engineHadRealMatch ? "FINDER" : "UNRESOLVED")
    : engineHadRealMatch && confidence !== "unverified" && pricingSupportsVerdict && retailPriceWasObserved ? "VERDICT"
    : engineHadRealMatch ? "FINDER"
    : "UNRESOLVED";

  const finalConfidence: "high" | "medium" | "low" =
    confidence === "exact" && vision.visiblePrice ? "high"
    : confidence === "exact" || (confidence === "likely" && vision.visiblePrice) ? "high"
    : confidence === "likely" ? "medium"
    : "low";

  const linkResolution = shopping?.productUrl
    ? await resolveMerchantLink(shopping.productUrl, shopping.productId)
    : { url: "", isDirect: false };
  const resolvedUrl = linkResolution.url;
  const linkIsDirect = linkResolution.isDirect;

  return {
    found: engineHadRealMatch,
    mode,
    priceSource: retailSource,
    engineUsed,
    matchConfidence: confidence,
    category: vision.category || "other",
    shippingNote: buildShippingNote(resolvedUrl, requesterCountry),
    sourceProduct: {
      title: cleanTitle(shopping?.title || discoveredPage?.title || vision.productName) || "Similar product found",
      price: parseFloat(wholesalePrice.toFixed(2)),
      currency: vision.currency || "USD",
      imageUrl: proxyImage(shopping?.imageUrl || ""),
      productUrl: resolvedUrl,
      affiliateUrl: resolvedUrl,
      linkIsDirect,
      platform: shopping?.source || vision.platform || "Web",
    },
    analysis: {
      retailEstimate: parseFloat(retailPrice.toFixed(2)),
      retailSource,
      markup,
      verdict: mode === "VERDICT" ? verdict : "UNVERIFIED",
      savings,
      savingsPercent,
      confidence: finalConfidence,
    },
  };
}

// ════════════════════════════════════════════════════════════════
// URL SCAN — fetches the real page, reads it fully, and uses a multi-tier
// search fallback so a valid, readable product page should essentially
// always produce at least a FINDER result.
//
// `country` is used ONLY for the shippingNote disclosure — search always
// targets the US index regardless of the requester's location (see file
// header).
// ════════════════════════════════════════════════════════════════
export async function scanProductUrl(url: string, country?: string, intent?: "verdict" | "finder"): Promise<ScanResult> {
  const requesterCountry = sanitizeCountry(country);
  const budget = createBudget();
  const spendMode = await currentSpendMode();

  try {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return getUnresolvedResult();
    }

    // ── Step 1: fetch the real page and extract real product data ──
    const html = await fetchProductPageHtml(url);
    const pageData: PageProductData = html
      ? await extractPageProductData(html)
      : { title: "", price: null, currency: "USD", imageUrl: "", description: "", searchQuery: "" };

    let baseQuery = pageData.searchQuery || pageData.title;
    if (!baseQuery) {
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      const lastPart = pathParts[pathParts.length - 1] || "";
      baseQuery = lastPart.replace(/[-_]/g, " ").replace(/[^a-zA-Z0-9 ]/g, " ").trim();
    }
    if (!baseQuery || baseQuery.length < 3) return getUnresolvedResult();

    const pageImage = pageData.imageUrl ? await fetchImageAsBase64(pageData.imageUrl) : null;
    // There is no vision pass on this path, so the page's own title is the
    // only identity hint available for ordering candidates. Same rule as
    // the image path: it affects the order candidates are checked in,
    // never whether they are checked.
    const hints: IdentityHints = { productName: pageData.title };
    const gate: GateOptions = { hints, budget, mode: spendMode };

    // ── Step 2: search, Lens-first if we have a real photo ──
    let shopping: ShoppingMatch | null = null;
    let engineUsed = "none";
    let confidence: "exact" | "likely" | "unverified" = "unverified";

    if (pageImage) {
      const lensImageUrl = await uploadForLensSearch(pageImage.data, pageImage.mimeType);
      if (lensImageUrl) {
        shopping = await searchLensViaSerpApi(lensImageUrl);
        if (shopping) engineUsed = "url_lens_serpapi";
        if (!shopping) {
          shopping = await searchLensViaSerper(lensImageUrl);
          if (shopping) engineUsed = "url_lens_serper";
        }
        await discardLensUpload(lensImageUrl);
      }
    }

    // Multi-tier query fallback (enriched -> plain title -> blunt top
    // words) instead of one narrow attempt. This is the core fix for a
    // valid URL coming back UNRESOLVED — a specific query is great when it
    // works, but "most specific possible" can mean "matches nothing" for a
    // niche product.
    if (!shopping) {
      const found = await searchShoppingWithFallbacks(
        [baseQuery, pageData.title, simplifyQuery(baseQuery)]
      );
      if (found) {
        shopping = found.match;
        engineUsed = `url_${found.engineUsed}`;
      }
    }

    if (!shopping) return getUnresolvedResult();

    // ── Step 3: visual verification — only possible with a real photo.
    //    Without one, confidence honestly stays "unverified" (FINDER). ──
    if (pageImage) {
      const verified = await verifyCandidates(shopping, pageImage, gate);
      confidence = verified.confidence;
      shopping = applyVerifiedCandidate(shopping, verified);

      // Identify, then price — same second step as the image pipeline. A
      // Lens match confirmed against this page's own product photo can
      // easily be a record with no published price; the confirmed name is
      // then what finds one.
      if (confidence !== "unverified" && shopping.lowestPrice <= 0) {
        const priced = await priceVerifiedIdentity(shopping, confidence, pageImage, gate);
        if (priced) {
          shopping = priced.match;
          engineUsed = `${engineUsed}+priced_${priced.engineUsed}`;
        }
      }
    }

    // ── Direct-retailer check: same structural fix as the image-scan
    //    path. A URL scan of a smaller brand's own product page is
    //    exactly the case where Google's Shopping graph is most likely
    //    to only show that brand's own listing, with a cheaper Amazon,
    //    Walmart, or eBay copy invisible to it. Applies before the
    //    VERDICT/FINDER branch below, so it holds for every intent. ──
    if (shopping && pageImage && spendMode === "full" && budget.allows(ALTERNATIVE_LAYER_COST_MS)) {
      // Once the product has been identified, the confirmed title is a
      // better retailer query than the page-derived one, for the same
      // reason it is a better pricing query.
      const identifiedTitle = confidence !== "unverified" ? queryFromTitle(shopping.title) : "";
      const retailerQuery = identifiedTitle.length >= 3 ? identifiedTitle : baseQuery.trim();
      if (retailerQuery.length >= 3) {
        const retailerFound = await searchAllDirectRetailers(retailerQuery);
        if (retailerFound && retailerFound.match.lowestPrice > 0) {
          const retailerVerified = await verifyCandidates(
            retailerFound.match, pageImage, { ...gate, window: VERIFY_WINDOW_PRICING }
          );
          // Same rule as the image pipeline: a cheaper challenger never
          // evicts a better-identified incumbent.
          if (shouldReplace(confidence, shopping.lowestPrice, retailerVerified.confidence, retailerVerified.best.price)) {
            shopping = applyVerifiedCandidate(retailerFound.match, retailerVerified);
            engineUsed = `url_direct_${retailerFound.source.toLowerCase()}`;
            confidence = retailerVerified.confidence;
          }
        }
      }
    }

    // ── Step 4: retail price. A price read directly off the real page is
    //    as trustworthy as a visible price in a screenshot. ──
    let retailPrice: number;
    let retailSource: "screenshot" | "estimated";
    if (pageData.price && pageData.price > 0) {
      retailPrice = pageData.price;
      retailSource = "screenshot";
    } else if (shopping.highestPrice > 0) {
      retailPrice = shopping.highestPrice;
      retailSource = "estimated";
    } else {
      return getUnresolvedResult();
    }

    const wholesalePrice = shopping.lowestPrice;
    // Only bail on truly invalid data (no usable price at all). Whether the
    // pricing actually supports a "you're overpaying" claim is decided
    // below by VERDICT-vs-FINDER, not by refusing to return a result.
    if (wholesalePrice <= 0) return getUnresolvedResult();

    const { markup, savings, savingsPercent, verdict } = calculateVerdict(retailPrice, wholesalePrice);
    const pricingSupportsVerdict = wholesalePrice < retailPrice;
    // Same three-part gate as the image pipeline: a confident verdict needs
    // a verified match, a real gap, AND a retail price actually read off
    // the seller's own page. A markup claim built on some other merchant's
    // listing price is a claim the seller can disprove in one click.
    const retailPriceWasObserved = retailSource === "screenshot";
    // Same override as the image path - an explicit "just find the
    // cheapest price" request always suppresses the verdict framing.
    const mode: ScanResult["mode"] =
      intent === "finder" ? "FINDER"
      : confidence !== "unverified" && pricingSupportsVerdict && retailPriceWasObserved ? "VERDICT" : "FINDER";
    const linkResolution = await resolveMerchantLink(shopping.productUrl, shopping.productId);
    const resolvedUrl = linkResolution.url;
    const linkIsDirect = linkResolution.isDirect;

    return {
      found: true,
      mode,
      priceSource: retailSource,
      engineUsed,
      matchConfidence: confidence,
      category: inferCategory(pageData.title, pageData.description, shopping.title),
      shippingNote: buildShippingNote(resolvedUrl, requesterCountry),
      sourceProduct: {
        title: cleanTitle(pageData.title || shopping.title),
        price: parseFloat(wholesalePrice.toFixed(2)),
        currency: pageData.currency || "USD",
        imageUrl: proxyImage(shopping.imageUrl || pageData.imageUrl || ""),
        productUrl: resolvedUrl,
        affiliateUrl: resolvedUrl,
        linkIsDirect,
        platform: shopping.source,
      },
      analysis: {
        retailEstimate: parseFloat(retailPrice.toFixed(2)),
        retailSource,
        markup,
        verdict: mode === "VERDICT" ? verdict : "UNVERIFIED",
        savings,
        savingsPercent,
        confidence: mode === "VERDICT" ? (confidence === "exact" ? "high" : "medium") : "low",
      },
    };
  } catch {
    return getUnresolvedResult();
  }
}

// ════════════════════════════════════════════════════════════════
// UNRESOLVED — only reached when every real layer has failed. Never
// carries a fabricated verdict or a fake "BUSTED" number.
// ════════════════════════════════════════════════════════════════
export function getUnresolvedResult(): ScanResult {
  return {
    found: false,
    mode: "UNRESOLVED",
    priceSource: "estimated",
    engineUsed: "none",
    matchConfidence: "unverified",
    category: "other",
    sourceProduct: {
      title: "Product not identified",
      price: 0, currency: "USD", imageUrl: "", productUrl: "", affiliateUrl: "",
      platform: "unknown",
    },
    analysis: {
      retailEstimate: 0, retailSource: "estimated", markup: 0,
      verdict: "UNVERIFIED", savings: 0, savingsPercent: 0, confidence: "low",
    },
  };
}
