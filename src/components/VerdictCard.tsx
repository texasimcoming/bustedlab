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
  confidence?: "high" | "medium" | "low";
  scanId?: string;
  isDemo?: boolean;
}

const VERDICT_CONFIG = {
  HIGH_MARKUP: {
    label: "BUSTED",
    accentColor: "#ef4444",
    accentGlow: "rgba(239,68,68,0.35)",
    accentDim: "rgba(239,68,68,0.08)",
    accentBorder: "rgba(239,68,68,0.22)",
    headerBg: "linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.04) 100%)",
    message: "",
  },
  OVERPRICED: {
    label: "OVERPRICED",
    accentColor: "#f59e0b",
    accentGlow: "rgba(245,158,11,0.3)",
    accentDim: "rgba(245,158,11,0.08)",
    accentBorder: "rgba(245,158,11,0.22)",
    headerBg: "linear-gradient(135deg, rgba(245,158,11,0.1) 0%, rgba(245,158,11,0.03) 100%)",
    message: "",
  },
  FAIR: {
    label: "CLEAR",
    accentColor: "#10d9a0",
    accentGlow: "rgba(16,217,160,0.25)",
    accentDim: "rgba(16,217,160,0.08)",
    accentBorder: "rgba(16,217,160,0.2)",
    headerBg: "linear-gradient(135deg, rgba(16,217,160,0.08) 0%, rgba(16,217,160,0.02) 100%)",
    message: "",
  },
  UNVERIFIED: {
    label: "CLOSEST MATCH",
    accentColor: "#38bdf8",
    accentGlow: "rgba(56,189,248,0.28)",
    accentDim: "rgba(56,189,248,0.08)",
    accentBorder: "rgba(56,189,248,0.22)",
    headerBg: "linear-gradient(135deg, rgba(56,189,248,0.1) 0%, rgba(56,189,248,0.03) 100%)",
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

const PLATE_LABEL: Record<MatchConfidence, string> = {
  exact: "PIXEL-MATCH VERIFIED",
  likely: "VISUAL MATCH CONFIRMED",
  unverified: "EXACT ITEM UNCONFIRMED",
};

// The human-voice line — one sentence, computed from the real numbers on
// every render. This is what makes the card readable by a person instead
// of just a computer: a tag and two prices is data, this is a verdict.
function buildMessage(data: VerdictData): string {
  const savings = data.savings.toFixed(2);
  const multiplier = data.wholesalePrice > 0 ? (data.retailPrice / data.wholesalePrice) : 0;

  switch (data.verdict) {
    case "HIGH_MARKUP":
      return `You'd have paid $${savings} more than this is actually worth. That is ${multiplier.toFixed(1)}x the real price.`;
    case "OVERPRICED":
      return `That's $${savings} more than the real price. Steep, but not the worst we've seen.`;
    case "FAIR":
      return "Priced close to what it's actually worth. No major red flags here.";
    case "UNVERIFIED":
    default:
      return `Closest match runs $${data.wholesalePrice.toFixed(2)}. The exact item is not confirmed yet.`;
  }
}

interface Props {
  data: VerdictData;
  animate?: boolean;
  compact?: boolean;
  cardRef?: React.RefObject<HTMLDivElement | null>;
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

export default function VerdictCard({ data, animate = true, compact = false, cardRef }: Props) {
  const [scanComplete, setScanComplete] = useState(!animate);
  const [stampIn, setStampIn] = useState(!animate);
  const [dataIn, setDataIn] = useState(!animate);
  const [scanlinePos, setScanlinePos] = useState(-100);
  const [imageFailed, setImageFailed] = useState(false);

  const cfg = data.mode === "UNRESOLVED" ? UNRESOLVED_CONFIG : VERDICT_CONFIG[data.verdict];
  const now = new Date();
  const timestamp = `${now.toISOString().split("T")[0]} ${now.toTimeString().slice(0, 8)} UTC`;

  useEffect(() => {
    if (!animate) return;
    const startTime = Date.now();
    const duration = 800;
    const raf = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      setScanlinePos(-10 + progress * 120);
      if (progress >= 1) {
        clearInterval(raf);
        setScanComplete(true);
        setTimeout(() => setDataIn(true), 100);
        setTimeout(() => setStampIn(true), 400);
      }
    }, 16);
    return () => clearInterval(raf);
  }, [animate]);

  const isVerdict = data.mode === "VERDICT";
  const isFinder = data.mode === "FINDER";
  const isUnresolved = data.mode === "UNRESOLVED";
  const hasImage = !!data.productImageUrl && !imageFailed;

  return (
    <div
      ref={cardRef}
      style={{
        borderRadius: compact ? "16px" : "20px",
        overflow: "hidden",
        background: "#0d0d1c",
        border: `1px solid ${cfg.accentBorder}`,
        position: "relative",
        boxShadow: scanComplete
          ? `0 0 40px ${cfg.accentGlow}, 0 0 80px ${cfg.accentGlow.replace(/[\d.]+\)$/, "0.1)")}, 0 24px 48px rgba(0,0,0,0.6)`
          : "0 8px 32px rgba(0,0,0,0.4)",
        transition: "box-shadow 0.6s ease",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `radial-gradient(ellipse at 50% 0%, ${cfg.accentDim} 0%, transparent 70%)`,
        zIndex: 0,
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
        <div style={{
          width: compact ? "20px" : "24px", height: compact ? "20px" : "24px",
          borderRadius: "5px", background: "linear-gradient(135deg, #9d7fd4, #7b5ea7)",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="5.5" r="3" stroke="white" strokeWidth="1.5" />
            <path d="M8.5 8L10.5 10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontFamily: "'Space Grotesk', sans-serif", fontSize: compact ? "8px" : "9px", fontWeight: "700",
            color: "rgba(184,160,232,0.65)", letterSpacing: "1.8px", textTransform: "uppercase",
            lineHeight: "1", whiteSpace: "nowrap",
          }}>BUSTEDLAB SCAN</div>
          <div style={{
            fontSize: compact ? "7px" : "8px", color: "rgba(238,238,246,0.22)", letterSpacing: "0.3px",
            marginTop: "2px", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{data.isDemo ? "2026-09-03 14:22:07 UTC" : timestamp}</div>
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
              fontFamily: "'Space Grotesk', sans-serif", fontSize: compact ? "24px" : "28px", fontWeight: "800",
              color: cfg.accentColor, letterSpacing: "-0.5px", marginBottom: "10px",
              opacity: stampIn ? 1 : 0, transition: "opacity 0.3s ease",
            }}>{cfg.label}</div>
            <div style={{ fontSize: compact ? "13px" : "14px", color: "rgba(238,238,246,0.55)", lineHeight: "1.5", maxWidth: "320px", margin: "0 auto" }}>
              {cfg.message}
            </div>
          </div>
        ) : (
          <>
            {/* Verdict headline + markup ring — leads the card */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: compact ? "16px" : "20px", gap: compact ? "10px" : "16px", overflow: "hidden" }}>
              {/* Verdict label */}
              <div style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: compact ? (isFinder ? "17px" : "16px") : (isFinder ? "32px" : "52px"),
                fontWeight: "800", color: cfg.accentColor,
                letterSpacing: compact ? "-0.2px" : "-1.5px", lineHeight: "1",
                textShadow: compact ? `0 0 12px ${cfg.accentGlow}` : `0 0 24px ${cfg.accentGlow}`,
                opacity: stampIn ? 1 : 0, transform: stampIn ? "none" : "scale(1.1)",
                transition: "opacity 0.3s ease, transform 0.3s ease",
                flex: 1, minWidth: 0,
                whiteSpace: "nowrap",
              }}>{cfg.label}</div>

              {/* Markup ring - perfectly sized, same viewBox as container */}
              {!isFinder && (
                <div style={{
                  position: "relative",
                  width: compact ? "52px" : "88px",
                  height: compact ? "52px" : "88px",
                  flexShrink: 0,
                }}>
                  <svg
                    width={compact ? 52 : 88}
                    height={compact ? 52 : 88}
                    viewBox={compact ? "0 0 52 52" : "0 0 88 88"}
                    style={{ position: "absolute", top: 0, left: 0 }}
                  >
                    {compact ? (
                      <>
                        <circle cx="26" cy="26" r="21" fill="none" stroke={cfg.accentBorder} strokeWidth="1.5"/>
                        <circle cx="26" cy="26" r="21" fill="none" stroke={cfg.accentColor} strokeWidth="2"
                          strokeLinecap="round"
                          strokeDasharray={`${Math.min(data.markup / 20, 100) * 1.319} 131.9`}
                          strokeDashoffset="33"
                          transform="rotate(-90 26 26)"
                          style={{ filter: `drop-shadow(0 0 3px ${cfg.accentColor})`, transition: "stroke-dasharray 1s ease" }}
                        />
                      </>
                    ) : (
                      <>
                        <circle cx="44" cy="44" r="37" fill="none" stroke={cfg.accentBorder} strokeWidth="1.5"/>
                        <circle cx="44" cy="44" r="37" fill="none" stroke={cfg.accentColor} strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeDasharray={`${Math.min(data.markup / 20, 100) * 2.325} 232.5`}
                          strokeDashoffset="58.1"
                          transform="rotate(-90 44 44)"
                          style={{ filter: `drop-shadow(0 0 4px ${cfg.accentColor})`, transition: "stroke-dasharray 1s ease" }}
                        />
                      </>
                    )}
                  </svg>
                  <div style={{
                    position: "absolute", inset: 0,
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <div style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: compact ? "10px" : "17px",
                      fontWeight: "800", color: cfg.accentColor,
                      letterSpacing: "-0.5px", lineHeight: "1",
                    }}>
                      {data.markup > 9999 ? "9999+" : `${data.markup}%`}
                    </div>
                    <div style={{
                      fontSize: "7px", color: "rgba(238,238,246,0.3)",
                      letterSpacing: "0.8px", marginTop: "3px",
                      textTransform: "uppercase",
                    }}>markup</div>
                  </div>
                </div>
              )}
            </div>

            {/* Human-voice line — computed, not static copy */}
            <div style={{
              fontSize: compact ? "13px" : "14.5px", color: "rgba(238,238,246,0.68)",
              lineHeight: "1.5", marginBottom: compact ? "16px" : "20px", maxWidth: "94%",
            }}>
              {buildMessage(data)}
            </div>

            {/* Price comparison row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 20px 1fr", gap: compact ? "8px" : "10px", alignItems: "center", marginBottom: compact ? "16px" : "20px" }}>
              <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: compact ? "10px" : "12px", padding: compact ? "11px 13px" : "13px 15px" }}>
                <div style={{ fontSize: compact ? "9px" : "10px", color: "rgba(238,238,246,0.3)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: compact ? "4px" : "5px", fontWeight: "600" }}>
                  Retail asking
                </div>
                <div style={{ position: "relative", display: "inline-block" }}>
                  <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: compact ? "20px" : "24px", fontWeight: "700", color: "#ef4444", letterSpacing: "-0.8px", lineHeight: "1" }}>
                    ${data.retailPrice.toFixed(2)}
                  </div>
                  {isVerdict && (
                    <div style={{ position: "absolute", top: "50%", left: "-2px", right: "-2px", height: "2px", background: "linear-gradient(90deg, transparent, #ef4444, #ef4444, transparent)", marginTop: "-1px", opacity: 0.7 }} />
                  )}
                </div>
              </div>

              <div style={{ textAlign: "center", fontSize: compact ? "9px" : "10px", color: "rgba(238,238,246,0.2)", fontWeight: "600", letterSpacing: "0.5px" }}>VS</div>

              <div style={{ background: "rgba(16,217,160,0.06)", border: "1px solid rgba(16,217,160,0.18)", borderRadius: compact ? "10px" : "12px", padding: compact ? "11px 13px" : "13px 15px" }}>
                <div style={{ fontSize: compact ? "9px" : "10px", color: "rgba(238,238,246,0.3)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: compact ? "4px" : "5px", fontWeight: "600" }}>
                  {isVerdict ? "Wholesale from" : "Closest listing"}
                </div>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: compact ? "20px" : "24px", fontWeight: "700", color: "#10d9a0", letterSpacing: "-0.8px", lineHeight: "1" }}>
                  ${data.wholesalePrice.toFixed(2)}
                </div>
              </div>
            </div>

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
                    <img
                      src={data.productImageUrl}
                      alt=""
                      onError={() => setImageFailed(true)}
                      style={{
                        width: "100%", height: "100%", objectFit: "cover",
                        filter: "none",
                      }}
                    />
                  ) : (
                    <EmptyThumb color={cfg.accentColor} />
                  )}
                </div>
                <MiniBrackets color={cfg.accentColor} confirmed={isVerdict} />
                <MiniConfidenceBadge confirmed={isVerdict} color={cfg.accentColor} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: compact ? "11.5px" : "12.5px", fontWeight: "600", color: "rgba(238,238,246,0.75)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: "3px",
                }}>{data.productTitle}</div>
                <div style={{
                  fontFamily: "monospace", fontSize: compact ? "8px" : "8.5px",
                  color: cfg.accentColor, letterSpacing: "0.6px", opacity: 0.85,
                }}>{PLATE_LABEL[data.matchConfidence]}</div>
              </div>
            </div>

            <div style={{ fontSize: compact ? "8px" : "9px", color: "rgba(238,238,246,0.18)", lineHeight: "1.5", letterSpacing: "0.2px" }}>
              {isVerdict
                ? "Market analysis based on publicly available wholesale listings for the identified product."
                : "Market analysis based on publicly available listings for a visually similar product. Exact item not confirmed."}
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
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: "700", fontSize: compact ? "10px" : "11px", color: "rgba(184,160,232,0.6)", letterSpacing: "0.5px" }}>
            bustedlab.com
          </span>
        </div>
        {data.scanId && (
          <div style={{ fontFamily: "monospace", fontSize: compact ? "8px" : "9px", color: "rgba(238,238,246,0.15)", letterSpacing: "0.5px" }}>
            {data.scanId}
          </div>
        )}
      </div>
    </div>
  );
}
