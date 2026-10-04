import { Redis } from "@upstash/redis";
import crypto from "crypto";

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

// Raw IP addresses are personal data under GDPR. They are only ever needed
// here as an opaque bucket for "has this requester used their free scans
// today", never as something we need to read back, so the key stores a
// salted hash instead of the address itself. The privacy policy states this,
// so it has to actually be true. IDENTITY_SALT keeps the hash from being
// reversible with a rainbow table of the whole IPv4 space; without it set,
// a fixed fallback still beats storing the address in clear.
const IDENTITY_SALT = process.env.IDENTITY_SALT || "bustedlab-identity-v1";

export function hashIdentifier(value: string): string {
  return crypto.createHmac("sha256", IDENTITY_SALT).update(value).digest("hex").slice(0, 32);
}

// Verified floor for the "highest markup recorded" stat: the purple
// whitening strips comparison rendered on the landing page demo card
// (retail $22.99 against a $4.30 source listing = 435%). Anyone who checks
// the demo card can verify the claim, which is the whole standard for every
// number on this site. The live counter only ever moves this upward.
export const MARKUP_FLOOR = 435;

export const keys = {
  scanCount: (identifier: string) => `scan:count:${hashIdentifier(identifier)}`,
  totalScans: () => `scan:total:global`,
  totalSavingsExposed: () => `scan:savings:global`,
  maxMarkup: () => `scan:markup:max`,
  verdictTotal: () => `scan:verdicts:total`,
  bustedTotal: () => `scan:verdicts:busted`,
  hourlyScans: () => `scan:hourly:${new Date().toISOString().slice(0, 13)}`, // buckets by UTC hour
  globalDaily: () => `scan:global:${new Date().toISOString().slice(0, 10)}`,
  globalDailyHistory: (day: string) => `scan:global:hist:${day}`,
  paidUser: (email: string) => `paid:${email.toLowerCase().trim()}`,
  magicToken: (token: string) => `magic:${token}`,
  session: (token: string) => `session:${token}`,
  scanCache: (fingerprint: string) => `scan:cache:${fingerprint}`,
  paidScanCount: (email: string) => `scan:paid:${hashIdentifier(email)}`,
  processedOrder: (orderId: string) => `order:${orderId}`,
  checkoutClaim: (claim: string) => `claim:${claim}`,
  cspDay: (day: string) => `csp:${day}`,
  window: (name: string, identifier: string, index: number) => `window:${name}:${hashIdentifier(identifier)}:${index}`,

  // ── The permanent record. See the SCAN LEDGER section below. ──
  scanRecord: (id: string) => `scan:rec:${id}`,
  recordIndex: () => `scan:ledger`,
  bustedIndex: () => `scan:ledger:busted`,
  markupIndex: () => `scan:ledger:markup`,
  productAggregate: (productKey: string) => `scan:product:${productKey}`,

  // ── Index and leaderboards ──
  trendingWeek: (week: string) => `scan:trending:${week}`,
  categoryStats: (category: string) => `scan:cat:${category}`,

  // ── Intent capture ──
  notifyEntry: (email: string) => `notify:${email.toLowerCase().trim()}`,
  notifyIndex: () => `notify:index`,
};

/** True if Upstash accepts a write and returns it. For the launch preflight. */
export async function redisRoundTrip(): Promise<boolean> {
  try {
    // Prefixed: an all-digit value would come back from the client as a number.
    const probe = `p-${crypto.randomBytes(8).toString("hex")}`;
    await getRedis().set("preflight:probe", probe, { ex: 60 });
    return (await getRedis().get("preflight:probe")) === probe;
  } catch {
    return false;
  }
}

// Real count of scans in the current UTC hour. Genuine data for a "scanned
// in the last hour" indicator, not an invented placeholder number. The key
// itself is time-bucketed by hour, so it naturally resets; a short TTL just
// keeps stale hour-buckets from lingering in Redis indefinitely.
export async function incrementHourlyScans(): Promise<void> {
  const key = keys.hourlyScans();
  await getRedis().incr(key);
  await getRedis().expire(key, 7200); // 2 hours, comfortably outlives the bucket it belongs to
}

export async function getHourlyScans(): Promise<number> {
  const count = await getRedis().get(keys.hourlyScans()) as number | null;
  return count || 0;
}

export const FREE_SCANS_PER_DAY = 2;

// The free allowance belongs to a BROWSER (the bl_bid cookie), not to an IP
// address. An address is not a person: a mobile carrier's shared IPv4, iCloud
// Private Relay, an office or a campus puts many people behind one address,
// and when the allowance was the stricter of the browser and the address, the
// third person behind a busy address opened the site for the first time and
// was told their free scans were spent. The address keeps a ceiling of its
// own, far above any household, which is what still bounds a script that
// clears or invents cookies; the daily model budget and the global scan cap
// bound the rest.
export const FREE_SCANS_PER_IP_PER_DAY = (() => {
  const configured = Number(process.env.FREE_SCANS_PER_IP_PER_DAY);
  return Number.isFinite(configured) && configured > 0 ? configured : 40;
})();

export async function getScanCount(identifier: string): Promise<number> {
  const count = await getRedis().get(keys.scanCount(identifier)) as number | null;
  return Number(count) || 0;
}

/**
 * Free scans left today for this visitor. Per browser, with the address
 * ceiling above. A client that refuses the browser cookie is counted by
 * address alone at the normal allowance, because that is how a script looks.
 */
