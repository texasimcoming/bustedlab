"use client";

/**
 * VerdictCard - THE weapon.
 * Used in both the demo (landing page) and actual results.
 *
 * LAYOUT — verdict leads, evidence follows:
 * The product photo used to be a full-width hero at the top — bigger than
 * the verdict itself, which made the card read as a product ad ("we sell
 * whitening strips") instead of an analysis result. It's now a small proof
 * strip near the bottom: still real, still carrying the containment-bracket
 * /confidence-pill visual language, but sized and placed as supporting
 * evidence, not the headline.
 *
 * The headline is now: verdict label + markup ring, immediately followed by
 * one computed sentence in a human voice — the thing a person actually
 * reads before deciding to screenshot this. Not copy someone wrote once and
 * left static: it's built from the real numbers on every render, so it's
 * exact to the scan, not a template line dropped over any result.
 *
 * Three real states, not one fixed shape:
 *  - VERDICT   -> visually verified match. Full markup %, full confidence.
 *  - FINDER    -> a plausible match found, not confirmed identical.
 *                 Shown as "closest match", never given a confident markup claim.
 *  - UNRESOLVED-> nothing verifiable found. No fabricated number, ever.
 */

import { useEffect, useState } from "react";
import { playVerdictTone } from "@/lib/sound";
import { buildFinderMessage, buildMessage, evidenceNote, formatOriginalPrice, plateLabel } from "@/lib/verdict-copy";

export type VerdictType = "HIGH_MARKUP" | "OVERPRICED" | "FAIR" | "UNVERIFIED";
export type CardMode = "VERDICT" | "FINDER" | "UNRESOLVED";
export type MatchConfidence = "exact" | "likely" | "unverified";

export interface VerdictData {
  verdict: VerdictType;
  mode: CardMode;
  matchConfidence: MatchConfidence;
  retailPrice: number;
  wholesalePrice: number;
  markup: number;
  savings: number;
  productTitle: string;
  productImageUrl?: string;
  productUrl?: string;
  platform?: string;
  retailSource?: "screenshot" | "estimated" | "shopping";
  /**
   * The asking price as the seller showed it, when that was not in US
   * dollars. Every number on the card is in USD; this is printed under the
   * converted asking price so the card never shows a figure in a currency
   * nobody charged.
   */
  retailOriginal?: { amount: number; currency: string; asOf: string };
  confidence?: "high" | "medium" | "low";
  scanId?: string;
  isDemo?: boolean;
  /**
   * When this scan happened, as epoch milliseconds.
   *
   * Supplied by archived records. Without it the card stamps itself with the
   * current time, which is correct for a scan that just ran and plainly wrong
   * on a permanent page: a verdict shared three months ago would render with
   * today's date on it, and the one artifact whose entire authority rests on
   * being a dated measurement would be quietly lying about when it was taken.
   */
  recordedAt?: number;
}

const VERDICT_CONFIG = {
  HIGH_MARKUP: {
    label: "BUSTED",
    accentColor: "#ff4d5e",
    accentGlow: "rgba(255,77,94,0.35)",
    accentDim: "rgba(255,77,94,0.08)",
    accentBorder: "rgba(255,77,94,0.22)",
    headerBg: "linear-gradient(135deg, rgba(255,77,94,0.12) 0%, rgba(255,77,94,0.04) 100%)",
    flashColor: "rgba(255,77,94,0.08)",
    message: "",
  },
  OVERPRICED: {
    label: "OVERPRICED",
    accentColor: "#f59e0b",
    accentGlow: "rgba(245,158,11,0.3)",
    accentDim: "rgba(245,158,11,0.08)",
    accentBorder: "rgba(245,158,11,0.22)",
    headerBg: "linear-gradient(135deg, rgba(245,158,11,0.1) 0%, rgba(245,158,11,0.03) 100%)",
    flashColor: "rgba(245,158,11,0.07)",
    message: "",
  },
  FAIR: {
    label: "FAIR PRICE",
    accentColor: "#10d9a0",
    accentGlow: "rgba(16,217,160,0.25)",
    accentDim: "rgba(16,217,160,0.08)",
    accentBorder: "rgba(16,217,160,0.2)",
    headerBg: "linear-gradient(135deg, rgba(16,217,160,0.08) 0%, rgba(16,217,160,0.02) 100%)",
    flashColor: "rgba(16,217,160,0.06)",
    message: "",
  },
  UNVERIFIED: {
    label: "CLOSEST MATCH",
    accentColor: "#38bdf8",
    accentGlow: "rgba(56,189,248,0.28)",
    accentDim: "rgba(56,189,248,0.08)",
    accentBorder: "rgba(56,189,248,0.22)",
    headerBg: "linear-gradient(135deg, rgba(56,189,248,0.1) 0%, rgba(56,189,248,0.03) 100%)",
    flashColor: "rgba(56,189,248,0.07)",
    message: "",
  },
};

