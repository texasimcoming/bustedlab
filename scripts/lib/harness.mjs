/**
 * THE OUTSIDE WORLD, IN MEMORY.
 *
 * Shared by the checks that run real route handlers outside Next: an Upstash
 * that honours expiry times against a clock the check can move, a Resend that
 * records what it was asked to send, console.error captured so a check can
 * assert that a failure was said out loud, and a resolver that lets Node
 * import app code as the app does ("@/lib/redis", "next/server").
 *
 * Nothing here reaches the network. Any fetch the checks did not anticipate
 * throws, so a new outbound call cannot slip through untested.
 */
import crypto from "node:crypto";
import { registerHooks } from "node:module";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const NEXT_SERVER = pathToFileURL(join(REPO, "node_modules/next/server.js")).href;

// ── Import app code the way the app does. ──
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return { url: NEXT_SERVER, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const base = join(REPO, "src", specifier.slice(2));
      for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
        if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

/** Imports a file under src/, e.g. importSrc("app/api/webhook/route.ts"). */
export const importSrc = (path) => import(pathToFileURL(join(REPO, "src", path)).href);

/** Imports TypeScript source held in a string, such as a frozen fixture. */
export async function importSource(source, label) {
  const dir = mkdtempSync(join(tmpdir(), "bustedlab-check-"));
  const file = join(dir, `${label}.ts`);
  writeFileSync(file, source, "utf8");
  return import(pathToFileURL(file).href);
}

// ── Upstash, with expiry. ──
const store = new Map(); // key -> { value, expiresAt }
let clockOffsetMs = 0;
const now = () => Date.now() + clockOffsetMs;

/** Moves the emulated Redis clock forward, so keys expire as they would. */
export function advance(seconds) {
  clockOffsetMs += seconds * 1000;
}

function live(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt !== null && entry.expiresAt <= now()) {
    store.delete(key);
    return undefined;
  }
  return entry;
}

function runRedisCommand(args) {
  const [rawCmd, key, ...rest] = args;
  const cmd = String(rawCmd).toUpperCase();
  switch (cmd) {
    case "GET": return live(key)?.value ?? null;
    case "GETDEL": {
      const entry = live(key);
      store.delete(key);
      return entry?.value ?? null;
    }
    case "SET": {
      const [value, ...opts] = rest;
      const flags = opts.map(o => String(o).toUpperCase());
      const existing = live(key);
      if (flags.includes("NX") && existing) return null;
      if (flags.includes("XX") && !existing) return null;
      let expiresAt = null;
      const ex = flags.indexOf("EX");
      const px = flags.indexOf("PX");
      if (ex >= 0) expiresAt = now() + Number(opts[ex + 1]) * 1000;
      else if (px >= 0) expiresAt = now() + Number(opts[px + 1]);
      else if (flags.includes("KEEPTTL") && existing) expiresAt = existing.expiresAt;
      store.set(key, { value: String(value), expiresAt });
      return "OK";
    }
    case "DEL": return [key, ...rest].reduce((n, k) => n + (live(k) && store.delete(k) ? 1 : 0), 0);
    case "EXISTS": return live(key) ? 1 : 0;
    case "INCR": {
      const entry = live(key);
      const next = (Number(entry?.value) || 0) + 1;
      store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
      return next;
    }
    case "TTL": {
      const entry = live(key);
      if (!entry) return -2;
      if (entry.expiresAt === null) return -1;
      return Math.ceil((entry.expiresAt - now()) / 1000);
    }
    case "EXPIRE": {
      const entry = live(key);
      if (!entry) return 0;
      entry.expiresAt = now() + Number(rest[0]) * 1000;
      return 1;
    }
    case "EXPIREAT": {
      const entry = live(key);
      if (!entry) return 0;
      entry.expiresAt = Number(rest[0]) * 1000;
      return 1;
    }
    case "MGET": return [key, ...rest].map(k => live(k)?.value ?? null);
    case "HINCRBY": {
      const entry = live(key) ?? { value: new Map(), expiresAt: null };
      const next = (Number(entry.value.get(String(rest[0]))) || 0) + Number(rest[1]);
      entry.value.set(String(rest[0]), String(next));
      store.set(key, entry);
      return next;
    }
    case "HEXISTS": return live(key)?.value.has(String(rest[0])) ? 1 : 0;
    case "HLEN": return live(key)?.value.size ?? 0;
    case "HGETALL": {
      const entry = live(key);
      return entry ? [...entry.value.entries()].flat() : [];
    }
    case "ZADD": {
      // Scores and members only; the checks never pass ZADD flags.
      const entry = live(key) ?? { value: new Map(), expiresAt: null };
      for (let i = 0; i + 1 < rest.length; i += 2) entry.value.set(String(rest[i + 1]), Number(rest[i]));
      store.set(key, entry);
      return 1;
    }
    case "ZREM": {
      const entry = live(key);
      if (!entry) return 0;
      return rest.reduce((n, m) => n + (entry.value.delete(String(m)) ? 1 : 0), 0);
    }
    case "ZSCORE": {
      const score = live(key)?.value.get(String(rest[0]));
      return score === undefined ? null : String(score);
    }
    default:
      throw new Error(`emulated Upstash: unsupported command ${cmd}`);
  }
}

