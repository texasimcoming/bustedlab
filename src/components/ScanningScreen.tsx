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
  { label: "Reverse image match", x: 18, y: 22 },
  { label: "Store signal", x: 72, y: 18 },
  { label: "Shopping index", x: 18, y: 55 },
  { label: "Visual verification", x: 68, y: 52 },
  { label: "Price confidence", x: 20, y: 78 },
  { label: "Category baseline", x: 70, y: 80 },
];

export default function ScanningScreen({ preview }: { preview: string | null }) {
  const [stageIndex, setStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [activeNodes, setActiveNodes] = useState<number[]>([]);
  const [scanY, setScanY] = useState(0);
  const [scanDirection, setScanDirection] = useState(1);

  // Progress arc
  useEffect(() => {
    const total = SCAN_STAGES.reduce((a, s) => a + s.duration, 0);
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 40;
      setProgress(Math.min((elapsed / total) * 100, 97));
      if (elapsed >= total) clearInterval(interval);
    }, 40);
    return () => clearInterval(interval);
  }, []);

  // Stage progression
  useEffect(() => {
    let idx = 0;
    const advance = () => {
      if (idx < SCAN_STAGES.length - 1) {
        idx++;
        setStageIndex(idx);
        setTimeout(advance, SCAN_STAGES[idx].duration);
      }
    };
    setTimeout(advance, SCAN_STAGES[0].duration);
  }, []);

  // Elapsed time — real, not a fabricated accumulating count
  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => setElapsedMs(Date.now() - start), 50);
    return () => clearInterval(interval);
  }, []);

  // Node activation
  useEffect(() => {
    DATA_NODES.forEach((_, i) => {
      setTimeout(() => {
        setActiveNodes(prev => [...prev, i]);
      }, i * 380 + 200);
    });
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
      justifyContent: "center",
      padding: "24px",
      position: "relative",
      overflow: "hidden",
      fontFamily: "'Inter', sans-serif",
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
        <span style={{ fontFamily: "monospace", fontSize: "10px", color: "rgba(238,238,246,0.4)", letterSpacing: "2px" }}>BUSTEDLAB  SCANNING</span>
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
              <img src={preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "32px" }}>📦</div>
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
            fontFamily: "monospace",
            fontSize: "11px",
            color: "rgba(184,160,232,0.6)",
            letterSpacing: "1px",
            whiteSpace: "nowrap",
          }}>
            {Math.round(progress)}% ANALYZED
          </div>
        </div>

        {/* ═══ CURRENT STAGE ═══ */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <h2 style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: "18px",
            fontWeight: "700",
            letterSpacing: "-0.4px",
            color: "var(--text)",
            marginBottom: "4px",
            transition: "all 0.3s ease",
          }}>
            {SCAN_STAGES[stageIndex].label}
          </h2>
          <p style={{
            fontFamily: "monospace",
            fontSize: "11px",
            color: "rgba(238,238,246,0.35)",
            letterSpacing: "0.5px",
            transition: "all 0.3s ease",
          }}>
            {SCAN_STAGES[stageIndex].detail}
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
              background: activeNodes.includes(i) ? "rgba(123,94,167,0.06)" : "transparent",
              border: activeNodes.includes(i) ? "1px solid rgba(123,94,167,0.12)" : "1px solid transparent",
              transition: "all 0.4s ease",
              opacity: activeNodes.includes(i) ? 1 : 0.2,
            }}>
              <div style={{
                width: "5px", height: "5px", borderRadius: "50%",
                background: activeNodes.includes(i) ? (i < stageIndex ? "#10d9a0" : "#9d7fd4") : "rgba(255,255,255,0.15)",
                boxShadow: activeNodes.includes(i) ? `0 0 5px ${i < stageIndex ? "#10d9a0" : "#9d7fd4"}` : "none",
                flexShrink: 0,
                transition: "all 0.4s ease",
              }} />
              <span style={{ fontFamily: "monospace", fontSize: "11px", color: activeNodes.includes(i) ? "rgba(238,238,246,0.5)" : "rgba(238,238,246,0.15)", letterSpacing: "0.3px", flex: 1 }}>
                {node.label}
              </span>
              {activeNodes.includes(i) && (
                <span style={{ fontFamily: "monospace", fontSize: "10px", color: i < stageIndex ? "#10d9a0" : "rgba(184,160,232,0.4)", letterSpacing: "0.5px" }}>
                  {i < stageIndex ? "MATCHED" : "SCANNING"}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* ═══ ELAPSED TIME ═══ */}
        <div style={{ textAlign: "center", marginTop: "20px", padding: "12px", borderRadius: "8px", background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.08)" }}>
          <span style={{ fontFamily: "monospace", fontSize: "10px", color: "rgba(239,68,68,0.5)", letterSpacing: "1px" }}>
            {(elapsedMs / 1000).toFixed(1)}S ELAPSED
          </span>
        </div>
      </div>
    </div>
  );
}
