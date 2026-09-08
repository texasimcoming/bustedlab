/**
 * BustedLab Scan Engine v9.1 - Lens-first, verified, reads the real product
 * page whenever one can be found, price/link always from the same record,
 * and honest about locality without sacrificing search depth for it.
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
 * Cost per scan (worst case, all layers + fallback tiers hit):
 *   ~$0.0017 Haiku vision (extract) + ~$0.0005 Haiku (query enrichment)
 *   + ~$0.0017 Haiku vision (verify) + ~$0.004 Lens/Shopping/Search calls = ~$0.009
 */

import { put, del } from "@vercel/blob";
import { randomBytes } from "crypto";
import { LENS_BLOB_PREFIX } from "@/lib/constants";
// Classification lives in its own dependency-free module so the landing page
// can publish the same thresholds the engine applies, and so the calibration
// check can execute the real function rather than a copy of it.
import { calculateVerdict } from "@/lib/verdict";

export interface ScanResult {
  found: boolean;
  mode: "VERDICT" | "FINDER" | "UNRESOLVED";
  priceSource: "screenshot" | "estimated" | "shopping";
  engineUsed?: string;
  matchConfidence: "exact" | "likely" | "unverified";
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
  price: number;
  imageUrl: string;
  productUrl: string;
  source: string;
  title: string;
  productId?: string; // SerpApi product_id, when present — enables merchant-link resolution
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
async function extractFromImage(imageBase64: string, mimeType: string): Promise<VisionExtraction> {
  const defaults: VisionExtraction = {
    productName: "", brand: "", visiblePrice: null,
    currency: "USD", quantity: "", category: "other", platform: "unknown",
    storeName: "", visibleUrl: "", priceConfidence: "none", imageQuality: "poor",
  };

  if (!process.env.ANTHROPIC_API_KEY) return defaults;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
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
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();
    const text = data.content?.[0]?.text || "{}";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

// ════════════════════════════════════════════════════════════════
// LAYER 6: Claude Haiku Vision — visual verification gate
// ════════════════════════════════════════════════════════════════
async function verifyVisualMatch(
  originalImageBase64: string,
  originalMimeType: string,
  candidateImageUrl: string
): Promise<VerificationResult> {
  const fallback: VerificationResult = { match: "different", reasoning: "verification unavailable" };
  if (!process.env.ANTHROPIC_API_KEY || !candidateImageUrl) return fallback;

  const candidateBase64 = await fetchImageAsBase64(candidateImageUrl);
  if (!candidateBase64) return fallback;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "IMAGE A (original):" },
            { type: "image", source: { type: "base64", media_type: originalMimeType, data: originalImageBase64 } },
            { type: "text", text: "IMAGE B (candidate product listing):" },
            { type: "image", source: { type: "base64", media_type: candidateBase64.mimeType, data: candidateBase64.data } },
            {
              type: "text",
              text: `Is IMAGE B showing the exact same physical product as IMAGE A, with the same design, same shape and same distinguishing features, and not just a similar item in the same category?
Return ONLY JSON:
{"match": "exact" | "similar" | "different", "reasoning": "one short sentence"}
"exact" = same specific product, high confidence.
"similar" = same category/type but cannot confirm it's the identical item (different colorway, different design details, generic stock photo, etc).
"different" = clearly not the same product.
Be strict. Default to "similar" or "different" when uncertain. Never guess "exact".`,
            },
          ],
        }],
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();
    const text = data.content?.[0]?.text || "{}";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    if (parsed.match === "exact" || parsed.match === "similar" || parsed.match === "different") {
      return parsed;
    }
    return fallback;
  } catch {
    return fallback;
  }
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

    const matches = (data.visual_matches || [])
      .filter((m: Record<string, unknown>) => {
        const price = m.price as { extracted_value?: number } | undefined;
        return typeof price?.extracted_value === "number" && price.extracted_value > 0.5 && m.thumbnail;
      })
      .map((m: Record<string, unknown>) => {
        const price = m.price as { extracted_value: number };
        return {
          price: price.extracted_value,
          title: String(m.title || ""),
          imageUrl: String(m.thumbnail || ""),
          productUrl: String(m.link || ""),
          source: String(m.source || ""),
          productId: m.product_id ? String(m.product_id) : undefined,
        };
      })
      .sort((a: { price: number }, b: { price: number }) => a.price - b.price);

    return buildShoppingMatch(matches);
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

    const raw: Record<string, unknown>[] = data.organic || data.visualMatches || data.matches || [];
    const matches = raw
      .map((m) => {
        const priceRaw = m.price ?? m.extractedPrice;
        const priceStr = String(priceRaw ?? "0").replace(/[^0-9.]/g, "");
        return {
          price: parseFloat(priceStr) || 0,
          title: String(m.title || ""),
          imageUrl: String(m.imageUrl || m.thumbnail || ""),
          productUrl: String(m.link || m.url || ""),
          source: String(m.source || m.domain || ""),
        };
      })
      .filter((m) => m.price > 0.5 && m.imageUrl)
      .sort((a, b) => a.price - b.price);

    return buildShoppingMatch(matches);
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

    const results = (data.shopping || [])
      .filter((r: Record<string, unknown>) => r.price)
      .map((r: Record<string, unknown>) => ({
        price: parseFloat(String(r.price || "0").replace(/[^0-9.]/g, "")) || 0,
        title: String(r.title || ""),
        imageUrl: String(r.imageUrl || r.thumbnailUrl || ""),
        productUrl: String(r.link || ""),
        source: String(r.source || ""),
      }))
      .filter((r: { price: number }) => r.price > 0.5)
      .sort((a: { price: number }, b: { price: number }) => a.price - b.price);

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

    const results = (data.shopping_results || [])
      .filter((r: Record<string, unknown>) => typeof r.extracted_price === "number" && r.extracted_price > 0.5 && r.thumbnail)
      .map((r: Record<string, unknown>) => ({
        price: r.extracted_price as number,
        title: String(r.title || ""),
        imageUrl: String(r.thumbnail || ""),
        productUrl: String(r.product_link || r.link || ""),
        source: String(r.source || ""),
        productId: r.product_id ? String(r.product_id) : undefined,
      }))
      .sort((a: { price: number }, b: { price: number }) => a.price - b.price);

    return buildShoppingMatch(filterRelevantCandidates(results, query));
  } catch {
    return null;
  }
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

