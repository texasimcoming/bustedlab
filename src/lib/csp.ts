/**
 * THE CONTENT SECURITY POLICY. Enforced, built per request by src/proxy.ts.
 *
 * WHERE THE DIRECTIVES CAME FROM. The report-only policy that preceded this
 * never collected anything: it had no reporting endpoint, so its violations
 * went to individual visitors' consoles and nowhere else. It also allowed
 * 'unsafe-inline' for scripts and styles, so it could not have flagged the
 * inline code a strict policy has to deal with even if someone had been
 * reading. The data this is built from came from crawling every page and
 * every flow in a real browser - landing page, paywall, checkout overlay and
 * its fallback, a scan through to the results page and the share card,
 * photo upload, permanent scan pages, the index, sign-in, unsubscribe, the
 * legal pages, 404s - first under a strict candidate in report-only mode,
 * then enforced.
 *
 * SCRIPTS: a per-request nonce plus 'strict-dynamic'. Next stamps the nonce
 * on its own inline hydration scripts and bundles (it reads it from the
 * request header proxy.ts sets); nothing else runs. 'strict-dynamic' lets
 * those trusted scripts load what they load - Next's route chunks, and
 * lemon.js when checkout starts - without an allowlist an attacker could
 * reuse. An injected <script>, inline handler, javascript: URL or eval() is
 * refused. The host list and 'self' after the nonce are ignored by every
 * browser that understands 'strict-dynamic' and are there only as the
 * fallback for the few that do not.
 *
 * STYLES: 'unsafe-inline', and this is the one place it is the only viable
 * option rather than a shortcut. Every component in this app styles itself
 * with React style props, which reach the browser as style="" attributes in
 * the server HTML, and a nonce cannot be attached to an attribute: a nonce-
 * only style policy blanks the whole site. The checkout overlay adds styles
 * of its own that no nonce of ours can cover. What makes this acceptable is
 * everything around it: CSS injection is only dangerous as an exfiltration
 * channel, and every channel it could use - background images, fonts,
 * connections to another host - is closed by img-src, font-src and
 * connect-src below.
 *
 * FRAMES: only the checkout. The overlay is an iframe on Lemon Squeezy's
 * domain, or on the store's custom checkout domain if CHECKOUT_URL uses one,
 * which is read at request time so a changed link cannot fall out of step.
 *
 * REPORTS go to /api/csp-report and are counted, per day, in the numbers
 * GET /api/stats returns, so an enforced policy that starts blocking
 * something real in the wild shows up where the funnel is read. report-uri
 * only, not report-to: every browser sends report-uri at the moment of the
 * violation, while Chrome's report-to batches for up to a minute and was
 * never delivered at all when tested, and a policy that names report-to
 * makes Chrome ignore report-uri.
 */

// lemon.js. The integration spec named assets.lemonsqueezy.com; Lemon
// Squeezy's own Next.js template loads from app.lemonsqueezy.com. Both are
// tried by src/lib/lemon-overlay.ts, so both are listed for browsers that
// fall back to the host list.
export const LEMON_SCRIPT_ORIGINS = ["https://assets.lemonsqueezy.com", "https://app.lemonsqueezy.com"];
export const LEMON_ORIGINS = ["https://*.lemonsqueezy.com"];

function checkoutOrigin(): string | null {
  try {
    const raw = (process.env.CHECKOUT_URL || "").trim();
    return raw ? new URL(raw).origin : null;
  } catch {
    return null;
  }
}

/** Origins the checkout may be framed from: Lemon Squeezy, plus a custom checkout domain. */
export function checkoutFrameOrigins(): string[] {
  return [...LEMON_ORIGINS, checkoutOrigin()].filter(
    (origin, i, all): origin is string => !!origin && all.indexOf(origin) === i
  );
}

export const CSP_REPORT_PATH = "/api/csp-report";

export interface CspOptions {
  nonce: string;
  /** 'self' only for /success, which the checkout overlay may load in its frame. */
  frameAncestors: "'none'" | "'self'";
  /** Only over https: upgrading requests on a plain-http origin breaks every one. */
  upgradeInsecureRequests: boolean;
  /** next dev evaluates code for its error overlay; production never does. */
  development?: boolean;
}

export function buildContentSecurityPolicy(options: CspOptions): string {
  const { nonce, frameAncestors, upgradeInsecureRequests, development } = options;
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'self' ${LEMON_SCRIPT_ORIGINS.join(" ")}${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // Product photos arrive through /api/proxy-image (same origin). data: and
    // blob: are the upload preview and the share card html2canvas paints.
    "img-src 'self' data: blob:",
    // Fonts are self-hosted at build time by next/font.
    "font-src 'self'",
    `connect-src 'self' ${LEMON_ORIGINS.join(" ")}`,
    `frame-src 'self' ${checkoutFrameOrigins().join(" ")}`,
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    ...(upgradeInsecureRequests ? ["upgrade-insecure-requests"] : []),
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}
