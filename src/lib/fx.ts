import { Redis } from "@upstash/redis";

/**
 * CURRENCY.
 *
 * The listings the engine compares against come from the US index and are in
 * US dollars. The asking price comes from the screenshot or the seller's page,
 * and is in whatever currency that seller charges. Until this module existed
 * the two were compared as raw numbers: a 299 dirham asking price against a
 * $30 listing read as a $299 asking price and a 897% markup, when at about
 * ten dirham to the dollar it is roughly the same price. Every non-dollar
 * scan was wrong, and the dirham, the krona and the yen were wrong by an
 * order of magnitude or more.
 *
 * Now every amount is converted to USD before anything is compared, using a
 * daily rate table that is fetched at most once a day, kept in Redis for
 * every instance to share, and kept for a week as a fallback if the source is
 * unreachable. When no rate can be had at all, a non-dollar asking price is
 * treated as unknown: the scan still finds the cheapest listing, it just does
 * not print a markup it cannot compute.
 *
 * Source: the open exchange-api dataset (CC0, daily, no key), served from
 * jsDelivr with a Cloudflare Pages mirror. Rates are units of the currency per
 * one US dollar.
 */

const SOURCES = [
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
  "https://latest.currency-api.pages.dev/v1/currencies/usd.json",
];
const DAY_TTL_SECONDS = 36 * 3600;
const LAST_TTL_SECONDS = 8 * 86400;
/** A table older than this is not used, even as a fallback. */
const MAX_STALE_DAYS = 7;

export interface RateTable {
  /** The day the rates are for, YYYY-MM-DD, as the source states it. */
  date: string;
  /** Units of currency per 1 USD, keyed by lowercase ISO 4217 code. */
  rates: Record<string, number>;
}

export interface Conversion {
  usd: number;
  /** Units of the source currency per 1 USD. */
  rate: number;
  asOf: string;
}

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL || "https://placeholder.upstash.io",
      token: process.env.UPSTASH_REDIS_REST_TOKEN || "placeholder",
    });
  }
  return _redis;
}

const today = () => new Date().toISOString().slice(0, 10);
const dayKey = (day: string) => `fx:usd:${day}`;
const LAST_KEY = "fx:usd:last";

let memo: { table: RateTable; day: string } | null = null;

/**
 * Validates a source payload. A corrupt or truncated feed is worse than none,
 * so the majors have to be present and plausible before any of it is used.
 */
export function readRateTable(payload: unknown): RateTable | null {
  const body = payload as { date?: unknown; usd?: unknown } | null;
  if (!body || typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return null;
  const raw = body.usd as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(raw)) {
    if (/^[a-z]{3}$/.test(code) && typeof value === "number" && Number.isFinite(value) && value > 0) rates[code] = value;
  }
  rates.usd = 1;
  const sane = (code: string, lo: number, hi: number) => rates[code] >= lo && rates[code] <= hi;
  if (!sane("eur", 0.5, 1.5) || !sane("gbp", 0.4, 1.2)) return null;
  return { date: body.date, rates };
}

function parseStored(value: unknown): RateTable | null {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return readRateTable({ date: (parsed as RateTable).date, usd: (parsed as RateTable).rates });
  } catch {
    return null;
  }
}

function freshEnough(table: RateTable): boolean {
  const age = (Date.parse(today()) - Date.parse(table.date)) / 86400000;
  return age <= MAX_STALE_DAYS;
}

async function fetchFromSources(): Promise<{ table: RateTable | null; problems: string[] }> {
  const problems: string[] = [];
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) { problems.push(`${new URL(url).host} ${res.status}`); continue; }
      const table = readRateTable(await res.json());
      if (table) return { table, problems };
      problems.push(`${new URL(url).host} returned an unusable table`);
    } catch (err) {
      problems.push(`${new URL(url).host} ${(err as Error)?.name || "error"}`);
    }
  }
  return { table: null, problems };
}

/**
 * Today's table: from this instance, else from Redis, else from the source
 * (then shared through Redis), else the last good table if it is under a week
 * old. Null only when all of that fails.
 */