const UNRESOLVED_CONFIG = {
  label: "NO CONFIRMED MATCH",
  accentColor: "#8b8b9e",
  accentGlow: "rgba(139,139,158,0.18)",
  accentDim: "rgba(139,139,158,0.07)",
  accentBorder: "rgba(139,139,158,0.2)",
  headerBg: "linear-gradient(135deg, rgba(139,139,158,0.08) 0%, rgba(139,139,158,0.02) 100%)",
  message: "Couldn't verify this one. Try a clearer screenshot or a direct product link.",
};

interface Props {
  data: VerdictData;
  animate?: boolean;
  compact?: boolean;
  cardRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * Fire the confirmation tone when the verdict stamps.
   *
   * Defaults to false, and that default is load-bearing. This same component
   * renders the reference card on the landing page, which animates on mount
   * with no user gesture behind it. A card that made noise on page load would
   * be hostile, would be blocked by every browser's autoplay policy anyway,
   * and would spend the one sound this product owns on someone who did not
   * ask for it. Only a card that came back from a scan the person actually
   * started passes true.
   */
  sound?: boolean;
}

// Small proof-strip brackets — a compact version of the corner brackets
// ScanningScreen draws around the live photo, sized for a thumbnail instead
// of a hero panel.
function MiniBrackets({ color, confirmed }: { color: string; confirmed: boolean }) {
  const dash = confirmed ? undefined : "3 3";
  return (
    <svg width="100%" height="100%" viewBox="0 0 64 64" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <path d="M2 12 L2 2 L12 2" stroke={color} strokeWidth="1.6" strokeLinecap="round" fill="none" strokeDasharray={dash} opacity={confirmed ? 0.9 : 0.6} />
      <path d="M52 2 L62 2 L62 12" stroke={color} strokeWidth="1.6" strokeLinecap="round" fill="none" strokeDasharray={dash} opacity={confirmed ? 0.9 : 0.6} />
      <path d="M2 52 L2 62 L12 62" stroke={color} strokeWidth="1.6" strokeLinecap="round" fill="none" strokeDasharray={dash} opacity={confirmed ? 0.9 : 0.6} />
      <path d="M62 52 L62 62 L52 62" stroke={color} strokeWidth="1.6" strokeLinecap="round" fill="none" strokeDasharray={dash} opacity={confirmed ? 0.9 : 0.6} />
    </svg>
  );
}

