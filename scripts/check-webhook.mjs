/**
 * PURCHASE PATH CHECK.
 *
 * The one flow in this product where a bug costs a customer money: somebody
 * pays, and the webhook has to turn that payment into access. Every failure
 * mode here is silent from both ends - the provider sees a response code, the
 * customer sees nothing - so it gets tested rather than reasoned about.
 *
 * Runs the REAL webhook route handler and the REAL checkout-readiness rules
 * against signed Lemon Squeezy deliveries and an in-memory Upstash. No
 * network, no database, no Lemon Squeezy account:
 *
 *   node --experimental-strip-types --no-warnings scripts/check-webhook.mjs
 *
 * It also loads the webhook as it was before the overlay change, from a
 * frozen fixture, and replays the misconfiguration that motivated the change, so the claim
 * "this used to reject paying customers" is shown rather than asserted.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";

const REPO = resolve(dirname(new URL(import.meta.url).pathname), "..");
const NEXT_SERVER = pathToFileURL(join(REPO, "node_modules/next/server.js")).href;
const lib = (name) => pathToFileURL(join(REPO, `src/lib/${name}.ts`)).href;

// ── Load a route handler outside Next: rewrite the specifiers Node cannot
//    resolve from a temp directory, and nothing else. ──
async function loadRoute(source, label) {
  let src = source
    .replace(/from "next\/server"/g, `from "${NEXT_SERVER}"`)
    .replace(/from "@\/lib\/([a-z0-9-]+)"/g, (_m, name) => `from "${lib(name)}"`);
  const unresolved = src.match(/from "@\/[^"]+"/g);
  if (unresolved) throw new Error(`${label}: unresolved imports ${unresolved.join(", ")}`);
  const dir = mkdtempSync(join(tmpdir(), "bustedlab-webhook-"));
  const file = join(dir, `${label}.ts`);
  writeFileSync(file, src, "utf8");
  return import(pathToFileURL(file).href);
}

// ── The mocked outside world: Upstash and Resend. ──
const store = new Map();
const emails = [];
let resendStatus = 200;

function runRedisCommand(args) {
  const [rawCmd, key, ...rest] = args;
  const cmd = String(rawCmd).toUpperCase();
  const flags = rest.map(r => String(r).toUpperCase());
  switch (cmd) {
    case "GET": return store.has(key) ? store.get(key) : null;
    case "SET":
      if (flags.includes("NX") && store.has(key)) return null;
      store.set(key, String(rest[0]));
      return "OK";
    case "DEL": return store.delete(key) ? 1 : 0;
    case "INCR": {
      const next = (Number(store.get(key)) || 0) + 1;
      store.set(key, String(next));
      return next;
    }
    case "EXPIRE":
    case "EXPIREAT": return 1;
    default: return null;
  }
}
const encode = (v) => (typeof v === "string" ? Buffer.from(v, "utf8").toString("base64") : v);

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : String(input?.url || input);
  if (url.startsWith("https://redis.test")) {
    const body = init.body ? JSON.parse(init.body) : [];
    const pipeline = Array.isArray(body[0]);
    const result = pipeline
      ? body.map(a => ({ result: encode(runRedisCommand(a)) }))
      : { result: encode(runRedisCommand(body)) };
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url === "https://api.resend.com/emails") {
    emails.push(JSON.parse(init.body));
    return new Response(JSON.stringify(resendStatus === 200 ? { id: "email_1" } : { message: "domain not verified" }), {
      status: resendStatus,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error(`unmocked fetch: ${url}`);
};

// console.error is where every silent-failure fix in this path reports, so it
// is captured and asserted on.
const errors = [];
const realError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(" ")); };

const BASE_ENV = {
  UPSTASH_REDIS_REST_URL: "https://redis.test",
  UPSTASH_REDIS_REST_TOKEN: "test",
  IDENTITY_SALT: "webhook-test-salt",
  RESEND_API_KEY: "re_test",
  NEXT_PUBLIC_BASE_URL: "https://bustedlab.test",
  LEMONSQUEEZY_WEBHOOK_SECRET: "ls_signing_secret",
};
const MANAGED = [
  ...Object.keys(BASE_ENV), "PAYMENT_PROVIDER", "CHECKOUT_URL", "GUMROAD_WEBHOOK_SECRET",
  "PADDLE_WEBHOOK_SECRET", "VERCEL_ENV", "LEMONSQUEEZY_ACCEPT_TEST_ORDERS",
];
function env(overrides = {}) {
  for (const k of MANAGED) delete process.env[k];
  Object.assign(process.env, BASE_ENV, overrides);
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete process.env[k];
}
function reset() {
  store.clear();
  emails.length = 0;
  errors.length = 0;
  resendStatus = 200;
}

// ── A genuine-looking Lemon Squeezy delivery, signed the way Lemon Squeezy
//    signs: HMAC-SHA256 of the raw body, hex, in X-Signature. ──
function lsDelivery({ event = "order_created", email = "buyer@example.com", orderId = "4815162342",
                     status = "paid", testMode = false, secret = BASE_ENV.LEMONSQUEEZY_WEBHOOK_SECRET } = {}) {
  const body = JSON.stringify({
    meta: { event_name: event, test_mode: testMode },
    data: { type: "orders", id: orderId, attributes: { user_email: email, status, total: 499, currency: "USD" } },
  });
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return { body, headers: { "content-type": "application/json", "x-signature": signature, "x-event-name": event } };
}

const { NextRequest } = await import(NEXT_SERVER);
async function deliver(route, delivery) {
  const req = new NextRequest("https://bustedlab.test/api/webhook", {
    method: "POST", headers: delivery.headers, body: delivery.body,
  });
  const res = await route.POST(req);
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

const redis = await import(lib("redis"));
const isPaid = (email) => redis.isPaidUser(email);

let failures = 0;
const check = (label, condition, detail = "") => {
  if (!condition) failures++;
  realError.call(console, `${condition ? "PASS" : "FAIL"}  ${label}${detail ? `   ${detail}` : ""}`);
};
const section = (title) => realError.call(console, `\n${title}\n${"-".repeat(78)}`);

const current = await loadRoute(readFileSync(join(REPO, "src/app/api/webhook/route.ts"), "utf8"), "webhook-current");

// ════════════════════════════════════════════════════════════════
section("A PURCHASE BECOMES ACCESS");

env(); reset();
let r = await deliver(current, lsDelivery());
check("signed order_created is accepted", r.status === 200, `HTTP ${r.status}`);
check("the buyer is granted access", await isPaid("buyer@example.com"));
check("the access email is sent", emails.length === 1 && emails[0].to === "buyer@example.com",
      `${emails.length} email(s)`);
check("the email carries a working sign-in link",
      emails.length === 1 && /https:\/\/bustedlab\.test\/api\/auth\?token=[0-9a-f]{64}/.test(emails[0].html));

r = await deliver(current, lsDelivery());
check("the provider's retry is recognised as a duplicate", r.body?.duplicate === true);
check("and does not send a second email", emails.length === 1, `${emails.length} email(s)`);

env(); reset();
r = await deliver(current, lsDelivery({ email: "Mixed.Case@Example.com", orderId: "1" }));
check("an email typed in mixed case still grants access to the address", await isPaid("mixed.case@example.com"));

// ════════════════════════════════════════════════════════════════
section("NOTHING GRANTS ACCESS WITHOUT THE SECRET");

env(); reset();
r = await deliver(current, lsDelivery({ secret: "not-the-secret" }));
check("a wrongly signed delivery is refused", r.status === 401, `HTTP ${r.status}`);
check("and grants nothing", !(await isPaid("buyer@example.com")));

env({ LEMONSQUEEZY_WEBHOOK_SECRET: undefined }); reset();
r = await deliver(current, lsDelivery());
check("with no Lemon Squeezy secret configured, nothing is trusted", r.status === 401, `HTTP ${r.status}`);

env(); reset();
r = await deliver(current, lsDelivery({ status: "pending" }));
check("an unpaid order unlocks nothing", !(await isPaid("buyer@example.com")), `HTTP ${r.status}`);

// ════════════════════════════════════════════════════════════════
section("THE MISCONFIGURATION THIS CHANGE EXISTS FOR");
// PAYMENT_PROVIDER=gumroad was the example value in .env.example. With a
// Lemon Squeezy store, that is every real purchase charged and rejected.

// A frozen copy rather than `git show`: CI checks out shallow, and history
// gets squashed on merge, so a commit hash is not something to depend on.
const beforeSource = readFileSync(join(REPO, "scripts/fixtures/webhook.pre-overlay.ts.txt"), "utf8");
const before = await loadRoute(beforeSource, "webhook-before");

env({ PAYMENT_PROVIDER: "gumroad", GUMROAD_WEBHOOK_SECRET: "gumroad_secret" }); reset();
r = await deliver(before, lsDelivery());
check("BEFORE: a paid Lemon Squeezy order under PAYMENT_PROVIDER=gumroad was rejected",
      r.status === 401 && !(await isPaid("buyer@example.com")),
      `HTTP ${r.status}, paid=${await isPaid("buyer@example.com")}  <- charged, never fulfilled`);

env({ PAYMENT_PROVIDER: "gumroad", GUMROAD_WEBHOOK_SECRET: "gumroad_secret" }); reset();
r = await deliver(current, lsDelivery());
check("NOW: the same delivery under the same setting grants access",
      r.status === 200 && (await isPaid("buyer@example.com")), `HTTP ${r.status}`);

// ════════════════════════════════════════════════════════════════
section("REFUNDS TAKE ACCESS BACK");

env(); reset();
await deliver(current, lsDelivery({ orderId: "77" }));
const hadAccess = await isPaid("buyer@example.com");
r = await deliver(current, lsDelivery({ event: "order_refunded", orderId: "77", status: "refunded" }));
check("a refund revokes access", hadAccess && !(await isPaid("buyer@example.com")), `HTTP ${r.status}`);

// ════════════════════════════════════════════════════════════════
section("TEST-MODE ORDERS");

env({ VERCEL_ENV: "production" }); reset();
r = await deliver(current, lsDelivery({ testMode: true, orderId: "t1" }));
check("on production, a test-card order is acknowledged but NOT granted",
      r.status === 200 && r.body?.ignored === true && !(await isPaid("buyer@example.com")),
      `HTTP ${r.status}`);
check("and says why, loudly", errors.some(e => e.includes("TEST-MODE order received on production")));

env({ VERCEL_ENV: "production", LEMONSQUEEZY_ACCEPT_TEST_ORDERS: "true" });
r = await deliver(current, lsDelivery({ testMode: true, orderId: "t1" }));
check("the SAME order, resent after allowing test orders, is granted - not called a duplicate",
      r.status === 200 && r.body?.duplicate !== true && (await isPaid("buyer@example.com")),
      `HTTP ${r.status}`);

env({ VERCEL_ENV: "preview" }); reset();
await deliver(current, lsDelivery({ testMode: true, orderId: "t2" }));
check("preview deployments accept test orders without the flag", await isPaid("buyer@example.com"));

// ════════════════════════════════════════════════════════════════
section("A REFUSED EMAIL IS NO LONGER SILENT");

env(); reset();
resendStatus = 403;
r = await deliver(current, lsDelivery({ orderId: "e1" }));
check("access is still granted when the email provider refuses",
      r.status === 200 && (await isPaid("buyer@example.com")), `HTTP ${r.status}`);
check("and the refusal is logged with its status",
      errors.some(e => e.includes("access email failed") && e.includes("403")));

// ════════════════════════════════════════════════════════════════
section("CHECKOUT ONLY OPENS WHEN THE PURCHASE CAN BE FULFILLED");

const { checkoutReadiness } = await import(lib("payment-provider"));
const LS_URL = "https://bustedlab.lemonsqueezy.com/checkout/buy/9f1c-variant";
const cases = [
  ["no checkout link", {}, false, "no_checkout_url"],
  ["Lemon Squeezy link, its secret set", { CHECKOUT_URL: LS_URL }, true, "lemonsqueezy/overlay"],
  ["Lemon Squeezy link, no Lemon Squeezy secret",
    { CHECKOUT_URL: LS_URL, LEMONSQUEEZY_WEBHOOK_SECRET: undefined, GUMROAD_WEBHOOK_SECRET: "g" },
    false, "webhook_unverifiable"],
  ["Lemon Squeezy link, PAYMENT_PROVIDER=gumroad",
    { CHECKOUT_URL: LS_URL, PAYMENT_PROVIDER: "gumroad", GUMROAD_WEBHOOK_SECRET: "g" },
    false, "provider_mismatch"],
  ["Gumroad link, its secret set",
    { CHECKOUT_URL: "https://seller.gumroad.com/l/busted", GUMROAD_WEBHOOK_SECRET: "g" },
    true, "gumroad/redirect"],
  ["custom domain, PAYMENT_PROVIDER=lemonsqueezy",
    { CHECKOUT_URL: "https://pay.bustedlab.com/buy/x", PAYMENT_PROVIDER: "lemonsqueezy" },
    true, "lemonsqueezy/overlay"],
  ["http link refused", { CHECKOUT_URL: "http://bustedlab.lemonsqueezy.com/checkout/buy/x" }, false, "no_checkout_url"],
];
for (const [label, overrides, expectOk, expectDetail] of cases) {
  env({ LEMONSQUEEZY_WEBHOOK_SECRET: BASE_ENV.LEMONSQUEEZY_WEBHOOK_SECRET, ...overrides });
  const ready = checkoutReadiness();
  const got = ready.ok ? `${ready.provider}/${ready.embed ? "overlay" : "redirect"}` : ready.reason;
  check(`${label}: ${expectOk ? "open" : "offline"}`, ready.ok === expectOk && got === expectDetail, got);
}

console.error = realError;
console.log("");
if (failures > 0) {
  console.error(`${failures} purchase-path case(s) failed.`);
  process.exit(1);
}
console.log("All purchase-path cases pass.");
