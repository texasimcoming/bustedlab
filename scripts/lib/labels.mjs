/**
 * THE LABELS, shared by the production evaluation (scripts/production-eval.mjs)
 * and the offline guard check (scripts/check-match-guards.mjs), so a result
 * is judged right or wrong by one rule wherever it is judged.
 *
 * A case's identity (evals/cases.json): every word in identity.all, at least
 * one in identity.any, and none in identity.none must appear in a listing's
 * title or link. identity.none names what makes a listing a different product
 * even though it carries the right words: a single earbud of a pair, a tablet
 * holder for a phone holder.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export function identityMatches(c, text) {
  const t = String(text || "").toLowerCase();
  const all = c.identity?.all || [];
  const any = c.identity?.any || [];
  const none = c.identity?.none || [];
  return all.every(w => t.includes(w)) && (any.length === 0 || any.some(w => t.includes(w))) && !none.some(w => t.includes(w));
}

/** Whether a listing the gate called "exact" or "likely" is the product in the case's photo. */
export function isRightProduct(c, listing) {
  return c.findable === true && identityMatches(c, `${listing.title || ""} ${listing.link || ""}`);
}

// The same host rule as isListingCandidate in src/lib/scan.ts: pages on these
// hosts never reach the gate. scripts/check-match-guards.mjs fails if the two
// lists drift apart.
export const NON_LISTING_HOSTS = [
  "wikipedia.org", "wikimedia.org", "wikiwand.com", "fandom.com", "reddit.com", "pinterest.",
  "youtube.com", "youtu.be", "instagram.com", "tiktok.com", "twitter.com", "x.com", "threads.net",
  "tumblr.com", "flickr.com", "imgur.com", "quora.com", "medium.com", "substack.com", "deviantart.com",
  "artstation.com", "behance.net", "dribbble.com", "cgtrader.com", "sketchfab.com", "turbosquid.com",
  "manuals.plus", "manualslib.com",
];

export function isListing(link) {
  let host = "", path = "";
  try { const u = new URL(link); host = u.hostname.toLowerCase(); path = u.pathname; } catch { return true; }
  if (host === "facebook.com" || host.endsWith(".facebook.com")) return path.startsWith("/marketplace/");
  return !NON_LISTING_HOSTS.some(h => (h.endsWith(".") ? host.includes(h) : host === h || host.endsWith(`.${h}`)));
}

/**
 * Every gate answer a stored run recorded, one row per candidate judged:
 * the live scans' traces, and (from run 6) the replays, which record the
 * gate's own answer, the tie it named, and the answer after the guards.
 */
export function storedAnswers(resultsDir, runs) {
  const rows = [];
  for (const n of runs) {
    const file = resolve(resultsDir, `run-${n}.json`);
    if (!existsSync(file)) continue;
    const d = JSON.parse(readFileSync(file, "utf8"));
    for (const s of d.scans || []) {
      const steps = s.json?.evaluation?.trace?.steps || [];
      const ext = steps.find(x => x.step === "extraction");
      const read = ext ? { brand: ext.brand || "", productName: ext.productName || "" } : null;
      for (const g of steps.filter(x => x.step === "gate")) {
        for (const k of g.candidates || []) {
          rows.push({
            run: n, source: "scan", caseId: s.caseId, intent: s.intent, purpose: g.purpose || "identify", read,
            listing: { title: k.title || "", source: k.source || "", link: k.link || "", price: k.price || 0 },
            gate: k.gate || k.match, match: k.match, tie: k.tie ?? undefined, guard: k.guard || null, why: k.why || "",
          });
        }
      }
    }
    for (const r of d.replay?.answers || []) {
      rows.push({
        run: n, source: "replay", caseId: r.caseId, intent: r.intent || "", purpose: r.purpose || "identify", read: r.read || null,
        listing: { title: r.title || "", source: r.source || "", link: r.link || "", price: r.price || 0 },
        gate: r.gate, match: r.match, tie: r.tie, guard: r.guard || null, why: r.why || "", from: r.from || null,
      });
    }
  }
  return rows;
}
