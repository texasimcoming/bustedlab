import { Redis } from "@upstash/redis";

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

export const keys = {
  scanCount: (ip: string) => `scan:count:${ip}`,
  totalScans: () => `scan:total:global`,
  paidUser: (email: string) => `paid:${email.toLowerCase().trim()}`,
  magicToken: (token: string) => `magic:${token}`,
  session: (token: string) => `session:${token}`,
};

export async function getScansRemaining(ip: string): Promise<number> {
  const count = await getRedis().get(keys.scanCount(ip)) as number | null;
  return Math.max(0, 2 - (count || 0));
}

export async function incrementScanCount(ip: string): Promise<void> {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  const secondsUntilMidnight = Math.floor((midnight.getTime() - now.getTime()) / 1000);
  const key = keys.scanCount(ip);
  await getRedis().incr(key);
  await getRedis().expire(key, secondsUntilMidnight);
}

// Global, lifetime, no-expiry counter — powers the real "X scanned" number
// on the landing page. Call this once per completed scan (success or
// FINDER/UNRESOLVED — every real attempt counts, this isn't a "wins" tally).
export async function incrementTotalScans(): Promise<void> {
  await getRedis().incr(keys.totalScans());
}

export async function getTotalScans(): Promise<number> {
  const count = await getRedis().get(keys.totalScans()) as number | null;
  return count || 0;
}

export async function isPaidUser(email: string): Promise<boolean> {
  const val = await getRedis().get(keys.paidUser(email.toLowerCase().trim()));
  return val === "paid";
}

export async function markAsPaid(email: string): Promise<void> {
  await getRedis().set(keys.paidUser(email.toLowerCase().trim()), "paid");
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