function buildShoppingMatch(candidates: ShoppingCandidate[]): ShoppingMatch | null {
  if (candidates.length === 0) return null;
  return {
    title: candidates[0].title,
    lowestPrice: candidates[0].price,
    highestPrice: candidates[candidates.length - 1].price,
    imageUrl: candidates[0].imageUrl,
    productUrl: candidates[0].productUrl,
    source: candidates[0].source,
    productId: candidates[0].productId,
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

async function resolveMerchantLink(url: string, productId?: string): Promise<string> {
  if (url && !isGoogleDomain(url)) return url;
  if (productId) {
    const resolved = await resolveSerpApiMerchantLink(productId);
    if (resolved) return resolved;
  }
  return "";
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
// Verify a shopping candidate list against a real reference image. Runs
// all candidate checks concurrently to bound worst-case latency.
// ════════════════════════════════════════════════════════════════
async function verifyCandidates(
  match: ShoppingMatch,
  referenceImageBase64: string,
  referenceMimeType: string
): Promise<{ best: ShoppingCandidate; confidence: "exact" | "likely" | "unverified" }> {
  const pool = match.candidates.slice(0, 5);
  const verifications = await Promise.all(
    pool.map(candidate => verifyVisualMatch(referenceImageBase64, referenceMimeType, candidate.imageUrl))
  );

  for (let i = 0; i < pool.length; i++) {
    if (verifications[i].match === "exact") return { best: pool[i], confidence: "exact" };
  }
  for (let i = 0; i < pool.length; i++) {
    if (verifications[i].match === "similar") return { best: pool[i], confidence: "likely" };
  }
  return { best: match.candidates[0], confidence: "unverified" };
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

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
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
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();
    const raw = data.content?.[0]?.text || "{}";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return {
      title: typeof parsed.title === "string" && parsed.title ? parsed.title : undefined,
      price: typeof parsed.price === "number" ? parsed.price : null,
      currency: typeof parsed.currency === "string" ? parsed.currency : undefined,
    };
  } catch {
    return {};
  }
}

async function buildEnrichedSearchQuery(title: string, description: string, rawText: string): Promise<string> {
  const fallback = title;
  if (!process.env.ANTHROPIC_API_KEY) return fallback;

  const context = [title, description, rawText].filter(Boolean).join("\n\n").slice(0, 8000);
  if (context.length < 20) return fallback;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
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
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();
    const query = String(data.content?.[0]?.text || "").trim().replace(/^["']|["']$/g, "");
    return query.length >= 3 ? query : fallback;
  } catch {
    return fallback;
  }
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
export async function scanProduct(imageBase64: string, mimeType: string, country?: string): Promise<ScanResult> {
  const requesterCountry = sanitizeCountry(country);
  const vision = await extractFromImage(imageBase64, mimeType);

  let shopping: ShoppingMatch | null = null;
  let engineUsed = "none";
  let confidence: "exact" | "likely" | "unverified" = "unverified";

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

  if (shopping) {
    const verified = await verifyCandidates(shopping, imageBase64, mimeType);
    confidence = verified.confidence === "unverified" ? "likely" : verified.confidence;
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
            const verified = await verifyCandidates(shopping, pageImage.data, pageImage.mimeType);
            confidence = verified.confidence === "unverified" ? "likely" : verified.confidence;
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
          const verified = await verifyCandidates(shopping, imageBase64, mimeType);
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
      const verified = await verifyCandidates(shopping, imageBase64, mimeType);
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
        const verified = await verifyCandidates(shopping, imageBase64, mimeType);
        confidence = verified.confidence;
        shopping = applyVerifiedCandidate(shopping, verified);
      }
    }
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
  const pricingSupportsVerdict = wholesalePrice > 0 && wholesalePrice < retailPrice;
  const retailPriceWasObserved = retailSource === "screenshot";
  const mode: ScanResult["mode"] =
    engineHadRealMatch && confidence !== "unverified" && pricingSupportsVerdict && retailPriceWasObserved ? "VERDICT"
    : engineHadRealMatch ? "FINDER"
    : "UNRESOLVED";

  const finalConfidence: "high" | "medium" | "low" =
    confidence === "exact" && vision.visiblePrice ? "high"
    : confidence === "exact" || (confidence === "likely" && vision.visiblePrice) ? "high"
    : confidence === "likely" ? "medium"
    : "low";

  const resolvedUrl = shopping?.productUrl
    ? await resolveMerchantLink(shopping.productUrl, shopping.productId)
    : "";

  return {
    found: engineHadRealMatch,
    mode,
    priceSource: retailSource,
    engineUsed,
    matchConfidence: confidence,
    shippingNote: buildShippingNote(resolvedUrl, requesterCountry),
    sourceProduct: {
      title: cleanTitle(shopping?.title || discoveredPage?.title || vision.productName) || "Similar product found",
      price: parseFloat(wholesalePrice.toFixed(2)),
      currency: vision.currency || "USD",
      imageUrl: proxyImage(shopping?.imageUrl || ""),
      productUrl: resolvedUrl,
      affiliateUrl: resolvedUrl,
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
export async function scanProductUrl(url: string, country?: string): Promise<ScanResult> {
  const requesterCountry = sanitizeCountry(country);

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
      const verified = await verifyCandidates(shopping, pageImage.data, pageImage.mimeType);
      confidence = verified.confidence;
      shopping = applyVerifiedCandidate(shopping, verified);
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
    const mode: ScanResult["mode"] =
      confidence !== "unverified" && pricingSupportsVerdict && retailPriceWasObserved ? "VERDICT" : "FINDER";
    const resolvedUrl = await resolveMerchantLink(shopping.productUrl, shopping.productId);

    return {
      found: true,
      mode,
      priceSource: retailSource,
      engineUsed,
      matchConfidence: confidence,
      shippingNote: buildShippingNote(resolvedUrl, requesterCountry),
      sourceProduct: {
        title: cleanTitle(pageData.title || shopping.title),
        price: parseFloat(wholesalePrice.toFixed(2)),
        currency: pageData.currency || "USD",
        imageUrl: proxyImage(shopping.imageUrl || pageData.imageUrl || ""),
        productUrl: resolvedUrl,
        affiliateUrl: resolvedUrl,
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
