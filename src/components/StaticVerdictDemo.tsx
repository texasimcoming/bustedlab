"use client";

import { useState, useEffect } from "react";
import VerdictCard, { VerdictData } from "@/components/VerdictCard";

// Real numbers, independently verified against live listings:
// - Wholesale $4.30: actual AliExpress "Hello Smile Store" listing, 7-pair
//   (14 strip / 7 session) purple teeth whitening strips, live price at
//   time of writing.
// - Retail $22.99: actual TikTok Shop list price for the identical 14-strip
//   / 7-session configuration of the current top-selling purple whitening
//   strips product in this category (992K+ sold). Same product shape,
//   independently verified, not the same listing.
// - Markup/savings computed with the exact formula scan.ts uses, not hand-picked.
// Product name is generic ("Purple Teeth Whitening Strips") rather than a
// brand name, matching how the real engine identifies products and for the
// same reason: this card is not naming a specific real business.
//
// The card renders "VERIFIED REFERENCE RECORD" in place of a timestamp. It
// used to carry a hardcoded date, which was three problems at once: it was a
// claim the numbers were captured at that instant, it aged visibly, and it
// told any visitor roughly when this site went up.
const DEMO_DATA: VerdictData = {
  verdict: "HIGH_MARKUP",
  mode: "VERDICT",
  matchConfidence: "exact",
  retailPrice: 22.99,
  wholesalePrice: 4.30,
  markup: 435,
  savings: 18.69,
  productTitle: "Purple Teeth Whitening Strips (14ct / 7 sessions)",
  // A local asset in public/demo, deliberately not a hotlinked third-party
  // product photo: a permanent marketing asset on your own site should be an
  // image you hold the rights to, not something scraped from a retailer
  // listing and served from your domain.
  productImageUrl: "/demo/purple-whitening-strips.jpg",
  isDemo: true,
};

export default function StaticVerdictDemo() {
  const [isMobile, setIsMobile] = useState(true);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 600);
    check(); // run immediately on mount
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <div style={{ marginBottom: "28px" }}>
      <div style={{
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: "9px",
        color: "rgba(184,160,232,0.3)",
        letterSpacing: "2px",
        textTransform: "uppercase",
        marginBottom: "16px",
        textAlign: "center",
      }}>
        VERIFIED REFERENCE SCAN
      </div>
      <div style={{
        borderRadius: "20px",
        animation: "alienGlow 6s ease-in-out infinite",
      }}>
        <VerdictCard data={DEMO_DATA} animate={true} compact={isMobile} />
      </div>
    </div>
  );
}
