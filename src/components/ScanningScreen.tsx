"use client";

import { useEffect, useState } from "react";

// Every stage below names a real step scan.ts v6 actually performs.
// If the pipeline changes, this list changes with it — nothing here is decorative.
const SCAN_STAGES = [
  { label: "Reading image signature", detail: "Extracting product identity", duration: 900 },
  { label: "Reverse image matching", detail: "Searching by pixel signature, not keywords", duration: 1100 },
  { label: "Cross-referencing listings", detail: "Scanning live shopping indexes", duration: 1200 },
  { label: "Verifying visual match", detail: "Confirming candidate against original image", duration: 1000 },
  { label: "Calculating markup", detail: "Comparing verified retail vs wholesale", duration: 800 },
  { label: "Building verdict", detail: "Compiling confidence-scored report", duration: 600 },
];

// Shown when a scan outlives the scripted stage list. Every one of these
// names a real fallback tier in scan.ts.
const EXTENDED_STAGE = {
  label: "Widening the search",
  detail: "Falling back through broader query tiers",
};

export default function ScanningScreen({ preview }: { preview: string | null }) {
  const [stageIndex, setStageIndex] = useState(0);
  const [extended, setExtended] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [scanY, setScanY] = useState(0);
  const [scanDirection, setScanDirection] = useState(1);

  // Progress arc.
  //
  // The scripted stages run 5.6 seconds. Real scans routinely take longer:
  // the engine has seven layers with multi-tier query fallbacks, and a hard
  // product takes every one of them. The previous version stopped its timer
  // the moment the script ended, which pinned the arc at 97% and froze the
  // stage readout on "Building verdict" for as long as the scan actually
  // needed. A machine that stops moving reads as a machine that has crashed,
  // and that is the moment a person closes the tab.
  //
  // After the script, the arc keeps advancing on an asymptotic curve driven
  // by the real clock. It approaches 99% and never reaches it, because the
  // screen genuinely does not know how much is left.
  useEffect(() => {
    const scripted = SCAN_STAGES.reduce((a, s) => a + s.duration, 0);
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      if (elapsed <= scripted) {
        setProgress((elapsed / scripted) * 96);
      } else {
        const overrun = elapsed - scripted;
        setProgress(96 + 3 * (1 - Math.exp(-overrun / 9000)));
      }
    }, 40);
    return () => clearInterval(interval);
  }, []);

  // Stage progression
  useEffect(() => {
    let idx = 0;
    let timer: ReturnType<typeof setTimeout>;
    const advance = () => {
      if (idx < SCAN_STAGES.length - 1) {
        idx++;
        setStageIndex(idx);
        timer = setTimeout(advance, SCAN_STAGES[idx].duration);
      } else {
        // The script is spent and the scan is still running, which means the
        // engine is into its fallback tiers. Say so, rather than sitting on
        // "Building verdict" indefinitely.
        timer = setTimeout(() => setExtended(true), 1400);
      }
    };
    timer = setTimeout(advance, SCAN_STAGES[0].duration);
    // The chain outlived the component: a scan that resolved faster than the
    // stage script kept firing setState against an unmounted tree.
    return () => clearTimeout(timer);
  }, []);

  // Elapsed time — real, not a fabricated accumulating count
  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => setElapsedMs(Date.now() - start), 50);
    return () => clearInterval(interval);
  }, []);

  // Scan beam sweep
  useEffect(() => {
    let pos = 0;
    let dir = 1;
    const interval = setInterval(() => {
      pos += dir * 1.2;
      if (pos >= 100) { pos = 100; dir = -1; }
      if (pos <= 0) { pos = 0; dir = 1; }
      setScanY(pos);
      setScanDirection(dir);
    }, 16);
    return () => clearInterval(interval);
  }, []);

  const circumference = 2 * Math.PI * 54;
  const strokeDash = (progress / 100) * circumference;

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "flex-start",
      padding: "calc(env(safe-area-inset-top, 0px) + 64px) 24px 24px",
      position: "relative",
      overflow: "hidden",
      fontFamily: "var(--font-sans), sans-serif",
    }}>

      {/* Ambient glow */}
      <div style={{ position: "fixed", top: "20%", left: "50%", transform: "translateX(-50%)", width: "600px", height: "400px", background: "radial-gradient(ellipse, rgba(123,94,167,0.1) 0%, transparent 65%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", top: "40%", left: "50%", transform: "translateX(-50%)", width: "300px", height: "300px", background: "radial-gradient(ellipse, rgba(239,68,68,0.05) 0%, transparent 65%)", pointerEvents: "none" }} />

      {/* Corner reticles */}
      <div style={{ position: "fixed", top: "16px", left: "16px" }}>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path d="M0 12 L0 0 L12 0" stroke="#9d7fd4" strokeOpacity="0.4" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
      <div style={{ position: "fixed", top: "16px", right: "16px" }}>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path d="M32 12 L32 0 L20 0" stroke="#9d7fd4" strokeOpacity="0.4" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
      <div style={{ position: "fixed", bottom: "16px", left: "16px" }}>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path d="M0 20 L0 32 L12 32" stroke="#9d7fd4" strokeOpacity="0.3" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
      <div style={{ position: "fixed", bottom: "16px", right: "16px" }}>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path d="M32 20 L32 32 L20 32" stroke="#9d7fd4" strokeOpacity="0.3" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>

      {/* Top system bar */}
      <div style={{ position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#9d7fd4", boxShadow: "0 0 6px #9d7fd4" }} />
        <span style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10px", color: "rgba(238,238,246,0.4)", letterSpacing: "2px" }}>SCAN IN PROGRESS</span>
      </div>

      <div style={{ maxWidth: "380px", width: "100%", position: "relative" }}>

        {/* ═══ CENTRAL SCAN UNIT ═══ */}
        <div style={{ position: "relative", width: "200px", height: "200px", margin: "0 auto 32px" }}>

          {/* Outer progress ring */}
          <svg width="200" height="200" style={{ position: "absolute", top: 0, left: 0, transform: "rotate(-90deg)" }}>
            {/* Track */}
            <circle cx="100" cy="100" r="94" fill="none" stroke="rgba(123,94,167,0.08)" strokeWidth="1"/>
            {/* Progress arc */}
            <circle
              cx="100" cy="100" r="54"
              fill="none"
              stroke="#9d7fd4"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={`${strokeDash} ${circumference}`}
              style={{ filter: "drop-shadow(0 0 4px #9d7fd4)", transition: "stroke-dasharray 0.1s linear" }}
            />
            {/* Outer decorative ring */}
            <circle cx="100" cy="100" r="90" fill="none" stroke="rgba(123,94,167,0.06)" strokeWidth="0.5" strokeDasharray="4 8"/>
          </svg>

          {/* Targeting brackets around image */}
          <svg width="200" height="200" style={{ position: "absolute", top: 0, left: 0 }}>
            {/* Top-left bracket */}
            <path d="M28 52 L28 28 L52 28" stroke="#9d7fd4" strokeOpacity="0.7" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
            {/* Top-right bracket */}
            <path d="M172 52 L172 28 L148 28" stroke="#9d7fd4" strokeOpacity="0.7" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
            {/* Bottom-left bracket */}
            <path d="M28 148 L28 172 L52 172" stroke="#9d7fd4" strokeOpacity="0.7" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
            {/* Bottom-right bracket */}
            <path d="M172 148 L172 172 L148 172" stroke="#9d7fd4" strokeOpacity="0.7" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
            {/* Center crosshair dots */}
            <circle cx="100" cy="28" r="1.5" fill="#9d7fd4" fillOpacity="0.5"/>
            <circle cx="100" cy="172" r="1.5" fill="#9d7fd4" fillOpacity="0.5"/>
            <circle cx="28" cy="100" r="1.5" fill="#9d7fd4" fillOpacity="0.5"/>
            <circle cx="172" cy="100" r="1.5" fill="#9d7fd4" fillOpacity="0.5"/>
          </svg>

          {/* Product image or placeholder */}
          <div style={{
            position: "absolute",
            top: "30px", left: "30px",
            width: "140px", height: "140px",
            borderRadius: "12px",
            overflow: "hidden",
            border: "1px solid rgba(123,94,167,0.3)",
            background: "var(--bg-card)",
          }}>
            {preview ? (
              // Local data: URL, same as on the landing page. Nothing for the
              // image optimizer to do with it.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true" opacity="0.5">
                  <circle cx="17" cy="17" r="9" stroke="#9d7fd4" strokeWidth="1.3" strokeDasharray="3 4" />
                  <circle cx="17" cy="17" r="2" fill="#9d7fd4" />
                  <path d="M17 2 L17 7 M17 27 L17 32 M2 17 L7 17 M27 17 L32 17" stroke="#9d7fd4" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </div>
            )}

            {/* Red scan beam sweeping across */}
            <div style={{
              position: "absolute",
              left: 0, right: 0,
              top: `${scanY}%`,
              height: "2px",
              background: "linear-gradient(90deg, transparent, #ef4444 30%, #ef4444 70%, transparent)",
              boxShadow: "0 0 8px #ef4444, 0 0 16px rgba(239,68,68,0.4)",
              transition: "top 0.016s linear",
            }} />

            {/* Red scan glow above beam */}
            <div style={{
              position: "absolute",
              left: 0, right: 0,
              top: `${Math.max(0, scanY - 8)}%`,
              height: "10%",
              background: `linear-gradient(to ${scanDirection > 0 ? "bottom" : "top"}, rgba(239,68,68,0.06), transparent)`,
              pointerEvents: "none",
            }} />

          </div>

        </div>

        {/* ═══ CURRENT STAGE ═══ */}
        <div style={{ textAlign: "center", marginBottom: "28px", overflow: "hidden" }}>
          <h2 key={extended ? "ext" : stageIndex} style={{
            fontFamily: "var(--font-display), sans-serif",
            fontSize: "18px",
            fontWeight: "700",
            letterSpacing: "-0.4px",
            color: "var(--text)",
            marginBottom: "4px",
            animation: "stageFadeUp 0.3s ease forwards",
          }}>
            {extended ? EXTENDED_STAGE.label : SCAN_STAGES[stageIndex].label}
          </h2>
          <p key={extended ? "dext" : `d${stageIndex}`} style={{
            fontFamily: "var(--font-mono), ui-monospace, monospace",
            fontSize: "11px",
            color: "rgba(238,238,246,0.55)",
            letterSpacing: "0.5px",
            animation: "stageFadeUp 0.3s ease 0.05s forwards",
            opacity: 0,
          }}>
            {extended ? EXTENDED_STAGE.detail : SCAN_STAGES[stageIndex].detail}
          </p>
        </div>

        {/* ═══ STAGE PROGRESS DOTS ═══ */}
        <div style={{ display: "flex", justifyContent: "center", gap: "6px", marginBottom: "28px" }}>
          {SCAN_STAGES.map((_, i) => (
            <div key={i} style={{
              width: i === stageIndex ? "20px" : "5px",
              height: "5px",
              borderRadius: "3px",
              background: i < stageIndex ? "#10d9a0" : i === stageIndex ? "#9d7fd4" : "rgba(255,255,255,0.08)",
              boxShadow: i === stageIndex ? "0 0 6px #9d7fd4" : "none",
              transition: "all 0.4s ease",
            }} />
          ))}
        </div>

        {/* ═══ ELAPSED ═══
            The one live number on this screen, straight off the clock. The
            layer list that lit up "CONFIRMED" on a timer and a "records swept"
            figure computed from elapsed time are gone: neither was reporting
            anything the scan had actually done. */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div style={{ padding: "10px 22px", borderRadius: "8px", background: "rgba(123,94,167,0.05)", border: "1px solid rgba(123,94,167,0.14)", textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "9px", color: "rgba(184,160,232,0.7)", letterSpacing: "1px", marginBottom: "2px" }}>ELAPSED</div>
            <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "14px", color: "var(--text-2)", fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>
              {(elapsedMs / 1000).toFixed(2)}s
            </div>
          </div>
        </div>
        <div style={{ marginTop: "8px", textAlign: "center", fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "9px", color: "rgba(238,238,246,0.35)", letterSpacing: "1px" }}>
          {extended ? "EXTENDED SEARCH" : `STAGE ${stageIndex + 1} / ${SCAN_STAGES.length}`}
        </div>
      </div>
    </div>
  );
}
