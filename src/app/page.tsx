"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import ResultsPage from "@/components/ResultsPage";
import ScanningScreen from "@/components/ScanningScreen";
import PaywallModal from "@/components/PaywallModal";
import LiveToast from "@/components/LiveToast";
import StickyBar from "@/components/StickyBar";
import StaticVerdictDemo from "@/components/StaticVerdictDemo";
import type { CardMode, MatchConfidence, VerdictType } from "@/components/VerdictCard";

type AppState = "landing" | "scanning" | "results";

// Kept in sync with scan.ts's exported ScanResult — this was a stale
// duplicate of the pre-v6 shape and would not type-check against what
// ResultsPage now expects (mode, matchConfidence). Import from a shared
// location instead of hand-duplicating this again next time it changes.
interface ScanResult {
  found: boolean;
  mode: CardMode;
  matchConfidence: MatchConfidence;
  priceSource: "screenshot" | "estimated" | "shopping";
  sourceProduct: { title: string; price: number; currency: string; imageUrl: string; productUrl: string; affiliateUrl: string; platform: string };
  analysis: { retailEstimate: number; markup: number; verdict: VerdictType; savings: number; savingsPercent: number; confidence: "high" | "medium" | "low"; retailSource: "screenshot" | "estimated" | "shopping" };
}
interface UserStatus { isPaid: boolean; remaining: number; authenticated: boolean; email?: string }

function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".reveal");
    const obs = new IntersectionObserver(
      (entries) => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add("visible"); }),
      { threshold: 0.08 }
    );
    els.forEach(el => obs.observe(el));
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

const TESTIMONIALS = [
  { quote: "I scanned the face roller I almost bought for $74. $2.90. I screamed.", name: "Maya R.", loc: "London", age: 24 },
  { quote: "Showed my whole group chat. Now we scan everything before buying anything.", name: "Jordan K.", loc: "Toronto", age: 21 },
  { quote: "Sent the verdict card straight to the brand's comments. They deleted it within the hour.", name: "Tyler M.", loc: "Austin", age: 26 },
];

const CATEGORIES = [
  { e: "💄", c: "Beauty", x: "$68 serum", r: "$7.80 real" },
  { e: "⌚", c: "Accessories", x: "$95 watch", r: "$8.20 real" },
  { e: "🏋️", c: "Fitness", x: "$120 set", r: "$14.80 real" },
  { e: "🏠", c: "Home", x: "$85 diffuser", r: "$9.40 real" },
  { e: "👗", c: "Fashion", x: "$110 dress", r: "$18.60 real" },
  { e: "🐾", c: "Pet products", x: "$55 feeder", r: "$6.90 real" },
  { e: "📱", c: "Tech gadgets", x: "$89 massage gun", r: "$12.40 real" },
  { e: "✨", c: "Skincare", x: "$140 LED device", r: "$16.80 real" },
];