export async function freeScansRemaining(ip: string, browserId: string | null): Promise<number> {
  if (!browserId) return getScansRemaining(ip);
  const [browserLeft, addressUsed] = await Promise.all([
    getScansRemaining(`browser:${browserId}`),
    getScanCount(ip),
  ]);
  return addressUsed >= FREE_SCANS_PER_IP_PER_DAY ? 0 : browserLeft;
}

// ════════════════════════════════════════════════════════════════
// FAIR USE ON THE UNLIMITED TIER.
//
// Paid access is unlimited, and this does not change that in any way a
// customer can feel: five hundred scans in one day is not a person using a
// product, it is a script. A realistic heavy session is a few dozen.
//
// What it stops is the one hole the unlimited tier left open. Paid accounts
// bypass the free daily allowance AND the global uncached-scan cap, so the
// only thing that applied to them was the per-IP burst limiter: 12 a minute,
// which is 17,280 a day. Priced from the real call sequences (see
// scripts/cost-model.mjs) that is around $800 of model and search spend from
// a single leaked or shared session, of which only the model half was
// bounded by the daily budget - nothing capped the search spend at all.
// At 500 it is roughly $25, and no real customer is anywhere near it.
//
// Keyed on the ACCOUNT, hashed like every other identifier here, not on the
// IP: the point is to stop one credential being shared or scripted, and an
// IP-keyed limit is defeated by a phone switching networks.
// ════════════════════════════════════════════════════════════════
export const PAID_DAILY_SCAN_CEILING = Number(process.env.PAID_DAILY_SCAN_CEILING || 500);

export async function getPaidScansToday(email: string): Promise<number> {
  const count = await getRedis().get(keys.paidScanCount(email)) as number | null;
  return count || 0;
}

export async function incrementPaidScanCount(email: string): Promise<void> {
  const key = keys.paidScanCount(email);
  await getRedis().incr(key);
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  await getRedis().expireat(key, Math.floor(midnight.getTime() / 1000));
}

export async function getScansRemaining(identifier: string): Promise<number> {
  const count = await getRedis().get(keys.scanCount(identifier)) as number | null;
  return Math.max(0, FREE_SCANS_PER_DAY - (count || 0));
}

export async function incrementScanCount(identifier: string): Promise<void> {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  const secondsUntilMidnight = Math.floor((midnight.getTime() - now.getTime()) / 1000);
  const key = keys.scanCount(identifier);
  await getRedis().incr(key);
  await getRedis().expire(key, secondsUntilMidnight);
}

// Global, lifetime, no-expiry counter. Powers the real "X scanned" number
// on the landing page. Called once per completed scan (success or
// FINDER/UNRESOLVED, every real attempt counts, this isn't a "wins" tally).
export async function incrementTotalScans(): Promise<void> {
  await getRedis().incr(keys.totalScans());
}

export async function getTotalScans(): Promise<number> {
  const count = await getRedis().get(keys.totalScans()) as number | null;
  return count || 0;
}

// Real, incrementing total of savings shown on actual VERDICT-mode scans.
// This is what makes the landing page's "$X exposed" stat true instead of a
// static invented figure. Only ever called with a real per-scan savings
// amount, never an estimate.
export async function incrementTotalSavings(amount: number): Promise<void> {
  if (!amount || amount <= 0) return;
  await getRedis().incrbyfloat(keys.totalSavingsExposed(), amount);
}

export async function getTotalSavingsExposed(): Promise<number> {
  const val = await getRedis().get(keys.totalSavingsExposed()) as number | string | null;
  return val ? parseFloat(String(val)) : 0;
}

// Highest markup any real verified scan has ever produced. Replaces the
// static "700%" figure that was on the landing page with a number that is
// literally true because a scan produced it. Never moves downward.
export async function recordMarkup(markup: number): Promise<void> {
  if (!Number.isFinite(markup) || markup <= 0) return;
  const current = await getRedis().get(keys.maxMarkup()) as number | null;
  if (!current || markup > current) {
    await getRedis().set(keys.maxMarkup(), Math.round(markup));
  }
}

export async function getMaxMarkup(): Promise<number> {
  const val = await getRedis().get(keys.maxMarkup()) as number | null;
  return Math.max(MARKUP_FLOOR, val || 0);
}

// Verdict distribution. "X% of scans come back BUSTED" is only worth showing
// when it is measured, so both halves of the ratio are counted for real and
// the UI hides the stat entirely until there is a sample behind it.
export async function recordVerdict(isBusted: boolean): Promise<void> {
  await getRedis().incr(keys.verdictTotal());
  if (isBusted) await getRedis().incr(keys.bustedTotal());
}

export async function getBustedRate(): Promise<{ total: number; busted: number }> {
  const [total, busted] = await Promise.all([
    getRedis().get(keys.verdictTotal()) as Promise<number | null>,
    getRedis().get(keys.bustedTotal()) as Promise<number | null>,
  ]);
  return { total: total || 0, busted: busted || 0 };
}

