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
    accentColor: "#ef4444",
    accentGlow: "rgba(239,68,68,0.35)",
    accentDim: "rgba(239,68,68,0.08)",
    accentBorder: "rgba(239,68,68,0.22)",
    headerBg: "linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.04) 100%)",
    flashColor: "rgba(239,68,68,0.08)",
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

const PLATE_LABEL: Record<MatchConfidence, string> = {
  exact: "PIXEL-MATCH VERIFIED",
  likely: "VISUAL MATCH CONFIRMED",
  unverified: "MATCH NOT CONFIRMED",
};

// THE LINE. The one a person reads before deciding whether to screenshot it.
//
// Computed from the real numbers on every render, never a static template
// dropped over any result. Three rules, and they are not stylistic:
//
//  1. EVERY message states the exact dollar gap. The percentage is the
//     headline; the dollar figure is what a person feels. A card that omits
//     it is a card that gets scrolled past.
//  2. Sharp, human, funny, angry where anger is earned. This is the copy that
//     travels. Clinical language is safe and gets zero reposts, and a verdict
//     nobody shares is a verdict nobody sees. The Terms exist to hold exactly
//     this: everything the Service outputs is framed there as editorial market
//     analysis and opinion, which is what these lines are.
//  3. Every claim stays anchored to something the engine actually measured.
//     The scan found the same product listed elsewhere at a price and compared
//     it to the asking price. So the copy says "it sells for $X", "available
//     at $X", "the market says $X" rather than "they paid $X for it" - the
//     first is an unarguable observation about a public listing, the second is
//     an assertion about a business's internal costs that no scan can see.
//     The measured version is not softer. It is harder, because there is
//     nothing in it to deny.
//
// Calibration is by intensity, not by topic. BUSTED is outrage with receipts.
// OVERPRICED is sharp frustration that never inflates itself into outrage it
// has not earned. FAIR is dry surprise, because honest pricing is rare enough
// to be the story.
// FINDER mode's own voice — deliberately not the verdict voice. VERDICT is
// outrage with receipts; this is confident discovery. There is no gap to
// expose here, no brand to indict — the job is simply "this is the real
// floor price, verified, here it is." The tone is satisfaction, not
// accusation: a target acquired, not a crime uncovered.
//
// Built as three independently-seeded clauses rather than one fixed list,
// the same principle the toast system already uses for its 313,200+
// combinations. Opener x connector x closer gives 288 grammatically clean
// combinations from real data, with no added latency or API cost per scan
// - every sentence is still assembled locally, deterministically, and
// includes the real price and platform every time. Three separate hashes
// (price cents, title character sum, platform character sum) drive the
// three indices so they drift out of sync with each other rather than all
// advancing together, which is what would make a small pool feel like it
// was visibly cycling.
function buildFinderMessage(data: VerdictData): string {
  const price = data.wholesalePrice.toFixed(2);
  const platform = data.platform || "the listing";

  const charSum = (s: string) => s.split("").reduce((a, c) => a + c.charCodeAt(0), 0);

  const OPENERS = [
    `Verified at $${price}.`,
    `Locked onto $${price}.`,
    `The real number: $${price}.`,
    `Target acquired at $${price}.`,
    `Confirmed floor price: $${price}.`,
    `$${price}. That is the real figure.`,
    `Found it at $${price}.`,
    `No guesswork. $${price} is real.`,
  ];

  const CONNECTORS = [
    `Live on ${platform}.`,
    `Available now on ${platform}.`,
    `Checked directly against ${platform}.`,
    `${platform} has it in stock at this price.`,
    `Sourced from ${platform}.`,
    `${platform} confirms it.`,
  ];

  const CLOSERS = [
    `Nothing cheaper we could verify.`,
    `This is as low as it goes right now.`,
    `Not an estimate. A measurement.`,
    `You will not find it lower today.`,
    `This is the floor, not a guess.`,
    `That is the number to act on.`,
  ];

  const priceCents = Math.round(data.wholesalePrice * 100);
  const openerIdx = priceCents % OPENERS.length;
  const connectorIdx = charSum(data.productTitle || "") % CONNECTORS.length;
  const closerIdx = charSum(platform) % CLOSERS.length;

  return `${OPENERS[openerIdx]} ${CONNECTORS[connectorIdx]} ${CLOSERS[closerIdx]}`;
}

