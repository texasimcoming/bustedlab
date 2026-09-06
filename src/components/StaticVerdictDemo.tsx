"use client";

import VerdictCard, { VerdictData } from "@/components/VerdictCard";

// Real numbers, verified 2026-09-06:
// - Wholesale $4.30: actual AliExpress "Hello Smile Store" listing, 7-pair
//   (14 strip / 7 session) purple teeth whitening strips, live price at
//   time of writing.
// - Retail $22.99: actual TikTok Shop list price for the identical 14-strip
//   / 7-session configuration of the current top-selling purple whitening
//   strips product in this category (992K+ sold) — same product shape,
//   independently verified, not the same listing.
// - Markup/savings computed with the exact formula scan.ts uses, not hand-picked.
// Product name is generic ("Purple Teeth Whitening Strips"), not a brand name —
// matching how the real engine identifies products, and for the same reason:
// this card isn't naming a specific real business.
const DEMO_DATA: VerdictData = {
  verdict: "OVERPRICED",
  mode: "VERDICT",
  matchConfidence: "exact",
  retailPrice: 22.99,
  wholesalePrice: 4.30,
  markup: 435,
  savings: 18.69,
  productTitle: "Purple Teeth Whitening Strips (14ct / 7 sessions)",
  // Points at a local asset you supply — see public/demo/README.txt.
  // Deliberately NOT a hotlinked third-party product photo: a permanent
  // marketing asset on your own site should be a photo you actually have
  // the rights to, not something scraped from a retailer listing.
  productImageUrl: "/demo/purple-whitening-strips.jpg",
  isDemo: true,
};

export default function StaticVerdictDemo() {
  return (
    <div style={{ marginBottom: "28px" }}>
      <p style={{
        fontSize: "11px",
        color: "rgba(238,238,246,0.28)",
        letterSpacing: "1.5px",
        textTransform: "uppercase",
        marginBottom: "12px",
        fontWeight: "500",
        textAlign: "center",
        fontFamily: "'Inter', sans-serif",
      }}>
        This is what your scan looks like
      </p>
      <VerdictCard data={DEMO_DATA} animate={true} />
    </div>
  );
}
