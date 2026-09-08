import { NextRequest, NextResponse } from "next/server";

// Hosts that should never be reachable through this proxy — this route
// previously fetched ANY url with no validation, which makes it a classic
// open-proxy / SSRF vector: an attacker could point it at internal services,
// cloud metadata endpoints, or use it to anonymize requests to third-party
// sites through BustedLab's own server.
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "169.254.169.254"]);

function isPrivateOrInternal(hostname: string): boolean {
  if (BLOCKED_HOSTS.has(hostname)) return true;
  // IPv4 private/link-local ranges: 10.x, 172.16-31.x, 192.168.x, 169.254.x
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [parseInt(ipv4[1], 10), parseInt(ipv4[2], 10)];
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 127) return true;
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
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse("Missing url", { status: 400 });

  let target: URL;
  try {
    target = new URL(decodeURIComponent(url));
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
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) throw new Error(`Status ${response.status}`);

    const contentType = response.headers.get("content-type") || "";
    // Never relay non-image content through here — the old version returned
    // whatever content-type the upstream server claimed, which meant this
    // route could be used to fetch and relay arbitrary text/HTML/JSON, not
    // just the product images it's meant for.
    if (!contentType.startsWith("image/")) return fallback();

    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return fallback();
  }
}