// ════════════════════════════════════════════════════════════════
// Global daily spend guard. Every paid API call in the scan pipeline
// (vision, Lens, shopping, verification) costs real money, so an
// unauthenticated flood is a direct bill. BUDGET MODE: 50 uncached free
// scans a day unless GLOBAL_DAILY_SCAN_CAP says otherwise: about $1.60 a day
// all-in (model and Serper credits) on a worst day of 50 distinct products,
// at the $0.032 a scan measured in production (evals/results/run-5.md;
// `npm run cost-model` models it at $0.028). Past it, visitors get the existing
// "free capacity full today" paywall (the 503 in the scan route). Raise it
// in the environment when revenue pays for more.
// Cache hits never touch this counter, so a single product going viral
// costs one scan no matter how many people scan it, and paid accounts sit
// outside it (they have the fair-use ceiling instead).
// ════════════════════════════════════════════════════════════════
export const GLOBAL_DAILY_CAP = Number(process.env.GLOBAL_DAILY_SCAN_CAP || 50);

export async function getGlobalScansToday(): Promise<number> {
  const count = await getRedis().get(keys.globalDaily()) as number | null;
  return count || 0;
}

export async function incrementGlobalScans(): Promise<void> {
  const key = keys.globalDaily();
  await getRedis().incr(key);
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  await getRedis().expireat(key, Math.floor(midnight.getTime() / 1000));
  // The same count kept per day for 400 days, for cost per scan in the
  // weekly brief: the cap's own counter expires at midnight.
  const history = keys.globalDailyHistory(new Date().toISOString().slice(0, 10));
  await getRedis().incr(history);
  await getRedis().expire(history, 60 * 60 * 24 * 400);
}

/** Uncached free scans per UTC day, oldest first, for the last `days` days. */
export async function readGlobalScansHistory(days: number): Promise<{ day: string; uncachedFreeScans: number }[]> {
  const list: string[] = [];
  for (let i = days - 1; i >= 0; i--) list.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  try {
    const values = await getRedis().mget<(number | string | null)[]>(...list.map(keys.globalDailyHistory));
    return list.map((day, i) => ({ day, uncachedFreeScans: Number(values[i]) || 0 }));
  } catch {
    return list.map(day => ({ day, uncachedFreeScans: 0 }));
  }
}

// ════════════════════════════════════════════════════════════════
// Scan result cache. The viral-load protection layer: the same product
// scanned ten thousand times in an afternoon costs the API exactly once.
// Keyed on the identity of the INPUT (normalized URL, or the bytes of the
// uploaded image), so a screenshot re-shared through a comment section is
// the same cache entry for everyone who scans it.
// ════════════════════════════════════════════════════════════════
export const SCAN_CACHE_TTL_SECONDS = 60 * 60 * 24;

export function fingerprintUrl(url: string): string {
  let normalized = url.trim();
  try {
    const parsed = new URL(normalized);
    // Marketing/campaign parameters change per share but never change the
    // product, so two people sharing the same listing hit the same entry.
    const TRACKING = /^(utm_|fbclid|gclid|ttclid|igshid|ref|ref_src|mc_|_branch)/i;
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    normalized = parsed.toString();
  } catch { /* not a parseable URL, hash the raw string */ }
  return `url:${crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 40)}`;
}

export function fingerprintImage(bytes: Buffer): string {
  return `img:${crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 40)}`;
}

export async function getCachedScan<T>(fingerprint: string): Promise<T | null> {
  const raw = await getRedis().get(keys.scanCache(fingerprint));
  if (!raw) return null;
  if (typeof raw === "object") return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return null;
  }
}

export async function setCachedScan(fingerprint: string, value: unknown): Promise<void> {
  await getRedis().set(keys.scanCache(fingerprint), JSON.stringify(value), {
    ex: SCAN_CACHE_TTL_SECONDS,
  });
}

// ════════════════════════════════════════════════════════════════
// Access
// ════════════════════════════════════════════════════════════════
export async function isPaidUser(email: string): Promise<boolean> {
  const val = await getRedis().get(keys.paidUser(email.toLowerCase().trim()));
  return val === "paid";
}

export async function markAsPaid(email: string): Promise<void> {
  await getRedis().set(keys.paidUser(email.toLowerCase().trim()), "paid");
}

// Refunds and chargebacks have to be able to take access back. Without this
// the only lever after a dispute is a manual Redis edit, which is not a
// lever at all once there is real volume.
export async function revokeAccess(email: string): Promise<void> {
  await getRedis().del(keys.paidUser(email.toLowerCase().trim()));
}

// Payment providers retry webhooks. Marking an order id as processed makes
// a replayed delivery a no-op instead of a second welcome email.
export async function claimOrder(orderId: string): Promise<boolean> {
  const claimed = await getRedis().set(keys.processedOrder(orderId), "1", {
    nx: true,
    ex: 60 * 60 * 24 * 30,
  });
  return claimed === "OK";
}

/**
 * Gives a claim back, so a delivery that failed part-way can be retried.
 *
 * An idempotency claim taken BEFORE the work is the right shape - it is what
 * stops a provider's retry from sending a second welcome email - but only if
 * a failure releases it. Without this, a webhook that claimed the order and
 * then died before granting access left the claim standing, the provider's
 * retry was answered "duplicate", and a customer who paid never got in. The
 * failure mode is silent on both sides: the provider sees 200, the customer
 * sees nothing.
 */
export async function releaseOrderClaim(orderId: string): Promise<void> {
  try {
    await getRedis().del(keys.processedOrder(orderId));
  } catch {
    /* the claim expires on its own in 30 days; nothing better to do here */
  }
}

