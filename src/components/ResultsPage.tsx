"use client";

import { useRef, useState, useEffect } from "react";
import VerdictCard, { VerdictData, VerdictType, CardMode, MatchConfidence } from "@/components/VerdictCard";
import SoundToggle from "@/components/SoundToggle";
import { track } from "@/lib/track";

interface ScanResult {
  found: boolean;
  shippingNote?: string;
  /** Present once the verdict has a permanent record in the ledger. */
  scanId?: string | null;
  mode: CardMode;
  matchConfidence: MatchConfidence;
  priceSource: "screenshot" | "estimated" | "shopping";
  sourceProduct: {
    title: string; price: number; currency: string;
    imageUrl: string; productUrl: string; affiliateUrl: string;
    linkIsDirect?: boolean;
    platform: string;
  };
  analysis: {
    retailEstimate: number; markup: number;
    verdict: VerdictType;
    savings: number; savingsPercent: number;
    confidence: "high" | "medium" | "low";
    retailSource: "screenshot" | "estimated" | "shopping";
  };
}

export default function ResultsPage({
  result, onReset, isPaid, onUpgrade,
}: {
  result: ScanResult;
  onReset: () => void;
  isPaid: boolean;
  onUpgrade: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(true); // default true, corrected on mount
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 600);
    // The previous version registered the listener but never ran the check,
    // so a desktop visitor got the compact phone card until they happened to
    // resize the window. Every scan on every desktop rendered the wrong
    // layout: smaller verdict type, tighter padding, a 68px markup ring where
    // an 88px one belongs.
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { sourceProduct: sp, analysis: an, mode, matchConfidence } = result;

  // Stable for the life of this result. Computed during render, it changed
  // on every re-render, so the id printed on the card was different from the
  // one in the image a person saved a second later.
  const [scanId] = useState(() => `SCAN #${Date.now().toString(36).toUpperCase()}`);
  // Pinned once, when this result first rendered. The card stamps itself with
  // this rather than reading the clock on every render, so the time printed on
  // the card and the time baked into the saved PNG are the same time.
  const [resolvedAt] = useState(() => Date.now());

  const verdictData: VerdictData = {
    verdict: an.verdict,
    mode,
    matchConfidence,
    retailPrice: an.retailEstimate,
    wholesalePrice: sp.price,
    markup: an.markup,
    savings: an.savings,
    productTitle: sp.title || "Product identified",
    productImageUrl: sp.imageUrl || undefined,
    productUrl: sp.productUrl || undefined,
    platform: sp.platform || undefined,
    retailSource: an.retailSource,
    confidence: an.confidence,
    scanId,
    recordedAt: resolvedAt,
    isDemo: false,
  };

  const generateCardImage = async (): Promise<File | null> => {
    try {
      const { default: html2canvas } = await import("html2canvas");
      if (!cardRef.current) return null;
      // Wait for web fonts to finish loading before capture. Without this,
      // a capture that races the font load falls back to a system font for
      // that frame, producing a shared image with different typography
      // than what the visitor is actually looking at on screen.
      if (typeof document !== "undefined" && document.fonts?.ready) {
        await document.fonts.ready;
      }
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: "#07070e", scale: 3, useCORS: true, allowTaint: true, logging: false,
      });
      return new Promise((resolve) => {
        canvas.toBlob(blob => {
          if (!blob) { resolve(null); return; }
          resolve(new File([blob], "bustedlab-verdict.png", { type: "image/png" }));
        }, "image/png");
      });
    } catch {
      return null;
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const file = await generateCardImage();
      if (!file) { setSaving(false); return; }

      // Try Web Share API with file first - saves directly to Photos on iOS
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "BustedLab Verdict" });
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
          setSaving(false);
          return;
        } catch { /* user cancelled or not supported, fall through to download */ }
      }

      // Fallback: trigger download
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bustedlab-verdict.png";
      a.click();
      URL.revokeObjectURL(url);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  };

  // The permanent address for this verdict. Present only when the ledger write
  // succeeded, so a share never points at a page that does not exist.
  const permalink = result.scanId
    ? `${typeof window === "undefined" ? "https://bustedlab.com" : window.location.origin}/scan/${result.scanId}`
    : "https://bustedlab.com";

  // The dollar figure is the hook, not the percentage: "$47.10 above market"
  // is a number a person feels, "412% markup" is a statistic. Both go in,
  // dollars first, because this string is the caption on every repost.
  //
  // The URL is the change that matters. Sharing only a PNG was a dead end: an
  // image cannot be clicked, indexed or attributed, so every repost of a
  // verdict card leaked its whole audience. The link now travels with the
  // image and lands on this exact verdict.
  const shareText = mode === "VERDICT"
    ? `$${an.savings.toFixed(2)} above market on this one. ${an.markup}% markup, verified.`
    : `Ran this through BustedLab. Closest listing found: $${sp.price.toFixed(2)}.`;

  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  const handleShare = async () => {
    // Counted on the tap, not on completion. Whether the share sheet is then
    // confirmed or dismissed is invisible to the page on every platform, so
    // counting "completed shares" would mean counting nothing at all. This
    // measures intent to share, which is the number the growth loop turns on.
    track("share_tapped");
    setSharing(true);
    try {
      // Try sharing the actual image file first
      const file = await generateCardImage();
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: "BustedLab",
            text: shareText,
            url: permalink,
          });
          setSharing(false);
          return;
        } catch { /* cancelled, fall through */ }
      }

      // Fallback: share the link on its own. Still an entry point.
      if (navigator.share) {
        try {
          await navigator.share({ title: "BustedLab", text: shareText, url: permalink });
          setSharing(false);
          return;
        } catch { /* fall through to clipboard */ }
      }

      // Last resort: copy to clipboard
      await navigator.clipboard.writeText(`${shareText} ${permalink}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* ignore */ }
    setSharing(false);
  };

  const isUnresolved = mode === "UNRESOLVED";

  return (
    <main style={{ position: "relative", zIndex: 1, minHeight: "100vh", paddingBottom: "40px", fontFamily: "var(--font-sans), sans-serif" }}>
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", zIndex: 2, position: "relative", borderBottom: "1px solid rgba(255,255,255,0.055)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
          {/* Fixed 32px mark. next/image would add an optimizer round trip
              and a srcset for an asset that is never rendered at another size.
              eslint-disable-next-line @next/next/no-img-element */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpg" alt="BustedLab" width={40} height={40} style={{ borderRadius: "9px", display: "block", objectFit: "cover" }} />
          <span style={{ fontFamily: "var(--font-display), sans-serif", fontWeight: "800", fontSize: "20px", letterSpacing: "-0.5px", color: "#eeeef6" }}>BustedLab</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <SoundToggle />
          <button onClick={onReset} style={{ background: "transparent", color: "rgba(238,238,246,0.5)", border: "1px solid rgba(255,255,255,0.09)", cursor: "pointer", transition: "color 0.18s ease, border-color 0.18s ease", fontFamily: "var(--font-sans), sans-serif", borderRadius: "8px", padding: "7px 16px", fontSize: "13px" }}>
            {isUnresolved ? "Try another scan" : "Check another"}
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: "520px", margin: "0 auto", padding: "16px 24px 60px", zIndex: 2, position: "relative" }}>
        <div style={{ marginBottom: "12px" }}>
          <VerdictCard data={verdictData} animate={true} compact={isMobile} cardRef={cardRef} sound />
        </div>

        {isUnresolved ? (
          <div style={{ textAlign: "center", padding: "8px 4px 20px", fontSize: "13px", color: "rgba(238,238,246,0.45)", lineHeight: "1.6" }}>
            Try a screenshot with the product more centered and in focus, or paste a direct product link instead.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
              <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: "14px", borderRadius: "10px", fontSize: "14px", fontWeight: "600", fontFamily: "var(--font-display), sans-serif", background: "linear-gradient(135deg, #9d7fd4, #7b5ea7)", color: "white", border: "none", cursor: "pointer", transition: "all 0.18s ease", opacity: saving ? 0.5 : 1 }}>
                {saving ? "Generating..." : saved ? "Saved" : "Save to photos"}
              </button>
              <button onClick={handleShare} disabled={sharing} style={{ padding: "14px 16px", borderRadius: "10px", fontSize: "14px", background: "transparent", color: copied ? "#10d9a0" : "rgba(238,238,246,0.5)", border: copied ? "1px solid rgba(16,217,160,0.3)" : "1px solid rgba(255,255,255,0.09)", cursor: sharing ? "default" : "pointer", transition: "color 0.18s ease, border-color 0.18s ease", fontFamily: "var(--font-sans), sans-serif", opacity: sharing ? 0.5 : 1 }}>
                {sharing ? "Rendering" : copied ? "Copied" : "Share"}
              </button>
            </div>

            {result.scanId && (
              <a
                href={`/scan/${result.scanId}`}
                style={{
                  display: "block", width: "100%", padding: "12px", borderRadius: "10px",
                  fontSize: "13px", textAlign: "center", textDecoration: "none", fontWeight: "500",
                  marginBottom: "8px", color: "rgba(184,160,232,0.75)",
                  border: "1px solid rgba(123,94,167,0.28)", background: "rgba(123,94,167,0.06)",
                  fontFamily: "var(--font-sans), sans-serif",
                }}
              >
                Permanent link to this verdict
              </a>
            )}

            {sp.affiliateUrl && (
              <>
                <a
                  href={sp.affiliateUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={mode === "VERDICT" ? {
                    display: "block", width: "100%", padding: "12px", borderRadius: "10px",
                    fontSize: "13px", textAlign: "center", textDecoration: "none", fontWeight: "500",
                    marginBottom: "8px", color: "rgba(238,238,246,0.5)",
                    border: "1px solid rgba(255,255,255,0.09)", background: "transparent",
                    transition: "all 0.18s ease", fontFamily: "var(--font-sans), sans-serif",
                  } : {
                    // FINDER mode's whole purpose is reaching this exact
                    // link fast, so it gets a real button here in the page
                    // itself - not inside the card, which also renders as a
                    // static shareable image where a button would be a dead
                    // click waiting to happen.
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                    width: "100%", padding: "14px", borderRadius: "12px",
                    background: "linear-gradient(135deg, #38bdf8, #2563eb)",
                    color: "#07070e", fontWeight: "700", fontSize: "14px",
                    fontFamily: "var(--font-display), sans-serif", textDecoration: "none",
                    marginBottom: "8px", boxShadow: "0 0 20px rgba(56,189,248,0.25)",
                  }}
                >
                  {mode === "VERDICT" ? "View wholesale source" : (
                    <>
                      {sp.linkIsDirect === false ? "Search this listing" : "Go to this price"}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M7 17L17 7M17 7H9M17 7V15" stroke="#07070e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </>
                  )}
                </a>
                {result.shippingNote && (
                  <p style={{ fontSize: "10px", color: "rgba(238,238,246,0.25)", textAlign: "center", marginBottom: "16px", lineHeight: "1.5" }}>
                    {result.shippingNote}
                  </p>
                )}
              </>
            )}

            {!isPaid && (
              <div style={{ borderRadius: "14px", padding: "20px", textAlign: "center", background: "linear-gradient(135deg, rgba(123,94,167,0.08) 0%, transparent 100%)", border: "1px solid rgba(123,94,167,0.15)", backgroundColor: "#10101e" }}>
                <p style={{ fontWeight: "600", fontSize: "14px", marginBottom: "4px", color: "#eeeef6" }}>Running low on scans?</p>
                <p style={{ fontSize: "13px", color: "rgba(238,238,246,0.5)", marginBottom: "16px", lineHeight: "1.55" }}>
                  One-time $4.99. Unlimited scans. HD verdict cards. Forever.
                </p>
                <button onClick={onUpgrade} style={{ padding: "11px 28px", borderRadius: "9px", fontSize: "14px", fontWeight: "700", fontFamily: "var(--font-display), sans-serif", background: "linear-gradient(135deg, #9d7fd4, #7b5ea7)", color: "white", border: "none", cursor: "pointer" }}>
                  Get unlimited access
                </button>
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: "24px", padding: "14px 16px", borderRadius: "10px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <p style={{ fontSize: "10px", color: "rgba(238,238,246,0.2)", lineHeight: "1.6", marginBottom: "6px" }}>
            <strong style={{ color: "rgba(238,238,246,0.25)" }}>Market Analysis Disclaimer:</strong> All pricing data shown reflects publicly available wholesale listings for similar or comparable products. Results are editorial market analysis, not verified statements about any specific product or brand.
          </p>
          <p style={{ fontSize: "10px", color: "rgba(238,238,246,0.2)", lineHeight: "1.6" }}>
            <strong style={{ color: "rgba(238,238,246,0.25)" }}>Affiliate Disclosure:</strong> Some outbound links may be affiliate links. Where they are, BustedLab may earn a commission at no additional cost to you.{" "}
            <a href="/terms" style={{ color: "rgba(184,160,232,0.5)", textDecoration: "none" }}>Terms</a>
            {" "}&middot;{" "}
            <a href="/privacy" style={{ color: "rgba(184,160,232,0.5)", textDecoration: "none" }}>Privacy</a>
          </p>
        </div>
      </div>
    </main>
  );
}
