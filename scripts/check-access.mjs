/**
 * ACCESS PATH CHECK.
 *
 * After the webhook grants access, a paying customer still has to get INTO
 * the product, and each way in has failed silently before. This runs the
 * real route handlers against the emulated outside world in
 * scripts/lib/harness.mjs:
 *
 *   node --experimental-strip-types --no-warnings scripts/check-access.mjs
 *
 * Sign-in links: mail filters open links before people do. Opening a link
 * must not spend it, and the page it opens must still sign the person in.
 *
 * The paying browser: the browser that paid signs itself in once the
 * webhook verifies the purchase, without the email - and a claim can never
 * sign in anyone the verified purchase did not pay for.
 */
import {
  importSrc, env, reset, advance, call, mail, redis, check, section, finish, lemonSqueezyDelivery,
} from "./lib/harness.mjs";

const auth = await importSrc("app/api/auth/route.ts");
const checkout = await importSrc("app/api/checkout/route.ts");
const webhook = await importSrc("app/api/webhook/route.ts");
const verify = await importSrc("app/api/auth/verify/route.ts");
const redisLib = await importSrc("lib/redis.ts");

const EMAIL = "buyer@example.com";
const tokenIn = (html) => html?.match(/\/auth\/verify\?token=([0-9a-f]{64})/)?.[1];
const signIn = (token) => call(verify.POST, "/api/auth/verify", { method: "POST", form: { token } });
const sessionEmail = (sessionToken) => redisLib.getSessionEmail(sessionToken);

async function paidCustomerRequestsLink() {
  await redisLib.markAsPaid(EMAIL);
  await call(auth.POST, "/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL }),
  });
  return tokenIn(mail.sent.at(-1)?.html);
}

// ════════════════════════════════════════════════════════════════
section("A SIGN-IN LINK SURVIVES THE MAIL FILTER");

env(); reset();
let token = await paidCustomerRequestsLink();
check("the emailed link opens the sign-in page, not the route that signs in", !!token,
      mail.sent.at(-1)?.html?.match(/https:\/\/[^"]+/)?.[0]);

let r = await call(auth.GET, `/api/auth?token=${token}`);
check("a link in the old shape is sent on to the sign-in page", r.status === 307 &&
      r.location === `https://bustedlab.test/auth/verify?token=${token}`, r.location);
check("and opening it spends nothing", redis.peek(`magic:${token}`) === EMAIL && redis.ttl(`magic:${token}`) > 800,
      `ttl ${redis.ttl(`magic:${token}`)}s`);
check("and sets no session", !r.cookies.bl_session);

r = await signIn(token);
check("the page's POST signs in", r.status === 303 && r.location === "https://bustedlab.test/?auth=success", r.location);
check("with a session for the paying address", (await sessionEmail(r.cookies.bl_session)) === EMAIL);
check("after first use the link has two minutes left, not fifteen", redis.ttl(`magic:${token}`) <= 120,
      `ttl ${redis.ttl(`magic:${token}`)}s`);

// A filter that runs the page opens it moments before the person does.
env(); reset();
token = await paidCustomerRequestsLink();
await signIn(token);            // the filter
advance(20);
r = await signIn(token);        // the person, twenty seconds later
check("a filter that runs the page first does not lock the person out",
      r.location?.endsWith("/?auth=success") && (await sessionEmail(r.cookies.bl_session)) === EMAIL, r.location);

advance(80);
await signIn(token);            // a third use inside the window
advance(25);
r = await signIn(token);        // 125s after first use
check("repeated use does not extend the window", r.location?.endsWith("/?auth=expired") && !r.cookies.bl_session,
      r.location);

// ════════════════════════════════════════════════════════════════
section("WHAT STILL FAILS, AND SAYS SO");

env(); reset();
token = await paidCustomerRequestsLink();
advance(901);
r = await signIn(token);
check("an unused link dies after fifteen minutes", r.location?.endsWith("/?auth=expired") && !r.cookies.bl_session,
      r.location);

r = await signIn("not-a-token");
check("a malformed token is refused without touching Redis", r.location?.endsWith("/?auth=failed"), r.location);

r = await call(verify.POST, "/api/auth/verify", { method: "POST" });
check("a POST with no form is refused", r.location?.endsWith("/?auth=failed"), r.location);

r = await call(auth.GET, "/api/auth");
check("an old-shape link with no token is refused", r.location?.endsWith("/?auth=failed"), r.location);

env(); reset();
await call(auth.POST, "/api/auth", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "stranger@example.com" }),
});
check("an address that never paid is sent nothing", mail.sent.length === 0, `${mail.sent.length} email(s)`);

// ════════════════════════════════════════════════════════════════
section("THE BROWSER THAT PAID UNLOCKS ITSELF");

const LS_LINK = "https://bustedlab.lemonsqueezy.com/checkout/buy/9f1c-variant?checkout%5Bdiscount_code%5D=LAUNCH";
const startCheckout = (ip = "203.0.113.7") =>
  call(checkout.POST, "/api/checkout", { method: "POST", headers: { "x-forwarded-for": ip } });
const sessionCheck = (cookies) => call(auth.PATCH, "/api/auth", { method: "PATCH", cookies });
const pay = (opts) => {
  const d = lemonSqueezyDelivery(opts);
  return call(webhook.POST, "/api/webhook", { method: "POST", headers: d.headers, body: d.body });
};

env({ CHECKOUT_URL: LS_LINK }); reset();
r = await startCheckout();
const url = new URL(r.json.url);
const claim = url.searchParams.get("checkout[custom][claim]");
check("the buy click opens a claim and puts it in the checkout link", /^[0-9a-f]{48}$/.test(claim ?? ""), claim);
check("the configured link is otherwise untouched", url.searchParams.get("checkout[discount_code]") === "LAUNCH" &&
      url.pathname === "/checkout/buy/9f1c-variant");