function MiniConfidenceBadge({ confirmed, color }: { confirmed: boolean; color: string }) {
  return (
    <div style={{
      position: "absolute", top: "-5px", right: "-5px",
      width: "17px", height: "17px", borderRadius: "50%",
      background: "#0a0a12", border: `1.3px solid ${color}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: confirmed ? `0 0 6px ${color}` : "none",
    }}>
      {confirmed ? (
        <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
          <path d="M2 6.2L4.6 9L10 2.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <span style={{ color, fontSize: "9px", fontWeight: 700, lineHeight: 1 }}>?</span>
      )}
    </div>
  );
}

function EmptyThumb({ color }: { color: string }) {
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: `repeating-linear-gradient(135deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 2px, transparent 2px, transparent 10px)`,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" opacity={0.35}>
        <circle cx="9" cy="9" r="6" stroke={color} strokeWidth="1.3" strokeDasharray="2 3" />
      </svg>
    </div>
  );
}

// How much of the markup ring is lit.
//
// The previous mapping was markup/20 capped at 100, then multiplied by a
// hand-measured circumference with a magic dash offset bolted on. It put a
// 60% markup at 3% of the ring (invisible) and started the arc at three
// o'clock for no reason. Markup is unbounded and heavily skewed, so a linear
// scale wastes the whole dial on the tail: a square-root curve against a
// 1000% ceiling keeps the ordinary 50-200% range legible while still leaving
// somewhere for a 900% outlier to go.
// html2canvas does not implement text-overflow: ellipsis. The card is
// captured through it to produce the shareable PNG, so a title relying on CSS
// truncation renders in the export as the full string running off the edge of
// the card and clipped mid-glyph. Truncating in JS makes the browser and the
// exported image agree.
function clampTitle(title: string, compact: boolean): string {
  const max = compact ? 32 : 46;
  const clean = (title || "").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).replace(/[\s,;:|-]+$/, "") + "\u2026";
}

function ringFraction(markup: number): number {
  if (!Number.isFinite(markup) || markup <= 0) return 0;
  return Math.min(Math.sqrt(markup / 1000), 1);
}

export default function VerdictCard({ data, animate = true, compact = false, cardRef, sound = false }: Props) {
  const [scanComplete, setScanComplete] = useState(!animate);
  const [stampIn, setStampIn] = useState(!animate);
  const [dataIn, setDataIn] = useState(!animate);
  const [scanlinePos, setScanlinePos] = useState(-100);
  const [imageFailed, setImageFailed] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
  const [numbersIn, setNumbersIn] = useState(!animate);

  const cfg = data.mode === "UNRESOLVED" ? UNRESOLVED_CONFIG : VERDICT_CONFIG[data.verdict];
  // toTimeString() returns the BROWSER'S LOCAL time. An earlier version
  // pasted it next to a hardcoded "UTC" suffix, so every card shipped a
  // timestamp that was wrong by the reader's offset and labelled with a
  // timezone it was not in. Both halves come from the ISO string now.
  //
  // The moment is passed in, never read from the clock during render.
  // Date.now() in a render body is impure: it returns something different on
  // every re-render, so the stamp on screen could drift away from the stamp
  // baked into the PNG a person saved from it seconds later. All three callers
  // supply it: the results page pins the moment the scan resolved, an archived
  // page passes the moment it was recorded, and the reference card renders a
  // fixed label instead of a time.
  const iso = data.recordedAt === undefined ? null : new Date(data.recordedAt).toISOString();
  const timestamp = iso ? `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC` : "";

  useEffect(() => {
    if (!animate) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const startTime = Date.now();
    const duration = 520;
    const raf = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      setScanlinePos(-10 + progress * 120);
      if (progress >= 1) {
        clearInterval(raf);
        // The card lands here. The 90ms slam class is applied by this state
        // change; nothing about it eases, fades, or settles.
        setScanComplete(true);
        setShowFlash(true);
        // Same frame as the slam and the flash. Visual and audio confirmation
        // are one event, not two: a tone that trails the stamp by even 100ms
        // reads as a reaction to the card rather than as part of it.
        if (sound) {
          playVerdictTone(data.mode === "UNRESOLVED" ? "UNVERIFIED" : data.verdict);
        }
        // One frame of verdict colour across the viewport. The class runs a
        // 90ms in-and-out, and the node is unmounted right after so it can
        // never linger as a coloured wash over the page, which is what the
        // previous 600ms hold on a "forwards" fade actually produced.
        timers.push(setTimeout(() => setShowFlash(false), 110));
        timers.push(setTimeout(() => setDataIn(true), 60));
        timers.push(setTimeout(() => {
          setStampIn(true);
          // Numbers resolve staggered, from below, after the label.
          timers.push(setTimeout(() => setNumbersIn(true), 70));
        }, 230));
      }
    }, 16);
    return () => {
      clearInterval(raf);
      timers.forEach(clearTimeout);
    };
  }, [animate, sound, data.mode, data.verdict]);

  const isVerdict = data.mode === "VERDICT";
  const isFinder = data.mode === "FINDER";
  const isUnresolved = data.mode === "UNRESOLVED";
  const hasImage = !!data.productImageUrl && !imageFailed;

  return (
    <>
    {/* Screen flash - one frame of verdict color filling the viewport */}
    {showFlash && (
      <div
        className="verdict-flash"
        style={{
          position: "fixed", inset: 0, zIndex: 9998,
          background: (cfg as Record<string, string>).flashColor || "rgba(138,111,240,0.06)",
          pointerEvents: "none",
          opacity: 0,
        }}
      />
    )}
    <div
      ref={cardRef}
      className={scanComplete ? "verdict-slam" : ""}
      style={{
        borderRadius: compact ? "16px" : "20px",
        overflow: "hidden",
        background: "linear-gradient(180deg, #110e1e 0%, #0b0915 100%)",
        border: `1px solid ${cfg.accentBorder}`,
        position: "relative",
        boxShadow: scanComplete
          ? `0 0 40px ${cfg.accentGlow}, 0 0 80px ${cfg.accentGlow.replace(/[\d.]+\)$/, "0.1)")}, 0 24px 48px rgba(0,0,0,0.6)`
          : "0 8px 32px rgba(0,0,0,0.4)",
        transition: "box-shadow 0.6s ease",
        fontFamily: "var(--font-sans), sans-serif",
      }}
    >
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `radial-gradient(ellipse at 50% 0%, ${cfg.accentDim} 0%, transparent 70%)`,
        zIndex: 0,
      }} />
      {/* The measurement line: the laser through the logo, drawn along the
          card's top edge in the verdict's colour once the verdict lands. */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: "2px", zIndex: 2, pointerEvents: "none",
        background: `linear-gradient(90deg, transparent 0%, ${cfg.accentColor} 30%, ${cfg.accentColor} 70%, transparent 100%)`,
        opacity: scanComplete ? 0.9 : 0, transition: "opacity 0.3s ease",
      }} />

      {animate && !scanComplete && (
        <div style={{
          position: "absolute", left: 0, right: 0, zIndex: 10,
          height: "3px", top: `${scanlinePos}%`,
          background: `linear-gradient(90deg, transparent, ${cfg.accentColor}, ${cfg.accentColor}, transparent)`,
          boxShadow: `0 0 12px ${cfg.accentColor}`,
          transition: "top 0.016s linear",
          pointerEvents: "none",
        }} />
      )}

      {/* TOP HEADER BAR */}
      <div style={{
        background: cfg.headerBg,
        borderBottom: `1px solid ${cfg.accentBorder}`,
        padding: compact ? "10px 16px" : "12px 20px",
        display: "flex", alignItems: "center", gap: "8px",
        position: "relative", zIndex: 1,
      }}>
        {/* The brand mark itself, same-origin so the saved image carries it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-120.webp" alt="" width={compact ? 26 : 30} height={compact ? 26 : 30}
          style={{ display: "block", width: compact ? "26px" : "30px", height: compact ? "26px" : "30px", borderRadius: "7px", flexShrink: 0, objectFit: "cover" }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px", fontWeight: "600",
            color: "rgba(214,201,255,0.95)", letterSpacing: "1.8px", textTransform: "uppercase",
            lineHeight: "1.4", whiteSpace: "nowrap",
          }}>BUSTEDLAB SCAN</div>
          <div style={{
            fontSize: "11px", color: "rgba(245,243,255,0.66)", letterSpacing: "0.3px",
            marginTop: "2px", fontFamily: "var(--font-mono), ui-monospace, monospace", lineHeight: "1.5",
          }}
          // The results page pins its moment in a state initialiser, which
          // runs once on the server and once on the client and can straddle a
          // second boundary between the two.
          suppressHydrationWarning
          >{data.isDemo ? "EXAMPLE" : timestamp}</div>
        </div>
      </div>

      {/* MAIN SECTION */}
      <div style={{
        padding: compact ? "18px 16px" : "22px 20px",
        position: "relative", zIndex: 1,
        opacity: dataIn ? 1 : 0,
        transform: dataIn ? "none" : "translateY(6px)",
        transition: "opacity 0.4s ease, transform 0.4s ease",
      }}>

        {isUnresolved ? (
          <div style={{ textAlign: "center", padding: compact ? "10px 0 6px" : "16px 0 10px" }}>
            <div style={{
              fontFamily: "var(--font-display), sans-serif", fontSize: compact ? "24px" : "28px", fontWeight: "800",
              color: cfg.accentColor, letterSpacing: "1.5px", marginBottom: "10px",
              opacity: stampIn ? 1 : 0, transition: "opacity 0.3s ease",
            }}>{cfg.label}</div>
            <div style={{ fontSize: compact ? "13px" : "14px", color: "rgba(245,243,255,0.55)", lineHeight: "1.5", maxWidth: "320px", margin: "0 auto" }}>
              {cfg.message}
            </div>
          </div>
        ) : (
          <>
            {isFinder ? (
              /* ═══ FINDER MODE — genuinely different from VERDICT: no
                 markup ring, no verdict message, no retail-vs-wholesale
                 comparison. Just the label, the cheapest confirmed price,
                 and where it was found. This is the "just get me the
                 cheapest link" promise the intent toggle makes - it was
                 previously the same elaborate card with one ring hidden,
                 which quietly broke that promise. ═══ */
              <>
                {/* Locator glyph - a crosshair that has already found its
                    target, distinct from the scanning reticle used
                    elsewhere. VERDICT mode measures a gap with a ring;
                    FINDER mode marks a location with a lock. Different
                    visual grammar for a genuinely different job. */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: compact ? "14px" : "18px" }}>
                  <div style={{ position: "relative", width: compact ? "36px" : "42px", height: compact ? "36px" : "42px", flexShrink: 0 }}>
                    <svg width="100%" height="100%" viewBox="0 0 42 42" fill="none" aria-hidden="true">
                      <circle cx="21" cy="21" r="18" stroke="#38bdf8" strokeWidth="1.2" opacity="0.35" />
                      <circle cx="21" cy="21" r="11" stroke="#38bdf8" strokeWidth="1.2" opacity="0.55" />
                      <path d="M21 3 L21 9" stroke="#38bdf8" strokeWidth="1.4" strokeLinecap="round" />
                      <path d="M21 33 L21 39" stroke="#38bdf8" strokeWidth="1.4" strokeLinecap="round" />
                      <path d="M3 21 L9 21" stroke="#38bdf8" strokeWidth="1.4" strokeLinecap="round" />
                      <path d="M33 21 L39 21" stroke="#38bdf8" strokeWidth="1.4" strokeLinecap="round" />
                      <circle cx="21" cy="21" r="6" fill="#38bdf8" opacity="0.18" />
                      <circle cx="21" cy="21" r="4.2" fill="#38bdf8" opacity="0.35" />
                      <circle cx="21" cy="21" r="3" fill="#38bdf8" />
                    </svg>
                  </div>
                  <div style={{
                    fontFamily: "var(--font-display), sans-serif",
                    fontSize: compact ? "24px" : "30px",
                    fontWeight: "800", color: cfg.accentColor,
                    letterSpacing: "0", lineHeight: "1.08",
                    textShadow: `0 0 ${compact ? "14px" : "24px"} ${cfg.accentGlow}`,
                    opacity: stampIn ? 1 : 0, transform: stampIn ? "none" : "scale(1.1)",
                    transition: "opacity 0.3s ease, transform 0.3s ease",
                  }}>{cfg.label}</div>
                </div>

                {/* Personalised computed sentence - FINDER's own voice,
                    never the verdict voice. */}
                <div style={{
                  fontSize: compact ? "13px" : "14.5px", color: "rgba(245,243,255,0.68)",
                  lineHeight: "1.5", marginBottom: compact ? "16px" : "20px", maxWidth: "94%",
                }}>
                  {buildFinderMessage(data)}
                </div>

                <div style={{
                  background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.18)",
                  borderRadius: compact ? "12px" : "14px", padding: compact ? "16px" : "20px",
                  marginBottom: compact ? "12px" : "14px", textAlign: "center",
                }}>
                  <div style={{ fontSize: "11px", color: "rgba(245,243,255,0.66)", textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: "8px", fontWeight: "600" }}>
                    Cheapest price found
                  </div>
                  <div style={{
                    fontFamily: "var(--font-display), sans-serif", fontSize: compact ? "32px" : "40px", fontWeight: "800",
                    color: "#38bdf8", letterSpacing: "-1px", lineHeight: "1",
                    opacity: numbersIn ? 1 : 0, transform: numbersIn ? "none" : "translateY(4px)",
                    transition: "opacity 0.25s ease 0.05s, transform 0.25s ease 0.05s",
                  }}>
                    ${data.wholesalePrice.toFixed(2)}
                  </div>
                  {data.platform && (
                    <div style={{ fontSize: compact ? "11.5px" : "12.5px", color: "rgba(245,243,255,0.66)", marginTop: "8px" }}>
                      at {data.platform}
                    </div>
                  )}
                </div>

              </>
            ) : (
            <>
            {/* Verdict headline + markup ring — leads the card */}
            <div style={{
                display: "grid",
                gridTemplateColumns: compact ? "1fr 76px" : "1fr 88px",
                alignItems: "center",
                gap: compact ? "12px" : "16px",
                marginBottom: compact ? "16px" : "20px",
              }}>
              {/* Verdict label - grid column 1 */}
              <div>
                <div style={{
                  fontFamily: "var(--font-display), sans-serif",
                  fontSize: cfg.label.length > 7
                    ? (compact ? "31px" : "42px")
                    : (compact ? "44px" : "58px"),
                  fontWeight: "800", color: cfg.accentColor,
                  letterSpacing: "-0.01em", lineHeight: "1.04",
                  paddingBottom: "2px",
                  textShadow: `0 0 ${compact ? "14px" : "24px"} ${cfg.accentGlow}`,
                  opacity: stampIn ? 1 : 0, transform: stampIn ? "none" : "scale(1.1)",
                  transition: "opacity 0.3s ease, transform 0.3s ease",
                  whiteSpace: "nowrap",
                }}>{cfg.label}</div>
                {isVerdict && (
                  <div style={{
                    fontFamily: "var(--font-display), sans-serif",
                    fontSize: compact ? "14px" : "16px",
                    fontWeight: "700",
                    color: data.verdict === "FAIR" ? "#10d9a0" : data.verdict === "HIGH_MARKUP" ? "#ff6b79" : "#f59e0b",
                    letterSpacing: "-0.01em",
                    lineHeight: "1.35",
                    marginTop: compact ? "4px" : "6px",
                    opacity: numbersIn ? 1 : 0,
                    transform: numbersIn ? "none" : "translateY(3px)",
                    transition: "opacity 0.2s ease 0.1s, transform 0.2s ease 0.1s",
                  }}>
                    {data.verdict === "FAIR"
                      ? `$${data.savings.toFixed(2)} spread`
                      : `Save $${data.savings.toFixed(2)}`}
                  </div>
                )}
              </div>

              {/* Markup ring */}
              {!isFinder && (
                <div style={{
                  position: "relative",
                  width: compact ? "76px" : "88px",
                  height: compact ? "76px" : "88px",
                  flexShrink: 0,
                }}>
                  <svg
                    width={compact ? 76 : 88}
                    height={compact ? 76 : 88}
                    viewBox={compact ? "0 0 76 76" : "0 0 88 88"}
                    style={{ position: "absolute", top: 0, left: 0 }}
                  >
                    {(() => {
                      const c = compact ? 38 : 44;
                      const r = compact ? 30 : 36;
                      const circumference = 2 * Math.PI * r;
                      const filled = circumference * ringFraction(data.markup);
                      const dash = `${filled.toFixed(2)} ${circumference.toFixed(2)}`;
                      // The dial: 40 graduations just outside the ring, every
                      // fifth one longer, so it reads as an instrument's
                      // scale rather than a progress spinner.
                      const ticks = Array.from({ length: 40 }, (_, i) => {
                        const a = (i / 40) * 2 * Math.PI - Math.PI / 2;
                        const major = i % 5 === 0;
                        const r1 = r + 3.5, r2 = r + (major ? 7 : 5.5);
                        return (
                          <line key={i}
                            x1={(c + r1 * Math.cos(a)).toFixed(2)} y1={(c + r1 * Math.sin(a)).toFixed(2)}
                            x2={(c + r2 * Math.cos(a)).toFixed(2)} y2={(c + r2 * Math.sin(a)).toFixed(2)}
                            stroke={major ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.14)"} strokeWidth="1" />
                        );
                      });
                      return (
                        <>
                          {ticks}
                          <circle cx={c} cy={c} r={r} fill="none" stroke={cfg.accentBorder} strokeWidth="1.5" />
                          {/* Glow simulated with a wider, softer duplicate stroke underneath
                              rather than a CSS filter - html2canvas does not reliably
                              reproduce filter: drop-shadow on SVG, which would make the
                              shared/downloaded card look flatter than the live page. */}
                          <circle
                            cx={c} cy={c} r={r} fill="none" stroke={cfg.accentColor} strokeWidth="6"
                            strokeLinecap="round" strokeDasharray={dash}
                            transform={`rotate(-90 ${c} ${c})`}
                            opacity="0.28"
                          />
                          <circle
                            cx={c} cy={c} r={r} fill="none" stroke={cfg.accentColor} strokeWidth="2.5"
                            strokeLinecap="round" strokeDasharray={dash}
                            transform={`rotate(-90 ${c} ${c})`}
                            style={{ transition: "stroke-dasharray 0.6s linear" }}
                          />
                        </>
                      );
                    })()}
                  </svg>
                  <div style={{
                    position: "absolute", inset: 0,
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <div style={{
                      fontFamily: "var(--font-display), sans-serif",
                      fontSize: compact ? "15px" : "17px",
                      fontWeight: "800", color: cfg.accentColor,
                      letterSpacing: "-0.5px", lineHeight: "1.2",
                      opacity: numbersIn ? 1 : 0,
                      transform: numbersIn ? "none" : "translateY(4px)",
                      transition: "opacity 0.25s ease, transform 0.25s ease",
                    }}>
                      {data.markup > 9999 ? "9999+" : `${data.markup}%`}
                    </div>
                    <div style={{
                      fontSize: "11px", color: "rgba(245,243,255,0.7)",
                      letterSpacing: "0.4px", marginTop: "2px",
                      textTransform: "uppercase",
                    }}>markup</div>
                  </div>
                </div>
              )}
            </div>

            {/* Human-voice line — computed, not static copy */}
            <div style={{
              fontSize: compact ? "13px" : "14.5px", color: "rgba(245,243,255,0.68)",
              lineHeight: "1.5", marginBottom: compact ? "16px" : "20px", maxWidth: "94%",
            }}>
              {buildMessage(data)}
            </div>

            {/* Price comparison row */}
            {/* The two boxes stretch to one height and hold their prices on
                the bottom edge, so when a label wraps on a narrow phone the
                two prices still line up. */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 28px 1fr", gap: compact ? "8px" : "10px", alignItems: "stretch", marginBottom: compact ? "16px" : "20px" }}>
              <div style={{ background: "rgba(255,77,94,0.06)", border: "1px solid rgba(255,77,94,0.15)", borderRadius: compact ? "10px" : "12px", padding: compact ? "11px 13px" : "13px 15px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px", color: "rgba(245,243,255,0.7)", textTransform: "uppercase", letterSpacing: compact ? "0.4px" : "1.2px", marginBottom: compact ? "4px" : "6px", fontWeight: "500" }}>
                  Retail asking
                </div>
                {/* The strike is a text decoration rather than a line laid
                    over the number, so it sits on the text wherever the text is
                    drawn: on screen and in the saved image (see "html2canvas"
                    in globals.css for why those used to disagree). */}
                <div>
                <div style={{
                  fontFamily: "var(--font-display), sans-serif", fontSize: compact ? "21px" : "26px", fontWeight: "750", color: "#ff6b79", letterSpacing: "-0.03em", lineHeight: "1.2", fontVariantNumeric: "tabular-nums",
                  textDecoration: isVerdict ? "line-through" : "none",
                  textDecorationColor: "rgba(255,77,94,0.75)",
                  textDecorationThickness: "2px",
                  opacity: numbersIn ? 1 : 0,
                  transform: numbersIn ? "none" : "translateY(4px)",
                  transition: "opacity 0.25s ease 0.05s, transform 0.25s ease 0.05s",
                }}>
                  ${data.retailPrice.toFixed(2)}
                </div>
                {data.retailOriginal && (
                  <div style={{ fontSize: "11px", color: "rgba(245,243,255,0.66)", marginTop: "3px", fontWeight: 500 }}>
                    {formatOriginalPrice(data.retailOriginal)} on screen
                  </div>
                )}
                </div>
              </div>

              {/* The two prices joined by the laser line, the gap between
                  them literally measured. */}
              <div style={{ position: "relative", alignSelf: "center", height: "22px", margin: compact ? "0 -8px" : "0 -10px" }}>
                <div style={{ position: "absolute", left: 0, right: 0, top: "10px", height: "2px", background: "linear-gradient(90deg, #ff4d5e, #2ee6b0)", boxShadow: "0 0 8px rgba(255,77,94,0.45)" }} />
                <div style={{
                  position: "absolute", left: "50%", top: 0, width: "30px", marginLeft: "-15px", height: "22px", lineHeight: "20px",
                  borderRadius: "11px", background: "#0b0915", border: "1px solid rgba(255,255,255,0.16)",
                  textAlign: "center", fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px", fontWeight: "600",
                  color: "rgba(245,243,255,0.75)", letterSpacing: "0.3px",
                }}>VS</div>
              </div>

              <div style={{ background: "rgba(16,217,160,0.06)", border: "1px solid rgba(16,217,160,0.18)", borderRadius: compact ? "10px" : "12px", padding: compact ? "11px 13px" : "13px 15px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px", color: "rgba(245,243,255,0.7)", textTransform: "uppercase", letterSpacing: compact ? "0.4px" : "1.2px", marginBottom: compact ? "4px" : "6px", fontWeight: "500" }}>
                  {isVerdict ? "Wholesale from" : "Closest listing"}
                </div>
                <div style={{
                  fontFamily: "var(--font-display), sans-serif", fontSize: compact ? "21px" : "26px", fontWeight: "750", color: "#2ee6b0", letterSpacing: "-0.03em", lineHeight: "1.2", fontVariantNumeric: "tabular-nums",
                  opacity: numbersIn ? 1 : 0,
                  transform: numbersIn ? "none" : "translateY(4px)",
                  transition: "opacity 0.25s ease 0.1s, transform 0.25s ease 0.1s",
                }}>
                  ${data.wholesalePrice.toFixed(2)}
                </div>
              </div>
            </div>
            </>
            )}

            {/* ═══ EVIDENCE STRIP — small, at the bottom, proof not headline ═══ */}
            <div style={{
              display: "flex", alignItems: "center", gap: "12px",
              padding: compact ? "9px 11px" : "10px 12px",
              background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: compact ? "10px" : "12px", marginBottom: compact ? "10px" : "12px",
            }}>
              <div style={{ position: "relative", width: compact ? "44px" : "50px", height: compact ? "44px" : "50px", flexShrink: 0, borderRadius: "9px", overflow: "visible" }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: "9px", overflow: "hidden", background: "#050508" }}>
                  {hasImage ? (
                    // Deliberately a plain <img>. This node is captured by
                    // html2canvas to produce the shareable PNG, and next/image
                    // renders a srcset plus a lazy-loading wrapper that the
                    // capture cannot resolve, so the evidence thumbnail comes
                    // out blank in every saved card. The source is already
                    // same-origin through /api/proxy-image, which is what makes
                    // the canvas capture possible at all.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={data.productImageUrl}
                      alt=""
                      onError={() => setImageFailed(true)}
                      style={{
                        display: "block", width: "100%", height: "100%", objectFit: "cover",
                        filter: isFinder ? "saturate(0.35) brightness(0.85)" : "none",
                      }}
                    />
                  ) : (
                    <EmptyThumb color={cfg.accentColor} />
                  )}
                </div>
                <MiniBrackets color={cfg.accentColor} confirmed={isVerdict || data.matchConfidence === "exact"} />
                <MiniConfidenceBadge confirmed={isVerdict || data.matchConfidence === "exact"} color={cfg.accentColor} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: compact ? "11.5px" : "12.5px", fontWeight: "600", color: "rgba(245,243,255,0.75)",
                  lineHeight: "1.45", marginBottom: "3px", wordBreak: "break-word",
                }}>{clampTitle(data.productTitle, compact)}</div>
                {/* The confidence readout is text and nothing else. The bar
                    graphic that used to sit beside it restated the same value
                    a second time in a second visual language, which is noise
                    in a card whose whole job is to be read in two seconds at
                    thumbnail size. */}
                <div style={{
                  fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px",
                  color: cfg.accentColor, letterSpacing: "0.7px", lineHeight: "1.4",
                }}>{plateLabel(data.mode, data.matchConfidence)}</div>
              </div>
            </div>

            <div style={{ fontSize: "11px", color: "rgba(245,243,255,0.62)", lineHeight: "1.5", letterSpacing: "0.2px" }}>
              {evidenceNote(data.mode, data.matchConfidence)}
            </div>
          </>
        )}
      </div>

      {/* BOTTOM BAR */}
      <div style={{
        borderTop: "1px solid rgba(255,255,255,0.05)", padding: compact ? "9px 18px" : "11px 22px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(0,0,0,0.2)", position: "relative", zIndex: 1,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: "#10d9a0", boxShadow: "0 0 4px rgba(16,217,160,0.6)" }} />
          <span style={{ fontFamily: "var(--font-display), sans-serif", fontWeight: "700", fontSize: compact ? "12.5px" : "13.5px", color: "rgba(236,229,255,0.95)", letterSpacing: "-0.01em" }}>
            bustedlab.com
          </span>
        </div>
        {data.scanId && (
          <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px", color: "rgba(245,243,255,0.6)", letterSpacing: "0.5px" }}>
            {data.scanId}
          </div>
        )}
      </div>
    </div>
    </>
  );
}
