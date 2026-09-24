/**
 * PRODUCT UPDATE LIST CHECK.
 *
 * Every address on this list will be mailed from the domain that delivers
 * access emails to paying customers, so the list has to hold only people
 * who asked to be on it, and anyone on it has to be able to leave - and
 * nobody else may take them off. Runs the real routes against the emulated
 * outside world in scripts/lib/harness.mjs:
 *
 *   node --experimental-strip-types --no-warnings scripts/check-notify.mjs
 */
import { importSrc, env, reset, advance, call, redis, logs, check, section, finish } from "./lib/harness.mjs";

const notify = await importSrc("app/api/notify/route.ts");
const unsubscribe = await importSrc("app/api/notify/unsubscribe/route.ts");
const links = await importSrc("lib/unsubscribe.ts");

const signUp = (email, ip = "203.0.113.7", consent = true) =>
  call(notify.POST, "/api/notify", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, source: "paywall", consent }),
  });
const onList = (email) => redis.peek(`notify:${email}`) !== undefined;
const leave = (email, token, oneClick = false) =>
  call(unsubscribe.POST, `/api/notify/unsubscribe?${new URLSearchParams({ email, token })}`, {
    method: "POST",
    ...(oneClick
      ? { headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }
      : { form: {} }),
  });

// ════════════════════════════════════════════════════════════════
section("ONLY PEOPLE WHO ASKED GET ON THE LIST");

env(); reset();
let r = await signUp("reader@example.com");
check("a consented sign-up is stored", r.json?.saved === true && onList("reader@example.com"));

r = await signUp("noconsent@example.com", "203.0.113.8", false);
check("without consent nothing is stored", r.status === 400 && !onList("noconsent@example.com"));

env(); reset();
for (let i = 1; i <= 5; i++) await signUp(`person${i}@example.com`, "198.51.100.1");
check("one visitor can add five addresses an hour", [1, 2, 3, 4, 5].every(i => onList(`person${i}@example.com`)));
r = await signUp("person6@example.com", "198.51.100.1");
check("the sixth is answered as saved but not stored", r.json?.saved === true && !onList("person6@example.com"));
r = await signUp("neighbour@example.com", "198.51.100.2");
check("another visitor is unaffected", onList("neighbour@example.com"));
advance(3601);
await signUp("person7@example.com", "198.51.100.1");
check("the first visitor can add more an hour later", onList("person7@example.com"));
check("visitor addresses are stored only as hashes", !redis.keys().some(k => k.includes("198.51.100")));

env({ NOTIFY_PER_IP_PER_HOUR: "1" }); reset();
await signUp("a@example.com", "192.0.2.1");
await signUp("b@example.com", "192.0.2.1");
check("the limit is configurable", onList("a@example.com") && !onList("b@example.com"));

env({ NOTIFY_PER_IP_PER_HOUR: "five" }); reset();
await signUp("c@example.com", "192.0.2.2");
check("a malformed limit falls back to the default instead of refusing everyone", onList("c@example.com"));

// ════════════════════════════════════════════════════════════════
section("ANYONE ON IT CAN LEAVE, AND NOBODY ELSE CAN REMOVE THEM");

check("the open DELETE that removed any address is gone", notify.DELETE === undefined);
check("a GET on the unsubscribe endpoint does nothing", unsubscribe.GET === undefined);

env(); reset();
await signUp("reader@example.com");
const token = links.unsubscribeToken("reader@example.com");
r = await leave("reader@example.com", "0".repeat(32));
check("a guessed token removes nothing", r.location?.includes("invalid=1") && onList("reader@example.com"), r.location);
r = await leave("reader@example.com", links.unsubscribeToken("other@example.com"));
check("another address's token removes nothing", onList("reader@example.com"));

r = await leave("reader@example.com", token);
check("the address's own link removes it, from the confirmation page",
      r.status === 303 && r.location?.includes("done=1") && !onList("reader@example.com"), r.location);
check("and takes it out of the index too", redis.peek("notify:index")?.has?.("reader@example.com") === false);

env(); reset();
await signUp("reader@example.com");
r = await leave("reader@example.com", token, true);
check("RFC 8058 one-click unsubscribe works with no page visit", r.status === 200 && !onList("reader@example.com"));
r = await leave("reader@example.com", "0".repeat(32), true);
check("and refuses a bad token with 403", r.status === 403);

env(); reset();
await signUp("reader@example.com");
redis.down = true;
r = await leave("reader@example.com", token);
redis.down = false;
check("if the removal fails, the person is told to try again, not that it worked",
      r.location?.includes("failed=1") && r.location.includes("token=") && onList("reader@example.com"), r.location);
check("and it is logged", logs.errors.some(e => e.includes("Unsubscribe failed")));

// ════════════════════════════════════════════════════════════════
section("THE LINKS");

env();
check("the token ignores the address's case", links.unsubscribeToken("Reader@Example.com ") === token);
const url = links.unsubscribeUrl("reader@example.com");
check("the email-body link opens the confirmation page",
      url === `https://bustedlab.test/unsubscribe?email=reader%40example.com&token=${token}`, url);
const headers = links.oneClickUnsubscribeHeaders("reader@example.com");
check("the one-click headers point at the endpoint",
      headers?.["List-Unsubscribe"] === `<https://bustedlab.test/api/notify/unsubscribe?email=reader%40example.com&token=${token}>` &&
      headers?.["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click");

env({ UNSUBSCRIBE_SECRET: "list-secret" });
const dedicated = links.unsubscribeToken("reader@example.com");
env({ UNSUBSCRIBE_SECRET: "list-secret", IDENTITY_SALT: "rotated" });
check("with UNSUBSCRIBE_SECRET set, rotating IDENTITY_SALT does not break sent links",
      dedicated !== token && links.unsubscribeToken("reader@example.com") === dedicated);

env({ IDENTITY_SALT: undefined }); reset();
await signUp("reader@example.com");
r = await leave("reader@example.com", token, true);
check("with no secret configured, nothing is accepted", links.unsubscribeToken("reader@example.com") === null &&
      r.status === 403 && onList("reader@example.com"));

finish("update-list");