export const redis = {
  /** While true, every Upstash request fails as an outage would. */
  down: false,
  /** The raw value under a key, or undefined. Expiry is honoured. */
  peek: (key) => live(key)?.value,
  ttl: (key) => runRedisCommand(["TTL", key]),
  keys: () => [...store.keys()].filter(k => live(k)),
};

// ── Resend. ──
export const mail = { sent: [], status: 200 };

// ── The network. ──
const encode = (v) =>
  typeof v === "string" ? Buffer.from(v, "utf8").toString("base64")
  : Array.isArray(v) ? v.map(encode)
  : v;

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : String(input?.url || input);
  if (url.startsWith("https://redis.test")) {
    if (redis.down) {
      return new Response(JSON.stringify({ error: "emulated outage" }), { status: 500, headers: { "content-type": "application/json" } });
    }
    const body = init.body ? JSON.parse(init.body) : [];
    const pipeline = Array.isArray(body[0]);
    const result = pipeline
      ? body.map(a => ({ result: encode(runRedisCommand(a)) }))
      : { result: encode(runRedisCommand(body)) };
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url === "https://api.resend.com/emails") {
    const message = JSON.parse(init.body);
    mail.sent.push({ ...message, to: Array.isArray(message.to) ? message.to[0] : message.to });
    const ok = mail.status === 200;
    return new Response(JSON.stringify(ok ? { id: `email_${mail.sent.length}` } : { name: "validation_error", message: "domain not verified" }), {
      status: mail.status,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error(`unmocked fetch: ${url}`);
};

// ── console.error, where every silent-failure fix reports. ──
export const logs = { errors: [] };
const realError = console.error;
console.error = (...args) => { logs.errors.push(args.map(String).join(" ")); };
const report = (line) => realError.call(console, line);

// ── Environment. ──
export const BASE_ENV = {
  UPSTASH_REDIS_REST_URL: "https://redis.test",
  UPSTASH_REDIS_REST_TOKEN: "test",
  IDENTITY_SALT: "check-salt",
  RESEND_API_KEY: "re_test",
  NEXT_PUBLIC_BASE_URL: "https://bustedlab.test",
  LEMONSQUEEZY_WEBHOOK_SECRET: "ls_signing_secret",
};
const touched = new Set(Object.keys(BASE_ENV));

/** Resets the environment to BASE_ENV plus overrides; undefined unsets. */
export function env(overrides = {}) {
  for (const k of Object.keys(overrides)) touched.add(k);
  for (const k of touched) delete process.env[k];
  Object.assign(process.env, BASE_ENV);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** Empties Redis, the outbox and the captured log, and resets the clock. */
export function reset() {
  store.clear();
  redis.down = false;
  clockOffsetMs = 0;
  mail.sent.length = 0;
  mail.status = 200;
  logs.errors.length = 0;
}

// ── Requests. ──
const { NextRequest } = await import(NEXT_SERVER);

/**
 * Calls a route handler. Returns the status, the redirect target, the
 * cookies it set (name -> value, "" for a deletion) and the parsed body.
 */
export async function call(handler, path, { method = "GET", headers = {}, body, cookies = {}, form } = {}) {
  const h = new Headers(headers);
  const jar = Object.entries(cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("; ");
  if (jar) h.set("cookie", jar);
  let payload = body;
  if (form) {
    payload = new URLSearchParams(form).toString();
    h.set("content-type", "application/x-www-form-urlencoded");
  }
  const req = new NextRequest(`https://bustedlab.test${path}`, { method, headers: h, body: payload });
  const res = await handler(req);
  const setCookies = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    const expired = /max-age=0|expires=thu, 01 jan 1970/i.test(line);
    setCookies[pair.slice(0, eq)] = expired ? "" : decodeURIComponent(pair.slice(eq + 1));
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return {
    status: res.status,
    location: res.headers.get("location"),
    cookies: setCookies,
    headers: res.headers,
    json,
    text,
  };
}

// ── Lemon Squeezy. ──

/**
 * A genuine-looking Lemon Squeezy webhook delivery, signed the way Lemon
 * Squeezy signs: HMAC-SHA256 of the raw body, hex, in X-Signature.
 */
export function lemonSqueezyDelivery({
  event = "order_created", email = "buyer@example.com", orderId = "4815162342", status = "paid",
  testMode = false, secret = BASE_ENV.LEMONSQUEEZY_WEBHOOK_SECRET, customData, attributes = {},
} = {}) {
  const body = JSON.stringify({
    meta: { event_name: event, test_mode: testMode, ...(customData ? { custom_data: customData } : {}) },
    data: { type: "orders", id: orderId, attributes: { user_email: email, status, total: 499, currency: "USD", ...attributes } },
  });
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return { body, headers: { "content-type": "application/json", "x-signature": signature, "x-event-name": event } };
}

// ── Reporting. ──
let failures = 0;
export function check(label, condition, detail = "") {
  if (!condition) failures++;
  report(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? `   ${detail}` : ""}`);
}
export function section(title) {
  report(`\n${title}\n${"-".repeat(78)}`);
}
/** Prints the verdict and exits non-zero on any failure. */
export function finish(name) {
  console.error = realError;
  console.log("");
  if (failures > 0) {
    console.error(`${failures} ${name} case(s) failed.`);
    process.exit(1);
  }
  console.log(`All ${name} cases pass.`);
}
