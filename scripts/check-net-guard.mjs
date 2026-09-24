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
import { isPrivateAddress, isPrivateHostname } from "../src/lib/net-guard.ts";

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

run("RESOLVED ADDRESSES (isPrivateAddress)", ADDRESSES, isPrivateAddress);
run("HOSTNAMES AS WRITTEN (isPrivateHostname)", HOSTNAMES, isPrivateHostname);

console.log("");
if (failures > 0) {
  console.error(`${failures} SSRF guard case(s) failed.`);
  process.exit(1);
}
console.log("All SSRF guard cases pass.");