function buildMessage(data: VerdictData): string {
  const s = data.savings.toFixed(2);
  const retail = data.retailPrice.toFixed(2);
  const source = data.wholesalePrice.toFixed(2);
  const m = data.wholesalePrice > 0 ? (data.retailPrice / data.wholesalePrice).toFixed(1) : "0";
  const idx = Math.floor((data.savings * 100 + data.retailPrice * 7 + data.markup * 3)) % 20;

  // ── BUSTED. Outrage with receipts. ──
  const HIGH = [
    `It sells for $${source}. They charged you $${retail}. That $${s} gap has a name.`,
    `You were about to pay ${m}x what this actually costs. $${s} of it was the story.`,
    `$${s}. That is what the aesthetic cost you.`,
    `Somebody's rent got paid with your $${s}.`,
    `The product is $${source}. The other $${s} is the ad you fell for.`,
    `$${s} above what everyone else charges. They were betting you would not check.`,
    `${m}x markup, $${s} deep, and the ad had soft lighting.`,
    `A $${source} item in a $${retail} costume. The costume runs $${s}.`,
    `$${s} of that price is not the product. It never was.`,
    `Same item, $${source}, publicly listed. Yours was $${retail}. The logo cost $${s}.`,
    `You nearly funded a $${s} marketing budget. One scan.`,
    `$${s}. Not a discount you missed. A markup you were handed.`,
    `Buy at $${source}, sell at $${retail}. The $${s} in the middle is the entire company.`,
    `${m}x the real price. That is not a margin, that is a personality, and it costs $${s}.`,
    `They called it premium. The market calls it $${source}. You were charged $${s} extra for the adjective.`,
    `$${s}. Screenshot this and send it to whoever recommended it.`,
    `Available right now for $${source}. You were quoted $${retail}. Do what you like with that. ($${s}.)`,
    `They are not selling a product. They are selling a $${retail} price tag with a $${source} product attached. You keep the $${s}.`,
    `${m}x. $${s}. And it ships from the same warehouse as the cheap one.`,
    `$${s} over market. That is not a business model, that is a magic trick, and you just saw the wires.`,
  ];

  // ── OVERPRICED. Sharp frustration. Real, never inflated. ──
  const OVER = [
    `$${s} over. Not a scandal. Still your $${s}.`,
    `Overpriced by $${s}. Not criminal. Just optimistic.`,
    `$${s}. The kind of gap you only catch when something is actually checking.`,
    `They are not robbing you. They are rounding up, by $${s}.`,
    `$${s} above market. Small enough to shrug at. That is exactly the point.`,
    `The market says $${source}. They say $${retail}. Somebody is $${s} braver than the data.`,
    `$${s} of confidence baked into the price.`,
    `Not outrageous. Just $${s} more than it needed to be.`,
    `$${s} over the going rate, and nothing about the product explains it.`,
    `You would not have noticed the $${s}. That is what it was counting on.`,
    `Overpriced by $${s}. Buy it if you want it. Just buy it knowing.`,
    `$${s}. Enough for lunch. They would rather have it than you.`,
    `The listing looks completely normal. The price runs $${s} hot.`,
    `$${s} above what this openly sells for elsewhere. Your call now.`,
    `A $${s} premium for the privilege of not checking.`,
    `Market rate $${source}, asking $${retail}. That is $${s} of nerve.`,
    `$${s} over. Not the worst we have seen today. Not nothing either.`,
    `They are $${s} ahead of the market and hoping nobody keeps score.`,
    `Overpriced by $${s}. Now it is a decision instead of an accident.`,
    `$${s}. Small gap, real gap, your money.`,
  ];

  // ── FAIR. Dry surprise. Honest pricing is rare and the rarity is the story. ──
  const FAIR = [
    `Fair. $${s} off market. We checked twice, because that is unusual.`,
    `Priced honestly. A $${s} spread. We are as surprised as you are.`,
    `No markup theatre. $${s}. Somebody here has principles or terrible margins.`,
    `$${s} from the market floor. That is a business, not a funnel.`,
    `Clean scan. $${s}. Nothing to expose, which is its own kind of news.`,
    `They could have charged you $${retail} and more. They did not. $${s} spread.`,
    `Fair price confirmed at $${s}. Screenshot it anyway. It is rarer than the bad ones.`,
    `$${s}. That is what a normal margin looks like, in case you had forgotten.`,
    `We came here to find a markup. We found $${s} and a straight answer.`,
    `Actually fair. $${s} of honest margin and no story underneath it.`,
    `$${s}. Either the margins are thin or the ethics are intact. Either way it passes.`,
    `Priced at what it costs plus $${s}. Revolutionary, apparently.`,
    `No inflation, no theatre, $${s}. Buy it and stop worrying.`,
    `The market price and the asking price agree within $${s}. Frame this.`,
    `$${s} spread. This seller is not running the play everyone else is running.`,
    `Fair. $${s}. We ran it twice because the first result looked like a mistake.`,
    `$${s} above cost and honest about it. That should not be remarkable.`,
    `Nothing hidden here. $${s}, and the price is just the price.`,
    `$${s}. You are not subsidising anyone's ad spend on this one.`,
    `Clean. $${s}. Enjoy the rare sensation of not being worked.`,
  ];

  switch (data.verdict) {
    case "HIGH_MARKUP": return HIGH[idx % 20];
    case "OVERPRICED": return OVER[idx % 20];
    case "FAIR": return FAIR[idx % 20];
    default: return `No confirmed asking price to compare against. Closest listing found runs $${source}.`;
  }
}

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
          background: (cfg as Record<string, string>).flashColor || "rgba(123,94,167,0.06)",
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
        background: "#0d0d1c",
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
            fontFamily: "var(--font-display), sans-serif", fontSize: compact ? "8px" : "9px", fontWeight: "700",
            color: "rgba(184,160,232,0.65)", letterSpacing: "1.8px", textTransform: "uppercase",
            lineHeight: "1.4", whiteSpace: "nowrap",
          }}>BUSTEDLAB SCAN</div>
          <div style={{
            fontSize: compact ? "7px" : "8px", color: "rgba(238,238,246,0.22)", letterSpacing: "0.3px",
            marginTop: "2px", fontFamily: "var(--font-mono), ui-monospace, monospace", lineHeight: "1.5",
          }}
          // The results page pins its moment in a state initialiser, which
          // runs once on the server and once on the client and can straddle a
          // second boundary between the two.
          suppressHydrationWarning
          >{data.isDemo ? "VERIFIED REFERENCE RECORD" : timestamp}</div>
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
            <div style={{ fontSize: compact ? "13px" : "14px", color: "rgba(238,238,246,0.55)", lineHeight: "1.5", maxWidth: "320px", margin: "0 auto" }}>
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
                    letterSpacing: compact ? "1.5px" : "2.5px", lineHeight: "1.12",
                    textShadow: `0 0 ${compact ? "14px" : "24px"} ${cfg.accentGlow}`,
                    opacity: stampIn ? 1 : 0, transform: stampIn ? "none" : "scale(1.1)",
                    transition: "opacity 0.3s ease, transform 0.3s ease",
                  }}>{cfg.label}</div>
                </div>

                {/* Personalised computed sentence - FINDER's own voice,
                    never the verdict voice. */}
                <div style={{
                  fontSize: compact ? "13px" : "14.5px", color: "rgba(238,238,246,0.68)",
                  lineHeight: "1.5", marginBottom: compact ? "16px" : "20px", maxWidth: "94%",
                }}>
                  {buildFinderMessage(data)}
                </div>

                <div style={{
                  background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.18)",
                  borderRadius: compact ? "12px" : "14px", padding: compact ? "16px" : "20px",
                  marginBottom: compact ? "12px" : "14px", textAlign: "center",
                }}>
                  <div style={{ fontSize: compact ? "9px" : "10px", color: "rgba(238,238,246,0.35)", textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: "8px", fontWeight: "600" }}>
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
                    <div style={{ fontSize: compact ? "11px" : "12px", color: "rgba(238,238,246,0.4)", marginTop: "8px" }}>
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
                gridTemplateColumns: compact ? "1fr 68px" : "1fr 88px",
                alignItems: "center",
                gap: compact ? "12px" : "16px",
                marginBottom: compact ? "16px" : "20px",
              }}>
              {/* Verdict label - grid column 1 */}
              <div>
                <div style={{
                  fontFamily: "var(--font-display), sans-serif",
                  fontSize: compact ? (isFinder ? "22px" : "38px") : (isFinder ? "30px" : "48px"),
                  fontWeight: "800", color: cfg.accentColor,
                  letterSpacing: compact ? "1.5px" : "3px", lineHeight: "1.12",
                  paddingBottom: "2px",
                  textShadow: `0 0 ${compact ? "14px" : "24px"} ${cfg.accentGlow}`,
                  opacity: stampIn ? 1 : 0, transform: stampIn ? "none" : "scale(1.1)",
                  transition: "opacity 0.3s ease, transform 0.3s ease",
                  whiteSpace: "nowrap",
                }}>{cfg.label}</div>
                {isVerdict && (
                  <div style={{
                    fontFamily: "var(--font-display), sans-serif",
                    fontSize: compact ? "13px" : "15px",
                    fontWeight: "700",
                    color: data.verdict === "FAIR" ? "#10d9a0" : data.verdict === "HIGH_MARKUP" ? "#ef4444" : "#f59e0b",
                    letterSpacing: "-0.3px",
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
                  width: compact ? "68px" : "88px",
                  height: compact ? "68px" : "88px",
                  flexShrink: 0,
                }}>
                  <svg
                    width={compact ? 68 : 88}
                    height={compact ? 68 : 88}
                    viewBox={compact ? "0 0 68 68" : "0 0 88 88"}
                    style={{ position: "absolute", top: 0, left: 0 }}
                  >
                    {(() => {
                      const c = compact ? 34 : 44;
                      const r = compact ? 28 : 37;
                      const circumference = 2 * Math.PI * r;
                      const filled = circumference * ringFraction(data.markup);
                      const dash = `${filled.toFixed(2)} ${circumference.toFixed(2)}`;
                      return (
                        <>
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
                      fontSize: compact ? "13px" : "17px",
                      fontWeight: "800", color: cfg.accentColor,
                      letterSpacing: "-0.5px", lineHeight: "1.2",
                      opacity: numbersIn ? 1 : 0,
                      transform: numbersIn ? "none" : "translateY(4px)",
                      transition: "opacity 0.25s ease, transform 0.25s ease",
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
                  <div style={{
                    fontFamily: "var(--font-display), sans-serif", fontSize: compact ? "20px" : "24px", fontWeight: "700", color: "#ef4444", letterSpacing: "-0.8px", lineHeight: "1.2",
                    opacity: numbersIn ? 1 : 0,
                    transform: numbersIn ? "none" : "translateY(4px)",
                    transition: "opacity 0.25s ease 0.05s, transform 0.25s ease 0.05s",
                  }}>
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
                <div style={{
                  fontFamily: "var(--font-display), sans-serif", fontSize: compact ? "20px" : "24px", fontWeight: "700", color: "#10d9a0", letterSpacing: "-0.8px", lineHeight: "1.2",
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
                        width: "100%", height: "100%", objectFit: "cover",
                        filter: isFinder ? "saturate(0.35) brightness(0.85)" : "none",
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
                  lineHeight: "1.45", marginBottom: "3px", wordBreak: "break-word",
                }}>{clampTitle(data.productTitle, compact)}</div>
                {/* The confidence readout is text and nothing else. The bar
                    graphic that used to sit beside it restated the same value
                    a second time in a second visual language, which is noise
                    in a card whose whole job is to be read in two seconds at
                    thumbnail size. */}
                <div style={{
                  fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: compact ? "8px" : "8.5px",
                  color: cfg.accentColor, letterSpacing: "0.7px", opacity: 0.85, lineHeight: "1.4",
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
          <span style={{ fontFamily: "var(--font-display), sans-serif", fontWeight: "700", fontSize: compact ? "10px" : "11px", color: "rgba(184,160,232,0.6)", letterSpacing: "0.5px" }}>
            bustedlab.com
          </span>
        </div>
        {data.scanId && (
          <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: compact ? "8px" : "9px", color: "rgba(238,238,246,0.15)", letterSpacing: "0.5px" }}>
            {data.scanId}
          </div>
        )}
      </div>
    </div>
    </>
  );
}
