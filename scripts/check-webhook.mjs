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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REPO, BASE_ENV, importSrc, importSource, env, reset, call, mail, logs, check, section, finish, lemonSqueezyDelivery,
} from "./lib/harness.mjs";

const lsDelivery = lemonSqueezyDelivery;

const deliver = (route, delivery) =>
  call(route.POST, "/api/webhook", { method: "POST", headers: delivery.headers, body: delivery.body })
    .then(r => ({ status: r.status, body: r.json }));

const redisLib = await importSrc("lib/redis.ts");
const isPaid = (email) => redisLib.isPaidUser(email);
const emails = mail.sent;
const errors = logs.errors;

const current = await importSrc("app/api/webhook/route.ts");

// ════════════════════════════════════════════════════════════════
section("A PURCHASE BECOMES ACCESS");

env(); reset();
let r = await deliver(current, lsDelivery());
check("signed order_created is accepted", r.status === 200, `HTTP ${r.status}`);
check("the buyer is granted access", await isPaid("buyer@example.com"));
check("the access email is sent", emails.length === 1 && emails[0].to === "buyer@example.com",
      `${emails.length} email(s)`);
check("the email carries a working sign-in link",
      emails.length === 1 && /https:\/\/bustedlab\.test\/auth\/verify\?token=[0-9a-f]{64}/.test(emails[0].html));

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
check("but is answered 200, not 401, so it is not retried as a failed delivery", r.status === 200, `HTTP ${r.status}`);
check("and the log says why, not that the signature failed",
      errors.some(e => e.includes('"pending"') && e.includes("no access was granted")));

// ════════════════════════════════════════════════════════════════
section("A SIGNED EVENT THIS APP DOES NOT HANDLE");

env(); reset();
r = await deliver(current, lsDelivery({ event: "license_key_created" }));
check("is answered 200, not 401 \"unverified\"", r.status === 200 && r.body?.ignored === true, `HTTP ${r.status}`);
check("grants nothing", !(await isPaid("buyer@example.com")));
check("and logs nothing", errors.length === 0, errors.join(" | "));

env(); reset();
r = await deliver(current, lsDelivery({ event: "license_key_created", secret: "not-the-secret" }));
check("the same event wrongly signed is still 401", r.status === 401, `HTTP ${r.status}`);

// ════════════════════════════════════════════════════════════════
section("THE MISCONFIGURATION THIS CHANGE EXISTS FOR");
// PAYMENT_PROVIDER=gumroad was the example value in .env.example. With a
// Lemon Squeezy store, that is every real purchase charged and rejected.

// A frozen copy rather than `git show`: CI checks out shallow, and history
// gets squashed on merge, so a commit hash is not something to depend on.
const beforeSource = readFileSync(join(REPO, "scripts/fixtures/webhook.pre-overlay.ts.txt"), "utf8");
const before = await importSource(beforeSource, "webhook-before");

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
mail.status = 403;
r = await deliver(current, lsDelivery({ orderId: "e1" }));
check("access is still granted when the email provider refuses",
      r.status === 200 && (await isPaid("buyer@example.com")), `HTTP ${r.status}`);
check("and the refusal is logged with its status",
      errors.some(e => e.includes("access email failed") && e.includes("403")));

// ════════════════════════════════════════════════════════════════
section("CHECKOUT ONLY OPENS WHEN THE PURCHASE CAN BE FULFILLED");

const { checkoutReadiness } = await importSrc("lib/payment-provider.ts");
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

finish("purchase-path");
