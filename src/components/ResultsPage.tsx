"use client";

import { useRef, useState, useEffect } from "react";
import VerdictCard, { VerdictData, VerdictType, CardMode, MatchConfidence } from "@/components/VerdictCard";
import SoundToggle from "@/components/SoundToggle";
import { track } from "@/lib/track";
import { conversionNote, shareCaption } from "@/lib/verdict-copy";

interface ScanResult {
  found: boolean;
  shippingNote?: string;
  priceNote?: string;
  /** Present once the verdict has a permanent record in the ledger. */
  scanId?: string | null;
  /** What a "wrong product" report is filed against: the ledger id, or a reference for this answer. */
  scanRef?: string;
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
    retailOriginal?: { amount: number; currency: string; rate: number; asOf: string };
  };
}

export default function ResultsPage({
  result, onReset, isPaid, onUpgrade, onUpgradeIntent,
}: {
  result: ScanResult;
  onReset: () => void;
  isPaid: boolean;
  onUpgrade: () => void;
  // A pointer or focus on the upgrade button, so the checkout script can be
  // fetched before the click lands.
  onUpgradeIntent?: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Read before the first paint: this page only ever renders in the browser
  // (page.tsx loads it with ssr: false), so there is no server render to
  // agree with, and starting from a guess drew the phone card on a desktop
  // for one frame before swapping it.
  const [isMobile, setIsMobile] = useState(() => typeof window === "undefined" || window.innerWidth < 600);
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
  // The result screen actually rendered: the step between the server
  // finishing a scan and anyone seeing it.
  useEffect(() => { track("result_shown"); }, []);
  // "Wrong product? Tell us": one report per result, recorded against the
  // scan (see /api/wrong-product). The link stays outside the card, so it is
  // never in a saved or shared image.
  const [reported, setReported] = useState(false);
  const reportWrongProduct = () => {
    if (reported) return;
    setReported(true);
    const scanRef = result.scanId || result.scanRef;
    if (!scanRef) return;
    fetch("/api/wrong-product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId: scanRef, mode, confidence: matchConfidence }),
      keepalive: true,
    }).catch(() => {});
  };
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
    retailOriginal: mode === "VERDICT" ? an.retailOriginal : undefined,
    confidence: an.confidence,
    scanId,
    recordedAt: resolvedAt,
    isDemo: false,
  };

  // The card as a canvas, at 3x. html2canvas is loaded on first use.
  const captureCard = async (): Promise<HTMLCanvasElement | null> => {
    const { default: html2canvas } = await import("html2canvas");
    if (!cardRef.current) return null;
    // Wait for web fonts to finish loading before capture. Without this,
    // a capture that races the font load falls back to a system font for
    // that frame, producing a shared image with different typography
    // than what the visitor is actually looking at on screen.
    if (typeof document !== "undefined" && document.fonts?.ready) {
      await document.fonts.ready;
    }
    // The text offset html2canvas used to add to every saved card is fixed
    // in globals.css (search "html2canvas"): it measures fonts in the live
    // page, so an option here cannot reach it.
    return html2canvas(cardRef.current, {
      backgroundColor: "#07070e", scale: 3, useCORS: true, allowTaint: true, logging: false,
    });
  };

  const toPng = (canvas: HTMLCanvasElement, name: string) => new Promise<File | null>(resolve => {
    canvas.toBlob(blob => resolve(blob ? new File([blob], name, { type: "image/png" }) : null), "image/png");
  });

  const generateCardImage = async (): Promise<File | null> => {
    try {
      const card = await captureCard();
      return card ? toPng(card, "bustedlab-verdict.png") : null;
    } catch {
      return null;
    }
  };

  // The Stories export: 1080 x 1920, the size Instagram and TikTok stories
  // use, so the card is not letterboxed into a square or cropped. The card
  // sits centred on the page colour with the address underneath, large
  // enough to read on a phone held at arm's length.
  const generateStoryImage = async (): Promise<File | null> => {
    try {
      const card = await captureCard();
      if (!card) return null;
      const W = 1080, H = 1920;
      const story = document.createElement("canvas");
      story.width = W; story.height = H;
      const ctx = story.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#07070e";
      ctx.fillRect(0, 0, W, H);
      const glow = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.9);
      glow.addColorStop(0, "rgba(123,94,167,0.22)");
      glow.addColorStop(1, "rgba(123,94,167,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      const cardW = 920;
      const cardH = Math.round(card.height * (cardW / card.width));
      const maxCardH = 1440;
      const scale = cardH > maxCardH ? maxCardH / cardH : 1;
      const drawW = Math.round(cardW * scale), drawH = Math.round(cardH * scale);
      const x = Math.round((W - drawW) / 2);
      const y = Math.round((H - drawH) / 2) - 90;
      ctx.drawImage(card, x, y, drawW, drawH);

      const display = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "sans-serif";
      const sans = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() || "sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(238,238,246,0.72)";
      ctx.font = `500 38px ${sans}`;
      ctx.fillText("Scan yours at", W / 2, y + drawH + 150);
      ctx.fillStyle = "#c4aff8";
      ctx.font = `700 64px ${display}`;
      ctx.fillText("bustedlab.com", W / 2, y + drawH + 230);
      return toPng(story, "bustedlab-verdict-story.png");
    } catch {
      return null;
    }
  };

  // Saves an image the way each platform allows: the share sheet on phones
  // (which is how an image reaches the camera roll on iOS), a download
  // everywhere else.
  const saveImage = async (file: File) => {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "BustedLab Verdict" });
        return;
      } catch { /* user cancelled or not supported, fall through to download */ }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    // Counted on the tap, like share_tapped: whether the image then reaches
    // the camera roll is invisible to the page.
    track("card_saved");
    setSaving(true);
    try {
      const file = await generateCardImage();
      if (file) {
        await saveImage(file);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  };

  const [storySaving, setStorySaving] = useState(false);
  const handleStory = async () => {
    track("story_saved");
    setStorySaving(true);
    try {
      const file = await generateStoryImage();
      if (file) await saveImage(file);
    } catch (e) {
      console.error(e);
    }
    setStorySaving(false);
  };

  // The permanent address for this verdict. Present only when the ledger write
  // succeeded, so a share never points at a page that does not exist.
  const permalink = result.scanId
    ? `${typeof window === "undefined" ? "https://bustedlab.com" : window.location.origin}/scan/${result.scanId}`
    : "https://bustedlab.com";

  // What travels with the card: see shareCaption in src/lib/verdict-copy.ts.
  // The URL is the part that matters. Sharing only a PNG was a dead end: an
  // image cannot be clicked, indexed or attributed, so every repost leaked its
  // audience. The link travels with the image and lands on this exact verdict.
  const shareText = shareCaption({
    mode, savings: an.savings, markup: an.markup, wholesalePrice: sp.price, hasPermalink: !!result.scanId,
  });

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
          <img src="/logo-120.webp" alt="" width={32} height={32} style={{ borderRadius: "8px", display: "block", objectFit: "cover" }} />
          <span className="nav-wordmark" style={{ fontFamily: "var(--font-display), sans-serif", fontWeight: "800", fontSize: "18px", letterSpacing: "-0.5px", color: "#eeeef6" }}>BustedLab</span>
        </div>
        {/* Sized so the labelled sound toggle and this button fit beside the
            wordmark on a 390px phone without wrapping. */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <SoundToggle />
          <button onClick={onReset} style={{ background: "transparent", color: "rgba(238,238,246,0.7)", border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", transition: "color 0.18s ease, border-color 0.18s ease", fontFamily: "var(--font-sans), sans-serif", borderRadius: "8px", padding: "10px 12px", fontSize: "13px", whiteSpace: "nowrap" }}>
            {/* One label for every result: a no-match ends in its own full
                "Try another scan" button, and the longer label pushed the
                nav past the edge of a 390px phone. */}
            Scan another
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: "520px", margin: "0 auto", padding: "16px 24px 60px", zIndex: 2, position: "relative" }}>
        <div style={{ marginBottom: "12px" }}>
          <VerdictCard data={verdictData} animate={true} compact={isMobile} cardRef={cardRef} sound />
        </div>

        {/* No product was shown on a no-match card, so there is nothing to
            call the wrong product. */}
        {!isUnresolved && (
        <p style={{ textAlign: "center", margin: "-4px 0 12px", fontSize: "12px", lineHeight: "1.5", position: "relative", zIndex: 1 }}>
          {reported ? (
            <span style={{ color: "var(--text-2)" }} role="status">Thanks, noted.</span>
          ) : (
            <button
              type="button"
              onClick={reportWrongProduct}
              style={{ background: "none", border: "none", padding: "10px 6px", margin: "-6px 0", cursor: "pointer", fontSize: "12px", color: "var(--text-2)", textDecoration: "underline", fontFamily: "var(--font-sans), sans-serif" }}
            >
              Wrong product? Tell us
            </button>
          )}
        </p>
        )}

        {isUnresolved ? (
          // A no-match is the one result with nothing to do on it, so it
          // ends in the next step rather than in a dead end: the retry used
          // to live only in the nav corner.
          <div style={{ textAlign: "center", padding: "8px 0 20px" }}>
            <p style={{ fontSize: "13px", color: "var(--text-2)", lineHeight: "1.6", margin: "0 4px 16px" }}>
              Try a screenshot with the product more centered and in focus, or paste a direct product link instead.
            </p>
            <button onClick={onReset} className="btn-primary" style={{ width: "100%", padding: "15px", borderRadius: "12px", fontSize: "15px", fontWeight: "700", fontFamily: "var(--font-display), sans-serif" }}>
              Try another scan
            </button>
          </div>
        ) : (
          <>
            {/* Its own layer: the card above is positioned, so its drop shadow
                otherwise paints on top of this row and greys the buttons out. */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "8px", position: "relative", zIndex: 1 }}>
              <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: "14px", borderRadius: "10px", fontSize: "14px", fontWeight: "600", fontFamily: "var(--font-display), sans-serif", background: "linear-gradient(135deg, #8563c0, #7b5ea7)", color: "white", border: "none", cursor: "pointer", transition: "all 0.18s ease", opacity: saving ? 0.5 : 1 }}>
                {saving ? "Generating..." : saved ? "Saved" : "Save to photos"}
              </button>
              {/* 9:16, for Stories. */}
              <button onClick={handleStory} disabled={storySaving} aria-label="Save for Stories" style={{ padding: "14px 14px", borderRadius: "10px", fontSize: "14px", background: "transparent", color: "rgba(238,238,246,0.8)", border: "1px solid rgba(255,255,255,0.14)", cursor: storySaving ? "default" : "pointer", fontFamily: "var(--font-sans), sans-serif", opacity: storySaving ? 0.5 : 1, whiteSpace: "nowrap" }}>
                {storySaving ? "Rendering" : "Stories"}
              </button>
              <button onClick={handleShare} disabled={sharing} style={{ padding: "14px 16px", borderRadius: "10px", fontSize: "14px", background: "transparent", color: copied ? "#10d9a0" : "rgba(238,238,246,0.8)", border: copied ? "1px solid rgba(16,217,160,0.3)" : "1px solid rgba(255,255,255,0.14)", cursor: sharing ? "default" : "pointer", transition: "color 0.18s ease, border-color 0.18s ease", fontFamily: "var(--font-sans), sans-serif", opacity: sharing ? 0.5 : 1 }}>
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
                {mode === "VERDICT" && an.retailOriginal && (
                  <p style={{ fontSize: "11px", color: "var(--text-2)", textAlign: "center", marginBottom: "8px", lineHeight: "1.5" }}>
                    {conversionNote(an.retailOriginal)}
                  </p>
                )}
                {result.priceNote && (
                  <p style={{ fontSize: "11px", color: "var(--text-2)", textAlign: "center", marginBottom: "8px", lineHeight: "1.5" }}>
                    {result.priceNote}
                  </p>
                )}
                {result.shippingNote && (
                  <p style={{ fontSize: "11px", color: "var(--text-2)", textAlign: "center", marginBottom: "16px", lineHeight: "1.5" }}>
                    {result.shippingNote}
                  </p>
                )}
              </>
            )}

            {!isPaid && (
              <div style={{ borderRadius: "14px", padding: "20px", textAlign: "center", background: "linear-gradient(135deg, rgba(123,94,167,0.08) 0%, transparent 100%)", border: "1px solid rgba(123,94,167,0.15)", backgroundColor: "#10101e" }}>
                <p style={{ fontWeight: "600", fontSize: "14px", marginBottom: "4px", color: "#eeeef6" }}>Running low on scans?</p>
                <p style={{ fontSize: "13px", color: "rgba(238,238,246,0.5)", marginBottom: "16px", lineHeight: "1.55" }}>
                  One-time $4.99. Unlimited scans. Forever.
                </p>
                <button onClick={onUpgrade} onPointerEnter={onUpgradeIntent} onPointerDown={onUpgradeIntent} onFocus={onUpgradeIntent} style={{ padding: "11px 28px", borderRadius: "9px", fontSize: "14px", fontWeight: "700", fontFamily: "var(--font-display), sans-serif", background: "linear-gradient(135deg, #8563c0, #7b5ea7)", color: "white", border: "none", cursor: "pointer" }}>
                  Get unlimited access
                </button>
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: "24px", padding: "14px 16px", borderRadius: "10px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <p style={{ fontSize: "12px", color: "var(--text-3)", lineHeight: "1.6", marginBottom: "6px" }}>
            <strong style={{ color: "var(--text-2)" }}>Market Analysis Disclaimer:</strong> All pricing data shown reflects publicly available wholesale listings for similar or comparable products. Results are editorial market analysis, not verified statements about any specific product or brand.
          </p>
          <p style={{ fontSize: "12px", color: "var(--text-3)", lineHeight: "1.6" }}>
            <strong style={{ color: "var(--text-2)" }}>Affiliate Disclosure:</strong> Some outbound links may be affiliate links. Where they are, BustedLab may earn a commission at no additional cost to you.{" "}
            <a href="/terms" style={{ color: "var(--accent-bright)", textDecoration: "underline" }}>Terms</a>
            {" "}&middot;{" "}
            <a href="/privacy" style={{ color: "var(--accent-bright)", textDecoration: "underline" }}>Privacy</a>
          </p>
        </div>
      </div>
    </main>
  );
}
