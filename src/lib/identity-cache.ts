import { Redis } from "@upstash/redis";
import crypto from "crypto";

/**
 * CROSS-USER IDENTIFICATION CACHE.
 *
 * During a viral spike, thousands of people photograph the SAME product,
 * from different angles, in different light, on different phones. The
 * existing scan cache in redis.ts is keyed on the bytes of the upload, so
 * every one of those photos is a cache miss and pays for a fresh
 * identification. That is the single largest avoidable cost in exactly the
 * traffic pattern this product is built to produce.
 *
 * WHAT THE KEY IS, AND WHY IT IS NOT A PERCEPTUAL HASH OF THE IMAGE.
 *
 * The obvious approach is a perceptual hash - dHash or similar - so two
 * photos of one object land on one key. Two problems with it here. First, it
 * needs to decode the image server-side, and the only image library in this
 * project is a devDependency used by the framework's own image optimizer;
 * relying on it inside a request is a deployment footgun. Second, and worse,
 * computing the hash in the browser instead would make the cache key
 * attacker-controlled: anyone could submit a photo of product A under the
 * hash of product B and poison what every later scanner of B is told. For a
 * product whose entire argument is that its numbers are right, a
 * cache-poisoning hole is not an acceptable cost saving.
 *
 * So the key is derived from Google's own answer instead. Two photos of the
 * same object produce Lens responses whose top matches are largely the same
 * listings - that overlap IS a same-product signal, it is computed from a
 * server-side API response no client can forge, and it is semantically
 * closer to "same product" than pixel similarity is, because Lens has
 * already done the visual work. The primary key is the whole top-5 listing
 * set; anchor keys are the individual top-3 listings, which catch the common
 * case where two angles return the same product but shuffle the tail.
 *
 * WHAT A HIT IS ALLOWED TO DO.
 *
 * A hit supplies a HYPOTHESIS, never a conclusion. The caller still checks
 * it against this specific photo before using it (one cheap comparison, in
 * place of the whole gate), and a rejection falls through to the full
 * pipeline. Combined with the acceptance rules the caller passes in - the
 * cached listing must appear in THIS scan's own candidate set, and the brand
 * read off this photo must be consistent with the cached title - a false
 * reuse needs the fingerprint to collide AND the confirmation to pass AND
 * the listing to be present in both responses. The identification being
 * reused was made by the strong model, so the cheap confirmation can only
 * accept an answer that was already paid for properly; it can never invent
 * a new one.
 *
 * Only confirmed identifications are stored, and they expire in an hour, so
 * a reused price is at most an hour old. The user's own retail price, the
 * verdict and the savings are still computed fresh on every scan - the only
 * thing reused is what the product is and the cheapest listing found for it.
 */

export interface CachedIdentity {
  title: string;
  price: number;
  highestPrice: number;
  imageUrl: string;
  productUrl: string;
  source: string;
  productId?: string;
  engineUsed: string;
  /** Only "exact" is ever stored. A weaker match is not worth reusing. */
  confidence: "exact";
  /**
   * The normalized top Lens listings of the scan that produced this entry,
   * and the reason this field exists rather than the obvious alternative.
   *
   * The corroboration rule wants proof that Google, looking at the NEW
   * photo, returned something the old photo also returned. The tempting
   * check is "is the cached product's own URL in the new candidate set" -
   * and it is wrong, because the winning record frequently does not come
   * from the Lens pool at all: it comes from the pricing search or the
   * direct-retailer sweep downstream. Checking the winner's URL would
   * reject almost every entry worth reusing, which is a silent
   * cache-never-hits bug rather than a loud one. So the entry carries the
   * Lens listings it was identified FROM, and overlap is measured against
   * those.
   */
  anchors: string[];
  at: number;
}

// An hour. Long enough to cover a spike, short enough that a reused source
// price is still a current source price.
export const IDENTITY_CACHE_TTL_SECONDS = Number(process.env.IDENTITY_CACHE_TTL || 3600);

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL || "https://placeholder.upstash.io",
      token: process.env.UPSTASH_REDIS_REST_TOKEN || "placeholder",
    });
  }
  return _redis;
}

const key = (digest: string) => `ident:${digest}`;
const digest = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);

/**
 * Host plus path, lowercased, without www or a trailing slash and without
 * any query string. Two merchants' links to one product differ constantly in
 * their tracking parameters and never in this.
 */
export function normalizeListingUrl(raw: string): string {
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

export interface Fingerprint {
  /** The whole top-of-response listing set. An exact-set match. */
  primary: string;
  /** Individual top listings, for two angles that agree on the product but not the tail. */
  anchors: string[];
  /** Those same top listings, unhashed, to be stored on the entry. */
  listings: string[];
}

export function lensFingerprint(listingUrls: string[]): Fingerprint | null {
  const normalized = listingUrls.map(normalizeListingUrl).filter(Boolean);
  if (normalized.length === 0) return null;
  const top = normalized.slice(0, 5);
  const listings = normalized.slice(0, 3);
  return {
    primary: digest(`set:${[...top].sort().join("|")}`),
    anchors: listings.map(u => digest(`one:${u}`)),
    listings,
  };
}

async function read(digestKey: string): Promise<CachedIdentity | null> {
  try {
    const raw = await getRedis().get(key(digestKey));
    if (!raw) return null;
    const parsed = (typeof raw === "object" ? raw : JSON.parse(String(raw))) as CachedIdentity;
    return parsed && parsed.confidence === "exact" && parsed.price > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Looks for a reusable identification. `accept` is the caller's semantic
 * gate - this module owns storage and key derivation, the engine owns what
 * counts as a safe reuse - and an entry it rejects is treated as a miss.
 */
export async function lookupIdentity(
  fingerprint: Fingerprint | null,
  accept: (entry: CachedIdentity, via: "set" | "listing") => boolean
): Promise<{ entry: CachedIdentity; via: "set" | "listing" } | null> {
  if (!fingerprint) return null;

  const exact = await read(fingerprint.primary);
  if (exact && accept(exact, "set")) return { entry: exact, via: "set" };

  for (const anchor of fingerprint.anchors) {
    const entry = await read(anchor);
    if (entry && accept(entry, "listing")) return { entry, via: "listing" };
  }
  return null;
}

/** Writes under every key the same response would be looked up by. */
export async function storeIdentity(
  fingerprint: Fingerprint | null,
  entry: CachedIdentity
): Promise<void> {
  if (!fingerprint || entry.confidence !== "exact" || !(entry.price > 0)) return;
  const payload = JSON.stringify(entry);
  try {
    const redis = getRedis();
    const targets = [fingerprint.primary, ...fingerprint.anchors];
    await Promise.all(
      targets.map(t => redis.set(key(t), payload, { ex: IDENTITY_CACHE_TTL_SECONDS }))
    );
  } catch {
    /* a cache that cannot be written is a cost problem, never a correctness one */
  }
}
