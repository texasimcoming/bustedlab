import { NextRequest, NextResponse } from "next/server";
import { buildContentSecurityPolicy } from "@/lib/csp";

/**
 * Stamps every page with an enforced Content-Security-Policy carrying a fresh
 * nonce. See src/lib/csp.ts for the policy itself and where it came from.
 *
 * The nonce is set on the REQUEST as well as the response: Next reads it
 * from the request's Content-Security-Policy header while rendering and puts
 * it on its own scripts. That only works for a page rendered per request, so
 * the root layout opts every page into dynamic rendering (a prerendered page
 * would carry no nonce and every script on it would be refused).
 *
 * CSP_REPORT_ONLY=true sends the same policy as report-only. It is a
 * break-glass switch for the day something legitimate is blocked in
 * production, so the fix can wait for a deploy without the site being
 * broken in the meantime; violations still reach /api/stats either way.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = buildContentSecurityPolicy({
    nonce,
    frameAncestors: request.nextUrl.pathname === "/success" ? "'self'" : "'none'",
    upgradeInsecureRequests: request.nextUrl.protocol === "https:",
    development: process.env.NODE_ENV === "development",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  const reportOnly = process.env.CSP_REPORT_ONLY === "true";
  response.headers.set(reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only. Not API routes, build assets, files in public/ (anything
      // with an extension), or the generated share images, none of which
      // are documents that run scripts. Prefetches are skipped because they
      // fetch data for a page, not the page.
      source: "/((?!api/|_next/static|_next/image|.*\\.|.*opengraph-image).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
