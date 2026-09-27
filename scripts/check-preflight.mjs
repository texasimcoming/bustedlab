/**
 * LAUNCH PREFLIGHT CHECK. GET /api/preflight is what says a deployment is
 * safe to send traffic to, so it has to be right in both directions: ready
 * when everything is configured, and naming each thing that would lose money
 * or customers when it is not - without ever echoing a secret.
 *
 *   node --experimental-strip-types --no-warnings scripts/check-preflight.mjs
 */
import { importSrc, env, reset, call, mail, redis, check, section, finish } from "./lib/harness.mjs";

const preflight = await importSrc("app/api/preflight/route.ts");
const LS_LINK = "https://bustedlab.lemonsqueezy.com/checkout/buy/9f1c-variant";
const READY = {
  ANALYTICS_TOKEN: "op-token", CHECKOUT_URL: LS_LINK, ANTHROPIC_API_KEY: "sk-ant-x", SERPER_API_KEY: "serper-x",
  BLOB_READ_WRITE_TOKEN: "blob-x", CRON_SECRET: "cron-x", UNSUBSCRIBE_SECRET: "unsub-x", VERCEL_ENV: "production",
};
const run = (origin) => call(preflight.GET, "/api/preflight", { headers: { authorization: "Bearer op-token" }, origin })
  .then(r => r.json);
const blocker = (res, name) => res.blockers.find(b => b.check === name);
const warning = (res, name) => res.warnings.find(w => w.check === name);

section("A FULLY CONFIGURED DEPLOYMENT");
env(READY); reset();
let res = await run();
check("reports ready", res.ready === true && res.blockers.length === 0, JSON.stringify(res.blockers));
check("with nothing to warn about", res.warnings.length === 0, JSON.stringify(res.warnings));
check("names what it verified", ["redis", "base url", "model key", "search key", "identity salt"].every(k => res.ok.includes(k)) &&
      res.ok.some(k => k.startsWith("checkout (lemonsqueezy, overlay")) && res.ok.includes("email (bustedlab.com verified)"), res.ok.join(", "));
check("and the spending limits in force", res.limits.dailyModelBudgetUsd > 0 && res.limits.paidScansPerAccountPerDay === 500);
check("never echoes a secret", !JSON.stringify(res).match(/sk-ant-x|serper-x|blob-x|cron-x|unsub-x|op-token|ls_signing_secret|re_test/));

section("EACH THING THAT WOULD LOSE MONEY OR CUSTOMERS IS A BLOCKER");
env(READY); reset();
redis.down = true;
res = await run();
check("Redis unreachable", !res.ready && !!blocker(res, "redis"));
env({ ...READY, LEMONSQUEEZY_WEBHOOK_SECRET: undefined }); reset();
res = await run();
check("checkout offline, with the reason", !res.ready && /LEMONSQUEEZY_WEBHOOK_SECRET/.test(blocker(res, "checkout")?.detail || ""));
env({ ...READY, NEXT_PUBLIC_BASE_URL: undefined }); reset();
res = await run();
check("no base URL (no access email would be sent)", !res.ready && !!blocker(res, "base url"));
env({ ...READY, RESEND_API_KEY: undefined }); reset();
res = await run();
check("no Resend key", !res.ready && !!blocker(res, "email"));
env(READY); reset();
mail.domains = [{ name: "bustedlab.com", status: "pending" }];
res = await run();
check("sending domain not verified yet", !res.ready && /"pending"/.test(blocker(res, "email")?.detail || ""));
env(READY); reset();
mail.domains = [{ name: "otherdomain.com", status: "verified" }];
res = await run();
check("sending domain not in the Resend account", !res.ready && /not a domain in this Resend account/.test(blocker(res, "email")?.detail || ""));
env({ ...READY, EMAIL_FROM: "BustedLab <hello@otherdomain.com>" }); reset();
mail.domains = [{ name: "otherdomain.com", status: "verified" }];
res = await run();
check("EMAIL_FROM on a verified domain fixes it", res.ready && res.ok.includes("email (otherdomain.com verified)"));
env({ ...READY, ANTHROPIC_API_KEY: undefined, SERPER_API_KEY: undefined }); reset();
res = await run();
check("scanner keys missing", !!blocker(res, "model key") && !!blocker(res, "search key"));
env({ ...READY, IDENTITY_SALT: undefined }); reset();
res = await run();
check("no identity salt", !!blocker(res, "identity salt"));

section("WORTH FIXING, BUT NOT BLOCKING");
env(READY); reset();
mail.domainsStatus = 401;
res = await run();
check("a send-only Resend key says to confirm by hand", res.ready && /send-only/.test(warning(res, "email")?.detail || ""));
env({ ...READY, LEMONSQUEEZY_ACCEPT_TEST_ORDERS: "true" }); reset();
res = await run();
check("test orders left on in production", !!warning(res, "test orders"));
env({ ...READY, GUMROAD_PRODUCT_PERMALINK: "busted" }); reset();
res = await run();
check("a Gumroad setting that does nothing on Lemon Squeezy", !!warning(res, "gumroad settings"));
env({ ...READY, CSP_REPORT_ONLY: "true" }); reset();
res = await run();
check("the CSP break-glass switch left on", !!warning(res, "csp"));
env({ ...READY, UNSUBSCRIBE_SECRET: undefined, CRON_SECRET: undefined, BLOB_READ_WRITE_TOKEN: undefined }); reset();
res = await run();
check("unsubscribe secret, cron secret and blob token", res.ready && !!warning(res, "unsubscribe") && !!warning(res, "cron") && !!warning(res, "blob"));
env(READY); reset();
res = await run("https://bustedlab-git-main.vercel.app");
check("base URL pointing at a different host than production serves", !!warning(res, "base url"));

section("OPERATORS ONLY");
env(READY); reset();
let r = await call(preflight.GET, "/api/preflight");
check("no token, no answer", r.status === 401);
env({ ...READY, ANALYTICS_TOKEN: undefined }); reset();
r = await call(preflight.GET, "/api/preflight", { headers: { authorization: "Bearer op-token" } });
check("no ANALYTICS_TOKEN configured, no way in", r.status === 401);

finish("launch-preflight");
