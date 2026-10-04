/**
 * AFFILIATE LINKS, OFF BY DEFAULT.
 *
 * Rewrites one link and nothing else: the final outbound "Go to this price"
 * link on a closest-match (FINDER) result, and only when AFFILIATE_PROVIDER
 * names a supported network and AFFILIATE_KEY has that network's shape.
 * Anything else, including a missing or malformed key, a link that is not a
 * direct merchant page, or a link already wrapped, goes out as the direct
 * URL, which is always the fallback.
 *
 * Commission can never influence which listing is shown: this runs in the
 * scan route on a result the engine has already finished deciding, the
 * engine (src/lib/scan.ts) does not import this file, and this file imports
 * nothing. The cached result, the ledger and every other link keep the
 * direct URL. scripts/check-affiliate.mjs holds all of that in place.
 *
 * Link formats, from each network's documentation (checked 2026-10-04):
 *   Sovrn Commerce (formerly VigLink), manual link wrapping:
 *     redirect.viglink.com?key=<API key>&u=<URL-encoded destination>
 *     (only the destination is encoded, never the whole link; the API key
 *     is on the site's row in the Commerce Settings page)
 *   Skimlinks Link Wrapper:
 *     https://go.skimresources.com/?id=<publisher id>X<domain id>&url=<URL-encoded destination>
 *     (the id is the domain-specific id from the Publisher Hub; the optional
 *     sref names the page the link sits on)
 */
export type AffiliateProvider = "sovrn" | "skimlinks";

const KEY_SHAPE: Record<AffiliateProvider, RegExp> = {
  // Sovrn's API keys are alphanumeric strings (32 hex characters in practice).
  sovrn: /^[A-Za-z0-9]{16,64}$/,
  // "<publisher id>X<domain id>", e.g. 123456X1234567.
  skimlinks: /^\d{3,10}X\d{3,12}$/,
};

/** Hosts whose links are never wrapped: our own pages, search pages, and the networks' own redirects. */
const NEVER_WRAP = /(^|\.)(bustedlab\.com|google\.[a-z.]+|redirect\.viglink\.com|go\.skimresources\.com|go\.redirectingat\.com)$/i;

export interface AffiliateConfig {
  provider: AffiliateProvider;
  key: string;
}

/** The configured network, or null when wrapping is off (the default) or the key is malformed. */
export function affiliateConfig(env: Record<string, string | undefined> = process.env): AffiliateConfig | null {
  const provider = String(env.AFFILIATE_PROVIDER || "").trim().toLowerCase();
  const key = String(env.AFFILIATE_KEY || "").trim();
  if (provider !== "sovrn" && provider !== "skimlinks") return null;
  return KEY_SHAPE[provider].test(key) ? { provider, key } : null;
}

/**
 * How the privacy page names each network: who it is, the host a wrapped
 * link passes through, and its own privacy policy (checked 2026-10-04).
 */
export const AFFILIATE_NETWORKS: Record<AffiliateProvider, { name: string; redirectHost: string; policy: string }> = {
  sovrn: { name: "Sovrn Commerce", redirectHost: "redirect.viglink.com", policy: "sovrn.com/privacy-policy/privacy-policy" },
  skimlinks: { name: "Skimlinks", redirectHost: "go.skimresources.com", policy: "skimlinks.com/privacy-policy" },
};

/**
 * The network links are wrapped through right now, or null when they go out
 * direct (the default, and also when the key is malformed). The privacy page
 * names it from this, so the page says what the scan route does.
 */
export function activeAffiliateNetwork(env: Record<string, string | undefined> = process.env) {
  const config = affiliateConfig(env);
  return config ? AFFILIATE_NETWORKS[config.provider] : null;
}

/** The wrapped link for a direct merchant URL, or the URL itself. */
export function wrapOutboundLink(url: string, config: AffiliateConfig | null, sourcePage = "https://www.bustedlab.com/"): string {
  if (!config || !url) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || NEVER_WRAP.test(parsed.hostname)) return url;
  const destination = encodeURIComponent(url);
  return config.provider === "sovrn"
    ? `https://redirect.viglink.com?key=${encodeURIComponent(config.key)}&u=${destination}`
    : `https://go.skimresources.com/?id=${config.key}&url=${destination}&sref=${encodeURIComponent(sourcePage)}`;
}

/**
 * The one place a result's outbound link is wrapped: a FINDER result's "Go to
 * this price" link, when it goes straight to a merchant. Everything else on
 * the result is returned untouched.
 */
export function withAffiliateLink<T extends { mode: string; sourceProduct: { affiliateUrl: string; linkIsDirect?: boolean } }>(
  result: T,
  env: Record<string, string | undefined> = process.env
): T {
  const config = affiliateConfig(env);
  if (!config || result.mode !== "FINDER" || result.sourceProduct.linkIsDirect === false) return result;
  const wrapped = wrapOutboundLink(result.sourceProduct.affiliateUrl, config);
  if (wrapped === result.sourceProduct.affiliateUrl) return result;
  return { ...result, sourceProduct: { ...result.sourceProduct, affiliateUrl: wrapped } };
}
