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
  paidUser: (email: string) => `paid:${email.toLowerCase().trim()}`,
  magicToken: (token: string) => `magic:${token}`,
  session: (token: string) => `session:${token}`,
  scanCache: (fingerprint: string) => `scan:cache:${fingerprint}`,
  processedOrder: (orderId: string) => `order:${orderId}`,

  // ── The permanent record. See the SCAN LEDGER section below. ──
  scanRecord: (id: string) => `scan:rec:${id}`,
  recordIndex: () => `scan:ledger`,
  bustedIndex: () => `scan:ledger:busted`,
  markupIndex: () => `scan:ledger:markup`,
  productAggregate: (productKey: string) => `scan:product:${productKey}`,

  // ── Intent capture ──
  notifyEntry: (email: string) => `notify:${email.toLowerCase().trim()}`,
  notifyIndex: () => `notify:index`,
};

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
// unauthenticated flood is a direct bill. The cap is deliberately an
// environment variable rather than a constant: the right number changes
// with the traffic, and hardcoding a small one is how a launch that goes
// viral ends up serving "high demand" to everyone at 500 scans.
// Cache hits never touch this counter, so a single product going viral
// costs one scan no matter how many people scan it.
// ════════════════════════════════════════════════════════════════
export const GLOBAL_DAILY_CAP = Number(process.env.GLOBAL_DAILY_SCAN_CAP || 25000);

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

export async function storeMagicToken(token: string, email: string): Promise<void> {
  await getRedis().set(keys.magicToken(token), email, { ex: 900 });
}

export async function consumeMagicToken(token: string): Promise<string | null> {
  const email = await getRedis().get(keys.magicToken(token)) as string | null;
  if (email) await getRedis().del(keys.magicToken(token));
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
    // Scored by markup so the worst offenders of all time are one ZRANGE away.
    // Only real measurements enter this one: a cached repeat would let a
    // single viral product colonise the leaderboard with copies of itself.
    if (!record.cached) {
      pipeline.zadd(keys.markupIndex(), { score: record.markup, member: record.id });
    }

    await pipeline.exec();
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

export async function removeNotifyEntry(email: string): Promise<void> {
  const normalized = email.toLowerCase().trim();
  try {
    const redis = getRedis();
    await redis.del(keys.notifyEntry(normalized));
    await redis.zrem(keys.notifyIndex(), normalized);
  } catch {
    /* nothing to do */
  }
}
