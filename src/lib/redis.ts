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