export async function usdRates(): Promise<RateTable | null> {
  const day = today();
  if (memo && memo.day === day) return memo.table;

  let cached: RateTable | null = null;
  try {
    cached = parseStored(await getRedis().get(dayKey(day)));
  } catch { /* a Redis outage falls through to the source */ }
  if (cached) {
    memo = { table: cached, day };
    return cached;
  }

  const { table, problems } = await fetchFromSources();
  if (table) {
    memo = { table, day };
    const stored = JSON.stringify(table);
    try {
      await getRedis().set(dayKey(day), stored, { ex: DAY_TTL_SECONDS });
      await getRedis().set(LAST_KEY, stored, { ex: LAST_TTL_SECONDS });
    } catch { /* the next instance fetches it again; that is all */ }
    return table;
  }

  console.error(`[fx] rate sources unavailable: ${problems.join("; ")}`);
  try {
    const last = parseStored(await getRedis().get(LAST_KEY));
    if (last && freshEnough(last)) {
      memo = { table: last, day };
      return last;
    }
  } catch { /* nothing more to try */ }
  return null;
}

/** Test seam. */
export function resetRatesMemo(): void {
  memo = null;
}

// Order matters: every prefixed dollar sign has to be tried before the bare
// one, and "US$" before "S$".
const SYMBOLS: [RegExp, string][] = [
  [/US\$/, "USD"],
  [/R\$/, "BRL"],
  [/CA\$|C\$/, "CAD"],
  [/AU\$|A\$/, "AUD"],
  [/NZ\$/, "NZD"],
  [/HK\$/, "HKD"],
  [/MX\$/, "MXN"],
  [/S\$/, "SGD"],
  [/\$/, "USD"],
  [/€/, "EUR"],
  [/£/, "GBP"],
  [/¥/, "JPY"],
  [/₹/, "INR"],
  [/₩/, "KRW"],
  [/₺/, "TRY"],
  [/₱/, "PHP"],
  [/₦/, "NGN"],
  [/د\.?\s?م\.?|درهم|\bDHS?\b|\bdirhams?\b/i, "MAD"],
];

/**
 * An ISO 4217 code from whatever a model or a page wrote: "eur", "EUR", "€",
 * "DH". Empty when it cannot be told. A bare "$" reads as USD, which is what
 * a US-index listing means by it.
 */
export function normalizeCurrency(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (/^[A-Za-z]{3}$/.test(text)) return text.toUpperCase();
  const iso = text.match(/\b([A-Z]{3})\b/);
  if (iso) return iso[1];
  for (const [pattern, code] of SYMBOLS) if (pattern.test(text)) return code;
  return "";
}

/**
 * A price string as a listing shows it: "$1,299.00", "€25,99", "1.299,00 €",
 * "MAD 299", "299 DH". The decimal separator is the last of "," or "." when
 * both appear, and a lone comma followed by exactly two digits; anything else
 * is a thousands separator. The old parser stripped every non-digit except
 * ".", which read "€25,99" as 2,599.
 */
export function parsePrice(raw: unknown): { amount: number; currency: string } {
  const text = String(raw ?? "").trim();
  const currency = normalizeCurrency(text.replace(/[\d.,\s]+/g, " ").trim()) || "";
  const digits = (text.match(/[\d.,]+/) || [""])[0];
  if (!digits) return { amount: 0, currency };
  const lastComma = digits.lastIndexOf(",");
  const lastDot = digits.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot
      ? digits.replace(/\./g, "").replace(",", ".")
      : digits.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = /,\d{2}$/.test(digits) && (digits.match(/,/g) || []).length === 1
      ? digits.replace(",", ".")
      : digits.replace(/,/g, "");
  } else {
    // Several dots: grouping, as in 1.299.000.
    normalized = (digits.match(/\./g) || []).length > 1 ? digits.replace(/\./g, "") : digits;
  }
  const amount = parseFloat(normalized);
  return { amount: Number.isFinite(amount) ? amount : 0, currency };
}

/**
 * An amount in USD. USD and an empty currency pass through unchanged (a price
 * with no stated currency from a US-index listing is a dollar price). Null
 * when the currency has no rate today.
 */
export async function toUsd(amount: number, currency: string): Promise<Conversion | null> {
  const code = normalizeCurrency(currency) || "USD";
  if (code === "USD") return { usd: amount, rate: 1, asOf: today() };
  const table = await usdRates();
  const rate = table?.rates[code.toLowerCase()];
  if (!table || !rate) return null;
  return { usd: Math.round((amount / rate) * 100) / 100, rate, asOf: table.date };
}
