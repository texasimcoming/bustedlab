/**
 * SSRF GUARD CHECK.
 *
 * Runs the REAL classifiers from src/lib/net-guard.ts against a fixed table.
 * No network and no DNS, so it is deterministic in CI.
 *
 * It exists because of a specific bug, caught by measurement and not by
 * reading. The image proxy gained a DNS pre-check so that a public hostname
 * pointing at a private address could be refused. The obvious implementation
 * reuses the hostname classifier on the resolved address, and the hostname
 * classifier refuses any IPv6 literal it does not recognise - which is the
 * right call for attacker-supplied text and a catastrophe for a resolved
 * address, because ordinary public IPv6 is exactly what it does not
 * recognise. Every hostname with an AAAA record would have been blocked:
 * cdn.shopify.com, m.media-amazon.com, every CDN a product photo comes from.
 * The site would have lost every image, and the guard would have looked like
 * it was working.
 *
 * So both directions are asserted here: private things are refused, and
 * public things - especially public IPv6 - are NOT.
 *
 *   node --experimental-strip-types --no-warnings scripts/check-net-guard.mjs
 */
import { isPrivateAddress, isPrivateHostname, publicHttpUrl, fetchPublic, setResolverForChecks } from "../src/lib/net-guard.ts";

// [input, expected, why this case exists]
const ADDRESSES = [
  // ── must be refused ──
  ["127.0.0.1",                 true,  "loopback"],
  ["10.1.2.3",                  true,  "private class A"],
  ["172.16.0.1",                true,  "private class B, low end"],
  ["172.31.255.254",            true,  "private class B, high end"],
  ["192.168.1.1",               true,  "private class C"],
  ["169.254.169.254",           true,  "cloud metadata"],
  ["100.64.0.1",                true,  "carrier-grade NAT"],
  ["0.0.0.0",                   true,  "unspecified"],
  ["224.0.0.1",                 true,  "multicast"],
  ["::1",                       true,  "IPv6 loopback"],
  ["::",                        true,  "IPv6 unspecified"],
  ["fd00::1",                   true,  "IPv6 unique-local"],
  ["fc00::1",                   true,  "IPv6 unique-local, low end"],
  ["fe80::1",                   true,  "IPv6 link-local"],
  ["ff02::1",                   true,  "IPv6 multicast"],
  ["::ffff:169.254.169.254",    true,  "IPv4-mapped metadata: the classic bypass"],
  ["::ffff:10.0.0.1",           true,  "IPv4-mapped private"],
  ["2002:0a00:0001::1",         true,  "6to4 wrapping 10.0.0.1"],
  ["2002:a9fe:a9fe::1",         true,  "6to4 wrapping 169.254.169.254"],
  ["::ffff:a9fe:a9fe",          true,  "IPv4-mapped metadata written in hex"],
  ["::ffff:7f00:1",             true,  "IPv4-mapped loopback written in hex"],
  ["64:ff9b::a00:1",            true,  "NAT64 wrapping 10.0.0.1"],
  ["198.18.0.1",                true,  "benchmarking range"],

  // ── must be allowed, or the site loses its images ──
  ["1.2.3.4",                   false, "ordinary public IPv4"],
  ["23.227.39.200",             false, "cdn.shopify.com as resolved"],
  ["99.84.98.145",              false, "m.media-amazon.com as resolved"],
  ["172.66.147.243",            false, "public 172.x OUTSIDE the private 16-31 band"],
  ["172.15.0.1",                false, "public 172.x just below the private band"],
  ["172.32.0.1",                false, "public 172.x just above the private band"],
  ["100.63.0.1",                false, "just below CGNAT"],
  ["100.128.0.1",               false, "just above CGNAT"],
  ["2606:4700:10::6814:179a",   false, "Cloudflare IPv6 - THE regression this file exists for"],
  ["2600:9000:20e2:e000::1",    false, "CloudFront IPv6"],
  ["2620:127:f00e:ff01::",      false, "Shopify IPv6"],
  ["64:ff9b::1702:27c8",        false, "NAT64 wrapping a public IPv4 (23.2.39.200)"],
  ["2001:4860:4860::8888",      false, "Google public IPv6"],
];

const HOSTNAMES = [
  ["localhost",                 true,  "named loopback"],
  ["foo.localhost",             true,  "loopback subdomain"],
  ["thing.internal",            true,  "internal TLD"],
  ["printer.local",             true,  "mDNS TLD"],
  ["metadata.google.internal",  true,  "named metadata endpoint"],
  ["127.0.0.1",                 true,  "loopback literal"],
  ["[::1]",                     true,  "bracketed IPv6 loopback literal"],
  ["[2606:4700:10::6814:179a]", true,  "public IPv6 LITERAL is still refused: untrusted text, not a resolver answer"],
  ["cdn.shopify.com",           false, "ordinary hostname"],
  ["m.media-amazon.com",        false, "ordinary hostname"],
  ["images.example.co.uk",      false, "ordinary hostname"],
];

