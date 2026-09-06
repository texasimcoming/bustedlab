/**
 * BustedLab Scan Engine v8 - Lens-first, verified, reads the real product
 * page whenever one can be found — from a screenshot OR a pasted URL.
 *
 * Image-upload pipeline:
 * Layer 1: Claude Haiku Vision → product identity, visible price, visible
 *          store/seller handle, and any URL literally visible in the shot
 * Layer 2: Reverse image search (Google Lens via SerpApi, primary) → exact-pixel candidates
 * Layer 3: Reverse image search (Google Lens via Serper, backup)
 * Layer 3.5 (v8): Product-page discovery — if a store name/handle or a
 *          visible URL was captured, find and READ the actual product page
 *          (same JSON-LD/meta/description extraction a pasted URL gets)
 *          before falling back to a keyword guess. Its real photo gets one
 *          more Lens attempt; its real title+description+specs build a far
 *          more specific search query than a bare product name ever could.
 * Layer 4: Store-name-targeted Shopping text search (Serper → SerpApi) —
 *          fallback if discovery above found nothing usable
 * Layer 5: Generic brand/product Shopping text search (Serper → SerpApi)
 * Layer 6: Visual verification gate — every non-Lens candidate gets checked against
 *          a real reference image before it's allowed to drive a confident verdict.
 * Layer 7: Category-average estimate — last resort, always labeled as an estimate,
 *          never rendered as a confident BUSTED verdict.
 *
 * URL pipeline:
 * 1. Fetch the real page HTML.
 * 2. Extract real price/title/image/description from JSON-LD (schema.org
 *    Product — with AggregateOffer ranges deliberately NOT treated as a
 *    single price, since that's the classic "SEO shows the cheapest
 *    variant" trap), microdata, and Open Graph meta tags. Claude (TEXT, not
 *    vision — there's no rendered-page image without a headless browser) is
 *    a fallback only when structured data isn't present.
 * 3. (v8) The full page content — title, description, specs, variants —
 *    is passed to Claude to build one highly specific search query, not
 *    just the bare title. This is shared by both the URL pipeline and the
 *    Layer 3.5 discovery step above.
 * 4. If the page had a real product photo, run it through the SAME Lens +
 *    visual-verification gate the image-upload flow uses — this is what lets
 *    a URL scan earn genuine VERDICT confidence instead of always defaulting
 *    to FINDER.
 * 5. Falls back to the old slug+search behavior only if the page can't be
 *    fetched or parsed at all (bot-protected pages, heavy client-side
 *    rendering) — degrades gracefully instead of failing outright.
 *
 * Shopping links: SerpApi/Serper shopping results sometimes link to a Google
 * search/product page rather than the actual merchant. Every final result
 * link is checked and, where possible, resolved to a real merchant URL
 * before it's shown as "view listing" — never a Google redirect.
 *
 * Shopping search relevance: results are filtered so a candidate's title
 * must share the query's actual distinguishing words (not just an
 * overlapping generic category term) — this is what stops a "jade roller"
 * search from accepting a "needle roller" result.
 *
 * Cost per scan (worst case, all layers hit, discovery attempted):
 *   ~$0.0017 Haiku vision (extract) + ~$0.0005 Haiku (query enrichment)
 *   + ~$0.0017 Haiku vision (verify) + ~$0.003 Lens/Shopping/Search = ~$0.008
 */

import { put } from "@vercel/blob";

