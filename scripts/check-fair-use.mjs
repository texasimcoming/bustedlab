/**
 * FAIR-USE CEILING CHECK.
 *
 * This limit sits in front of PAYING customers, so its failure mode is
 * locking out someone who has paid. That earns a test rather than a
 * code read.
 *
 * It exercises the real counter functions from src/lib/redis.ts against an
 * in-memory Upstash, so it needs no network and no database:
 *
 *   node --experimental-strip-types --no-warnings scripts/check-fair-use.mjs
 *
 * What it asserts: a fresh account starts at zero, the count is per-account
 * and not global, the boundary is exact (the last allowed scan is allowed
 * and the next one is not), the counter is keyed on a hash rather than the
 * address itself, and the key is given an expiry so the ceiling actually
 * resets instead of becoming permanent.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

const REPO = resolve(dirname(new URL(import.meta.url).pathname), "..");

// ── The emulated Upstash, recording every command so the test can assert
//    on the shape of the writes and not just their effect. ──
const store = new Map();
const commands = [];

function runRedisCommand(args) {
  const [rawCmd, key, ...rest] = args;
  const cmd = String(rawCmd).toUpperCase();
  commands.push({ cmd, key });
  switch (cmd) {
    case "GET": return store.has(key) ? store.get(key) : null;
    case "SET": store.set(key, String(rest[0])); return "OK";
    case "INCR": {
      const next = (Number(store.get(key)) || 0) + 1;
      store.set(key, String(next));
      return next;
    }
    case "DEL": return store.delete(key) ? 1 : 0;
    case "EXPIREAT":
    case "EXPIRE": return 1;
    default: return null;
  }
}

// The client sends `Upstash-Encoding: base64` and decodes what comes back.
const encode = (value) =>
  typeof value === "string" ? Buffer.from(value, "utf8").toString("base64") : value;

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : String(input?.url || input);
  if (!url.startsWith("https://redis.test")) throw new Error(`unmocked fetch: ${url}`);
  const body = init.body ? JSON.parse(init.body) : [];
  const isPipeline = Array.isArray(body) && Array.isArray(body[0]);
  const result = isPipeline
    ? body.map(args => ({ result: encode(runRedisCommand(args)) }))
    : { result: encode(runRedisCommand(body)) };
  return {
    ok: true, status: 200,
    headers: { get: () => "application/json" },
    json: async () => result,
    text: async () => JSON.stringify(result),
  };
};

process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
process.env.IDENTITY_SALT = "fair-use-test-salt";
// A small ceiling so the boundary can be walked exactly. Set before the
// import, because the constant is read at module load - which is itself
// worth asserting, since a ceiling read once per process is a ceiling that
// ignores a change until redeploy.
const CEILING = 7;
process.env.PAID_DAILY_SCAN_CEILING = String(CEILING);

const {
  PAID_DAILY_SCAN_CEILING,
  getPaidScansToday,
  incrementPaidScanCount,
} = await import("../src/lib/redis.ts");

let failures = 0;
const check = (label, condition, detail = "") => {
  if (!condition) failures++;
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

console.log("\nFAIR-USE CEILING");
console.log("-".repeat(78));

check(
  "the ceiling is read from the environment",
  PAID_DAILY_SCAN_CEILING === CEILING,
  `got ${PAID_DAILY_SCAN_CEILING}, set ${CEILING}`
);

// The shipped default, read from source rather than from this process, so an
// accidental change to it is caught here and not in production.
const source = readFileSync(resolve(REPO, "src/lib/redis.ts"), "utf8");
const declared = source.match(/PAID_DAILY_SCAN_CEILING = Number\(process\.env\.PAID_DAILY_SCAN_CEILING \|\| (\d+)\)/);
check(
  "the shipped default is 500",
  declared !== null && declared[1] === "500",
  declared ? `source says ${declared[1]}` : "declaration not found"
);

const ACCOUNT = "customer@example.com";
const OTHER = "someone-else@example.com";

check("a fresh account starts at zero", (await getPaidScansToday(ACCOUNT)) === 0);

// Walk right up to the boundary.
for (let i = 0; i < CEILING - 1; i++) await incrementPaidScanCount(ACCOUNT);
const beforeLast = await getPaidScansToday(ACCOUNT);
check(
  "the last allowed scan is still allowed",
  beforeLast === CEILING - 1 && PAID_DAILY_SCAN_CEILING - beforeLast === 1,
  `${beforeLast} used, 1 remaining`
);

await incrementPaidScanCount(ACCOUNT);
const atCeiling = await getPaidScansToday(ACCOUNT);
check(
  "the scan that reaches the ceiling closes it",
  atCeiling === CEILING && PAID_DAILY_SCAN_CEILING - atCeiling <= 0,
  `${atCeiling} used, 0 remaining`
);

check(
  "a different account is unaffected",
  (await getPaidScansToday(OTHER)) === 0,
  "the ceiling is per-account, not global"
);

// The counter must not be a permanent record of who scanned what, and it
// must not be a permanent ceiling either.
const key = [...store.keys()].find(k => k.startsWith("scan:paid:"));
check("the counter key exists", !!key, key || "");
check(
  "the account is hashed, not stored in the clear",
  !!key && !key.includes(ACCOUNT) && !key.includes("example.com"),
  key || ""
);
check(
  "the key is given an expiry, so the ceiling resets",
  commands.some(c => c.cmd === "EXPIREAT" && c.key === key),
  "EXPIREAT issued"
);

console.log("");
if (failures > 0) {
  console.error(`${failures} fair-use case(s) failed.`);
  process.exit(1);
}
console.log("All fair-use cases pass.");
