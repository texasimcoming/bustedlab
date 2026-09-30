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
 * Kept in its own module with zero imports so scripts/check-net-guard.mjs
 * can exercise the real functions against a fixed table, the same way
 * verdict.ts is separated for the calibration check. A guard whose failure
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
