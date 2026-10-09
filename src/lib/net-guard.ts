import { lookup } from "node:dns/promises";

/**
 * ADDRESS AND HOSTNAME CLASSIFICATION for the image proxy's SSRF guard.
 *
 * Two functions, deliberately not one, because they answer different
 * questions about differently-trusted input. Collapsing them is a real bug
 * that was caught by measurement rather than by reading:
 *
 *   isPrivateHostname - judges the host as WRITTEN in a URL. The input is
 *     attacker-supplied text, so an IPv6 literal it does not recognise is
 *     REFUSED. Guessing about a weird literal is how a bypass gets through.
 *
 *   isPrivateAddress - judges an address DNS actually returned. Here the
 *     same "refuse what I do not recognise" rule is a catastrophe: ordinary
 *     public IPv6 is exactly the thing it does not recognise, so every
 *     hostname with an AAAA record gets blocked. That is most of the modern
 *     internet - cdn.shopify.com, m.media-amazon.com, example.com all have
 *     one - and the failure mode is every product photo on the site going
 *     blank. This one classifies global unicast as public, and enumerates
 *     what is private.
 *
 * Kept in its own module, importing nothing but Node's resolver, so
 * scripts/check-net-guard.mjs can exercise the real functions against a
 * fixed table, the same way verdict.ts is separated for the calibration
 * check, and the scan engine's test loader can use it as it is. A guard whose failure
 * mode is "the whole site loses its images" earns a test that does not
 * depend on a DNS server answering.
 */

const BLOCKED_HOSTS = new Set(["localhost", "0.0.0.0", "metadata.google.internal"]);

const stripBrackets = (host: string) => host.toLowerCase().replace(/^\[|\]$/g, "");

/** IPv4 in the ranges that are never a public product image. */
function isPrivateIPv4(host: string): boolean {
  const parts = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!parts) return false;
  const [a, b] = [parseInt(parts[1], 10), parseInt(parts[2], 10)];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;          // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18.0.0/15
  if (a >= 224) return true;                         // multicast and reserved
  return false;
}

const looksLikeIPv4 = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

/**
 * A resolved address. Anything not enumerated here is treated as public,
 * because the caller has a real answer from DNS rather than a guess.
 */
export function isPrivateAddress(address: string): boolean {
  const host = stripBrackets(address);
  if (looksLikeIPv4(host)) return isPrivateIPv4(host);
  if (!host.includes(":")) return false;

  if (host === "::" || host === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;  // unique-local fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;  // link-local fe80::/10
  if (/^ff[0-9a-f]{2}:/.test(host)) return true;     // multicast ff00::/8

  // IPv4-mapped and IPv4-translated forms carry a v4 address inside them.
  const embedded = host.match(/:((?:\d{1,3}\.){3}\d{1,3})$/);
  if (embedded) return isPrivateIPv4(embedded[1]);

  // The same mapped forms written in hex (::ffff:a9fe:a9fe is
  // 169.254.169.254), and the NAT64 prefix 64:ff9b::/96, which a resolver
  // can hand back for any IPv4 address, private ones included.
  const hexMapped = host.match(/^(?:::ffff:(?:0:)?|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    return isPrivateIPv4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
  }

  // 6to4 (2002::/16) encodes an IPv4 address in the next two hextets, which
  // is a documented way to smuggle a private destination past a v6 check.
  const sixToFour = host.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/);
  if (sixToFour) {
    const high = parseInt(sixToFour[1].padStart(4, "0"), 16);
    const low = parseInt(sixToFour[2].padStart(4, "0"), 16);
    const v4 = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    return isPrivateIPv4(v4);
  }

  // Global unicast and everything else DNS can legitimately return.
  return false;
}

/**
 * A hostname as written in a URL. Conservative by design: an IPv6 literal
 * that is not recognised is refused rather than guessed about.
 */
export function isPrivateHostname(hostname: string): boolean {
  const host = stripBrackets(hostname);
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return true;
  if (looksLikeIPv4(host)) return isPrivateIPv4(host);
  if (host.includes(":")) {
    // A literal the resolved-address classifier calls private is private.
    if (isPrivateAddress(host)) return true;
    // Anything else in literal form is refused: this is untrusted text, not
    // an answer from a resolver.
    return true;
  }
  return false;
}

/**
 * A URL the server may fetch on someone else's say-so (a link a visitor
 * pasted, a store address read off a screenshot): http or https on the
 * default port, no credentials in it, a dotted public hostname. Returns the
 * parsed URL, or null. The resolved address is judged separately
 * (fetchPublic, below), because that needs DNS.
 */
export function publicHttpUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "443" && url.port !== "80") return null;
  const host = stripBrackets(url.hostname);
  if (!host.includes(".") || isPrivateHostname(host)) return null;
  return url;
}


/**
 * FETCHING A URL SOMEONE ELSE CHOSE.
 *
 * A link scan fetches whatever page the visitor pasted, and a screenshot scan
 * fetches the store address the model read off the image. Both used to go
 * straight to fetch() with redirects followed, so a link to an internal
 * address, or a public page that redirects to one, was fetched from inside
 * the platform and its text handed to the model. Every hop is now checked
 * here first: the URL itself (publicHttpUrl, above) and the
 * addresses its hostname resolves to. Redirects are followed by hand, at most
 * MAX_REDIRECTS of them, each checked the same way.
 *
 * The same trade the image proxy makes (src/app/api/proxy-image/route.ts):
 * the address is checked, not pinned, so a resolver that answers differently
 * a moment later is not covered. Pinning means a custom connection agent on
 * the scan path; this narrows the real hole for one DNS lookup per hop.
 */
const MAX_REDIRECTS = 4;

type Resolver = (host: string) => Promise<{ address: string }[]>;
let resolveHost: Resolver = host => lookup(host, { all: true, verbatim: true });

/**
 * For the offline checks only (scripts/check-*.mjs), which serve made-up shop
 * hosts from a stubbed fetch and have no DNS to ask. Production never calls it.
 */
export function setResolverForChecks(resolver: Resolver): void {
  resolveHost = resolver;
}

/** True when the name has no public address, or any of its addresses is private. */
export async function resolvesToPrivate(hostname: string): Promise<boolean> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // A literal was already judged by publicHttpUrl.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return false;
  try {
    const records = await resolveHost(host);
    if (records.length === 0) return true;
    return records.some(record => isPrivateAddress(record.address));
  } catch {
    return true;
  }
}

/**
 * fetch() for a URL from outside, or null when any hop is refused, a redirect
 * has nowhere to go, or there are too many of them. The caller's own errors
 * (a timeout, a reset) still throw, as fetch() does.
 */
export async function fetchPublic(raw: string, init: RequestInit = {}): Promise<Response | null> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = publicHttpUrl(current);
    if (!url || (await resolvesToPrivate(url.hostname))) return null;
    const res = await fetch(url.toString(), { ...init, redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get("location");
    if (!location) return null;
    try {
      current = new URL(location, url).toString();
    } catch {
      return null;
    }
  }
  return null;
}
