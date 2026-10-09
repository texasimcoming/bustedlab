"use client";

import VerdictCard, { VerdictData } from "@/components/VerdictCard";
import { EXAMPLE_SCANS } from "@/content/examples";

// The first example scan, drawn as the card a scan produces. Its numbers come
// from src/content/examples.ts, where their sources are recorded, so this card
// and the hero instrument above it can never disagree.
//
// Product name is generic ("Purple Teeth Whitening Strips") rather than a
// brand name, matching how the real engine identifies products and for the
// same reason: this card is not naming a specific real business.
//
// The card is labelled "EXAMPLE" (with "EXAMPLE SCAN" above it) in place of a
// timestamp: it is a demonstration, not a scan anyone ran here. It used to
// carry a hardcoded date, which was three problems at once: it was a claim
// the numbers were captured at that instant, it aged visibly, and it told any
// visitor roughly when this site went up.
const example = EXAMPLE_SCANS[0];
const DEMO_DATA: VerdictData = {
  verdict: example.verdict,
  mode: "VERDICT",
  matchConfidence: "exact",
  retailPrice: example.asking,
  wholesalePrice: example.source,
  markup: example.markup,
  savings: example.savings,
  productTitle: example.title,
  // A local asset, deliberately not a hotlinked third-party product photo: a
  // permanent marketing asset on your own site should be an image you hold
  // the rights to, not something scraped from a retailer listing.
  productImageUrl: example.thumb,
  isDemo: true,
};

// Both sizes are rendered and CSS shows the one that fits (globals.css,
// .demo-compact / .demo-full). Choosing in JavaScript after mount drew the
// compact card first and swapped it for the full one a moment later, which
// was a visible jump.
export default function StaticVerdictDemo() {
  return (
    <div>
      <div className="demo-compact"><VerdictCard data={DEMO_DATA} animate={true} compact /></div>
      <div className="demo-full"><VerdictCard data={DEMO_DATA} animate={true} /></div>
    </div>
  );
}
