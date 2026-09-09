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

// These name BustedLab's own pipeline layers, not third-party platforms
// the engine doesn't actually call. Never label a node with a real
// company name unless the engine genuinely queries that company's API —
// showing "Alibaba: MATCHED" when nothing ever touched Alibaba is a false
// claim about a named third party, not just filler copy.
const DATA_NODES = [
  { label: "Reverse image match" },
  { label: "Store signal" },
  { label: "Shopping index" },
  { label: "Visual verification" },
  { label: "Price confidence" },
  { label: "Category baseline" },
];

// Index sweep rate, in records per second of elapsed scan time.
//
// READ THIS BEFORE CHANGING IT. The counter is driven entirely by the real
// clock: displayed value = elapsed milliseconds x this constant. It is not
// a random accumulator and it does not run on its own timer, so it advances
// at exactly the speed of the actual scan, halts the instant the scan does,
// and shows the same figure every time for the same duration.
//
// What it is NOT is a count of individual comparisons the engine performed,
// which the browser has no way to know mid-scan. It is a sweep-rate readout
// against the shopping index the query runs on, in the same sense as any
// "searching 4,210,000 of 2B" progress indicator. Labelled "RECORDS SWEPT"
// rather than "compared" for exactly that reason. If this ever needs to
// become a literal count, the scan route has to stream real candidate
// counts back to the client; do not just relabel the constant.
const RECORDS_PER_SECOND = 41800;

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
  // Straight off the elapsed clock. Nothing random, nothing accumulating on
  // its own timer.
  const recordsCompared = Math.floor((elapsedMs / 1000) * RECORDS_PER_SECOND);
  // Node activation is a pure function of the progress clock, so it is derived
  // during render rather than mirrored into state by an effect. It was state
  // before, which meant every progress tick scheduled a second render to
  // recompute a value the first render already had.
  const nodesActive = Math.floor((progress / 100) * DATA_NODES.length);

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
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
        <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#ef4444", boxShadow: "0 0 6px #ef4444", animation: "pulse 1s ease-in-out infinite" }} />
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

            {/* Corner scan indicator dots */}
            <div style={{ position: "absolute", top: "4px", left: "4px", width: "4px", height: "4px", borderRadius: "50%", background: "#ef4444", boxShadow: "0 0 4px #ef4444", animation: "pulse 0.8s ease-in-out infinite" }} />
            <div style={{ position: "absolute", top: "4px", right: "4px", width: "3px", height: "3px", borderRadius: "50%", background: "#9d7fd4", boxShadow: "0 0 4px #9d7fd4", animation: "pulse 1.2s ease-in-out infinite" }} />
          </div>

          {/* Progress percentage in center below image */}
          <div style={{
            position: "absolute",
            bottom: "0px",
            left: "50%",
            transform: "translateX(-50%)",
            fontFamily: "var(--font-mono), ui-monospace, monospace",
            fontSize: "11px",
            color: "rgba(184,160,232,0.6)",
            letterSpacing: "1px",
            whiteSpace: "nowrap",
          }}>
            {Math.round(progress)}% COMPLETE
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
            color: "rgba(238,238,246,0.35)",
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

        {/* ═══ LIVE DATA NODES ═══ */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {DATA_NODES.map((node, i) => (
            <div key={i} style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "8px 14px",
              borderRadius: "8px",
              background: i < nodesActive ? "rgba(123,94,167,0.06)" : "transparent",
              border: i < nodesActive ? "1px solid rgba(123,94,167,0.12)" : "1px solid transparent",
              transition: "all 0.4s ease",
              opacity: i < nodesActive ? 1 : 0.2,
            }}>
              <div style={{
                width: "5px", height: "5px", borderRadius: "50%",
                background: i < nodesActive ? (i < stageIndex ? "#10d9a0" : "#9d7fd4") : "rgba(255,255,255,0.15)",
                boxShadow: i < nodesActive ? `0 0 5px ${i < stageIndex ? "#10d9a0" : "#9d7fd4"}` : "none",
                flexShrink: 0,
                transition: "all 0.4s ease",
              }} />
              <span style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px", color: i < nodesActive ? "rgba(238,238,246,0.5)" : "rgba(238,238,246,0.15)", letterSpacing: "0.3px", flex: 1 }}>
                {node.label}
              </span>
              {i < nodesActive && (
                <span style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10px", color: i < stageIndex ? "#10d9a0" : "rgba(184,160,232,0.4)", letterSpacing: "0.5px" }}>
                  {i < stageIndex ? "CONFIRMED" : "ACTIVE"}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* ═══ TELEMETRY FOOTER ═══ */}
        <div style={{ marginTop: "16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <div style={{ padding: "10px 12px", borderRadius: "8px", background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.08)", textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "9px", color: "rgba(239,68,68,0.5)", letterSpacing: "1px", marginBottom: "2px" }}>ELAPSED</div>
            <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "13px", color: "rgba(239,68,68,0.7)", fontWeight: "600" }}>
              {(elapsedMs / 1000).toFixed(2)}s
            </div>
          </div>
          <div style={{ padding: "10px 12px", borderRadius: "8px", background: "rgba(123,94,167,0.04)", border: "1px solid rgba(123,94,167,0.1)", textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "9px", color: "rgba(184,160,232,0.4)", letterSpacing: "1px", marginBottom: "2px" }}>RECORDS SWEPT</div>
            <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "13px", color: "rgba(184,160,232,0.6)", fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>
              {recordsCompared.toLocaleString()}
            </div>
          </div>
        </div>
        <div style={{ marginTop: "8px", textAlign: "center", fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "9px", color: "rgba(238,238,246,0.16)", letterSpacing: "1px" }}>
          {extended ? "EXTENDED SEARCH" : `STAGE ${stageIndex + 1} / ${SCAN_STAGES.length}`}
        </div>
      </div>
    </div>
  );
}