export async function storeMagicToken(token: string, email: string): Promise<void> {
  await getRedis().set(keys.magicToken(token), email, { ex: 900 });
}

// How long a sign-in link keeps working after its first use. See below.
export const MAGIC_LINK_REUSE_SECONDS = 120;

/**
 * Exchanges a sign-in link's token for the address it was minted for.
 *
 * Deliberately not strictly single-use. Corporate mail filters - Outlook Safe
 * Links, Mimecast, Proofpoint - open links before the person does, and the
 * ones that check at the moment of the click open it seconds ahead of them.
 * A token deleted on first use was spent by the filter, the customer saw
 * "Link expired", and every replacement link was spent the same way: a paying
 * customer on a work address could not sign in at all.
 *
 * Two things stop that now. Opening the link no longer signs anyone in - the
 * link opens a page that signs in with a POST, which link scanners do not
 * send (see src/app/auth/verify). And the first use shortens the token's life
 * to MAGIC_LINK_REUSE_SECONDS instead of deleting it, which covers the
 * filters that do run the page, since they open it only moments before the
 * person does. The window hands nothing to anyone new: whoever can read the
 * inbox can already request a fresh link.
 */
export async function consumeMagicToken(token: string): Promise<string | null> {
  const redis = getRedis();
  const key = keys.magicToken(token);
  const email = await redis.get(key) as string | null;
  if (!email) return null;
  const ttl = await redis.ttl(key);
  if (ttl < 0 || ttl > MAGIC_LINK_REUSE_SECONDS) await redis.expire(key, MAGIC_LINK_REUSE_SECONDS);
  return email;
}

export async function storeSession(sessionToken: string, email: string): Promise<void> {
  await getRedis().set(keys.session(sessionToken), email, { ex: 60 * 60 * 24 * 365 });
}

export async function getSessionEmail(sessionToken: string): Promise<string | null> {
  return getRedis().get(keys.session(sessionToken)) as Promise<string | null>;
}

export async function deleteSession(sessionToken: string): Promise<void> {
  await getRedis().del(keys.session(sessionToken));
}

// ════════════════════════════════════════════════════════════════
// Checkout claims: the browser that paid unlocks itself.
//
// Opened when a checkout starts ("pending"), fulfilled by the webhook with
// the buyer's address, and redeemed once by the browser holding the claim's
// cookie. See src/lib/checkout-claim.ts for the whole flow.
// ════════════════════════════════════════════════════════════════
export const CHECKOUT_CLAIM_SECONDS = 2 * 60 * 60;
const CLAIM_PENDING = "pending";

export async function openCheckoutClaim(claim: string): Promise<void> {
  await getRedis().set(keys.checkoutClaim(claim), CLAIM_PENDING, { ex: CHECKOUT_CLAIM_SECONDS });
}

/**
 * Attaches a paid address to a claim this server opened. Only a pending
 * claim is fulfilled, so a claim cannot be pointed at a second order.
 */
export async function fulfilCheckoutClaim(claim: string, email: string): Promise<boolean> {
  const redis = getRedis();
  const key = keys.checkoutClaim(claim);
  if ((await redis.get(key)) !== CLAIM_PENDING) return false;
  const set = await redis.set(key, email.toLowerCase().trim(), { xx: true, ex: CHECKOUT_CLAIM_SECONDS });
  return set === "OK";
}

/** "pending", the paid address, or null when there is no live claim. */
export async function readCheckoutClaim(claim: string): Promise<string | null> {
  return getRedis().get(keys.checkoutClaim(claim)) as Promise<string | null>;
}

/** Takes the paid address off a fulfilled claim. Only one caller ever gets it. */
export async function redeemCheckoutClaim(claim: string): Promise<string | null> {
  const value = await getRedis().getdel(keys.checkoutClaim(claim)) as string | null;
  return value && value !== CLAIM_PENDING ? value : null;
}

// ════════════════════════════════════════════════════════════════
// Content-Security-Policy violation reports, counted per UTC day.
//
// One hash per day, one field per kind of violation ("enforce script-src
// inline /scan/[id]"), so the whole record of what the policy is blocking is
// a few hundred small counters rather than a log. The number of distinct
// kinds per day is capped: past it, kinds already seen keep counting and new
// ones are dropped, so nobody can fill the database by inventing reports.
// ════════════════════════════════════════════════════════════════
const CSP_KINDS_PER_DAY = 300;
const CSP_DAYS_KEPT = 35;

export async function recordCspViolation(kind: string): Promise<void> {
  const redis = getRedis();
  const key = keys.cspDay(new Date().toISOString().slice(0, 10));
  if (!(await redis.hexists(key, kind)) && (await redis.hlen(key)) >= CSP_KINDS_PER_DAY) return;
  await redis.hincrby(key, kind, 1);
  await redis.expire(key, CSP_DAYS_KEPT * 86400);
}

export async function readCspViolations(days: number): Promise<{ day: string; counts: Record<string, number> }[]> {
  const redis = getRedis();
  const span = Math.min(Math.max(Math.floor(days), 1), CSP_DAYS_KEPT);
  const out: { day: string; counts: Record<string, number> }[] = [];
  for (let i = 0; i < span; i++) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const raw = (await redis.hgetall<Record<string, string | number>>(keys.cspDay(day))) || {};
    const counts = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v) || 0]));
    if (Object.keys(counts).length) out.push({ day, counts });
  }
  return out;
}

