import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { verifyImageSignature } from "@/lib/image-proxy";
import { isPrivateAddress, isPrivateHostname } from "@/lib/net-guard";

// A response body with no ceiling is a memory-exhaustion lever: one request
// pointed at a multi-gigabyte file can take a serverless function down. No
// product thumbnail is anywhere near this.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * The hostname check reads the NAME. This one reads what the name RESOLVES
 * to, which is the hole a string comparison leaves open: a perfectly public
 * hostname whose DNS record points at 169.254.169.254 or 10.0.0.1 walks
 * straight through.
 *
 * This narrows that hole rather than closing it. Node re-resolves the name
 * when fetch runs, so a record that changes between this lookup and that one
 * still wins the race; closing it completely needs a custom dispatcher that
 * pins the resolved address, which is a much larger change to a hot path.
 * Narrowing a real hole is worth one DNS round trip, and the platform
 * resolver caches the answer for its TTL anyway.
 *
 * It uses isPrivateAddress, NOT isPrivateHostname. The distinction is the
 * whole reason those are two functions: the hostname version refuses IPv6 it
 * does not recognise, which for a resolved address means refusing ordinary
 * public IPv6 and blanking every product photo on the site. See
 * src/lib/net-guard.ts.
 *
 * Fails closed: a name that cannot be resolved is refused, which costs
 * nothing, because the fetch that followed would have failed too.
 */
async function resolvesToPrivate(hostname: string): Promise<boolean> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // A literal address needs no lookup - isPrivateHostname already judged it.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return false;
  try {
    const records = await lookup(host, { all: true, verbatim: true });
    if (records.length === 0) return true;
    // ANY private record disqualifies the name: an attacker who controls DNS
    // can publish a public A record alongside a private AAAA one.
    return records.some(record => isPrivateAddress(record.address));
  } catch {
    return true;
  }
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

  // ── Signature first, before anything is fetched. ──
  // An unsigned or wrongly-signed request is refused outright rather than
  // answered with the fallback pixel: the whole point is to spend no
  // bandwidth and make no upstream request for a URL this application did
  // not generate. A 403 also makes abuse unambiguous in the logs, where a
  // silent 1x1 would look like a broken thumbnail.
  if (!verifyImageSignature(url, req.nextUrl.searchParams.get("s"))) {
    return new NextResponse("Unsigned image request", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return fallback();
  }

  if (target.protocol !== "https:" && target.protocol !== "http:") return fallback();
  if (isPrivateHostname(target.hostname)) return fallback();
  if (await resolvesToPrivate(target.hostname)) return fallback();

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
      if (isPrivateHostname(next.hostname)) return fallback();
      if (await resolvesToPrivate(next.hostname)) return fallback();
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