check("the same claim is set on this browser, httpOnly", r.cookies.bl_claim === claim &&
      /httponly/i.test(r.headers.getSetCookie().find(c => c.startsWith("bl_claim=")) ?? ""));
check("and it lives for two hours", redis.peek(`claim:${claim}`) === "pending" && redis.ttl(`claim:${claim}`) === 7200);

r = await sessionCheck({ bl_claim: claim });
check("before the webhook, the page is told to keep asking", r.json.authenticated === false && r.json.claim === "pending");

r = await pay({ customData: { claim } });
check("the verified order grants access as always", r.status === 200 && (await redisLib.isPaidUser(EMAIL)));
check("and the access email still goes out", mail.sent.length === 1 && mail.sent[0].to === EMAIL);

r = await sessionCheck({ bl_claim: claim });
check("the next check signs the paying browser in", r.json.claimed === true && r.json.paid === true &&
      (await sessionEmail(r.cookies.bl_session)) === EMAIL);
check("and removes the claim cookie", r.cookies.bl_claim === "");

r = await sessionCheck({ bl_claim: claim });
check("a claim works once: replaying it signs in nobody", !r.cookies.bl_session && r.json.authenticated === false);

r = await sessionCheck({});
check("a browser without the claim gets nothing", !r.cookies.bl_session && r.json.authenticated === false);

// ── What a claim cannot do. ──
env({ CHECKOUT_URL: LS_LINK }); reset();
const forged = "ab".repeat(24);
r = await pay({ customData: { claim: forged }, orderId: "f1" });
r = await sessionCheck({ bl_claim: forged });
check("a claim this server never opened unlocks nothing", !r.cookies.bl_session && r.json.authenticated === false);

env({ CHECKOUT_URL: LS_LINK }); reset();
const c2 = new URL((await startCheckout()).json.url).searchParams.get("checkout[custom][claim]");
await pay({ customData: { claim: c2 }, orderId: "o1", email: "first@example.com" });
await pay({ customData: { claim: c2 }, orderId: "o2", email: "second@example.com" });
r = await sessionCheck({ bl_claim: c2 });
check("a claim cannot be re-pointed at a second order", (await sessionEmail(r.cookies.bl_session)) === "first@example.com");

env({ CHECKOUT_URL: LS_LINK, VERCEL_ENV: "production" }); reset();
const c3 = new URL((await startCheckout()).json.url).searchParams.get("checkout[custom][claim]");
await pay({ customData: { claim: c3 }, testMode: true });
r = await sessionCheck({ bl_claim: c3 });
check("a test-card order on production unlocks nothing", !r.cookies.bl_session && r.json.claim === "pending");

env({ CHECKOUT_URL: LS_LINK }); reset();
const c4 = new URL((await startCheckout()).json.url).searchParams.get("checkout[custom][claim]");
await pay({ customData: { claim: c4 } });
await pay({ event: "order_refunded", orderId: "4815162342" });
r = await sessionCheck({ bl_claim: c4 });
check("refunded before the browser asked: no session", !r.cookies.bl_session && r.json.authenticated === false);

env({ CHECKOUT_URL: LS_LINK }); reset();
const c5 = new URL((await startCheckout()).json.url).searchParams.get("checkout[custom][claim]");
advance(7201);
await pay({ customData: { claim: c5 } });
r = await sessionCheck({ bl_claim: c5 });
check("a claim older than two hours unlocks nothing", !r.cookies.bl_session && r.cookies.bl_claim === "");
check("but the purchase itself is still granted", await redisLib.isPaidUser(EMAIL));

env({ CHECKOUT_URL: LS_LINK }); reset();
mail.status = 403;
const c6 = new URL((await startCheckout()).json.url).searchParams.get("checkout[custom][claim]");
await pay({ customData: { claim: c6 } });
r = await sessionCheck({ bl_claim: c6 });
check("a refused access email does not stop the browser unlocking", r.json.claimed === true);

// ── Around it. ──
env({ CHECKOUT_URL: LS_LINK }); reset();
await redisLib.markAsPaid(EMAIL);
const existing = (await signIn(await (async () => {
  await call(auth.POST, "/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL }) });
  return tokenIn(mail.sent.at(-1)?.html);
})())).cookies.bl_session;
const c7 = new URL((await startCheckout()).json.url).searchParams.get("checkout[custom][claim]");
r = await sessionCheck({ bl_session: existing, bl_claim: c7 });
check("an already signed-in customer is answered from the session, claim untouched",
      r.json.paid === true && !r.json.claimed && redis.peek(`claim:${c7}`) === "pending");

env({ CHECKOUT_URL: "https://seller.gumroad.com/l/busted", GUMROAD_WEBHOOK_SECRET: "g" }); reset();
r = await startCheckout();
check("a Gumroad link gets no claim (it has no custom data to carry it)",
      r.json.url === "https://seller.gumroad.com/l/busted" && !r.cookies.bl_claim);

env({ CHECKOUT_URL: LS_LINK }); reset();
for (let i = 0; i < 20; i++) await startCheckout("198.51.100.9");
r = await startCheckout("198.51.100.9");
check("past 20 checkouts an hour from one visitor, checkout still opens, without a claim",
      r.status === 200 && !new URL(r.json.url).searchParams.has("checkout[custom][claim]") && !r.cookies.bl_claim);
r = await startCheckout("198.51.100.10");
check("while another visitor still gets one", !!r.cookies.bl_claim);
check("and the visitor's address is stored only as a hash",
      !redis.keys().some(k => k.includes("198.51.100")));

finish("access-path");
