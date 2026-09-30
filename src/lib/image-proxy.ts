import crypto from "crypto";

/**
 * SIGNED IMAGE PROXY PATHS.
 *
 * /api/proxy-image exists because product photos come from merchant CDNs and
 * next/image is deliberately pointed at nothing remote. The route itself is
 * carefully guarded against SSRF, oversized bodies and non-image content.
 * What it was not guarded against was being used at all: unauthenticated,
 * unmetered, and answering for ANY public image URL with
 * `Access-Control-Allow-Origin: *` and a day of cache headers.
 *
 * That makes it a free image CDN for anyone who finds it, billed to this
 * project's bandwidth and function invocations. Every other public endpoint
 * on the site has a rate limiter; this one had nothing, and it is the one
 * that moves the most bytes.
 *
 * The fix is a signature rather than a rate limit, because rate limiting the
 * route would throttle legitimate page loads (a results page requests
 * several images at once) while barely inconveniencing a determined abuser.
 * A signature answers a different and better question: did THIS application
 * generate this URL? Only the engine can sign one, so the route will only
 * ever fetch an image the engine actually chose to show.
 *
 * THE KEY. IMAGE_PROXY_SECRET, falling back to IDENTITY_SALT, falling back
 * to a built-in development value. The fallback chain means images work with
 * no configuration at all, but only a real secret makes the signature mean
 * anything: a built-in default is derivable by anyone who can read this
 * file. Setting IMAGE_PROXY_SECRET is what closes the hole.
 *
 * NO EXPIRY IN THE SIGNATURE, and that is deliberate. Proxied paths are
 * stored inside 24-hour cached scan results and inside permanent ledger
 * records that have public pages. An expiring signature would break those
 * pages the moment it lapsed, which is a worse failure than the one being
 * fixed. Instead, stored paths are re-signed as they are read out (see
 * resignProxyPath), so rotating the secret invalidates abuse without
 * blanking a single permanent page.
 */

const PROXY_PREFIX = "/api/proxy-image";
const DEV_FALLBACK_KEY = "bustedlab-image-proxy-unconfigured";

function signingKey(): string {
  return (
    process.env.IMAGE_PROXY_SECRET ||
    process.env.IDENTITY_SALT ||
    DEV_FALLBACK_KEY
  );
}

/** 128 bits of HMAC, which is plenty to make guessing pointless and keeps URLs short. */
export function signImageUrl(rawUrl: string): string {
  return crypto.createHmac("sha256", signingKey()).update(rawUrl).digest("hex").slice(0, 32);
}

export function verifyImageSignature(rawUrl: string, provided: string | null): boolean {
  if (!provided) return false;
  const expected = signImageUrl(rawUrl);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Builds a signed proxy path from a raw upstream image URL. */
export function proxyImagePath(rawUrl: string): string {
  if (!rawUrl) return "";
  if (rawUrl.startsWith(PROXY_PREFIX)) return resignProxyPath(rawUrl);
  return `${PROXY_PREFIX}?url=${encodeURIComponent(rawUrl)}&s=${signImageUrl(rawUrl)}`;
}

/**
 * Re-signs a proxy path that was stored earlier, so records written before
 * signing existed - or before the current secret did - keep working. Anything
 * that is not one of our proxy paths is returned untouched.
 */
export function resignProxyPath(stored: string): string {
  if (!stored || !stored.startsWith(PROXY_PREFIX)) return stored;
  const query = stored.indexOf("?");
  if (query < 0) return stored;
  const raw = new URLSearchParams(stored.slice(query + 1)).get("url");
  if (!raw) return stored;
  return `${PROXY_PREFIX}?url=${encodeURIComponent(raw)}&s=${signImageUrl(raw)}`;
}