/**
 * Counts one more request in a fixed window and returns the count so far.
 * For per-visitor limits on endpoints that write to Redis, so a script
 * cannot fill the database. The identifier is hashed before it is stored.
 */
export async function countInWindow(name: string, identifier: string, windowSeconds: number): Promise<number> {
  const redis = getRedis();
  const key = keys.window(name, identifier, Math.floor(Date.now() / 1000 / windowSeconds));
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count;
}


// ════════════════════════════════════════════════════════════════
// THE SCAN LEDGER
//
// Permanent, append-only, and deliberately separate from the 24-hour result
// cache. The cache exists so a viral product costs the API once; it is keyed
// by input fingerprint, it expires, and it is not queryable. This is the
// opposite of all three.
//
// Before this existed, the entire historical record of the business was five
// integers: a scan count, a savings total, a peak markup, and two verdict
// tallies. Every measurement the engine ever performed - the product, both
// prices, the markup, the verdict, the platform, the moment - was serialized
// to the browser and then destroyed.
//
// That is the asset. The scanner itself is not defensible: vision plus a
// shopping API is roughly $0.009 a scan and a competent team rebuilds it in a
// weekend. Four hundred million real measurements of what things cost versus
// what they are sold for is not rebuildable by anyone, at any price, because
// the only way to obtain it is to have been running for years. It is also the
// precondition for everything already promised: price history, alerts,
// "this product has been scanned 4,200 times", and every per-scan page.
//
// PRIVACY, and this constraint is absolute: a record contains NOTHING about
// the person who made it. No IP, no hashed IP, no email, no session, no
// browser id, no uploaded image. It describes a product and two prices. That
// is what makes it publishable as a permanent page and what keeps a subject
// access request from ever touching it.
//
// It also deliberately does NOT store the retail URL the person scanned.
// Storing it would be easy and it is the one field that would turn every
// record into a permanent, indexed, public assertion that a specific named
// business overcharges - which is precisely the claim the Terms decline to
// make. The wholesale source link is stored, because that one is an offer to
// sell, not an accusation.
//
// Four writes, one pipeline, one round trip:
//   scan:rec:<id>          the record
//   scan:ledger            zset by timestamp   -> feeds, pagination, history
//   scan:ledger:busted     zset by timestamp   -> the BUSTED feed
//   scan:ledger:markup     zset by markup      -> worst offenders, all time
//   scan:product:<key>     rolling aggregate   -> "scanned N times"
// ════════════════════════════════════════════════════════════════

export interface ScanRecord {
  id: string;
  ts: number;
  title: string;
  category: string;
  retailPrice: number;
  wholesalePrice: number;
  markup: number;
  savings: number;
  verdict: "HIGH_MARKUP" | "OVERPRICED" | "FAIR";
  confidence: "high" | "medium" | "low";
  matchConfidence: "exact" | "likely" | "unverified";
  platform: string;
  sourceUrl: string;
  imageUrl: string;
  /** The product fingerprint, so repeat scans of one product aggregate. */
  productKey: string;
  /**
   * True when this scan was answered from the 24-hour cache rather than a
   * fresh measurement. Kept because a repeat scan is still real demand data
   * and worth counting, but it must never be mistaken for an independent
   * measurement of the price.
   */
  cached: boolean;
  /**
   * The asking price as the seller showed it, when it was not in US dollars.
   * retailPrice above is always the USD conversion; this is what the page
   * prints beside it. Absent on dollar scans and on records from before
   * currency conversion existed.
   */
  retailOriginal?: { amount: number; currency: string; rate: number; asOf: string };
}

export interface ProductAggregate {
  count: number;
  firstTs: number;
  lastTs: number;
  maxMarkup: number;
  sumMarkup: number;
  title: string;
  lastId: string;
}

// Time-ordered prefix plus 96 bits of randomness. Sortable enough to be
// useful, unguessable enough that the ledger cannot be walked by anyone who
// finds one shared link.
// The vision layer's category enum. Fixed and small, so the "most expensive
// categories" board reads every category with one bounded MGET rather than
// scanning for keys.
export const CATEGORIES = [
  "beauty", "skincare", "fitness", "tech", "fashion",
  "accessories", "home", "pet", "food", "other",
] as const;

// ISO-8601 week, e.g. 2026-W37. Used to bucket "most scanned this week" so the
// board resets on its own rather than needing a sweeper.
export function isoWeek(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Thursday of the current week determines the year the week belongs to.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function newScanId(): string {
  return `${Date.now().toString(36)}${crypto.randomBytes(12).toString("hex")}`;
}

function parseJson<T>(raw: unknown): T | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return null;
  }
}

/**
 * Writes one measurement into the ledger. Never throws: a failed ledger write
 * must never turn a successful scan into an error for the person waiting on
 * it. Returns whether the record landed, so the caller knows if the permanent
 * page for it will resolve.
 */
