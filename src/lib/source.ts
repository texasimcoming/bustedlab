/**
 * WHERE A VISIT CAME FROM, AS ONE WORD.
 *
 * The first thing to know once marketing starts is which channel brings
 * people who scan and pay: TikTok, Instagram, a shared verdict card, or
 * something else. This answers it with a single label from a fixed list,
 * worked out in the browser when a page loads and held in memory (nothing is
 * written to the device), then sent with each funnel count. The label is all
 * that leaves the browser: the referring address, the link's tags and the
 * user agent are read here and never sent or stored. A count says "on this day,
 * this many landings came from TikTok", which describes a channel, not a
 * person.
 *
 * Zero imports, so the browser bundle, the beacon route and the offline
 * checks all run this same function.
 */
export const SOURCES = ["tiktok", "instagram", "x", "facebook", "whatsapp", "shared", "search", "direct", "other"] as const;
export type TrafficSource = (typeof SOURCES)[number];

export function isTrafficSource(value: unknown): value is TrafficSource {
  return typeof value === "string" && (SOURCES as readonly string[]).includes(value);
}

const BY_NAME: [RegExp, TrafficSource][] = [
  [/tiktok|musical_?ly|bytedance/i, "tiktok"],
  [/instagram|^ig$/i, "instagram"],
  [/^x$|twitter|^t\.co$/i, "x"],
  [/facebook|^fb$|messenger/i, "facebook"],
  [/whatsapp|^wa$/i, "whatsapp"],
  [/^share$|^card$|^shared$/i, "shared"],
];

const fromName = (name: string): TrafficSource | null => {
  for (const [pattern, source] of BY_NAME) if (pattern.test(name)) return source;
  return null;
};

/** The in-app browsers people arrive in, by their user agent. */
const IN_APP: [RegExp, TrafficSource][] = [
  [/musical_ly|BytedanceWebview|TikTok/i, "tiktok"],
  [/Instagram/i, "instagram"],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, "facebook"],
  [/WhatsApp/i, "whatsapp"],
  [/Twitter/i, "x"],
];

const REFERRERS: [RegExp, TrafficSource][] = [
  [/(^|\.)tiktok\.com$/i, "tiktok"],
  [/(^|\.)instagram\.com$/i, "instagram"],
  [/(^|\.)(x\.com|twitter\.com|t\.co)$/i, "x"],
  [/(^|\.)(facebook\.com|fb\.me|messenger\.com)$/i, "facebook"],
  [/(^|\.)(whatsapp\.com|wa\.me)$/i, "whatsapp"],
  [/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|ecosia\.org|search\.brave\.com)$/i, "search"],
];

export interface SourceInput {
  /** location.search of the first page. */
  search: string;
  /** location.pathname of the first page. */
  path: string;
  /** document.referrer, often empty inside in-app browsers. */
  referrer: string;
  userAgent: string;
  /** This site's own host, so moving between its pages is not a referral. */
  host: string;
}

/**
 * In order: a tag on the link (utm_source or ref, which is how a link in a
 * bio or a Story sticker should be tagged), the app the page opened in, the
 * referring site, and a first page that is a shared verdict. Otherwise direct.
 */
export function detectSource({ search, path, referrer, userAgent, host }: SourceInput): TrafficSource {
  try {
    const params = new URLSearchParams(search);
    const tag = (params.get("utm_source") || params.get("ref") || "").trim().slice(0, 40);
    if (tag) return fromName(tag) ?? "other";
  } catch { /* a malformed query is no tag */ }

  for (const [pattern, source] of IN_APP) if (pattern.test(userAgent)) return source;

  let referrerHost = "";
  let referrerPath = "";
  try {
    if (referrer) ({ hostname: referrerHost, pathname: referrerPath } = new URL(referrer));
  } catch { /* unreadable referrer */ }
  const sameSite = referrerHost === host || referrerHost.endsWith(`.${host}`) || host.endsWith(`.${referrerHost}`);
  // From a shared verdict on this site to the scanner: the share loop.
  if (referrerHost && sameSite && /^\/scan\/[^/]+/.test(referrerPath)) return "shared";
  if (referrerHost && !sameSite) {
    for (const [pattern, source] of REFERRERS) if (pattern.test(referrerHost)) return source;
    return "other";
  }

  if (/^\/scan\/[^/]+/.test(path)) return "shared";
  return "direct";
}