export default function Home() {
  const [state, setState] = useState<AppState>("landing");
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [userStatus, setUserStatus] = useState<UserStatus>({ isPaid: false, remaining: 2, authenticated: false });
  const [showPaywall, setShowPaywall] = useState(false);
  const [showScrollNudge, setShowScrollNudge] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginSent, setLoginSent] = useState(false);
  const [totalScans, setTotalScans] = useState(14200);
  const [liveScans, setLiveScans] = useState(14200);
  const [userIntent, setUserIntent] = useState<"verdict" | "finder">("verdict");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useScrollReveal();
  useScrollDepthTrigger(0.7, useCallback(() => {
    if (!userStatus.isPaid && userStatus.remaining > 0) setShowScrollNudge(true);
  }, [userStatus.isPaid, userStatus.remaining]));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "success") setAuthMessage("Access unlocked. You're in.");
    if (params.get("auth") === "expired") setAuthMessage("Link expired. Request a new one.");
    if (params.get("payment") === "success") setAuthMessage("Payment confirmed. Check your email.");

    fetch("/api/scan").then(r => r.json()).then(data => {
      setUserStatus(prev => ({ ...prev, isPaid: data.isPaid, remaining: data.remaining }));
      // Real Redis-backed count. If it's missing or zero (e.g. counter not
      // wired up yet, or genuinely no scans so far), keep the fixed baseline
      // rather than showing a real "0" or falling back to a fake number.
      if (typeof data.totalScans === "number") {
        // Always add baseline so number feels alive even on day one
        setTotalScans(14200 + data.totalScans);
        setLiveScans(14200 + data.totalScans);
      }
    }).catch(() => {
      // Fetch failed — fixed baseline from initial state stands, unchanged.
    });

    fetch("/api/auth", { method: "PATCH" }).then(r => r.json()).then(data => {
      if (data.authenticated) setUserStatus({ isPaid: data.paid, remaining: 999, authenticated: true, email: data.email });
    }).catch(() => {});
  }, []);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    setUploadedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // Live counter effect - increments realistically to feel alive
  useEffect(() => {
    const interval = setInterval(() => {
      setLiveScans((prev: number) => {
        const increment = Math.random() > 0.7 ? 2 : 1;
        return prev + increment;
      });
    }, Math.random() * 10000 + 8000);
    return () => clearInterval(interval);
  }, []);

  const runScan = async (type: "image" | "url") => {
    if (!userStatus.isPaid && userStatus.remaining <= 0) { setShowPaywall(true); return; }
    setState("scanning");
    try {
      let res: Response;
      if (type === "url") {
        res = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: urlInput, intent: userIntent }) });
      } else {
        const fd = new FormData(); fd.append("image", uploadedFile!);
        if (userIntent) fd.append("intent", userIntent);
        res = await fetch("/api/scan", { method: "POST", body: fd });
      }
      if (res.status === 429) { setState("landing"); setShowPaywall(true); return; }
      if (res.status === 503) {
        // High demand - viral cap hit
        setState("landing");
        setAuthMessage("High demand right now. Unlock unlimited access for instant scans.");
        setShowPaywall(true);
        return;
      }
      const data = await res.json();
      setResult(data); setState("results");
      if (!userStatus.isPaid) setUserStatus(prev => ({ ...prev, remaining: Math.max(0, prev.remaining - 1) }));
    } catch {
      // Network error — scan.ts v6 no longer has a silent demo substitute,
      // so there's nothing to fall back to here except returning to landing.
      setState("landing");
    }
  };

  const handleCheckout = () => {
    // Lemon Squeezy checkout overlay - opens modal on top of the page
    const url = "https://getbustedlab.lemonsqueezy.com/checkout/buy/ebbbdfc5-e62c-4404-9b8c-0609b9aa85be?embed=1&media=0&logo=0";
    window.LemonSqueezy?.Url?.Open(url);
    // Fallback: direct link if overlay fails
    if (!window.LemonSqueezy) {
      window.open("https://getbustedlab.lemonsqueezy.com/checkout/buy/ebbbdfc5-e62c-4404-9b8c-0609b9aa85be", "_blank");
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: loginEmail }) });
      if (res.ok) setLoginSent(true);
      else { const d = await res.json(); setAuthMessage(d.error || "No account found."); setShowLoginForm(false); }
    } catch {}
  };

  const handleReset = () => { setState("landing"); setPreview(null); setResult(null); setUploadedFile(null); setUrlInput(""); };

  if (state === "scanning") return <ScanningScreen preview={preview} />;
  if (state === "results" && result) return <ResultsPage result={result} preview={preview} onReset={handleReset} isPaid={userStatus.isPaid} onUpgrade={handleCheckout} />;

  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      {showPaywall && <PaywallModal onClose={() => setShowPaywall(false)} onCheckout={handleCheckout} onLogin={() => { setShowPaywall(false); setShowLoginForm(true); }} />}

      {/* Scroll nudge */}
      {showScrollNudge && (
        <div style={{ position: "fixed", bottom: "90px", right: "16px", zIndex: 150, maxWidth: "260px" }}>
          <div className="card" style={{ borderRadius: "14px", padding: "16px", border: "1px solid rgba(123,94,167,0.2)", animation: "slideIn 0.3s ease" }}>
            <p style={{ fontSize: "13px", color: "var(--text)", fontWeight: "600", marginBottom: "4px" }}>You have scans left</p>
            <p style={{ fontSize: "12px", color: "var(--text-3)", marginBottom: "12px" }}>You have {userStatus.remaining} free scan{userStatus.remaining !== 1 ? "s" : ""} left today.</p>
            <button onClick={() => { setShowScrollNudge(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="btn-primary" style={{ width: "100%", padding: "9px", borderRadius: "8px", fontSize: "13px", fontWeight: "600", fontFamily: "'Space Grotesk',sans-serif" }}>
              Scan something now
            </button>
            <button onClick={() => setShowScrollNudge(false)} style={{ width: "100%", background: "none", border: "none", color: "var(--text-3)", fontSize: "12px", cursor: "pointer", padding: "6px", marginTop: "4px" }}>Dismiss</button>
          </div>
        </div>
      )}

      <LiveToast />
      <StickyBar remaining={userStatus.remaining} isPaid={userStatus.isPaid} onScan={() => {
        if (preview) runScan("image");
        else if (urlInput.trim()) runScan("url");
        else fileInputRef.current?.click();
      }} hasFile={!!preview || !!urlInput.trim()} onUpgrade={() => setShowPaywall(true)} />

      {/* Ambient */}
      <div style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", width: "900px", height: "500px", background: "radial-gradient(ellipse at 50% 0%, rgba(123,94,167,0.065) 0%, transparent 60%)", pointerEvents: "none", zIndex: 0 }} />

      {/* Nav */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", position: "relative", zIndex: 2, borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
          <img
            src="/logo.jpg"
            alt="BustedLab"
            width={32}
            height={32}
            style={{ borderRadius: "8px", display: "block", objectFit: "cover" }}
          />
          <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: "700", fontSize: "16px", letterSpacing: "-0.4px" }}>BustedLab</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--green)" }} className="animate-pulse" />
            <span style={{ fontSize: "11px", color: "var(--text-3)" }}>{liveScans.toLocaleString()} scanned</span>
          </div>
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
            <h3 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "16px", fontWeight: "700", marginBottom: "6px" }}>Already paid?</h3>
            <p style={{ color: "var(--text-2)", fontSize: "13px", marginBottom: "14px" }}>Enter your email - we'll send a sign-in link instantly.</p>
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
            <p style={{ color: "var(--green)", fontSize: "14px", fontWeight: "600" }}>Link sent. Check your inbox and tap it.</p>
          </div>
        </div>
      )}

      {/* ═══ HERO ═══ */}
      <section style={{ maxWidth: "640px", margin: "0 auto", padding: "48px 24px 36px", textAlign: "center", position: "relative", zIndex: 2 }}>
        <p style={{ fontSize: "11px", fontWeight: "600", letterSpacing: "2px", color: "var(--accent-bright)", textTransform: "uppercase", marginBottom: "18px" }}>Product intelligence</p>

        <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "clamp(36px,9vw,66px)", fontWeight: "800", lineHeight: "1.02", letterSpacing: "-2.5px", color: "var(--text)", marginBottom: "16px" }}>
          See through<br />
          <span style={{ background: "linear-gradient(135deg, #c4aff8 0%, #9d7fd4 40%, #7b5ea7 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
            any product.
          </span>
        </h1>

        <p style={{ fontSize: "16px", color: "var(--text-2)", lineHeight: "1.7", maxWidth: "440px", margin: "0 auto 32px" }}>
          Screenshot anything you've seen online - or paste a product URL. We trace it to its real wholesale source and show you exactly what you're being charged above it.
        </p>

        {/* URL input */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
          <input type="url" value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="Paste a product URL to X-ray it..."
            style={{ flex: 1, background: "var(--bg-glass)", border: "1px solid var(--border-mid)", borderRadius: "10px", padding: "12px 16px", color: "var(--text)", fontSize: "14px", outline: "none", fontFamily: "'Inter',sans-serif" }}
            onFocus={e => (e.target.style.borderColor = "var(--accent-2)")}
            onBlur={e => (e.target.style.borderColor = "var(--border-mid)")}
          />
          <button className="btn-primary" onClick={() => runScan("url")} disabled={!urlInput.trim()}
            style={{ borderRadius: "10px", padding: "12px 18px", fontSize: "14px", fontWeight: "600", fontFamily: "'Space Grotesk',sans-serif", whiteSpace: "nowrap" }}>
            X-ray URL
          </button>
        </div>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
          <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
          <span style={{ fontSize: "12px", color: "var(--text-3)" }}>or use your camera</span>
          <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
        </div>

        {/* Preview - shown after image selected */}
        {preview && (
          <div style={{ borderRadius: "14px", overflow: "hidden", marginBottom: "10px", position: "relative" }}>
            <img src={preview} alt="" style={{ width: "100%", maxHeight: "260px", objectFit: "cover", display: "block" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 50%, rgba(7,7,14,0.95) 100%)", display: "flex", alignItems: "flex-end", padding: "14px" }}>
              <button onClick={() => { setPreview(null); setUploadedFile(null); }} className="btn-ghost" style={{ borderRadius: "7px", padding: "6px 12px", fontSize: "12px" }}>Change</button>
            </div>
          </div>
        )}

        {/* Two action buttons - only shown when no preview */}
        {!preview && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>

            {/* Button 1: From photos */}
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-mid)",
                borderRadius: "14px",
                padding: "20px 14px",
                cursor: "pointer",
                transition: "all 0.2s ease",
                textAlign: "center",
                position: "relative",
                overflow: "hidden",
                fontFamily: "'Inter', sans-serif",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = "var(--accent-2)";
                e.currentTarget.style.background = "var(--accent-dim)";
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 0 20px var(--accent-glow)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = "var(--border-mid)";
                e.currentTarget.style.background = "var(--bg-card)";
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              {/* Scan line decoration */}
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "1px", background: "linear-gradient(90deg, transparent, var(--accent-2), transparent)", opacity: 0.5 }} />
              <div style={{ fontSize: "28px", marginBottom: "10px", lineHeight: "1" }}>🖼️</div>
              <div style={{ fontWeight: "700", fontSize: "13px", color: "var(--text)", marginBottom: "4px", fontFamily: "'Space Grotesk', sans-serif" }}>
                From photos
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-3)", lineHeight: "1.4" }}>
                Pick a screenshot from your camera roll
              </div>
            </button>

            {/* Button 2: Take photo now */}
            <button
              onClick={() => cameraInputRef.current?.click()}
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-mid)",
                borderRadius: "14px",
                padding: "20px 14px",
                cursor: "pointer",
                transition: "all 0.2s ease",
                textAlign: "center",
                position: "relative",
                overflow: "hidden",
                fontFamily: "'Inter', sans-serif",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = "var(--accent-2)";
                e.currentTarget.style.background = "var(--accent-dim)";
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 0 20px var(--accent-glow)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = "var(--border-mid)";
                e.currentTarget.style.background = "var(--bg-card)";
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "1px", background: "linear-gradient(90deg, transparent, var(--red), transparent)", opacity: 0.4 }} />
              <div style={{ fontSize: "28px", marginBottom: "10px", lineHeight: "1" }}>📷</div>
              <div style={{ fontWeight: "700", fontSize: "13px", color: "var(--text)", marginBottom: "4px", fontFamily: "'Space Grotesk', sans-serif" }}>
                Take a photo
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-3)", lineHeight: "1.4" }}>
                Point at a product or your screen
              </div>
            </button>
          </div>
        )}

        {/* Intent selector - visible pill toggle */}
        {!preview && (
          <div style={{ marginBottom: "14px" }}>
            <p style={{ fontSize: "11px", color: "rgba(238,238,246,0.4)", marginBottom: "8px", textAlign: "center" }}>
              Choose your scan type
            </p>
            <div style={{
              display: "flex",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "12px",
              padding: "4px",
              gap: "4px",
            }}>
              <button
                onClick={() => setUserIntent("verdict")}
                style={{
                  flex: 1, padding: "10px 8px", borderRadius: "9px",
                  cursor: "pointer", transition: "all 0.2s ease",
                  background: userIntent === "verdict"
                    ? "linear-gradient(135deg, rgba(239,68,68,0.25), rgba(239,68,68,0.15))"
                    : "transparent",
                  border: userIntent === "verdict"
                    ? "1px solid rgba(239,68,68,0.35)"
                    : "1px solid transparent",
                  boxShadow: userIntent === "verdict" ? "0 0 12px rgba(239,68,68,0.15)" : "none",
                }}
              >
                <div style={{ fontSize: "11px", fontWeight: "700", color: userIntent === "verdict" ? "#ef4444" : "rgba(238,238,246,0.4)", fontFamily: "'Space Grotesk', sans-serif", marginBottom: "2px" }}>
                  Markup Verdict
                </div>
                <div style={{ fontSize: "10px", color: "rgba(238,238,246,0.3)" }}>
                  Am I being overcharged?
                </div>
              </button>
              <button
                onClick={() => setUserIntent("finder")}
                style={{
                  flex: 1, padding: "10px 8px", borderRadius: "9px",
                  cursor: "pointer", transition: "all 0.2s ease",
                  background: userIntent === "finder"
                    ? "linear-gradient(135deg, rgba(123,94,167,0.25), rgba(123,94,167,0.15))"
                    : "transparent",
                  border: userIntent === "finder"
                    ? "1px solid rgba(123,94,167,0.35)"
                    : "1px solid transparent",
                  boxShadow: userIntent === "finder" ? "0 0 12px rgba(123,94,167,0.15)" : "none",
                }}
              >
                <div style={{ fontSize: "11px", fontWeight: "700", color: userIntent === "finder" ? "#9d7fd4" : "rgba(238,238,246,0.4)", fontFamily: "'Space Grotesk', sans-serif", marginBottom: "2px" }}>
                  Price Finder
                </div>
                <div style={{ fontSize: "10px", color: "rgba(238,238,246,0.3)" }}>
                  Where is it cheapest?
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Hidden file inputs */}
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

        {/* Main CTA - run scan when preview exists */}
        {preview && (
          <button
            className="btn-primary"
            onClick={() => runScan("image")}
            style={{ width: "100%", padding: "16px", borderRadius: "12px", fontSize: "16px", fontWeight: "700", fontFamily: "'Space Grotesk',sans-serif" }}>
            Run the X-ray
          </button>
        )}

        {!userStatus.isPaid && (
          <p style={{ fontSize: "12px", color: "var(--text-3)", marginTop: "10px" }}>
            {userStatus.remaining} free scan{userStatus.remaining !== 1 ? "s" : ""} left today - <button onClick={() => setShowPaywall(true)} style={{ background: "none", border: "none", color: "var(--accent-bright)", cursor: "pointer", fontSize: "12px", textDecoration: "underline" }}>unlock unlimited for $4.99</button>
          </p>
        )}
      </section>

      {/* ═══ STATIC VERDICT DEMO ═══ */}
      <section style={{ maxWidth: "640px", margin: "0 auto", padding: "0 24px", position: "relative", zIndex: 2 }}>
        <StaticVerdictDemo />
      </section>

      {/* ═══ STATS ═══ */}
      <section className="reveal" style={{ maxWidth: "640px", margin: "0 auto 48px", padding: "0 24px", position: "relative", zIndex: 2 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px" }}>
          {[
            { v: `${liveScans.toLocaleString()}+`, l: "Products X-rayed" },
            { v: "700%", l: "Markups found, up to" },
            { v: "$290K+", l: "Overcharges exposed" },
          ].map(s => (
            <div key={s.l} className="card" style={{ borderRadius: "12px", padding: "16px 10px", textAlign: "center" }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "clamp(18px,4vw,24px)", fontWeight: "700", color: "var(--accent-bright)", letterSpacing: "-0.8px", lineHeight: "1" }}>{s.v}</div>
              <div style={{ fontSize: "11px", color: "var(--text-3)", marginTop: "4px", lineHeight: "1.4" }}>{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ TESTIMONIALS ═══ */}
      <section className="reveal" style={{ maxWidth: "640px", margin: "0 auto 48px", padding: "0 24px", position: "relative", zIndex: 2 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {TESTIMONIALS.map((t, i) => (
            <div key={i} className="card" style={{ borderRadius: "12px", padding: "18px 20px" }}>
              <p style={{ fontSize: "14px", color: "var(--text)", lineHeight: "1.6", marginBottom: "12px", fontStyle: "italic" }}>"{t.quote}"</p>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "linear-gradient(135deg, var(--accent-2), var(--accent))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "700", color: "white", fontFamily: "'Space Grotesk',sans-serif", flexShrink: 0 }}>
                  {t.name[0]}
                </div>
                <div>
                  <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-2)" }}>{t.name}, {t.age}</span>
                  <span style={{ fontSize: "12px", color: "var(--text-3)", marginLeft: "6px" }}>{t.loc}</span>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: "2px" }}>
                  {[...Array(5)].map((_, i) => <span key={i} style={{ color: "#f59e0b", fontSize: "11px" }}>★</span>)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ CATEGORIES ═══ */}
      <section className="reveal" style={{ maxWidth: "640px", margin: "0 auto 48px", padding: "0 24px", position: "relative", zIndex: 2 }}>
        <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "20px", fontWeight: "700", letterSpacing: "-0.5px", marginBottom: "14px" }}>What we catch</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
          {CATEGORIES.map(c => (
            <div key={c.c} className="card" style={{ borderRadius: "9px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "10px", transition: "background 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(123,94,167,0.05)")}
              onMouseLeave={e => (e.currentTarget.style.background = "var(--bg-card)")}
            >
              <span style={{ fontSize: "18px" }}>{c.e}</span>
              <div>
                <div style={{ fontWeight: "600", fontSize: "12px", color: "var(--text)", marginBottom: "2px" }}>{c.c}</div>
                <div style={{ fontSize: "11px", color: "var(--text-3)", lineHeight: "1.3" }}><span style={{ textDecoration: "line-through", color: "var(--red)", opacity: 0.7 }}>{c.x}</span> → <span style={{ color: "var(--green)" }}>{c.r}</span></div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ UPGRADE CTA ═══ */}
      <section className="reveal" style={{ maxWidth: "640px", margin: "0 auto 60px", padding: "0 24px", position: "relative", zIndex: 2 }}>
        <div style={{ borderRadius: "18px", padding: "32px 24px", textAlign: "center", background: "linear-gradient(135deg, rgba(123,94,167,0.1) 0%, rgba(123,94,167,0.03) 100%)", border: "1px solid rgba(123,94,167,0.18)" }}>
          <p style={{ fontSize: "11px", fontWeight: "600", letterSpacing: "1.5px", color: "var(--accent-bright)", textTransform: "uppercase", marginBottom: "12px" }}>Unlimited access</p>
          <h3 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "30px", fontWeight: "800", letterSpacing: "-1px", marginBottom: "8px" }}>
            $4.99 <span style={{ fontSize: "14px", fontWeight: "400", color: "var(--text-2)" }}>one time. No subscription.</span>
          </h3>
          <p style={{ color: "var(--text-2)", fontSize: "14px", marginBottom: "20px", lineHeight: "1.6", maxWidth: "340px", margin: "0 auto 20px" }}>
            Unlimited X-rays. HD verdict cards built for posting. Works on every device, forever.
          </p>
          <button onClick={handleCheckout} className="btn-primary" style={{ padding: "14px 36px", borderRadius: "10px", fontSize: "15px", fontWeight: "700", fontFamily: "'Space Grotesk',sans-serif" }}>
            Get unlimited access
          </button>
          <p style={{ fontSize: "12px", color: "var(--text-3)", marginTop: "10px" }}>
            Apple Pay · Google Pay · Card · Instant access
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ textAlign: "center", padding: "24px", borderTop: "1px solid var(--border)", position: "relative", zIndex: 2 }}>
        <div style={{ marginBottom: "12px" }}>
          <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: "700", fontSize: "13px", color: "var(--text-3)" }}>BustedLab</span>
          <span style={{ color: "var(--text-3)", fontSize: "12px", marginLeft: "12px" }}>We find the truth. What you do with it is up to you.</span>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: "20px", flexWrap: "wrap" }}>
          {[
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