let failures = 0;
const run = (label, cases, fn) => {
  console.log(`\n${label}`);
  console.log("-".repeat(78));
  for (const [input, expected, why] of cases) {
    const got = fn(input);
    const ok = got === expected;
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${String(input).padEnd(28)} ` +
      `${got ? "refused" : "allowed"}${ok ? "" : ` (expected ${expected ? "refused" : "allowed"})`}  ${why}`
    );
  }
};

// Links the scanner fetches on a visitor's say-so (fetchPublic in net-guard.ts).
// true = refused before any request is made.
const LINKS = [
  ["http://169.254.169.254/latest/meta-data/", true,  "cloud metadata by address"],
  ["http://localhost:3000/api/stats",          true,  "the server itself"],
  ["https://127.0.0.1/",                       true,  "loopback literal"],
  ["https://[::1]/",                           true,  "IPv6 loopback literal"],
  ["file:///etc/passwd",                       true,  "not http"],
  ["ftp://example.com/file",                   true,  "not http"],
  ["https://user:pass@example.com/",           true,  "credentials in the link"],
  ["https://example.com:6379/",                true,  "a non-web port"],
  ["https://intranet/",                        true,  "single-label host"],
  ["https://metadata.google.internal/",        true,  "cloud metadata by name"],
  ["https://shop.example.com/products/mug",    false, "an ordinary product page"],
  ["http://shop.example.com/products/mug",     false, "plain http is still a web page"],
  ["https://shop.example.com:443/p",           false, "explicit default port"],
];

run("RESOLVED ADDRESSES (isPrivateAddress)", ADDRESSES, isPrivateAddress);
run("HOSTNAMES AS WRITTEN (isPrivateHostname)", HOSTNAMES, isPrivateHostname);
run("LINKS THE SCANNER MAY FETCH (publicHttpUrl)", LINKS, url => publicHttpUrl(url) === null);

// fetchPublic, end to end, against a stubbed resolver and fetch: every hop
// of a redirect chain is checked, not only the first.
const DNS = { "shop.example.com": "93.184.216.34", "cdn.example.com": "93.184.216.35", "rebind.example.com": "10.0.0.7" };
setResolverForChecks(async host => (DNS[host] ? [{ address: DNS[host] }] : []));
const REDIRECTS = {
  "https://shop.example.com/p": [200],
  "https://shop.example.com/moved": [302, "https://cdn.example.com/p"],
  "https://cdn.example.com/p": [200],
  "https://shop.example.com/to-metadata": [301, "http://169.254.169.254/latest/meta-data/"],
  "https://shop.example.com/to-rebind": [302, "https://rebind.example.com/"],
  "https://shop.example.com/relative": [302, "/p"],
  "https://shop.example.com/loop": [302, "https://shop.example.com/loop"],
};
const requested = [];
globalThis.fetch = async (url, init) => {
  requested.push(url);
  if (init?.redirect !== "manual") throw new Error("fetchPublic must follow redirects by hand");
  const [status, location] = REDIRECTS[url] || [404];
  return new Response(status === 200 ? "<html></html>" : "", { status, headers: location ? { location } : {} });
};
const FETCHES = [
  ["https://shop.example.com/p",           "fetched", "a public page"],
  ["https://shop.example.com/moved",       "fetched", "a redirect to another public host"],
  ["https://shop.example.com/relative",    "fetched", "a relative redirect"],
  ["https://shop.example.com/to-metadata", "refused", "a public page redirecting to cloud metadata"],
  ["https://shop.example.com/to-rebind",   "refused", "a redirect to a name that resolves to a private address"],
  ["https://rebind.example.com/",          "refused", "a name that resolves to a private address"],
  ["https://unknown.example.com/",         "refused", "a name that does not resolve"],
  ["https://shop.example.com/loop",        "refused", "a redirect loop"],
];
console.log("\nFETCHES (fetchPublic, stubbed DNS and network)");
console.log("-".repeat(78));
for (const [url, expected, why] of FETCHES) {
  requested.length = 0;
  const res = await fetchPublic(url);
  const got = res && res.status === 200 ? "fetched" : "refused";
  const leaked = requested.some(u => /\/\/(169\.254|rebind\.)/.test(u));
  const ok = got === expected && !leaked;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${url.padEnd(40)} ${got}${leaked ? " (A REQUEST REACHED A PRIVATE ADDRESS)" : ""}  ${why}`);
}

console.log("");
if (failures > 0) {
  console.error(`${failures} SSRF guard case(s) failed.`);
  process.exit(1);
}
console.log("All SSRF guard cases pass.");
