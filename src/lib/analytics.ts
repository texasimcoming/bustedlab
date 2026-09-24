import { Redis } from "@upstash/redis";

/**
 * FIRST-PARTY ANALYTICS.
 *
 * Six events, counted in Redis, and nothing else. No PostHog, no Plausible, no
 * Google, no script tag, no cookie, no identifier of any kind. That is not
 * squeamishness: the privacy policy states that no third-party scripts run on
 * this site, and the moment a tag manager lands on the page that sentence
 * becomes false. This product's entire argument is that it tells you the truth
 * about what things cost. It cannot be running a surveillance stack behind the
 * page that says so.
 *
 * What is stored is a number per event per day. There is no session, no user,
 * no path, no referrer, no device, no country. A row here cannot be traced to
 * a person because it does not describe one: it says "on this date, this many
 * scans finished". That is enough to run the machine and it is the most that
 * can be collected without becoming the thing this product exists to expose.
 *
 * AUTHORITATIVE vs BEST-EFFORT. Three of these are counted on the server at
 * the moment the thing happens and cannot be forged from outside:
 * scan_completed, the three verdict counters, and email_captured. The other
 * three are browser interactions and reach the server through a public beacon,
 * so they are rate limited but ultimately best-effort. The read endpoint
 * labels which is which, because a funnel that silently mixes a number you can
 * trust with one you cannot is worse than no funnel.
 */

export const EVENTS = [
  "scan_completed",
  "verdict_busted",
  "verdict_overpriced",
  "verdict_fair",
  "share_tapped",
  "paywall_shown",
  "email_captured",
  "checkout_clicked",
] as const;

export type EventName = (typeof EVENTS)[number];

/** The events a browser is allowed to report. Everything else is server-side. */
export const CLIENT_EVENTS: readonly EventName[] = [
  "share_tapped",
  "paywall_shown",
  "checkout_clicked",
];

const EVENT_SET = new Set<string>(EVENTS);
const CLIENT_EVENT_SET = new Set<string>(CLIENT_EVENTS);

export function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && EVENT_SET.has(value);
}

export function isClientReportable(value: unknown): value is EventName {
  return typeof value === "string" && CLIENT_EVENT_SET.has(value);
}

// Just over a year, so the same day last year is still there to compare
// against, and the keyspace still has a ceiling.
const DAY_TTL_SECONDS = 60 * 60 * 24 * 400;

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

export function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

const keys = {
  day: (event: EventName, day: string) => `stat:${event}:${day}`,
  total: (event: EventName) => `stat:${event}:total`,
};

/**
 * Counts one or more events. Never throws and never blocks anything that
 * matters: an analytics write that fails is a number nobody sees, while an
 * analytics write that breaks a scan is a customer nobody keeps.
 *
 * Batched through a pipeline because these are almost always recorded in
 * groups (a finished scan is a scan_completed plus a verdict counter) and two
 * sequential round trips to count two integers is two too many.
 */
export async function recordEvents(events: EventName[], date = new Date()): Promise<void> {
  const valid = events.filter(isEventName);
  if (valid.length === 0) return;

  const day = dayKey(date);
  try {
    const pipeline = getRedis().pipeline();
    for (const event of valid) {
      pipeline.incr(keys.day(event, day));
      pipeline.expire(keys.day(event, day), DAY_TTL_SECONDS);
      pipeline.incr(keys.total(event));
    }
    await pipeline.exec();
  } catch {
    /* counting is never worth an error path */
  }
}

export async function recordEvent(event: EventName, date = new Date()): Promise<void> {
  return recordEvents([event], date);
}

export interface EventSeries {
  event: EventName;
  total: number;
  days: { day: string; count: number }[];
  windowTotal: number;
}

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    out.push(dayKey(new Date(now - i * 86400000)));
  }
  return out;
}

/**
 * Reads the whole board in two round trips regardless of the window: one MGET
 * for every day of every event, one for the lifetime totals. A day-by-day loop
 * would be 8 x days round trips, which for a 30-day window is 240 requests to
 * render one page.
 */
export async function readEvents(days = 30): Promise<EventSeries[]> {
  const window = lastNDays(days);
  const redis = getRedis();

  const dayFields: string[] = [];
  for (const event of EVENTS) {
    for (const day of window) dayFields.push(keys.day(event, day));
  }

  let dayValues: (number | null)[] = [];
  let totals: (number | null)[] = [];
  try {
    [dayValues, totals] = await Promise.all([
      redis.mget<(number | null)[]>(...dayFields),
      redis.mget<(number | null)[]>(...EVENTS.map(e => keys.total(e))),
    ]);
  } catch {
    dayValues = [];
    totals = [];
  }

  return EVENTS.map((event, eventIndex) => {
    const slice = window.map((day, dayIndex) => ({
      day,
      count: Number(dayValues[eventIndex * window.length + dayIndex] ?? 0) || 0,
    }));
    return {
      event,
      total: Number(totals[eventIndex] ?? 0) || 0,
      days: slice,
      windowTotal: slice.reduce((a, b) => a + b.count, 0),
    };
  });
}

export interface Funnel {
  scans: number;
  verdicts: { busted: number; overpriced: number; fair: number };
  bustedRate: number | null;
  shares: number;
  sharesPerScan: number | null;
  paywalls: number;
  paywallRate: number | null;
  emails: number;
  emailCaptureRate: number | null;
  checkoutClicks: number;
  checkoutClickRate: number | null;
}

const pct = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;

/**
 * The only ratios worth looking at, computed rather than eyeballed.
 *
 * sharesPerScan is the one that decides whether this reaches 750 million
 * people or 750 thousand. It is the loop coefficient: every share is an
 * impression that produces some fraction of a new scan, so the whole growth
 * model is a function of this number and nothing else. It was unmeasured until
 * now, which meant every decision about the card, the tone and the permanent
 * page was being made blind.
 */
export function buildFunnel(series: EventSeries[], scope: "window" | "total" = "window"): Funnel {
  const get = (event: EventName) => {
    const found = series.find(s => s.event === event);
    if (!found) return 0;
    return scope === "total" ? found.total : found.windowTotal;
  };

  const scans = get("scan_completed");
  const busted = get("verdict_busted");
  const overpriced = get("verdict_overpriced");
  const fair = get("verdict_fair");
  const verdictTotal = busted + overpriced + fair;
  const shares = get("share_tapped");
  const paywalls = get("paywall_shown");
  const emails = get("email_captured");
  const checkoutClicks = get("checkout_clicked");

  return {
    scans,
    verdicts: { busted, overpriced, fair },
    bustedRate: pct(busted, verdictTotal),
    shares,
    // Deliberately not a percentage. A loop coefficient above 1 is the whole
    // point and a "percentage" that can exceed 100 reads as a bug.
    sharesPerScan: scans > 0 ? Math.round((shares / scans) * 1000) / 1000 : null,
    paywalls,
    paywallRate: pct(paywalls, scans),
    emails,
    emailCaptureRate: pct(emails, paywalls),
    checkoutClicks,
    checkoutClickRate: pct(checkoutClicks, paywalls),
  };
}
