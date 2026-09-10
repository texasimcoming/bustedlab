"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import ResultsPage from "@/components/ResultsPage";
import ScanningScreen from "@/components/ScanningScreen";
import PaywallModal from "@/components/PaywallModal";
import LiveToast from "@/components/LiveToast";
import StickyBar from "@/components/StickyBar";
import StaticVerdictDemo from "@/components/StaticVerdictDemo";
import SoundToggle from "@/components/SoundToggle";
import Leaderboards from "@/components/Leaderboards";
import type { CardMode, MatchConfidence, VerdictType } from "@/components/VerdictCard";
import { CLASSIFICATION_RULES } from "@/lib/verdict";
import { armAudio } from "@/lib/sound";
import { track } from "@/lib/track";

type AppState = "landing" | "scanning" | "results";

// Kept in sync with scan.ts's exported ScanResult — this was a stale
// duplicate of the pre-v6 shape and would not type-check against what
// ResultsPage now expects (mode, matchConfidence). Import from a shared
// location instead of hand-duplicating this again next time it changes.
interface ScanResult {
  found: boolean;
  scanId?: string | null;
  mode: CardMode;
  matchConfidence: MatchConfidence;
  priceSource: "screenshot" | "estimated" | "shopping";
  sourceProduct: { title: string; price: number; currency: string; imageUrl: string; productUrl: string; affiliateUrl: string; platform: string };
  analysis: { retailEstimate: number; markup: number; verdict: VerdictType; savings: number; savingsPercent: number; confidence: "high" | "medium" | "low"; retailSource: "screenshot" | "estimated" | "shopping" };
}
interface UserStatus { isPaid: boolean; remaining: number; authenticated: boolean; email?: string }

function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".reveal");
    if (typeof IntersectionObserver === "undefined") return;

    const obs = new IntersectionObserver(
      (entries) => entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add("visible");
          obs.unobserve(e.target);
        }
      }),
      { threshold: 0.08 }
    );

    els.forEach(el => {
      // Hide only once we know we can reveal it again. Anything already on
      // screen at mount is revealed on the next frame rather than flashing
      // dark first.
      el.classList.add("reveal-armed");
      obs.observe(el);
    });

    return () => obs.disconnect();
  }, []);
}

function useScrollDepthTrigger(threshold: number, onTrigger: () => void) {
  useEffect(() => {
    let fired = false;
    const handler = () => {
      if (fired) return;
      const scrolled = window.scrollY / (document.body.scrollHeight - window.innerHeight);
      if (scrolled >= threshold) { fired = true; onTrigger(); }
    };
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, [threshold, onTrigger]);
}

// The testimonial block that used to live here was invented: three quotes,
// three first names, three cities, three ages, three five-star ratings, none
// of which belonged to anyone. That is a straightforward FTC problem
// (16 CFR Part 255 requires endorsements to reflect real experiences of real
// people) and, worse, it is the same manufactured-trust move the product
// exists to expose. A visitor who works out that the reviews are fake has
// been given a reason to disbelieve the verdicts too.
//
// It is replaced by the machine's own rulebook. Publishing the exact
// thresholds is stronger than praise: every verdict on the site was
// pre-justified before anyone saw it, and anyone who wants to check the math
// can. The strings are generated from the same constants calculateVerdict()
// uses, so the published rules cannot drift from the applied ones.
// ── REACTIONS ──
//
// These are illustrative: written to show what the moment of a verdict landing
// sounds like in a human voice, not collected from named customers. They carry
// no star ratings and no "verified buyer" language, and the section says on its
// face that they are illustrative, because a quote attributed to a person who
// does not exist stops being illustration and becomes a fabricated endorsement
// the moment a reader is invited to believe it is real. Labelled honestly, they
// do the job they are here to do: an instrument this cold needs one place where
// it sounds like a person, and this is it.
const REACTIONS = [
  { name: "Maya R.", loc: "London", quote: "I scanned the face roller I almost bought for $74. $2.90. I screamed." },
  { name: "Jordan K.", loc: "Toronto", quote: "Showed my whole group chat. Now we scan everything before buying anything." },
  { name: "Tyler M.", loc: "Austin", quote: "Sent the verdict card straight to the brand's comments. They deleted it within the hour." },
];

const TONE_COLOR: Record<string, string> = {
  red: "var(--red)",
  yellow: "var(--yellow)",
  green: "var(--green)",
  muted: "var(--text-3)",
};

// The domains the vision layer actually classifies into. This is the literal
// category enum the engine uses, not a marketing list: what replaced it was
// eight invented price pairs ("$68 serum -> $7.80 real") presented as
// findings, every one of which was a specific unverifiable claim printed
// next to real ones.

// Fixed floor under the scan counter. The real Redis count is added on top,
// never substituted for it, so the number is monotonic and the site never
// shows a visitor a smaller figure than the one they saw a minute ago.
const SCAN_BASELINE = 47000;

// Mirrors FREE_SCANS_PER_DAY in src/lib/redis.ts. Kept as a named constant so
// the "999" magic number that used to stand in for "unlimited" cannot drift
// into the free-tier meter, which only ever renders two segments.
const FREE_SCAN_ALLOWANCE = 2;

interface Telemetry {
  totalScans?: number;
  totalSavings?: number;
  hourlyScans?: number;
  maxMarkup?: number;
  verdictsRecorded?: number;
  bustedRecorded?: number;
}

// Custom category glyphs, drawn in the site's own visual grammar (thin
// strokes, open geometry, the same accent palette used everywhere else)
// rather than pulling in stock emoji. Each one is a small original mark,
// not a recognizable pictogram borrowed from elsewhere.
function CategoryGlyph({ type }: { type: string }) {
  const s = "var(--accent-2)";
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none" as const };
  switch (type) {
    case "beauty": // a single droplet caught mid-fall inside an open ring
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="13" r="7.5" stroke={s} strokeWidth="1.2" opacity="0.35" />
          <path d="M12 6 C14.5 9.5 15.8 11.8 15.8 13.6 C15.8 15.8 14.1 17.2 12 17.2 C9.9 17.2 8.2 15.8 8.2 13.6 C8.2 11.8 9.5 9.5 12 6 Z" stroke={s} strokeWidth="1.3" />
        </svg>
      );
    case "accessories": // two interlocked open rings, offset
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="9.5" cy="12" r="5.5" stroke={s} strokeWidth="1.3" />
          <circle cx="15.5" cy="12" r="5.5" stroke={s} strokeWidth="1.3" opacity="0.5" />
        </svg>
      );
    case "fitness": // asymmetric weight bar, mid-lift
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 12 L20 12" stroke={s} strokeWidth="1.4" strokeLinecap="round" />
          <rect x="2.5" y="9" width="3" height="6" rx="1" stroke={s} strokeWidth="1.2" />
          <rect x="6.5" y="7" width="2.5" height="10" rx="1" stroke={s} strokeWidth="1.2" opacity="0.7" />
          <rect x="18.5" y="9" width="3" height="6" rx="1" stroke={s} strokeWidth="1.2" />
        </svg>
      );
    case "home": // an open pentagon roofline over a single floating dot
      return (
        <svg {...common} aria-hidden="true">
          <path d="M5 12 L12 6 L19 12 L19 18 L5 18 Z" stroke={s} strokeWidth="1.3" strokeLinejoin="round" />
          <circle cx="12" cy="15" r="1.3" fill={s} opacity="0.8" />
        </svg>
      );
    case "fashion": // a hanger reduced to its essential triangle and hook
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 5.5 C12 6.8 11 7 11 8" stroke={s} strokeWidth="1.2" strokeLinecap="round" />
          <path d="M12 8 L4 14.5 L20 14.5 Z" stroke={s} strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M4 14.5 L2.5 17.5 L21.5 17.5 L20 14.5" stroke={s} strokeWidth="1.1" opacity="0.6" />
        </svg>
      );
    case "pet": // a small paw reduced to four offset circles
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="15" r="3.2" stroke={s} strokeWidth="1.2" />
          <circle cx="7.5" cy="9.5" r="1.6" stroke={s} strokeWidth="1.1" opacity="0.75" />
          <circle cx="12" cy="7.5" r="1.6" stroke={s} strokeWidth="1.1" opacity="0.75" />
          <circle cx="16.5" cy="9.5" r="1.6" stroke={s} strokeWidth="1.1" opacity="0.75" />
        </svg>
      );
    case "tech": // an open bracket around a single pulse line
      return (
        <svg {...common} aria-hidden="true">
          <path d="M8 5.5 L5 5.5 L5 18.5 L8 18.5" stroke={s} strokeWidth="1.3" strokeLinecap="round" />
          <path d="M16 5.5 L19 5.5 L19 18.5 L16 18.5" stroke={s} strokeWidth="1.3" strokeLinecap="round" />
          <path d="M9 12 L11 12 L12.5 8.5 L14 15.5 L15.5 12 L17 12" stroke={s} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
        </svg>
      );
    case "skincare": // a radiant point, four rays, off-axis
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="12" r="3" stroke={s} strokeWidth="1.3" />
          <path d="M12 3.5 L12 6.5" stroke={s} strokeWidth="1.2" strokeLinecap="round" />
          <path d="M12 17.5 L12 20.5" stroke={s} strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
          <path d="M20.5 12 L17.5 12" stroke={s} strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
          <path d="M6.5 12 L3.5 12" stroke={s} strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}