export async function recordScan(record: ScanRecord): Promise<boolean> {
  try {
    const redis = getRedis();
    const pipeline = redis.pipeline();

    pipeline.set(keys.scanRecord(record.id), JSON.stringify(record));
    pipeline.zadd(keys.recordIndex(), { score: record.ts, member: record.id });
    if (record.verdict === "HIGH_MARKUP") {
      pipeline.zadd(keys.bustedIndex(), { score: record.ts, member: record.id });
    }

    // "Most scanned this week" counts every scan, including cache hits: a
    // repeat scan is a real person looking the product up, which is exactly
    // what this board is measuring. The week key expires itself.
    if (record.productKey) {
      pipeline.zincrby(keys.trendingWeek(isoWeek()), 1, record.productKey);
    }

    // Scored by markup so the worst offenders of all time are one ZRANGE away.
    // Category averages likewise. Neither takes cached repeats: a single viral
    // product would otherwise colonise the leaderboard with copies of itself
    // and drag its whole category's average along with it.
    if (!record.cached) {
      pipeline.zadd(keys.markupIndex(), { score: record.markup, member: record.id });
      const catKey = keys.categoryStats(record.category || "other");
      pipeline.hincrby(catKey, "count", 1);
      pipeline.hincrby(catKey, "sumMarkup", Math.round(record.markup));
    }

    await pipeline.exec();
    // Eight weeks of trending history is plenty for a weekly board and keeps
    // the keyspace from growing without bound.
    try {
      await redis.expire(keys.trendingWeek(isoWeek()), 60 * 60 * 24 * 56);
    } catch { /* non-fatal */ }
    await bumpProductAggregate(record);
    return true;
  } catch (err) {
    console.error("Ledger write failed:", err);
    return false;
  }
}

// Read-modify-write rather than atomic counters, because the aggregate is a
// small object rather than a set of independent numbers and a lost update
// under concurrency costs one scan out of a rolling total. If contention ever
// matters, this becomes a Redis hash with HINCRBY per field.
async function bumpProductAggregate(record: ScanRecord): Promise<void> {
  if (!record.productKey) return;
  try {
    const redis = getRedis();
    const key = keys.productAggregate(record.productKey);
    const existing = parseJson<ProductAggregate>(await redis.get(key));

    const next: ProductAggregate = existing
      ? {
          count: existing.count + 1,
          firstTs: existing.firstTs,
          lastTs: record.ts,
          maxMarkup: Math.max(existing.maxMarkup, record.markup),
          sumMarkup: existing.sumMarkup + record.markup,
          title: record.title || existing.title,
          lastId: record.id,
        }
      : {
          count: 1,
          firstTs: record.ts,
          lastTs: record.ts,
          maxMarkup: record.markup,
          sumMarkup: record.markup,
          title: record.title,
          lastId: record.id,
        };

    await redis.set(key, JSON.stringify(next));
  } catch {
    /* aggregate is a nice-to-have; the record itself already landed */
  }
}

