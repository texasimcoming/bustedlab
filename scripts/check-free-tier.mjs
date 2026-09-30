/**
 * FREE TIER CHECK. The free allowance is the first thing every visitor from
 * a campaign meets, so it has to be right in both directions: nobody told
 * their free scans are spent before they have scanned, and nobody able to
 * scan for free without limit.
 *
 *   node --experimental-strip-types --no-warnings scripts/check-free-tier.mjs
 */
import { importSrc, env, reset, advance, redis, check, section, finish } from "./lib/harness.mjs";

const lib = await importSrc("lib/redis.ts");
const SHARED = "100.64.0.1"; // a carrier-grade NAT address many phones share
const browser = (n) => n.toString(16).padStart(32, "0");
async function scan(ip, browserId) {
  await lib.incrementScanCount(ip);
  if (browserId) await lib.incrementScanCount(`browser:${browserId}`);
}

section("PEOPLE SHARING ONE ADDRESS DO NOT SHARE ONE ALLOWANCE");
env(); reset();
await scan(SHARED, browser(1));
await scan(SHARED, browser(1));
await scan(SHARED, browser(2));
await scan(SHARED, browser(2));
check("the first two people behind the address used their scans", (await lib.freeScansRemaining(SHARED, browser(1))) === 0 &&
      (await lib.freeScansRemaining(SHARED, browser(2))) === 0);
check("the third person arriving from the same address still has both", (await lib.freeScansRemaining(SHARED, browser(3))) === 2,
      String(await lib.freeScansRemaining(SHARED, browser(3))));

section("AND THE ALLOWANCE STILL HOLDS");
env(); reset();
await scan("203.0.113.9", browser(4));
await scan("203.0.113.9", browser(4));
check("one browser gets two a day", (await lib.freeScansRemaining("203.0.113.9", browser(4))) === 0);
check("changing network does not reset it (the browser is counted)", (await lib.freeScansRemaining("198.51.100.77", browser(4))) === 0);
check("a client that refuses the cookie is counted by address, two a day",
      (await lib.freeScansRemaining("203.0.113.9", null)) === 0 && (await lib.freeScansRemaining("203.0.113.10", null)) === 2);

env(); reset();
for (let i = 0; i < 40; i++) await scan(SHARED, browser(1000 + i));
check("inventing a cookie per scan stops at the address ceiling (40 a day)",
      (await lib.freeScansRemaining(SHARED, browser(9999))) === 0 && lib.FREE_SCANS_PER_IP_PER_DAY === 40);
check("the counters reset at midnight UTC", redis.ttl(`scan:count:${lib.hashIdentifier(SHARED)}`) <= 86400 &&
      redis.ttl(`scan:count:${lib.hashIdentifier(SHARED)}`) > 0);
advance(86401);
check("and the next day the address is clear again", (await lib.freeScansRemaining(SHARED, browser(9999))) === 2);
check("addresses and browser ids are stored only as hashes", !redis.keys().some(k => k.includes("100.64.0.1") || k.includes(browser(1))));

finish("free-tier");