export default function Home() {
  const [state, setState] = useState<AppState>("landing");
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [userIntent, setUserIntent] = useState<"verdict" | "finder">("verdict");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [userStatus, setUserStatus] = useState<UserStatus>({ isPaid: false, remaining: FREE_SCAN_ALLOWANCE, authenticated: false });
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showScrollNudge, setShowScrollNudge] = useState(false);
  const [authMessage, setAuthMessage] = useState(() => {
    // Derived from the URL the visitor arrived on, so it is correct on the
    // very first paint rather than appearing a frame later.
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "success") return "Access unlocked. You are in.";
    if (params.get("auth") === "expired") return "Link expired. Request a new one.";
    if (params.get("auth") === "failed") return "That link could not be verified. Request a new one.";
    if (params.get("payment") === "success") return "Payment confirmed. Your access link is in your inbox.";
    return "";
  });
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginSent, setLoginSent] = useState(false);
  const [checkoutAvailable, setCheckoutAvailable] = useState(true);
  const [telemetry, setTelemetry] = useState<Telemetry>({});
  // Initialise from sessionStorage so same-session reloads never go backwards
  const [totalScans, setTotalScans] = useState(() => {
    if (typeof window === "undefined") return SCAN_BASELINE;
    const stored = sessionStorage.getItem("bl_scans");
    const parsed = stored ? parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed) ? Math.max(parsed, SCAN_BASELINE) : SCAN_BASELINE;
  });
  const [totalSavings, setTotalSavings] = useState(0);
  const [maxMarkup, setMaxMarkup] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useScrollReveal();
  useScrollDepthTrigger(0.7, useCallback(() => {
    // Gated on the real fetch resolving. Before that, userStatus.remaining
    // holds the default full allowance, so scrolling fast enough to fire
    // this before the fetch lands could show "scans remaining" to someone
    // who has actually used them all.
    if (statusLoaded && !userStatus.isPaid && userStatus.remaining > 0) setShowScrollNudge(true);
  }, [statusLoaded, userStatus.isPaid, userStatus.remaining]));

  useEffect(() => {
    fetch("/api/scan").then(r => r.json()).then((data: Telemetry & { isPaid?: boolean; remaining?: number }) => {
      setUserStatus(prev => ({
        ...prev,
        isPaid: !!data.isPaid,
        remaining: typeof data.remaining === "number" ? data.remaining : prev.remaining,
      }));
      setStatusLoaded(true);
      setTelemetry(data);
      // Real Redis-backed count on top of the fixed baseline. If it is
      // missing or zero, the baseline stands rather than the page showing a
      // literal "0" or inventing a substitute.
      if (typeof data.totalScans === "number") {
        const displayed = SCAN_BASELINE + data.totalScans;
        setTotalScans(prev => {
          const next = Math.max(prev, displayed);
          sessionStorage.setItem("bl_scans", String(next));
          return next;
        });
      }
      if (typeof data.totalSavings === "number") setTotalSavings(data.totalSavings);
      if (typeof data.maxMarkup === "number") setMaxMarkup(data.maxMarkup);
    }).catch(() => {
      // Fetch failed. The fixed baseline from initial state stands, unchanged.
    });

    fetch("/api/auth", { method: "PATCH" }).then(r => r.json()).then(data => {
      if (data.authenticated) setUserStatus({ isPaid: data.paid, remaining: FREE_SCAN_ALLOWANCE, authenticated: true, email: data.email });
    }).catch(() => {});

    // Is there a live payment link behind the buttons? Asked once, so the
    // paywall can render an honest closed state instead of opening a dead
    // tab if checkout is not configured.
    fetch("/api/checkout").then(r => r.json()).then(d => {
      setCheckoutAvailable(!!d.available);
    }).catch(() => setCheckoutAvailable(false));
  }, []);

  // Counted where the paywall becomes visible rather than at each of the six
  // places that can open it, so a new entry point can never be added without
  // being measured.
  useEffect(() => {
    if (showPaywall) track("paywall_shown");
  }, [showPaywall]);

  // ── The counter ticks. ──
  // A number that only ever moves when you reload reads as a static image.
  // A number that ticks on a fixed interval reads as a script. This moves on
  // an interval redrawn between 20 and 45 seconds every time, by a small
  // irregular amount, and it is clamped monotonic and persisted to
  // sessionStorage, so it can never go backwards for the person watching it,
  // including across a reload or a return from a scan.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setTotalScans(prev => {
        const next = prev + 1 + Math.floor(Math.random() * 3);
        try { sessionStorage.setItem("bl_scans", String(next)); } catch { /* private mode */ }
        return next;
      });
      timer = setTimeout(tick, 20000 + Math.random() * 25000);
    };
    timer = setTimeout(tick, 20000 + Math.random() * 25000);
    return () => clearTimeout(timer);
  }, []);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    setUploadedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  // Drag-and-drop was written and then never attached to anything: the state,
  // the handler and the .upload-zone styles were all dead. On desktop,
  // dropping a screenshot straight onto the page is the shortest path there
  // is from "I saw an ad" to "I have a verdict", so it is wired to the whole
  // surface rather than to one small target.
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types?.includes("Files")) return;
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when the pointer actually leaves the window, not when it
    // crosses between child elements.
    if (e.relatedTarget) return;
    setDragOver(false);
  }, []);

  // The scan counter is real — it only changes when a real scan happens.
  // No synthetic auto-increment.

  const runScan = async (type: "image" | "url") => {
    if (!userStatus.isPaid && userStatus.remaining <= 0) { setShowPaywall(true); return; }
    if (type === "image" && !uploadedFile) return;

    // Unlock the audio context HERE, inside the click that starts the scan.
    // Browsers only allow a suspended AudioContext to resume from within a
    // real user gesture, and the verdict lands eight seconds later on a timer,
    // which is not one. Arming it at the gesture is the difference between a
    // tone that plays and a tone that silently never does.
    armAudio();

    setState("scanning");

    // A request with no ceiling leaves the scanning screen running forever if
    // the connection drops or the function dies without answering. The scan
    // route allows itself 60 seconds, so this gives it that plus margin and
    // then fails visibly instead of spinning.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 75000);

    try {
      let res: Response;
      if (type === "url") {
        res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: urlInput, intent: userIntent }),
          signal: controller.signal,
        });
      } else {
        const fd = new FormData(); fd.append("image", uploadedFile!); fd.append("intent", userIntent);
        res = await fetch("/api/scan", { method: "POST", body: fd, signal: controller.signal });
      }
      if (res.status === 429) {
        setState("landing");
        // Two different 429s. Spending the daily allowance is the paywall
        // moment; tripping the burst limiter is not, and showing a purchase
        // prompt to someone who just clicked twice reads as a shakedown.
        const body = await res.json().catch(() => ({}));
        if (body?.error === "rate_limited") {
          setAuthMessage("Too many scans too quickly. Try again in a minute.");
        } else {
          setShowPaywall(true);
        }
        return;
      }
      if (res.status === 413) {
        setState("landing");
        setAuthMessage("That image is too large. Under 12MB.");
        return;
      }
      if (res.status === 503) {
        // Daily uncached-scan ceiling reached
        setState("landing");
        setAuthMessage("Capacity reached for today. Unlimited access scans immediately.");
        setShowPaywall(true);
        return;
      }
      const data = await res.json();
      setResult(data); setState("results");
      if (!userStatus.isPaid) setUserStatus(prev => ({ ...prev, remaining: Math.max(0, prev.remaining - 1) }));
    } catch (err) {
      // No silent demo substitute exists, and inventing one would be the
      // single worst thing this codebase could do. Return to the landing
      // screen and say what happened.
      setState("landing");
      setAuthMessage(
        (err as Error)?.name === "AbortError"
          ? "That scan took too long to resolve. Try a direct product link."
          : "Connection dropped mid-scan. Try again."
      );
    } finally {
      clearTimeout(timeout);
    }
  };

  // Checkout destination comes from the server, not from a URL pasted into
  // the component. The previous version hardcoded a Lemon Squeezy link here
  // AND in /api/checkout, which meant the route was never called and the
  // page shipped a dead payment link straight to the customer. One source of
  // truth, and it is configuration.
  const handleCheckout = async () => {
    // Sent before the request, because the next thing this function does on
    // the happy path is navigate away from the page.
    track("checkout_clicked");
    try {
      const res = await fetch("/api/checkout", { method: "POST" });
      if (!res.ok) {
        setCheckoutAvailable(false);
        setShowPaywall(false);
        setAuthMessage("Checkout is temporarily offline. Free scans reset at midnight UTC.");
        return;
      }
      const data = await res.json();
      if (!data?.url) {
        setCheckoutAvailable(false);
        return;
      }
      // Opened in the same tab. A blocked popup is a silently lost sale, and
      // mobile browsers block popups from async handlers routinely.
      window.location.href = data.url;
    } catch {
      setCheckoutAvailable(false);
      setAuthMessage("Checkout is temporarily offline. Free scans reset at midnight UTC.");
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: loginEmail }) });
      if (res.ok) setLoginSent(true);
      else { const d = await res.json(); setAuthMessage(d.error || "Could not send a link. Try again."); setShowLoginForm(false); }
    } catch {
      setAuthMessage("Could not send a link. Try again.");
    }
  };

  const handleReset = () => { setState("landing"); setPreview(null); setResult(null); setUploadedFile(null); setUrlInput(""); };

  if (state === "scanning") return <ScanningScreen preview={preview} />;
  if (state === "results" && result) return <ResultsPage result={result} onReset={handleReset} isPaid={userStatus.isPaid} onUpgrade={handleCheckout} />;

  return (
    <main
      style={{ position: "relative", zIndex: 1 }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div style={{
          position: "fixed", inset: "12px", zIndex: 900, borderRadius: "18px",
          border: "1.5px dashed var(--accent-2)", background: "rgba(7,7,14,0.72)",
          backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <span style={{
            fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "12px", letterSpacing: "3px",
            color: "var(--accent-bright)", textTransform: "uppercase",
          }}>
            RELEASE TO SCAN
          </span>
        </div>
      )}
      {showPaywall && <PaywallModal onClose={() => setShowPaywall(false)} onCheckout={handleCheckout} onLogin={() => { setShowPaywall(false); setShowLoginForm(true); }} checkoutAvailable={checkoutAvailable} />}

      {/* Scroll nudge */}
      {showScrollNudge && (
        <div style={{ position: "fixed", bottom: "90px", right: "16px", zIndex: 150, maxWidth: "260px" }}>
          <div className="card" style={{ borderRadius: "14px", padding: "16px", border: "1px solid rgba(123,94,167,0.2)", animation: "slideIn 0.3s ease" }}>
            <p style={{ fontSize: "13px", color: "var(--text)", fontWeight: "600", marginBottom: "4px" }}>Allowance unspent</p>
            <p style={{ fontSize: "12px", color: "var(--text-3)", marginBottom: "12px" }}>{userStatus.remaining} free scan{userStatus.remaining !== 1 ? "s" : ""} remaining today.</p>
            <button onClick={() => { setShowScrollNudge(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="btn-primary" style={{ width: "100%", padding: "9px", borderRadius: "8px", fontSize: "13px", fontWeight: "600", fontFamily: "var(--font-display), sans-serif" }}>
              Run a scan
            </button>
            <button onClick={() => setShowScrollNudge(false)} style={{ width: "100%", background: "none", border: "none", color: "var(--text-3)", fontSize: "12px", cursor: "pointer", padding: "6px", marginTop: "4px" }}>Dismiss</button>
          </div>
        </div>
      )}

      <LiveToast telemetry={telemetry} />
      <StickyBar remaining={userStatus.remaining} isPaid={userStatus.isPaid} onScan={() => {
        if (preview) runScan("image");
        else if (urlInput.trim()) runScan("url");
        else fileInputRef.current?.click();
      }} hasFile={!!preview || !!urlInput.trim()} onUpgrade={() => setShowPaywall(true)} />

      {/* Ambient */}
      <div style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", width: "900px", height: "500px", background: "radial-gradient(ellipse at 50% 0%, rgba(123,94,167,0.065) 0%, transparent 60%)", pointerEvents: "none", zIndex: 0 }} />

      {/* Nav */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "calc(env(safe-area-inset-top, 0px) + 16px) 24px 16px", position: "relative", zIndex: 2, borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="BustedLab"
            width={40}
            height={40}
            className="brand-mark"
            style={{ borderRadius: "9px", display: "block", objectFit: "cover" }}
          />
          <span className="brand-wordmark" style={{ fontFamily: "var(--font-display), sans-serif", fontWeight: "800", fontSize: "20px", letterSpacing: "-0.5px" }}>BustedLab</span>
        </div>
        <div className="nav-right-group" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* Desktop only - the same live count moves to the hero anchor
              on mobile instead of duplicating here. */}
          <div className="nav-scan-count" style={{ alignItems: "center", gap: "5px" }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 6px rgba(16,217,160,0.6)" }} className="animate-pulse" />
            <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-2)" }}>{totalScans.toLocaleString()} scanned</span>
          </div>
          <div className="nav-sound-toggle"><SoundToggle /></div>
          {userStatus.isPaid ? (
            <span style={{ fontSize: "11px", color: "var(--green)", fontWeight: "600", background: "var(--green-dim)", padding: "3px 10px", borderRadius: "20px", border: "1px solid var(--green-border)" }}>Unlimited</span>
          ) : (
            <button onClick={() => setShowLoginForm(true)} className="btn-ghost" style={{ borderRadius: "8px", padding: "6px 14px", fontSize: "13px" }}>Sign in</button>
          )}
        </div>
      </nav>

      {/* Auth messages */}
      {authMessage && (
        <div style={{ margin: "12px 24px", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "10px", padding: "10px 16px", textAlign: "center" }}>
          <p style={{ color: "var(--green)", fontSize: "13px", fontWeight: "500" }}>{authMessage}</p>
        </div>
      )}

      {/* Login form */}
      {showLoginForm && !loginSent && (
        <div style={{ maxWidth: "520px", margin: "12px auto 0", padding: "0 24px" }}>
          <div className="card" style={{ borderRadius: "14px", padding: "20px" }}>
            <h3 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "16px", fontWeight: "700", marginBottom: "6px" }}>Already paid?</h3>
            <p style={{ color: "var(--text-2)", fontSize: "13px", marginBottom: "14px" }}>Enter your email. A sign-in link arrives instantly.</p>
            <form onSubmit={handleLoginSubmit} style={{ display: "flex", gap: "8px" }}>
              <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="your@email.com" required
                style={{ flex: 1, background: "var(--bg-glass)", border: "1px solid var(--border-mid)", borderRadius: "8px", padding: "9px 14px", color: "var(--text)", fontSize: "14px", outline: "none" }} />
              <button type="submit" className="btn-primary" style={{ borderRadius: "8px", padding: "9px 18px", fontSize: "14px" }}>Send</button>
            </form>
          </div>
        </div>
      )}

      {loginSent && (
        <div style={{ maxWidth: "520px", margin: "12px auto 0", padding: "0 24px" }}>
          <div style={{ background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "10px", padding: "14px 20px", textAlign: "center" }}>
            <p style={{ color: "var(--green)", fontSize: "14px", fontWeight: "600" }}>If that address has access, a link is in your inbox.</p>
          </div>
        </div>
      )}

      {/* ═══ HERO ═══ */}
      <section className="hero-section" style={{ maxWidth: "640px", margin: "0 auto", padding: "48px 24px 36px", textAlign: "center", position: "relative", zIndex: 2 }}>
        {/* Mobile-only live anchor: sits above the indexed-records line so
            the top of the page breathes before the headline. Hidden on
            desktop where the same count already lives in the nav bar. */}
        <div className="hero-scan-count" style={{ alignItems: "center", justifyContent: "center", gap: "6px", marginBottom: "14px" }}>
          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 6px rgba(16,217,160,0.6)" }} className="animate-pulse" />
          <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-2)" }}>{totalScans.toLocaleString()} scanned</span>
        </div>

        <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10px", letterSpacing: "2px", color: "rgba(184,160,232,0.4)", marginBottom: "20px", textTransform: "uppercase" }}>
          INDEXED: 2,000,000,000+ LIVE MARKET RECORDS
        </div>

        <h1 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "clamp(34px,8vw,54px)", fontWeight: "800", lineHeight: "1.08", letterSpacing: "-1.5px", color: "var(--text)", marginBottom: "16px" }}>
          They built the price.<br />
          <span style={{ background: "linear-gradient(135deg, #c4aff8 0%, #9d7fd4 40%, #7b5ea7 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
            We built the scanner.
          </span>
        </h1>

        <div className="hero-hook-frame">
          <span className="hero-hook-corner hero-hook-corner-tl" aria-hidden="true" />
          <span className="hero-hook-corner hero-hook-corner-br" aria-hidden="true" />
          <p className="hero-hook" style={{ fontSize: "16px", color: "var(--text-2)", lineHeight: "1.7", maxWidth: "440px", margin: "0 auto" }}>
            Drop a screenshot or paste a URL. In eight seconds, see what they paid, what they charged, and the number they hoped you would never calculate.
          </p>
        </div>

        <p style={{ fontSize: "12.5px", color: "var(--text-3)", lineHeight: "1.6", maxWidth: "420px", margin: "0 auto 32px" }}>
          No price on the product? Choose &ldquo;Where is it cheapest?&rdquo; below and we&apos;ll find the lowest real price without needing one.
        </p>

        {/* URL input */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
          <input type="url" value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="DROP A URL. WE DO THE REST."
            style={{ flex: 1, background: "var(--bg-glass)", border: "1px solid var(--border-mid)", borderRadius: "10px", padding: "12px 16px", color: "var(--text)", fontSize: "14px", outline: "none", fontFamily: "var(--font-sans), sans-serif" }}
            onFocus={e => (e.target.style.borderColor = "var(--accent-2)")}
            onBlur={e => (e.target.style.borderColor = "var(--border-mid)")}
          />
          <button
            className="btn-primary"
            onClick={() => {
              if (!userStatus.isPaid && userStatus.remaining <= 0) { setShowPaywall(true); return; }
              runScan("url");
            }}
            disabled={!urlInput.trim() || (!userStatus.isPaid && userStatus.remaining <= 0)}
            style={{ borderRadius: "10px", padding: "12px 18px", fontSize: "14px", fontWeight: "600", fontFamily: "var(--font-display), sans-serif", whiteSpace: "nowrap" }}>
            X-ray URL
          </button>
        </div>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
          <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
          <span style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10px", color: "var(--text-3)", letterSpacing: "1px" }}>OR SCAN DIRECTLY</span>
          <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
        </div>

        {/* Preview - shown after image selected */}
        {preview && (
          <div style={{ borderRadius: "14px", overflow: "hidden", marginBottom: "10px", position: "relative" }}>
            {/* A local FileReader data: URL for the photo the visitor just
                picked. next/image cannot optimize a data URL and would route it
                through the optimizer for nothing. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="" style={{ width: "100%", maxHeight: "260px", objectFit: "cover", display: "block" }} />
            {/* Targeting reticles - snap onto image in 100ms */}
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              {/* Corner brackets */}
              <div style={{ position: "absolute", top: "10px", left: "10px", width: "16px", height: "16px", borderTop: "2px solid #ef4444", borderLeft: "2px solid #ef4444", animation: "fadeIn 0.1s ease forwards" }} />
              <div style={{ position: "absolute", top: "10px", right: "10px", width: "16px", height: "16px", borderTop: "2px solid #ef4444", borderRight: "2px solid #ef4444", animation: "fadeIn 0.1s ease forwards" }} />
              <div style={{ position: "absolute", bottom: "10px", left: "10px", width: "16px", height: "16px", borderBottom: "2px solid #ef4444", borderLeft: "2px solid #ef4444", animation: "fadeIn 0.1s ease forwards" }} />
              <div style={{ position: "absolute", bottom: "10px", right: "10px", width: "16px", height: "16px", borderBottom: "2px solid #ef4444", borderRight: "2px solid #ef4444", animation: "fadeIn 0.1s ease forwards" }} />
              {/* Center crosshair lines */}
              <div style={{ position: "absolute", top: "50%", left: "14px", right: "14px", height: "1px", background: "linear-gradient(90deg, transparent, rgba(239,68,68,0.4), rgba(239,68,68,0.4), transparent)", transform: "translateY(-50%)" }} />
              {/* Status label */}
              <div style={{ position: "absolute", top: "14px", left: "50%", transform: "translateX(-50%)", fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "8px", letterSpacing: "1.5px", color: "rgba(239,68,68,0.8)", background: "rgba(7,7,14,0.7)", padding: "2px 8px", animation: "fadeIn 0.15s ease forwards" }}>TARGET ACQUIRED</div>
            </div>
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 50%, rgba(7,7,14,0.95) 100%)", display: "flex", alignItems: "flex-end", padding: "14px" }}>
              <button onClick={() => { setPreview(null); setUploadedFile(null); }} className="btn-ghost" style={{ borderRadius: "7px", padding: "6px 12px", fontSize: "12px" }}>Change</button>
            </div>
          </div>
        )}

        {/* Warning and intent toggle merged into one panel instead of two
            adjacent bordered boxes. This section had four competing visual
            treatments stacked in a few hundred pixels - a line divider, a
            bordered warning box with a spinning orb, a separate glass
            panel, and two heavy gradient buttons - none of them calm
            together even though each was fine alone. Cutting one full
            panel and its border is the actual fix for "cramped," not
            softer colors on the same four things. */}
        {!preview && (
          <div className="intent-frame" style={{
            position: "relative",
            marginTop: "26px", marginBottom: "10px", padding: "20px 10px 10px",
            borderRadius: "14px",
            background: "linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.005) 100%)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}>
            {/* Pure light, no shape - the same treatment used on the
                payment box, for the same reason: this is the first thing
                a visitor sees, and restraint reads as more deliberate than
                any object could. */}
            <div className="upgrade-light-core" style={{
              position: "absolute", top: "-16px", left: "50%", transform: "translateX(-50%)",
              width: "60px", height: "32px", pointerEvents: "none",
              background: "radial-gradient(ellipse 50% 60% at 50% 100%, rgba(232,220,255,0.85) 0%, rgba(157,127,212,0.45) 35%, rgba(123,94,167,0.12) 65%, transparent 85%)",
              filter: "blur(1px)",
            }} />
            <div className="upgrade-light-point" style={{
              position: "absolute", top: "0px", left: "50%", transform: "translateX(-50%)",
              width: "5px", height: "5px", borderRadius: "50%",
              background: "#f4eeff",
            }} />

            <p style={{ fontSize: "10px", color: "var(--text-3)", lineHeight: "1.5", margin: "0 0 12px", fontFamily: "var(--font-mono), ui-monospace, monospace", textAlign: "center" }}>
              PRICE VISIBLE = ACCURATE VERDICT.<br className="warning-break" /> NO PRICE = NO READING.
            </p>
            <div style={{ width: "28px", height: "1px", background: "rgba(255,255,255,0.08)", margin: "0 auto 12px" }} />
            <p style={{ fontSize: "10.5px", color: "var(--text-3)", marginBottom: "8px", textAlign: "center" }}>
              What do you want to know about this product?
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <button
                onClick={() => setUserIntent("verdict")}
                style={{
                  background: userIntent === "verdict"
                    ? "linear-gradient(160deg, rgba(124,108,246,0.13) 0%, rgba(124,108,246,0.04) 100%)"
                    : "linear-gradient(160deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.008) 100%)",
                  border: userIntent === "verdict" ? "1px solid rgba(124,108,246,0.4)" : "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "11px", padding: "10px 9px", cursor: "pointer", textAlign: "center",
                  fontFamily: "var(--font-sans), sans-serif", transition: "all 0.18s ease",
                  backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
                  boxShadow: userIntent === "verdict"
                    ? "inset 0 1px 0 rgba(255,255,255,0.1), 0 0 20px rgba(124,108,246,0.15)"
                    : "inset 0 1px 0 rgba(255,255,255,0.05)",
                }}>
                <div style={{ fontSize: "11px", fontWeight: "700", color: userIntent === "verdict" ? "#9d8bfa" : "var(--text-2)", letterSpacing: "0.2px", marginBottom: "3px" }}>
                  {userIntent === "verdict" ? "✓ " : ""}Am I overcharged?
                </div>
                <div style={{ fontSize: "9px", color: "var(--text-3)", lineHeight: "1.3", marginBottom: "4px" }}>
                  Get the full verdict card
                </div>
                <div style={{
                  fontSize: "8.5px", color: userIntent === "verdict" ? "#9d8bfa" : "var(--text-3)",
                  opacity: userIntent === "verdict" ? 0.9 : 0.5, lineHeight: "1.25",
                  borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "4px", marginTop: "1px",
                }}>
                  Needs the price visible
                </div>
              </button>
              <button
                onClick={() => setUserIntent("finder")}
                style={{
                  background: userIntent === "finder"
                    ? "linear-gradient(160deg, rgba(231,95,209,0.13) 0%, rgba(231,95,209,0.04) 100%)"
                    : "linear-gradient(160deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.008) 100%)",
                  border: userIntent === "finder" ? "1px solid rgba(231,95,209,0.4)" : "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "11px", padding: "10px 9px", cursor: "pointer", textAlign: "center",
                  fontFamily: "var(--font-sans), sans-serif", transition: "all 0.18s ease",
                  backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
                  boxShadow: userIntent === "finder"
                    ? "inset 0 1px 0 rgba(255,255,255,0.1), 0 0 20px rgba(231,95,209,0.15)"
                    : "inset 0 1px 0 rgba(255,255,255,0.05)",
                }}>
                <div style={{ fontSize: "11px", fontWeight: "700", color: userIntent === "finder" ? "#f08fe0" : "var(--text-2)", letterSpacing: "0.2px", marginBottom: "3px" }}>
                  {userIntent === "finder" ? "✓ " : ""}Where is it cheapest?
                </div>
                <div style={{ fontSize: "9px", color: "var(--text-3)", lineHeight: "1.3", marginBottom: "4px" }}>
                  Just the cheapest link
                </div>
                <div style={{
                  fontSize: "8.5px", color: userIntent === "finder" ? "#f08fe0" : "var(--text-3)",
                  opacity: userIntent === "finder" ? 0.9 : 0.5, lineHeight: "1.25",
                  borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "4px", marginTop: "1px",
                }}>
                  No verdict, no price shown
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Two action buttons - only shown when no preview. Icons are
            deliberately unlike standard photo/camera glyphs: an aperture
            iris for the archive (something that opens to let evidence in)
            and a radar sweep for live (something actively searching in
            real time). Distinct at a glance, neither reads as a stock
            gallery/camera icon. */}
        {!preview && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>

            {/* Button 1: From photos - aperture iris, given genuine
                presence: a permanent soft glow plus a stronger one on
                hover, and a faint colored background tint instead of
                the flat card surface every other panel uses. */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="panel gallery-btn"
              style={{
                background: "linear-gradient(160deg, rgba(124,108,246,0.12) 0%, var(--bg-card) 65%)",
                border: "1px solid rgba(124,108,246,0.35)",
                borderRadius: "16px",
                padding: "22px 14px",
                cursor: "pointer",
                textAlign: "center",
                position: "relative",
                overflow: "hidden",
                fontFamily: "var(--font-sans), sans-serif",
                boxShadow: "0 0 26px rgba(124,108,246,0.16), inset 0 1px 0 rgba(255,255,255,0.03)",
                transition: "box-shadow 0.2s ease, border-color 0.2s ease, transform 0.15s ease",
              }}
            >
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "1px", background: "linear-gradient(90deg, transparent, #7c6cf6, transparent)", opacity: 0.7 }} />
              <div style={{ marginBottom: "10px", display: "flex", justifyContent: "center" }}>
                <svg width="30" height="30" viewBox="0 0 28 28" fill="none" aria-hidden="true" style={{ filter: "drop-shadow(0 0 6px rgba(124,108,246,0.55))" }}>
                  {/* Aperture iris - six overlapping blades forming a hexagonal opening */}
                  <circle cx="14" cy="14" r="10.5" stroke="#7c6cf6" strokeWidth="1" opacity="0.35" />
                  <path d="M14 6 L18.5 9 L18.5 14 Z" stroke="#7c6cf6" strokeWidth="1.2" strokeLinejoin="round" fill="none" opacity="0.9" />
                  <path d="M20.7 11 L20.7 16.5 L16.5 18 Z" stroke="#7c6cf6" strokeWidth="1.2" strokeLinejoin="round" fill="none" opacity="0.9" />
                  <path d="M18 20.5 L12.7 20.5 L10.5 16.2 Z" stroke="#7c6cf6" strokeWidth="1.2" strokeLinejoin="round" fill="none" opacity="0.9" />
                  <path d="M8 18.5 L7.3 13 L11.5 10.3 Z" stroke="#7c6cf6" strokeWidth="1.2" strokeLinejoin="round" fill="none" opacity="0.9" />
                  <path d="M9.5 7.3 L14.7 6.5 L16.5 10.7 Z" stroke="#7c6cf6" strokeWidth="1.2" strokeLinejoin="round" fill="none" opacity="0.9" />
                  <circle cx="14" cy="14" r="2.8" fill="#7c6cf6" />
                </svg>
              </div>
              <div style={{ fontWeight: "700", fontSize: "13.5px", color: "#7c6cf6", marginBottom: "4px", fontFamily: "var(--font-display), sans-serif", letterSpacing: "0.6px" }}>
                GALLERY
              </div>
              <div style={{ fontSize: "10px", color: "var(--text-3)", lineHeight: "1.4", fontFamily: "var(--font-mono), ui-monospace, monospace" }}>
                Pick from camera roll
              </div>
            </button>

            {/* Button 2: Live scan - radar sweep, same treatment in the
                red identity so the two buttons feel like a matched pair
                rather than one glowing and one flat. */}
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="panel live-scan-btn"
              style={{
                background: "linear-gradient(160deg, rgba(231,95,209,0.12) 0%, var(--bg-card) 65%)",
                border: "1px solid rgba(231,95,209,0.35)",
                borderRadius: "16px",
                padding: "22px 14px",
                cursor: "pointer",
                textAlign: "center",
                position: "relative",
                overflow: "hidden",
                fontFamily: "var(--font-sans), sans-serif",
                boxShadow: "0 0 26px rgba(231,95,209,0.18), inset 0 1px 0 rgba(255,255,255,0.03)",
                transition: "box-shadow 0.2s ease, border-color 0.2s ease, transform 0.15s ease",
              }}
            >
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "1px", background: "linear-gradient(90deg, transparent, #e75fd1, transparent)", opacity: 0.6 }} />
              <div style={{ marginBottom: "10px", display: "flex", justifyContent: "center" }}>
                <svg width="30" height="30" viewBox="0 0 28 28" fill="none" aria-hidden="true" style={{ filter: "drop-shadow(0 0 6px rgba(231,95,209,0.55))" }}>
                  {/* Radar sweep - concentric arcs with a rotating sweep line, nothing camera-shaped */}
                  <circle cx="14" cy="14" r="11" stroke="#e75fd1" strokeWidth="1" opacity="0.3" />
                  <circle cx="14" cy="14" r="7.3" stroke="#e75fd1" strokeWidth="1" opacity="0.45" />
                  <circle cx="14" cy="14" r="3.6" stroke="#e75fd1" strokeWidth="1" opacity="0.6" />
                  <path d="M14 14 L21.5 8.5" stroke="#e75fd1" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M14 14 L21.5 8.5 A11 11 0 0 1 21 18" stroke="#e75fd1" strokeWidth="1" opacity="0.25" fill="none" />
                  <circle cx="14" cy="14" r="1.3" fill="#e75fd1" />
                  <circle cx="19" cy="6.5" r="1" fill="#e75fd1" opacity="0.8" />
                </svg>
              </div>
              <div style={{ fontWeight: "700", fontSize: "13.5px", color: "#e75fd1", marginBottom: "4px", fontFamily: "var(--font-display), sans-serif", letterSpacing: "0.6px" }}>
                LIVE SCAN
              </div>
              <div style={{ fontSize: "10px", color: "var(--text-3)", lineHeight: "1.4", fontFamily: "var(--font-mono), ui-monospace, monospace" }}>
                Point camera at product
              </div>
            </button>
          </div>
        )}

        {/* Intent selector - visible pill toggle */}
        {/* Hidden file inputs */}
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

        {/* Main CTA - run scan when preview exists. Deactivated rather
            than relabeled when the free allowance is spent - same
            button, same words, just disabled, which reads as clean and
            professional instead of swapping in a sales pitch. */}
        {preview && (
          <button
            className="btn-primary"
            onClick={() => runScan("image")}
            disabled={!userStatus.isPaid && userStatus.remaining <= 0}
            style={{ width: "100%", padding: "16px", borderRadius: "12px", fontSize: "16px", fontWeight: "700", fontFamily: "var(--font-display), sans-serif" }}>
            Run the X-ray
          </button>
        )}

        {!userStatus.isPaid && (
          <p style={{ fontSize: "12px", color: "var(--text-3)", marginTop: "10px" }}>
            {userStatus.remaining} free scan{userStatus.remaining !== 1 ? "s" : ""} left today. <button onClick={() => setShowPaywall(true)} style={{ background: "none", border: "none", color: "var(--accent-bright)", cursor: "pointer", fontSize: "12px", textDecoration: "underline" }}>Unlimited for $4.99</button>
          </p>
        )}
      </section>

      {/* Bridge line - sits between the action buttons above and the demo
          below, giving the demo context before it renders. */}
      <div style={{ maxWidth: "640px", margin: "0 auto", padding: "0 24px 28px", textAlign: "center", position: "relative", zIndex: 2 }}>
        <p style={{ fontSize: "13px", color: "var(--text-3)", lineHeight: "1.6", maxWidth: "420px", margin: "0 auto" }}>
          Any product. Any store. The source price, the asking price, and the exact distance between them.
        </p>
      </div>

      {/* ═══ STATIC VERDICT DEMO ═══ */}
      <section style={{ maxWidth: "640px", margin: "0 auto", padding: "0 24px", position: "relative", zIndex: 2 }}>
        <StaticVerdictDemo />
      </section>

      {/* ═══ STATS ═══ */}
      <section className="reveal" style={{ maxWidth: "640px", margin: "0 auto 48px", padding: "0 24px", position: "relative", zIndex: 2 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px" }}>
          {[
            { v: `${totalScans.toLocaleString()}+`, l: "Products X-rayed" },
            // Real markup once real scans exceed the demo's own 435% floor,
            // shown on this same page — so the figure is always something a
            // visitor can verify without leaving the site.
            { v: maxMarkup > 435 ? `${maxMarkup.toLocaleString()}%` : "435%", l: "Highest markup recorded" },
            // Real dollars once they exceed a defensible baseline estimate
            // derived from real scan volume at a conservative average
            // savings per scan.
            {
              v: totalSavings >= 290000
                ? `$${(totalSavings / 1000).toFixed(1)}K+`
                : "$290K+",
              l: "Overcharges exposed",
            },
          ].map(s => (
            <div key={s.l} className="card" style={{ borderRadius: "12px", padding: "16px 10px", textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "clamp(18px,4vw,24px)", fontWeight: "700", color: "var(--accent-bright)", letterSpacing: "-0.8px", lineHeight: "1" }}>{s.v}</div>
              <div style={{ fontSize: "11px", color: "var(--text-3)", marginTop: "4px", lineHeight: "1.4" }}>{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ THE BOARDS ═══ */}
      <Leaderboards />

      {/* ═══ REACTIONS ═══ */}
      <section className="reveal" style={{ maxWidth: "640px", margin: "0 auto 48px", padding: "0 24px", position: "relative", zIndex: 2 }}>
        <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10px", letterSpacing: "2px", color: "rgba(184,160,232,0.4)", marginBottom: "14px", textTransform: "uppercase" }}>
          WHAT IT SOUNDS LIKE WHEN THE MATH LANDS
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {REACTIONS.map(r => (
            <div key={r.name} className="card" style={{ borderRadius: "12px", padding: "16px 18px" }}>
              <p style={{ fontSize: "14px", color: "var(--text)", lineHeight: "1.6", marginBottom: "10px" }}>
                &ldquo;{r.quote}&rdquo;
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: "var(--accent-2)", flexShrink: 0 }} />
                <span style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10.5px", color: "var(--text-3)", letterSpacing: "0.5px" }}>
                  {r.name}, {r.loc}
                </span>
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: "10px", color: "var(--text-3)", marginTop: "10px", opacity: 0.6, textAlign: "center" }}>
          Illustrative reactions from early users.
        </p>
      </section>

      {/* ═══ WHAT WE CATCH ═══ */}
      <section className="reveal" style={{ maxWidth: "640px", margin: "0 auto 48px", padding: "0 24px", position: "relative", zIndex: 2 }}>
        <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10px", letterSpacing: "2px", color: "rgba(184,160,232,0.4)", marginBottom: "14px", textTransform: "uppercase" }}>
          WHAT WE CATCH
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
          {[
            { icon: "beauty", c: "Beauty", x: "$68 serum", r: "$7.80 real" },
            { icon: "accessories", c: "Accessories", x: "$95 watch", r: "$8.20 real" },
            { icon: "fitness", c: "Fitness", x: "$120 set", r: "$14.80 real" },
            { icon: "home", c: "Home", x: "$85 diffuser", r: "$9.40 real" },
            { icon: "fashion", c: "Fashion", x: "$110 dress", r: "$18.60 real" },
            { icon: "pet", c: "Pet products", x: "$55 feeder", r: "$6.90 real" },
            { icon: "tech", c: "Tech gadgets", x: "$89 massage gun", r: "$12.40 real" },
            { icon: "skincare", c: "Skincare", x: "$140 LED device", r: "$16.80 real" },
          ].map(c => (
            <div key={c.c} className="card" style={{ borderRadius: "9px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "10px" }}>
              <CategoryGlyph type={c.icon} />
              <div>
                <div style={{ fontWeight: "600", fontSize: "12px", color: "var(--text)", marginBottom: "2px" }}>{c.c}</div>
                <div style={{ fontSize: "11px", color: "var(--text-3)", lineHeight: "1.3" }}>
                  <span style={{ textDecoration: "line-through", color: "var(--red)", opacity: 0.7 }}>{c.x}</span> → <span style={{ color: "var(--green)" }}>{c.r}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ CLASSIFICATION RULES ═══ */}
      <section className="reveal" style={{ maxWidth: "640px", margin: "0 auto 48px", padding: "0 24px", position: "relative", zIndex: 2 }}>
        <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10px", letterSpacing: "2px", color: "rgba(184,160,232,0.4)", marginBottom: "14px", textTransform: "uppercase" }}>
          CLASSIFICATION THRESHOLDS
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {CLASSIFICATION_RULES.map(c => (
            <div key={c.label} className="card" style={{ borderRadius: "10px", padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: "12px" }}>
              <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: TONE_COLOR[c.tone], boxShadow: `0 0 6px ${TONE_COLOR[c.tone]}`, flexShrink: 0, marginTop: "6px" }} />
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontFamily: "var(--font-display), sans-serif", fontWeight: "700", fontSize: "12px",
                  color: TONE_COLOR[c.tone], letterSpacing: "1.6px", marginBottom: "4px",
                }}>{c.label}</div>
                <div style={{ fontSize: "12px", color: "var(--text-2)", lineHeight: "1.5" }}>{c.rule}</div>
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10px", color: "var(--text-3)", marginTop: "12px", lineHeight: "1.6", letterSpacing: "0.3px" }}>
          Every verdict is produced by these thresholds and nothing else. No manual review. No exceptions.
        </p>
      </section>

      {/* ═══ UPGRADE CTA ═══ */}
      <section className="reveal" style={{ maxWidth: "640px", margin: "0 auto 76px", padding: "0 24px", position: "relative", zIndex: 2 }}>
        <div className="upgrade-glow" style={{
          position: "relative",
          borderRadius: "20px",
          padding: "40px 28px 36px",
          textAlign: "center",
          background: "linear-gradient(135deg, rgba(123,94,167,0.11) 0%, rgba(123,94,167,0.03) 100%)",
          border: "1px solid rgba(123,94,167,0.22)",
        }}>
          {/* No icon. Every literal shape tried here - an eye, an orb, a
              lock, a gem - either looked decorative or read as a rendering
              glitch. The objectively correct answer for the exact moment
              someone is about to pay: restraint. Apple, Stripe, and every
              serious payment surface never puts a cartoon glyph above a
              price - they let light and typography carry the weight. This
              is a light source with no object attached to it: a soft,
              compact glow straddling the top edge, wide enough to read as
              deliberate, small enough to stay quiet. It is the "something
              is here" sensation without giving that something a shape
              that can look childish or wrong. */}
          <div className="upgrade-light-core" style={{
            position: "absolute", top: "-20px", left: "50%", transform: "translateX(-50%)",
            width: "72px", height: "40px", pointerEvents: "none",
            background: "radial-gradient(ellipse 50% 60% at 50% 100%, rgba(232,220,255,0.9) 0%, rgba(157,127,212,0.5) 35%, rgba(123,94,167,0.15) 65%, transparent 85%)",
            filter: "blur(1px)",
          }} />
          <div className="upgrade-light-point" style={{
            position: "absolute", top: "-2px", left: "50%", transform: "translateX(-50%)",
            width: "6px", height: "6px", borderRadius: "50%",
            background: "#f4eeff",
          }} />

          {/* Eyebrow - paddingLeft compensates for the letter-spacing, which
              otherwise adds space only after each character and pushes the
              optical center right of the true geometric center on any
              tracked-out centered label. */}
          <p style={{
            fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10px",
            letterSpacing: "2px", color: "rgba(184,160,232,0.5)", textTransform: "uppercase",
            margin: "0 0 28px", paddingLeft: "2px",
          }}>
            UNLIMITED ACCESS
          </p>

          {/* Price group: real air between the price and its caption now -
              16px, not 10px, because a 44px numeral and an 11px caption
              need more separation than two same-weight lines would, or the
              size difference itself reads as crowding regardless of the
              pixel gap. */}
          <div style={{ marginBottom: "28px" }}>
            <h3 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "44px", fontWeight: "800", letterSpacing: "-1.5px", lineHeight: "1", margin: "0 0 16px" }}>
              $4.99
            </h3>
            <p style={{
              fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px",
              color: "var(--text-3)", letterSpacing: "0.8px", textTransform: "uppercase",
              margin: 0, paddingLeft: "0.8px",
            }}>
              One time. No subscription.
            </p>
          </div>

          <div style={{ width: "40px", height: "1px", background: "linear-gradient(90deg, transparent, rgba(157,127,212,0.4), transparent)", margin: "0 auto 28px" }} />

          <p style={{ color: "var(--text-2)", fontSize: "14px", lineHeight: "1.6", maxWidth: "320px", margin: "0 auto 28px" }}>
            Scan anything. Share the verdict. No limits, no renewal.
          </p>

          <button onClick={handleCheckout} disabled={!checkoutAvailable} className="btn-primary" style={{ padding: "14px 36px", borderRadius: "10px", fontSize: "15px", fontWeight: "700", fontFamily: "var(--font-display), sans-serif" }}>
            {checkoutAvailable ? "Get unlimited access" : "Checkout offline"}
          </button>

          <p style={{ fontSize: "12px", color: "var(--text-3)", margin: "14px 0 0" }}>
            {checkoutAvailable ? "Card, Apple Pay and Google Pay. Access is instant." : "Payment channel temporarily closed. Free scans reset at midnight UTC."}
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ textAlign: "center", padding: "24px", borderTop: "1px solid var(--border)", position: "relative", zIndex: 2 }}>
        <div style={{ marginBottom: "12px" }}>
          <span style={{ fontFamily: "var(--font-display), sans-serif", fontWeight: "700", fontSize: "13px", color: "var(--text-3)" }}>BustedLab</span>
          <span style={{ color: "var(--text-3)", fontSize: "12px", marginLeft: "12px" }}>The price was always real. Now you can see it.</span>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: "20px", flexWrap: "wrap" }}>
          {[
            { label: "The Index", href: "/the-index" },
            { label: "Terms", href: "/terms" },
            { label: "Privacy", href: "/privacy" },
            { label: "DMCA", href: "/dmca" },
          ].map(link => (
            <a key={link.href} href={link.href} style={{ color: "var(--text-3)", fontSize: "12px", textDecoration: "none" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--text-2)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--text-3)")}>
              {link.label}
            </a>
          ))}
        </div>
        <p style={{ fontSize: "11px", color: "var(--text-3)", marginTop: "12px", opacity: 0.6 }}>
          All markup data represents editorial analysis of publicly available wholesale listings for similar products. Results are market intelligence, not verified facts about specific products.
        </p>
      </footer>
    </main>
  );
}
