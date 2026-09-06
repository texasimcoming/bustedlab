"use client";

import { useRef, useState } from "react";
import VerdictCard, { VerdictData, VerdictType, CardMode, MatchConfidence } from "@/components/VerdictCard";

interface ScanResult {
  found: boolean;
  mode: CardMode;
  matchConfidence: MatchConfidence;
  priceSource: "screenshot" | "estimated" | "shopping";
  sourceProduct: {
    title: string; price: number; currency: string;
    imageUrl: string; productUrl: string; affiliateUrl: string;
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
  result, preview, onReset, isPaid, onUpgrade,
}: {
  result: ScanResult;
  preview: string | null;
  onReset: () => void;
  isPaid: boolean;
  onUpgrade: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { sourceProduct: sp, analysis: an, mode, matchConfidence } = result;

  // Deterministic scan id from a real timestamp — never a fabricated random number
  const scanId = `SCAN #${Date.now().toString(36).toUpperCase()}`;

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
    isDemo: false,
  };

  const generateCardImage = async (): Promise<File | null> => {
    try {
      const { default: html2canvas } = await import("html2canvas");
      if (!cardRef.current) return null;
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

  const shareText = mode === "VERDICT"
    ? `Just scanned a product. ${an.markup}% markup above verified wholesale price. Check yours: bustedlab.com`
    : `Ran this through BustedLab — check what things actually cost before you buy: bustedlab.com`;

  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  const handleShare = async () => {
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
          });
          setSharing(false);
          return;
        } catch { /* cancelled, fall through */ }
      }

      // Fallback: share URL
      if (navigator.share) {
        try {
          await navigator.share({ title: "BustedLab", text: shareText, url: "https://bustedlab.com" });
          setSharing(false);
          return;
        } catch { /* fall through to clipboard */ }
      }

      // Last resort: copy to clipboard
      await navigator.clipboard.writeText(`${shareText} https://bustedlab.com`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* ignore */ }
    setSharing(false);
  };

  const isUnresolved = mode === "UNRESOLVED";

  return (
    <main style={{ position: "relative", zIndex: 1, minHeight: "100vh", paddingBottom: "40px", fontFamily: "'Inter', sans-serif" }}>
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", zIndex: 2, position: "relative", borderBottom: "1px solid rgba(255,255,255,0.055)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
          <img src="/logo.jpg" alt="BustedLab" width={32} height={32} style={{ borderRadius: "8px", display: "block", objectFit: "cover" }} />
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: "700", fontSize: "16px", letterSpacing: "-0.4px", color: "#eeeef6" }}>BustedLab</span>
        </div>
        <button onClick={onReset} style={{ background: "transparent", color: "rgba(238,238,246,0.5)", border: "1px solid rgba(255,255,255,0.09)", cursor: "pointer", transition: "all 0.18s ease", fontFamily: "'Inter', sans-serif", borderRadius: "8px", padding: "7px 16px", fontSize: "13px" }}>
          {isUnresolved ? "Try another scan" : "Check another"}
        </button>
      </nav>

      <div style={{ maxWidth: "520px", margin: "0 auto", padding: "16px 24px 60px", zIndex: 2, position: "relative" }}>
        <div style={{ marginBottom: "12px" }}>
          <VerdictCard data={verdictData} animate={true} compact={false} cardRef={cardRef} />
        </div>

        {isUnresolved ? (
          <div style={{ textAlign: "center", padding: "8px 4px 20px", fontSize: "13px", color: "rgba(238,238,246,0.45)", lineHeight: "1.6" }}>
            Try a screenshot with the product more centered and in focus, or paste a direct product link instead.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
              <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: "14px", borderRadius: "10px", fontSize: "14px", fontWeight: "600", fontFamily: "'Space Grotesk', sans-serif", background: "linear-gradient(135deg, #9d7fd4, #7b5ea7)", color: "white", border: "none", cursor: "pointer", transition: "all 0.18s ease", opacity: saving ? 0.5 : 1 }}>
                {saving ? "Generating..." : saved ? "Saved" : "Save to photos"}
              </button>
              <button onClick={handleShare} style={{ padding: "14px 16px", borderRadius: "10px", fontSize: "14px", background: "transparent", color: copied ? "#10d9a0" : "rgba(238,238,246,0.5)", border: copied ? "1px solid rgba(16,217,160,0.3)" : "1px solid rgba(255,255,255,0.09)", cursor: "pointer", transition: "all 0.18s ease", fontFamily: "'Inter', sans-serif" }}>
                {copied ? "Copied!" : "Share"}
              </button>
            </div>

            {sp.affiliateUrl && (
              <a href={sp.affiliateUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block", width: "100%", padding: "12px", borderRadius: "10px", fontSize: "13px", textAlign: "center", textDecoration: "none", fontWeight: "500", marginBottom: "20px", color: "rgba(238,238,246,0.5)", border: "1px solid rgba(255,255,255,0.09)", background: "transparent", transition: "all 0.18s ease", fontFamily: "'Inter', sans-serif" }}>
                {mode === "VERDICT" ? "View wholesale source" : "View closest listing found"}
              </a>
            )}

            {!isPaid && (
              <div style={{ borderRadius: "14px", padding: "20px", textAlign: "center", background: "linear-gradient(135deg, rgba(123,94,167,0.08) 0%, transparent 100%)", border: "1px solid rgba(123,94,167,0.15)", backgroundColor: "#10101e" }}>
                <p style={{ fontWeight: "600", fontSize: "14px", marginBottom: "4px", color: "#eeeef6" }}>Running low on scans?</p>
                <p style={{ fontSize: "13px", color: "rgba(238,238,246,0.5)", marginBottom: "16px", lineHeight: "1.55" }}>
                  One-time $4.99. Unlimited scans. HD verdict cards. Forever.
                </p>
                <button onClick={onUpgrade} style={{ padding: "11px 28px", borderRadius: "9px", fontSize: "14px", fontWeight: "700", fontFamily: "'Space Grotesk', sans-serif", background: "linear-gradient(135deg, #9d7fd4, #7b5ea7)", color: "white", border: "none", cursor: "pointer" }}>
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
            <strong style={{ color: "rgba(238,238,246,0.25)" }}>Affiliate Disclosure:</strong> BustedLab may earn a commission if you purchase through links on this page at no additional cost to you.{" "}
            <a href="/terms" style={{ color: "rgba(184,160,232,0.5)", textDecoration: "none" }}>Terms</a>
            {" "}&middot;{" "}
            <a href="/privacy" style={{ color: "rgba(184,160,232,0.5)", textDecoration: "none" }}>Privacy</a>
          </p>
        </div>
      </div>
    </main>
  );
}
