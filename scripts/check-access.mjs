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
 */
import { importSrc, env, reset, advance, call, mail, redis, check, section, finish } from "./lib/harness.mjs";

const auth = await importSrc("app/api/auth/route.ts");
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

finish("access-path");