export async function getScanRecord(id: string): Promise<ScanRecord | null> {
  try {
    return parseJson<ScanRecord>(await getRedis().get(keys.scanRecord(id)));
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// EVALUATION PURGE. Operator evaluation scans are kept out of public data
// (the scan route), but runs before that rule wrote to it. These two undo
// it, for POST /api/eval/purge: one deletes a ledger record together with
// everything it put on the boards, the other backs out what those scans
// added to the public counters. Neither is reachable from a visitor's
// request.
// ════════════════════════════════════════════════════════════════

/** Deletes one ledger record and its index, board and aggregate entries. Returns the record, or null if there was none. */
export async function deleteScanRecord(id: string): Promise<ScanRecord | null> {
  const record = await getScanRecord(id);
  if (!record) return null;
  const redis = getRedis();
  const pipeline = redis.pipeline();
  pipeline.del(keys.scanRecord(id));
  pipeline.zrem(keys.recordIndex(), id);
  pipeline.zrem(keys.bustedIndex(), id);
  pipeline.zrem(keys.markupIndex(), id);
  const week = keys.trendingWeek(isoWeek(new Date(record.ts)));
  if (record.productKey) pipeline.zincrby(week, -1, record.productKey);
  // Category averages only ever took first measurements (see recordScan).
  if (!record.cached) {
    const catKey = keys.categoryStats(record.category || "other");
    pipeline.hincrby(catKey, "count", -1);
    pipeline.hincrby(catKey, "sumMarkup", -Math.round(record.markup));
  }
  await pipeline.exec();
  // A product no longer scanned this week leaves the trending board.
  if (record.productKey) await redis.zremrangebyscore(week, "-inf", 0).catch(() => 0);
  if (record.productKey) {
    const key = keys.productAggregate(record.productKey);
    const agg = parseJson<ProductAggregate>(await redis.get(key).catch(() => null));
    if (agg && agg.count <= 1) await redis.del(key).catch(() => 0);
    else if (agg) {
      await redis.set(key, JSON.stringify({ ...agg, count: agg.count - 1, sumMarkup: agg.sumMarkup - record.markup })).catch(() => null);
    }
  }
  return record;
}

export interface PublicCounterCorrection {
  /** Completed scans, each of which added one to the lifetime counter. */
  scans: number;
  /** First-measurement verdicts, each of which added one to the verdict total. */
  verdicts: number;
  /** Of those, the HIGH_MARKUP ones. */
  busted: number;
  /** The savings those verdicts added to the "exposed" total, in USD. */
  savingsUsd: number;
}

/**
 * Subtracts evaluation scans from the public counters, never below zero.
 * Returns each counter before and after. The display rules on top of them
 * (the counter's floor and tick, the markup floor) are untouched; the
 * highest-markup record is not, because it only moves upward and no
 * evaluation verdict ever reached the floor it sits on.
 */
export async function subtractPublicCounters(c: PublicCounterCorrection): Promise<Record<string, { before: number; after: number }>> {
  const redis = getRedis();
  const out: Record<string, { before: number; after: number }> = {};
  const plan: [string, string, number][] = [
    ["scans", keys.totalScans(), c.scans],
    ["verdicts", keys.verdictTotal(), c.verdicts],
    ["busted", keys.bustedTotal(), c.busted],
    ["savingsUsd", keys.totalSavingsExposed(), c.savingsUsd],
  ];
  for (const [name, key, amount] of plan) {
    const before = Number(await redis.get(key)) || 0;
    const after = Math.max(0, Math.round((before - amount) * 100) / 100);
    if (amount > 0 && after !== before) await redis.set(key, after);
    out[name] = { before, after: amount > 0 ? after : before };
  }
  return out;
}

export async function getProductAggregate(productKey: string): Promise<ProductAggregate | null> {
  if (!productKey) return null;
  try {
    return parseJson<ProductAggregate>(await getRedis().get(keys.productAggregate(productKey)));
  } catch {
    return null;
  }
}

async function readRecords(ids: string[]): Promise<ScanRecord[]> {
  if (ids.length === 0) return [];
  try {
    const raw = await getRedis().mget<unknown[]>(...ids.map(keys.scanRecord));
    return raw
      .map(r => parseJson<ScanRecord>(r))
      .filter((r): r is ScanRecord => r !== null);
  } catch {
    return [];
  }
}

/** Most recent measurements first. */
export async function getRecentRecords(limit = 12, offset = 0): Promise<ScanRecord[]> {
  try {
    const ids = await getRedis().zrange<string[]>(
      keys.recordIndex(), offset, offset + limit - 1, { rev: true }
    );
    return readRecords(ids || []);
  } catch {
    return [];
  }
}

/** Highest markup ever measured, first. Real measurements only. */
export async function getTopMarkupRecords(limit = 12): Promise<ScanRecord[]> {
  try {
    const ids = await getRedis().zrange<string[]>(
      keys.markupIndex(), 0, limit - 1, { rev: true }
    );
    return readRecords(ids || []);
  } catch {
    return [];
  }
}

export async function getLedgerSize(): Promise<number> {
  try {
    return (await getRedis().zcard(keys.recordIndex())) || 0;
  } catch {
    return 0;
  }
}

// ════════════════════════════════════════════════════════════════
// INTENT CAPTURE
//
// Everyone who scans, hits the limit and does not pay was previously lost the
// instant they closed the tab. They are also the single most qualified
// audience this product will ever have: they did not read about it, they used
// it, and they ran out. Storing an address is a marketing purpose rather than
// a contractual one, so it needs consent at the point of entry and a line in
// the privacy policy, both of which exist.
// ════════════════════════════════════════════════════════════════

export interface NotifyEntry {
  email: string;
  ts: number;
  /** Where in the product the address was given, for attribution. */
  source: string;
}

export async function addNotifyEntry(email: string, source: string): Promise<boolean> {
  const normalized = email.toLowerCase().trim();
  try {
    const redis = getRedis();
    const entry: NotifyEntry = { email: normalized, ts: Date.now(), source };
    // NX: the first submission wins, so a resubmit never overwrites the
    // original consent timestamp, which is the one that has to be defensible.
    const created = await redis.set(keys.notifyEntry(normalized), JSON.stringify(entry), { nx: true });
    if (created === "OK") {
      await redis.zadd(keys.notifyIndex(), { score: entry.ts, member: normalized });
    }
    return true;
  } catch (err) {
    console.error("Notify capture failed:", err);
    return false;
  }
}

// Throws on failure: telling someone they are off the list when they are not
// is worse than telling them to try again.
export async function removeNotifyEntry(email: string): Promise<void> {
  const normalized = email.toLowerCase().trim();
  const redis = getRedis();
  await redis.del(keys.notifyEntry(normalized));
  await redis.zrem(keys.notifyIndex(), normalized);
}


// ════════════════════════════════════════════════════════════════
// THE PUBLIC INDEX AND THE LEADERBOARDS
//
// Everything below reads the ledger. Before these existed the ledger was
// write-only: a dataset nobody could see, which is a dataset that persuades
// nobody. These are what turn a lookup tool into an instrument pointed at the
// whole consumer economy, and every figure in them is a count of something
// that actually happened.
// ════════════════════════════════════════════════════════════════

/**
 * Records measured since a timestamp, newest first.
 *
 * Bounded by `cap` deliberately. The window is queried through the
 * time-ordered index, so this is exact while a window holds fewer records than
 * the cap. Past that it becomes "the most recent `cap` in the window", which
 * is the point at which the markup index needs sharding into day buckets and a
 * union across them. That is a real threshold, not a hypothetical: it arrives
 * somewhere around a thousand verdicts per window.
 */
export async function getRecordsSince(sinceTs: number, cap = 1000): Promise<ScanRecord[]> {
  try {
    const ids = await getRedis().zrange<string[]>(
      keys.recordIndex(), sinceTs, "+inf",
      { byScore: true, rev: false, offset: 0, count: cap }
    );
    return readRecords(ids || []);
  } catch {
    return [];
  }
}

export interface IndexEntry extends ScanRecord {
  /** How many times this product has been scanned in total. */
  scanCount: number;
}

/**
 * The public index: the steepest markups measured inside a window, one row per
 * product rather than one per scan.
 *
 * Deduping by product is what makes it readable. Without it, a product scanned
 * two hundred times fills the entire first page with itself and the index
 * stops being an index of the market and becomes an index of one item.
 */
export async function getIndexEntries(options: {
  days?: number;
  category?: string;
  limit?: number;
} = {}): Promise<IndexEntry[]> {
  const { days = 30, category, limit = 60 } = options;
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const records = await getRecordsSince(since);

  const byProduct = new Map<string, ScanRecord>();
  const counts = new Map<string, number>();

  for (const r of records) {
    // Cached repeats are not measurements, so they never define a row. They
    // still count toward how often a product was looked up.
    const key = r.productKey || r.id;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (r.cached) continue;
    if (category && r.category !== category) continue;
    const held = byProduct.get(key);
    if (!held || r.markup > held.markup) byProduct.set(key, r);
  }

  return [...byProduct.values()]
    .sort((a, b) => b.markup - a.markup)
    .slice(0, limit)
    .map(r => ({ ...r, scanCount: counts.get(r.productKey || r.id) || 1 }));
}

/** How many measurements sit behind each category inside a window. */
export function countByCategory(entries: ScanRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) out[e.category] = (out[e.category] || 0) + 1;
  return out;
}

export interface TrendingProduct {
  productKey: string;
  title: string;
  scans: number;
  maxMarkup: number;
  lastId: string;
}

/** Most scanned products in the current ISO week. */
export async function getTrendingProducts(limit = 10): Promise<TrendingProduct[]> {
  try {
    const redis = getRedis();
    const raw = await redis.zrange<(string | number)[]>(
      keys.trendingWeek(isoWeek()), 0, limit - 1, { rev: true, withScores: true }
    );
    if (!raw || raw.length === 0) return [];

    const pairs: { key: string; scans: number }[] = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
      pairs.push({ key: String(raw[i]), scans: Number(raw[i + 1]) });
    }
    if (pairs.length === 0) return [];

    const aggregates = await redis.mget<unknown[]>(...pairs.map(p => keys.productAggregate(p.key)));
    return pairs
      .map((p, i) => {
        const agg = parseJson<ProductAggregate>(aggregates[i]);
        if (!agg) return null;
        return {
          productKey: p.key,
          title: agg.title,
          scans: p.scans,
          maxMarkup: agg.maxMarkup,
          lastId: agg.lastId,
        };
      })
      .filter((t): t is TrendingProduct => t !== null);
  } catch {
    return [];
  }
}

