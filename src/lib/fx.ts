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

// What may group thousands in a written price besides "." and ",": a normal
// space, a no-break space, a narrow no-break space, a thin space, and the
// Swiss apostrophe ("1'299.00").
const GAP = "[ \\u00A0\\u202F\\u2009'\\u2019]";
const GAPS = new RegExp(GAP, "g");
// One written number: digit runs joined by "." or ",", or by a gap that is
// followed by exactly three digits (a gap before anything else ends the
// number, so "10 20" is not 1020).
const NUMBER = new RegExp(`\\d+(?:(?:[.,]|${GAP}(?=\\d{3}(?!\\d)))\\d+)*`);
// Currencies with three decimals, where "12.500" is twelve and a half.
const THREE_DECIMALS = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

/**
 * A price as a listing, a page or a model wrote it: "$1,299.00", "€55,00",
 * "1.299,00 €", "1 299,00 €", "CHF 1'299.00", "MAD 299", or a number. The
 * amount is null when it cannot be read, and that includes every format
 * that could honestly mean two things: a missing price only costs a
 * verdict, a wrong one accuses a seller. The old readers stripped every
 * character but digits and ".", so a European "55,00" became 5,500.
 *
 * The rules, in order:
 *   - a gap (space or apostrophe) only ever groups thousands;
 *   - with both "." and ",", the last one is the decimal point and the other
 *     groups thousands;
 *   - a lone "." or "," before exactly three digits groups thousands
 *     ("1.299", "1,299"), except after a leading 0 ("0,299") or after a gap,
 *     and in a three-decimal currency, where it is unreadable; before any
 *     other number of digits it is the decimal point ("55,5", "55.0000");
 *   - several of the same separator must group thousands properly
 *     ("12.345.678"; "1,29,999" in Indian grouping), or nothing is read.
 *
 * `currencyHint` is the currency a page states in its own fields, used only
 * to tell a three-decimal currency apart; the currency returned is the one
 * written in `raw` itself, or "" when none is.
 */
export function parsePrice(raw: unknown, currencyHint?: unknown): { amount: number | null; currency: string } {
  if (typeof raw === "number") return { amount: Number.isFinite(raw) && raw >= 0 ? raw : null, currency: "" };
  const text = String(raw ?? "").trim();
  const currency = normalizeCurrency(text.replace(/[\d.,\s'\u2019]+/g, " ").trim()) || "";
  const found = NUMBER.exec(text);
  if (!found) return { amount: null, currency };
  // "$.99" or ",50": a number that starts with its separator starts at 0, so
  // it is 0.99, never 99. "Rs.1,299" is a currency's abbreviation, not that.
  const lead = /(?:^|[^\p{L}\d])([.,])$/u.exec(text.slice(0, found.index))?.[1] ?? "";
  const threeDecimals = THREE_DECIMALS.has(normalizeCurrency(currencyHint) || currency);
  return { amount: readAmount(lead ? `0${lead}${found[0]}` : found[0], threeDecimals), currency };
}

function readAmount(token: string, threeDecimals: boolean): number | null {
  const t = token.replace(GAPS, "_");
  const gapped = t.includes("_");
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  let point = "";
  if (lastComma >= 0 && lastDot >= 0) {
    point = lastComma > lastDot ? "," : ".";
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = t.split(sep);
    if (parts.length === 2) {
      const [head, tail] = parts;
      const grouping = !gapped && tail.length === 3 && head.length <= 3 && !/^0+$/.test(head);
      if (!grouping) point = sep;
      else if (threeDecimals) return null;
    }
  }
  const at = point ? t.lastIndexOf(point) : -1;
  const whole = at >= 0 ? t.slice(0, at) : t;
  const fraction = at >= 0 ? t.slice(at + 1) : "";
  if (at >= 0 && !/^\d+$/.test(fraction)) return null;
  const groups = whole.split(/[.,_]/);
  if (groups.length > 1) {
    const seps = new Set(whole.match(/[.,_]/g));
    if (seps.size > 1 || !groupsThousands(groups, [...seps][0])) return null;
  }
  const value = Number(`${groups.join("")}${fraction ? `.${fraction}` : ""}`);
  return Number.isFinite(value) ? value : null;
}

/** Whether digit groups split by one separator group thousands: 1,299,000, or Indian 1,29,999. */
function groupsThousands(groups: string[], sep: string): boolean {
  const [first, ...rest] = groups;
  if (/^[1-9]\d{0,2}$/.test(first) && rest.every(g => g.length === 3)) return true;
  if (sep !== ",") return false;
  const last = rest[rest.length - 1];
  return /^[1-9]\d?$/.test(first) && last.length === 3 && rest.slice(0, -1).every(g => g.length === 2);
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