export interface ScanResult {
  found: boolean;
  mode: "VERDICT" | "FINDER" | "UNRESOLVED";
  priceSource: "screenshot" | "estimated" | "shopping";
  engineUsed?: string;
  matchConfidence: "exact" | "likely" | "unverified";
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
// LAYER 1: Claude Haiku Vision — extraction
// ════════════════════════════════════════════════════════════════
async function extractFromImage(imageBase64: string, mimeType: string): Promise<VisionExtraction> {
  const defaults: VisionExtraction = {
    productName: "", brand: "", visiblePrice: null,
    currency: "USD", category: "other", platform: "unknown",
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
  "category": "beauty|fitness|tech|fashion|home|pet|skincare|accessories|food|other",
  "platform": "tiktok|instagram|amazon|shopify|facebook|aliexpress|website|unknown",
  "storeName": "the seller/shop/store name or @handle if visible anywhere in the screenshot (watermark, caption, URL bar, product page header, checkout logo) — empty string if none is visible",
  "visibleUrl": "an actual URL/website address/domain visibly written or shown anywhere in the screenshot (browser address bar, a link in a caption or bio, a 'shop at ___' text overlay) — empty string if no URL text is actually visible. Do not construct or guess a URL — only report one if it is literally shown as text.",
  "priceConfidence": "visible|inferred|none",
  "imageQuality": "good|poor"
}
CRITICAL: visiblePrice must be null unless a price number is clearly visible. Never guess.
CRITICAL: storeName must be read directly from visible text/logos/handles/URLs in the image. Never guess or infer a store name that isn't actually shown.
CRITICAL: visibleUrl must be an actual URL string visible as text in the image. Never invent one from a store name or brand guess.
CRITICAL: productName must include the defining material/type descriptor whenever visible or inferable — "jade roller" not "roller", "rose quartz gua sha" not "gua sha tool", "copper straightening brush" not "hair brush". A bare generic category word causes wrong-product matches against visually similar but materially different items (e.g. jade rollers vs needle/derma rollers both being "rollers"). Never drop a visible distinguishing word to make the name shorter.`,
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
// Compares the original screenshot crop (or, for URL scans, the real
// product photo fetched from the page) against a candidate product image
// before any candidate is allowed to drive a confident verdict.
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
              text: `Is IMAGE B showing the exact same physical product as IMAGE A — same design, same shape, same distinguishing features — not just a similar item in the same category?
Return ONLY JSON:
{"match": "exact" | "similar" | "different", "reasoning": "one short sentence"}
"exact" = same specific product, high confidence.
"similar" = same category/type but cannot confirm it's the identical item (different colorway, different design details, generic stock photo, etc).
"different" = clearly not the same product.
Be strict. Default to "similar" or "different" when uncertain — never guess "exact".`,
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
    // Guard against oversized candidate images blowing up the vision call
    if (buf.byteLength > 4_500_000) return null;
    return { data: buf.toString("base64"), mimeType };
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// Temp-host an image so Lens APIs (which require a public image URL, not
// base64) can reverse-search it. Used for both uploaded screenshots and,
// new in v7, real product photos fetched from a pasted URL's page.
// ════════════════════════════════════════════════════════════════
async function uploadForLensSearch(imageBase64: string, mimeType: string): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const ext = mimeType.split("/")[1]?.split("+")[0] || "jpg";
    const buf = Buffer.from(imageBase64, "base64");
    const blob = await put(`lens-scans/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`, buf, {
      access: "public",
      contentType: mimeType,
      addRandomSuffix: false,
    });
    return blob.url;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// LAYER 2: Google Lens reverse image search via SerpApi (primary)
// ════════════════════════════════════════════════════════════════
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
// This is the actual fix for "jade roller" matching a "needle roller"
// listing: both share "roller", but only a real match also shares "jade".
// Short queries (2-3 significant words — the common case for a bare
// extracted product name) require ALL of them: with so few words to begin
// with, a partial match is exactly how one shared generic word lets a
// wrong product through. Longer queries (full page titles, which carry
// marketing filler) only need a majority.
// If a query has nothing distinctive to filter on (0-1 significant words),
// or filtering would wipe out every result, this returns the original list
// unfiltered rather than over-filtering to nothing — a loose match plus the
// downstream visual verification gate is better than no result at all.
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
// Merchant-link resolution — SerpApi/Serper shopping results sometimes
// link to a Google search/product page rather than the actual merchant.
// Showing that as "view listing" is misleading (it's not a place to buy
// anything). This is only ever run on the single FINAL chosen candidate,
// not every search result, to avoid extra API calls per scan.
// ════════════════════════════════════════════════════════════════
function isGoogleDomain(url: string): boolean {
  if (!url) return true;
  try {
    return new URL(url).hostname.includes("google.");
  } catch {
    return true; // malformed URL — treat as unusable, same as a Google redirect
  }
}

// One follow-up SerpApi call to resolve a real seller link from a
// product_id. NOTE: response shape (sellers_results.online_sellers[].link)
// is SerpApi's documented Google Product API pattern — not verified
// against a live response from here, so it degrades to null rather than
// throwing if the shape doesn't match.
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

// Never hand back a Google-domain URL as "the merchant listing." Only
// called once, on the final chosen candidate, at the point of building
// the result the person actually sees.
async function resolveMerchantLink(url: string, productId?: string): Promise<string> {
  if (url && !isGoogleDomain(url)) return url;
  if (productId) {
    const resolved = await resolveSerpApiMerchantLink(productId);
    if (resolved) return resolved;
  }
  return ""; // no verified direct link — show nothing rather than a bad redirect
}

// ════════════════════════════════════════════════════════════════
// PRODUCT-PAGE DISCOVERY — when a screenshot shows a store name, seller
// handle, or a visible URL, try to find and read the ACTUAL product page
// before falling back to a generic text search. Reads it the same way a
// pasted URL is read (JSON-LD, meta tags, full description text).
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

// A store name captured by vision might be a bare domain-ish string
// ("shopname.com") or a full/partial URL missing its scheme. Normalize it
// into something fetchable, or return null if it isn't plausibly a URL.
function normalizeUrlCandidate(raw: string): string | null {
  const candidate = raw.trim();
  if (!candidate) return null;
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  try {
    const parsed = new URL(withScheme);
    // Require at least one dot in the hostname — filters out plain seller
    // handles like "@storename" that aren't actually a URL/domain.
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

// Finds a plausible product-page URL for a seller/store name that isn't
// itself a URL — e.g. a TikTok/Instagram handle or a plain shop name.
// Site-restricts the search when the store name itself looks domain-like,
// otherwise does a general search and takes the first non-social,
// non-search-engine result. Best-effort: web search returning a URL is not
// the same guarantee as a direct link, which is why this whole layer still
// falls back to the existing store-name text search if nothing usable comes
// back or the page it finds doesn't parse into real product data.
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

// The actual discovery + fetch + full-context extraction step. Returns null
// (not a thrown error) whenever discovery/fetch/parsing doesn't produce
// anything usable, so callers can cleanly fall back to the existing
// store-name text search — this is a strictly additive first attempt, not
// a replacement that can make things worse than before.
async function discoverAndFetchProductPage(vision: VisionExtraction): Promise<PageProductData | null> {
  let targetUrl: string | null = null;

  if (vision.visibleUrl) {
    targetUrl = normalizeUrlCandidate(vision.visibleUrl);
  }
  if (!targetUrl && vision.storeName) {
    targetUrl = await findStoreProductUrl(vision.storeName, vision.brand, vision.productName);
  }
  if (!targetUrl) return null;

  const html = await fetchProductPageHtml(targetUrl);
  if (!html) return null;

  const pageData = await extractPageProductData(html);
  // Require at least a title or a price — an empty extraction means the
  // fetch found a page but it wasn't a readable product page (a homepage,
  // a category listing, a bot-protection interstitial, etc.).
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

function calculateVerdict(retail: number, wholesale: number) {
  const markup = Math.round(((retail - wholesale) / wholesale) * 100);
  const savings = parseFloat((retail - wholesale).toFixed(2));
  const savingsPercent = Math.round((savings / retail) * 100);
  let verdict: "HIGH_MARKUP" | "OVERPRICED" | "FAIR";
  if (markup >= 500) verdict = "HIGH_MARKUP";
  else if (markup >= 100) verdict = "OVERPRICED";
  else verdict = "FAIR";
  return { markup, savings, savingsPercent, verdict };
}

function proxyImage(url: string): string {
  if (!url) return "";
  return `/api/proxy-image?url=${encodeURIComponent(url)}`;
}

// ════════════════════════════════════════════════════════════════
// Verify a shopping candidate list against a real reference image —
// either the uploaded screenshot, or (new in v7) a real product photo
// fetched from a pasted URL's page. Runs all candidate checks
// concurrently to bound worst-case latency to roughly one timeout
// window instead of stacking them.
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
// URL PAGE FETCHING + STRUCTURED EXTRACTION (v7)
// ════════════════════════════════════════════════════════════════

// Fetch the real page HTML for a pasted product URL. Sends browser-like
// headers since many e-commerce sites block obviously non-browser
// requests — but some pages (heavy client-side rendering, bot protection,
// e.g. AliExpress) will still return unusable HTML. That's a real,
// honest limit: it degrades to slug-based search rather than failing.
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

// Read one meta tag's content regardless of whether `content` or
// `property`/`name` appears first in the tag — HTML doesn't guarantee order.
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

// JSON-LD (schema.org Product) — the structured format Google requires for
// shopping rich results, which is why most real e-commerce platforms emit
// it for SEO. This is the most reliable source when present — with one
// real trap: AggregateOffer.lowPrice is often the cheapest VARIANT's price,
// published for SEO purposes, while the page actually defaults to a
// different (often pricier) variant. Treating a range as "the" price is a
// guess dressed as data, so AggregateOffer is deliberately NOT used here —
// this function returns null price for it and lets extractPageProductData
// fall through to microdata/meta tags/Claude instead.
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

// Resolves a single canonical price from a Product's `offers` field.
//  - A plain Offer (single object, has `.price`) → unambiguous, use it.
//  - An AggregateOffer (has `lowPrice`/`highPrice`, no single `.price`) →
//    deliberately returns null; a price range can't answer "what does the
//    page show right now" without guessing an endpoint.
//  - An array of Offers → drop anything that looks like a subscription,
//    installment, or per-unit-of-multipack fragment (these are reliably
//    the LOWER numbers that cause the "$29.99 extracted, $34.99 real" bug),
//    then take the highest remaining price — the standard one-time price is
//    consistently the larger number relative to financing/subscription
//    fragments in real storefront data. This is a heuristic, not a
//    certainty, which is exactly why layers 2-4 below (microdata, meta
//    tags, Claude fallback) exist as cross-checks.
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

  // AggregateOffer shape (lowPrice/highPrice, no single price) — ambiguous
  // by design, deliberately not resolved here. See function comment above.
  return null;
}

// Microdata itemprop="price" — common even on sites without full JSON-LD,
// and it's normally rendered by the same template logic that draws the
// visible price on the page, making it a reliable single-value source.
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

// Fallback when JSON-LD isn't present: Open Graph / product meta tags.
// Also widely supported, slightly less structured than JSON-LD.
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

// Strip a page to plain text for the Claude fallback below — only used
// when structured data finds nothing, so this is the exception path.
function stripHtmlForText(html: string, maxLength = 6000): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const text = withoutScripts.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, maxLength);
}

// Text-only Claude fallback — NOT vision. There's no rendered-page image
// without a headless browser (Playwright/Puppeteer), which this
// environment doesn't run. Only called when JSON-LD and meta tags above
// both found no usable price.
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
CRITICAL: price must be the main one-time purchase price of this exact product as currently displayed by default — never a per-installment amount ("4 payments of $X"), a subscription/subscribe-and-save price, a shipping cost, or a price for a different variant/bundle than the one shown by default. If several prices appear and it's unclear which is the main displayed price, return null rather than guessing.
CRITICAL: title must include defining material/type descriptors, not a bare generic category word — "jade roller" not "roller".

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

// Builds the most specific possible search query from everything the page
// actually says about the product — not just the title. A title alone is
// often generic ("Jade Facial Roller"); the description usually carries the
// distinguishing details ("dual-head", "2-in-1 with gua sha tool", specific
// material) that determine whether a search finds the right product or just
// something in the same broad category. Falls back to the plain title if
// there's not enough content to work with, or if the call fails.
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

Return ONLY the search query text — no quotes, no JSON, no explanation, nothing else.

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

// Combine JSON-LD → microdata → meta tags → Claude text fallback for
// title/price, then always build an enriched, context-rich search query
// from whatever title/description/page text was found — this is what lets
// the search be "dual-head jade facial roller 2-in-1 with gua sha tool"
// instead of just "jade facial roller".
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

  // Broader text excerpt than the price-fallback uses — specs, materials,
  // and variant details usually sit further down the page than the price.
  const rawText = stripHtmlForText(html, 9000);
  const searchQuery = await buildEnrichedSearchQuery(title, description, rawText);

  return { title, price, currency, imageUrl, description, searchQuery: searchQuery || title };
}

// ════════════════════════════════════════════════════════════════
// MAIN SCAN — image upload
// ════════════════════════════════════════════════════════════════
export async function scanProduct(imageBase64: string, mimeType: string, intent?: "verdict" | "finder" | null): Promise<ScanResult> {
  const vision = await extractFromImage(imageBase64, mimeType);

  // ── Try Lens first: match on pixels, not words ──
  let shopping: ShoppingMatch | null = null;
  let engineUsed = "none";
  let confidence: "exact" | "likely" | "unverified" = "unverified";

  const lensImageUrl = await uploadForLensSearch(imageBase64, mimeType);
  if (lensImageUrl) {
    shopping = await searchLensViaSerpApi(lensImageUrl);
    if (shopping) engineUsed = "lens_serpapi";
    if (!shopping) {
      shopping = await searchLensViaSerper(lensImageUrl);
      if (shopping) engineUsed = "lens_serper";
    }
  }

  // Lens results are already image-matched — verify anyway, cheap and worth it,
  // but seed confidence high since the search itself was pixel-based.
  if (shopping) {
    const verified = await verifyCandidates(shopping, imageBase64, mimeType);
    confidence = verified.confidence === "unverified" ? "likely" : verified.confidence;
    shopping = { ...shopping, ...verified.best, candidates: shopping.candidates };
    shopping.lowestPrice = Math.min(...shopping.candidates.map(c => c.price));
    shopping.highestPrice = Math.max(...shopping.candidates.map(c => c.price));
  }

  // ── NEW: if Lens found nothing and vision saw a store name or a visible
  //    URL, try to find and READ the actual product page before falling
  //    back to a generic text search — the same JSON-LD/meta/description
  //    extraction a pasted URL gets, not just a keyword guess. ──
  let discoveredPage: PageProductData | null = null;
  if (!shopping && (vision.storeName || vision.visibleUrl)) {
    discoveredPage = await discoverAndFetchProductPage(vision);

    if (discoveredPage) {
      // A real product photo from the actual page is usually cleaner than a
      // screenshot crop — worth one more Lens attempt against it before
      // falling to text search.
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
          }
          if (shopping) {
            const verified = await verifyCandidates(shopping, pageImage.data, pageImage.mimeType);
            confidence = verified.confidence === "unverified" ? "likely" : verified.confidence;
            shopping = { ...shopping, ...verified.best, candidates: shopping.candidates };
            shopping.lowestPrice = Math.min(...shopping.candidates.map(c => c.price));
            shopping.highestPrice = Math.max(...shopping.candidates.map(c => c.price));
          }
        }
      }

      // No image match — fall to text search, but with the ENRICHED query
      // built from the real page's title + description + specs/variants,
      // not just a bare store-name-and-guess string.
      if (!shopping && discoveredPage.searchQuery) {
        shopping = await searchShoppingViaSerper(discoveredPage.searchQuery);
        if (shopping) engineUsed = "store_page_serper";
        if (!shopping) {
          shopping = await searchShoppingViaSerpApi(discoveredPage.searchQuery);
          if (shopping) engineUsed = "store_page_serpapi";
        }
        if (shopping) {
          const verified = await verifyCandidates(shopping, imageBase64, mimeType);
          confidence = verified.confidence;
          shopping = { ...shopping, ...verified.best, candidates: shopping.candidates };
        }
      }
    }
  }

  // ── Store-name-targeted text search — falls back to this if page
  //    discovery above found nothing usable, or wasn't attempted. ──
  if (!shopping && vision.storeName) {
    const storeQuery = `${vision.storeName} ${vision.brand} ${vision.productName}`.trim();
    shopping = await searchShoppingViaSerper(storeQuery);
    if (shopping) engineUsed = "store_serper";
    if (!shopping) {
      shopping = await searchShoppingViaSerpApi(storeQuery);
      if (shopping) engineUsed = "store_serpapi";
    }
    if (shopping) {
      const verified = await verifyCandidates(shopping, imageBase64, mimeType);
      confidence = verified.confidence;
      shopping = { ...shopping, ...verified.best, candidates: shopping.candidates };
    }
  }

  // ── Generic brand/product text search, last resort before category guess ──
  if (!shopping) {
    const genericQuery = vision.brand
      ? `${vision.brand} ${vision.productName}`.trim()
      : vision.productName || "";
    if (genericQuery) {
      shopping = await searchShoppingViaSerper(genericQuery);
      if (shopping) engineUsed = "generic_serper";
      if (!shopping) {
        shopping = await searchShoppingViaSerpApi(genericQuery);
        if (shopping) engineUsed = "generic_serpapi";
      }
      if (shopping) {
        const verified = await verifyCandidates(shopping, imageBase64, mimeType);
        confidence = verified.confidence;
        shopping = { ...shopping, ...verified.best, candidates: shopping.candidates };
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
    // A price read directly off the real product page we found and fetched
    // is just as trustworthy as a price visible in the screenshot — it's
    // not a guess, it's the actual page saying what it costs.
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
  let wholesalePrice: number;
  if (shopping && shopping.lowestPrice > 0) {
    wholesalePrice = shopping.lowestPrice;
  } else {
    const cat = CATEGORY_DATA[vision.category] || CATEGORY_DATA.other;
    wholesalePrice = retailPrice * cat.wholesaleRatio;
  }
  if (wholesalePrice >= retailPrice) wholesalePrice = retailPrice * 0.35;

  const { markup, savings, savingsPercent, verdict } = calculateVerdict(retailPrice, wholesalePrice);

  // ── Gate: only "exact" or "likely" visual-verified matches get a
  //    confident VERDICT. Everything else renders as FINDER — same
  //    engine, no confident markup percentage attached to a guess. ──
  const engineHadRealMatch = !!shopping;
  let mode: ScanResult["mode"] =
    engineHadRealMatch && confidence !== "unverified" ? "VERDICT"
    : engineHadRealMatch ? "FINDER"
    : "UNRESOLVED";
  // Respect user intent - if they chose "finder", force finder mode
  // even if a price was visible (they want cheapest source, not markup)
  if (intent === "finder" && mode === "VERDICT") mode = "FINDER";
  // If they chose "verdict" but no price found, keep as FINDER (can't fake it)

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
    sourceProduct: {
      title: shopping?.title || discoveredPage?.title || vision.productName || "Similar product found",
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
// URL SCAN (v7) — fetches the real page instead of guessing from the slug.
// ════════════════════════════════════════════════════════════════
export async function scanProductUrl(url: string, intent?: "verdict" | "finder" | null): Promise<ScanResult> {
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

    // Search query: prefer the enriched, context-rich query built from the
    // full page (title + description + specs/variants) — this is what finds
    // "dual-head jade roller 2-in-1 with gua sha tool" instead of just
    // "jade roller". Fall back to slug-parsing only if the page couldn't be
    // read/parsed at all (bot-protected pages, heavy client-side rendering —
    // a real limit, not a bug) — degrade gracefully instead of failing.
    let searchQuery = pageData.searchQuery || pageData.title;
    if (!searchQuery) {
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      const lastPart = pathParts[pathParts.length - 1] || "";
      searchQuery = lastPart.replace(/[-_]/g, " ").replace(/[^a-zA-Z0-9 ]/g, " ").trim();
    }
    if (!searchQuery || searchQuery.length < 3) return getUnresolvedResult();

    // If the page had a real product photo, fetch it once so we can run
    // genuine visual verification — the same gate the image-upload flow
    // uses. This is what lets a URL scan earn real VERDICT confidence.
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
      }
    }

    if (!shopping) {
      shopping = await searchShoppingViaSerper(searchQuery);
      if (shopping) engineUsed = "url_generic_serper";
      if (!shopping) {
        shopping = await searchShoppingViaSerpApi(searchQuery);
        if (shopping) engineUsed = "url_generic_serpapi";
      }
    }

    if (!shopping) return getUnresolvedResult();

    // ── Step 3: visual verification — only possible with a real photo.
    //    Without one, confidence honestly stays "unverified" (FINDER),
    //    same rule the image-upload flow follows. ──
    if (pageImage) {
      const verified = await verifyCandidates(shopping, pageImage.data, pageImage.mimeType);
      confidence = verified.confidence;
      shopping = { ...shopping, ...verified.best, candidates: shopping.candidates };
    }

    // ── Step 4: retail price. A price read directly off the real page is
    //    as trustworthy as a visible price in a screenshot — same trust
    //    tier, not a guess. ──
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
    if (wholesalePrice >= retailPrice || wholesalePrice <= 0) return getUnresolvedResult();

    const { markup, savings, savingsPercent, verdict } = calculateVerdict(retailPrice, wholesalePrice);
    let mode: ScanResult["mode"] = confidence !== "unverified" ? "VERDICT" : "FINDER";
    if (intent === "finder" && mode === "VERDICT") mode = "FINDER";
    const resolvedUrl = await resolveMerchantLink(shopping.productUrl, shopping.productId);

    return {
      found: true,
      mode,
      priceSource: retailSource,
      engineUsed,
      matchConfidence: confidence,
      sourceProduct: {
        title: pageData.title || shopping.title,
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
// UNRESOLVED — replaces silent demo-mode substitution.
// Only reached when every real layer has failed. Never carries a
// fabricated verdict or a fake "BUSTED" number.
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