export interface CategoryStat {
  category: string;
  count: number;
  averageMarkup: number;
}

/**
 * Average measured markup per category, steepest first.
 *
 * A minimum sample is enforced because "the most expensive category on
 * BustedLab" resting on two scans is not a finding, it is an accident, and it
 * is the kind of number a journalist would quote and a competitor would
 * disprove in an afternoon.
 */
export async function getCategoryStats(minSample = 5): Promise<CategoryStat[]> {
  const redis = getRedis();

  // Per-category isolation, deliberately. Most categories hold nothing until
  // the ledger has real breadth, and hgetall against a key that does not exist
  // rejects rather than returning empty. Under Promise.all a single untouched
  // category would take the whole board down with it, so the board would be
  // invisible for precisely as long as the product is young.
  const rows = await Promise.all(
    CATEGORIES.map(async c => {
      try {
        return await redis.hgetall<Record<string, string | number>>(keys.categoryStats(c));
      } catch {
        return null;
      }
    })
  );

  return CATEGORIES
    .map((category, i) => {
      const row = rows[i];
      const count = Number(row?.count ?? 0);
      const sum = Number(row?.sumMarkup ?? 0);
      return { category, count, averageMarkup: count > 0 ? Math.round(sum / count) : 0 };
    })
    .filter(c => c.count >= minSample)
    .sort((a, b) => b.averageMarkup - a.averageMarkup);
}

/**
 * The biggest verified gaps, one row per product: "What we catch" on the
 * landing page.
 *
 * Drawn from the most recent `pool` measurements rather than the whole ledger,
 * because there is no index scored by savings and one mget of a few hundred
 * records is the most a public, edge-cached board should cost. Excluded:
 * cached repeats (not independent measurements), matches the engine itself
 * marked unverified, and anything without a positive saving. Each product is
 * represented by its largest measured saving.
 */
export async function getTopSavingsProducts(limit = 8, pool = 500): Promise<ScanRecord[]> {
  const records = await getRecentRecords(pool);
  const byProduct = new Map<string, ScanRecord>();
  for (const r of records) {
    if (r.cached || r.matchConfidence === "unverified" || !(r.savings > 0)) continue;
    const key = r.productKey || r.id;
    const held = byProduct.get(key);
    if (!held || r.savings > held.savings) byProduct.set(key, r);
  }
  return [...byProduct.values()].sort((a, b) => b.savings - a.savings).slice(0, limit);
}

/** Highest markups ever measured, one row per product. */
export async function getTopMarkupProducts(limit = 10): Promise<ScanRecord[]> {
  // Over-fetch, because the raw index is per scan and collapses once deduped.
  const records = await getTopMarkupRecords(limit * 6);
  const seen = new Set<string>();
  const out: ScanRecord[] = [];
  for (const r of records) {
    const key = r.productKey || r.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}
