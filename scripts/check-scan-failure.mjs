/**
 * A PROVIDER ERROR IS NOT A "NO MATCH".
 *
 * Runs the real scan route against the emulated Upstash in
 * scripts/lib/harness.mjs with the Claude API unreachable, and asserts what
 * the person and the dashboard see: "could not be completed, try again", not
 * "no match"; no free scan used; nothing cached; counted as scan_failed with
 * a reason; and said out loud in the log, without the key.
 *
 *   node --experimental-strip-types --no-warnings scripts/check-scan-failure.mjs
 */
import { importSrc, env, reset, call, redis, logs, check, section, finish } from "./lib/harness.mjs";

const route = await importSrc("app/api/scan/route.ts");
const { FREE_SCANS_PER_DAY } = await importSrc("lib/redis.ts");

const BROWSER = "ab".repeat(16);
const photo = () => {
  const form = new FormData();
  form.append("image", new Blob([Buffer.from("FAILURE-CHECK-PHOTO")], { type: "image/jpeg" }), "photo.jpg");
  form.append("intent", "verdict");
  return form;
};
const scan = () => call(route.POST, "/api/scan", {
  method: "POST", body: photo(), headers: { "x-forwarded-for": "203.0.113.20" }, cookies: { bl_bid: BROWSER },
});
const remaining = async () => (await call(route.GET, "/api/scan", {
  headers: { "x-forwarded-for": "203.0.113.20" }, cookies: { bl_bid: BROWSER },
})).json.remaining;

for (const [label, overrides] of [
  ["no API key configured", { ANTHROPIC_API_KEY: undefined }],
  ["the Claude API unreachable", { ANTHROPIC_API_KEY: "sk-ant-failure-check-key" }],
]) {
  section(`A SCAN WITH ${label.toUpperCase()}`);
  env(overrides); reset();
  const before = await remaining();
  const res = await scan();
  check("answers 502 scan_incomplete, not a no-match result", res.status === 502 && res.json?.error === "scan_incomplete",
    `${res.status} ${res.text.slice(0, 120)}`);
  check("with the failing layer as the reason", res.json?.reason === "extraction", String(res.json?.reason));
  check("and a message that says try again and that no scan was used",
    /could not be completed/.test(res.json?.message || "") && /did not use a free scan/.test(res.json?.message || "") && !/—/.test(res.json?.message || ""),
    res.json?.message);
  check("no free scan is used", (await remaining()) === before && before === FREE_SCANS_PER_DAY, `${before} -> ${await remaining()}`);
  check("nothing is cached", !redis.keys().some(k => k.includes("cache")), redis.keys().join(", "));
  check("counted as scan_failed, with its reason",
    redis.peek("stat:scan_failed:total") === "1" && redis.peek("stat:scan_failed:reason:extraction:total") === "1");
  check("and not as a completed scan or an unresolved result",
    !redis.peek("stat:scan_completed:total") && !redis.peek("stat:result_unresolved:total"));
  const cost = redis.peek(`stat:scancost:${new Date().toISOString().slice(0, 10)}`);
  check("its cost is still counted (a scan that reached the engine), not as 'Product not identified'",
    cost?.get("scans") === "1" && cost?.get("scans_plain") === "1" && !cost?.has("not_identified"), JSON.stringify([...(cost || new Map())]));
  const line = logs.errors.find(e => e.includes("layer=extraction"));
  check("said out loud: layer, provider, model and status in the log", !!line && /provider=anthropic/.test(line) && /model=claude-/.test(line) && /status=/.test(line), logs.errors.join(" | "));
  check("without the key", !logs.errors.some(e => e.includes("sk-ant-failure-check-key")));
}

section("THE FAILURE RECORD IS READABLE");
{
  const { readScanFailures } = await importSrc("lib/analytics.ts");
  const failures = await readScanFailures(7);
  const extraction = failures.byReason.find(r => r.reason === "extraction");
  check("by reason, in the window and in total", extraction?.windowTotal === 1 && extraction?.total === 1, JSON.stringify(extraction));
  check("and the latest failure names its layers", failures.recent[0]?.reason === "extraction" && failures.recent[0]?.layers?.[0]?.startsWith("extraction:anthropic"),
    JSON.stringify(failures.recent[0]));
}

section("REDIS UNREACHABLE: A FREE SCAN IS REFUSED, NOT RUN UNCAPPED");
{
  // An Upstash outage, or its free tier running out in a spike. Every other
  // limit fails open; the global daily cap must not, or free scans would run
  // without any cap on spend.
  env({ ANTHROPIC_API_KEY: "sk-ant-failure-check-key" }); reset();
  const callsBefore = logs.errors.filter(e => e.includes("provider=anthropic")).length;
  redis.down = true;
  const res = await scan();
  redis.down = false;
  check("answers 503 high_demand", res.status === 503 && res.json?.error === "high_demand", `${res.status} ${res.text.slice(0, 120)}`);
  check("no model call was attempted", logs.errors.filter(e => e.includes("provider=anthropic")).length === callsBefore,
    logs.errors.slice(-3).join(" | "));
  check("and it says why in the log", logs.errors.some(e => e.includes("global daily cap could not be read")), logs.errors.slice(-2).join(" | "));
}

finish("scan failure");
