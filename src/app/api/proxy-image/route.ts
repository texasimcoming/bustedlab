import { NextRequest, NextResponse } from "next/server";

// Hosts that should never be reachable through this proxy — this route
// previously fetched ANY url with no validation, which makes it a classic
// open-proxy / SSRF vector: an attacker could point it at internal services,
// cloud metadata endpoints, or use it to anonymize requests to third-party
// sites through BustedLab's own server.
const BLOCKED_HOSTS = new Set(["localhost", "0.0.0.0", "metadata.google.internal"]);

// A response body with no ceiling is a memory-exhaustion lever: one request
// pointed at a multi-gigabyte file can take a serverless function down. No
// product thumbnail is anywhere near this.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function isPrivateOrInternal(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return true;

  // IPv4 loopback, private, link-local (incl. the cloud metadata endpoint),
  // carrier-grade NAT, and this-network ranges.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [parseInt(ipv4[1], 10), parseInt(ipv4[2], 10)];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;         // link-local, 169.254.169.254 included
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  // IPv6 loopback, unique-local (fc00::/7), link-local (fe80::/10), and
  // IPv4-mapped forms of all of the above. The previous version only
  // string-matched "::1", so ::ffff:169.254.169.254 walked straight through.
  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
    const mapped = host.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isPrivateOrInternal(mapped[1]);
    return true; // unrecognized literal IPv6, refuse rather than guess
  }

  return false;
}

const FALLBACK_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

function fallback() {
  return new NextResponse(FALLBACK_PIXEL, {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-cache" },
  });
}

export async function GET(req: NextRequest) {
  // searchParams already percent-decodes. The previous version called
  // decodeURIComponent on top of that, which double-decoded any image URL
  // carrying an encoded character (a %2B in a CDN signature, a %20 in a
  // filename) and turned a working thumbnail into a broken one.
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse("Missing url", { status: 400 });

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return fallback();
  }

  if (target.protocol !== "https:" && target.protocol !== "http:") return fallback();
  if (isPrivateOrInternal(target.hostname)) return fallback();

  try {
    const response = await fetch(target.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BustedLab/1.0)",
        "Accept": "image/*,*/*",
      },
      // Following redirects means the SSRF check above can be sidestepped by
      // a public host that 302s to an internal address, so each hop is
      // validated by hand instead.
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return fallback();
      let next: URL;
      try {
        next = new URL(location, target);
      } catch {
        return fallback();
      }
      if (next.protocol !== "https:" && next.protocol !== "http:") return fallback();
      if (isPrivateOrInternal(next.hostname)) return fallback();
      const followed = await fetch(next.toString(), {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BustedLab/1.0)", "Accept": "image/*,*/*" },
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      return relay(followed);
    }

    return relay(response);
  } catch {
    return fallback();
  }
}

async function relay(response: Response): Promise<NextResponse> {
  if (!response.ok) return fallback();

  const contentType = response.headers.get("content-type") || "";
  // Never relay non-image content through here — the old version returned
  // whatever content-type the upstream server claimed, which meant this
  // route could be used to fetch and relay arbitrary text/HTML/JSON, not
  // just the product images it's meant for.
  if (!contentType.startsWith("image/")) return fallback();

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_IMAGE_BYTES) return fallback();

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) return fallback();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, immutable",
      "Access-Control-Allow-Origin": "*",
      // These images are third-party product photos relayed for comparison.
      // Keeping them out of search indexes avoids BustedLab looking like the
      // origin of somebody else's catalogue imagery.
      "X-Robots-Tag": "noindex",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
