"use client";

import type { CSSProperties } from "react";

// The last resort: an error in the root layout itself, where the page's own
// error boundary cannot render because the layout around it is what failed.
// It has to supply its own <html>, <head> (the viewport, or phones draw it at
// desktop width) and <body>, and it cannot rely on the layout's fonts or
// stylesheet, so everything here is inline. It draws the
// same frame as every other status page (the violet light from above, the
// instrument's brackets around ERR, the mono label), so even this screen is
// plainly BustedLab. Its links are plain <a>, so going home reloads the page
// and gets a fresh layout instead of reusing the one that failed.
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const corner = (v: "top" | "bottom", h: "left" | "right"): CSSProperties => ({
  position: "absolute", [v]: "6px", [h]: "6px", width: "20px", height: "20px",
  borderStyle: "solid", borderColor: "#c9b8ff", borderWidth: 0,
  [`border${v === "top" ? "Top" : "Bottom"}Width`]: "2px",
  [`border${h === "left" ? "Left" : "Right"}Width`]: "2px",
  [`border${v === "top" ? "Top" : "Bottom"}${h === "left" ? "Left" : "Right"}Radius`]: "6px",
  filter: "drop-shadow(0 0 6px rgba(169,147,255,0.8))",
});
const cta: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: "52px",
  padding: "14px 32px", borderRadius: "16px", fontSize: "15.5px", fontWeight: 650,
  textDecoration: "none", cursor: "pointer", fontFamily: "inherit", boxSizing: "border-box",
};

export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>BustedLab</title>
      </head>
      <body style={{
        margin: 0, minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative",
        background: "#050409", color: "#f5f3ff", padding: "0 20px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}>
        <div aria-hidden="true" style={{
          position: "absolute", inset: "0 0 auto 0", height: "520px", pointerEvents: "none",
          background: "radial-gradient(60% 60% at 50% 0%, rgba(138,111,240,0.16) 0%, transparent 75%)",
        }} />
        <header style={{ position: "relative", width: "100%", maxWidth: "640px", margin: "0 auto", paddingTop: "18px" }}>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load on purpose: the layout that client navigation would reuse is what failed */}
          <a href="/" style={{ color: "#f5f3ff", textDecoration: "none", fontWeight: 760, fontSize: "17px", letterSpacing: "-0.03em" }}>BustedLab</a>
        </header>
        <main style={{
          position: "relative", flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", textAlign: "center", width: "100%", maxWidth: "400px", margin: "0 auto", padding: "16px 0 96px",
        }}>
          <div aria-hidden="true" style={{
            position: "relative", width: "132px", height: "96px", marginBottom: "26px", display: "flex",
            alignItems: "center", justifyContent: "center", borderRadius: "16px",
            background: "radial-gradient(circle at 50% 50%, rgba(138,111,240,0.14), transparent 70%)",
          }}>
            <span style={corner("top", "left")} />
            <span style={corner("top", "right")} />
            <span style={corner("bottom", "left")} />
            <span style={corner("bottom", "right")} />
            <span style={{ fontFamily: MONO, fontSize: "22px", fontWeight: 600, letterSpacing: "0.08em", color: "#e7defe", textShadow: "0 0 18px rgba(169,147,255,0.6)" }}>ERR</span>
          </div>
          <div style={{ fontFamily: MONO, fontSize: "11px", letterSpacing: "0.18em", color: "#c9b8ff", marginBottom: "12px" }}>SIGNAL LOST</div>
          <h1 style={{ fontSize: "32px", fontWeight: 760, letterSpacing: "-0.04em", lineHeight: 1.08, margin: "0 0 12px", textWrap: "balance" }}>Something broke on our side</h1>
          <p style={{ color: "rgba(245,243,255,0.72)", fontSize: "15px", lineHeight: 1.6, margin: "0 0 24px" }}>
            Not you, and nothing you did is lost. Try again in a moment.
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => retry()} style={{
              ...cta, border: "none", color: "#0b0915",
              background: "linear-gradient(180deg, #f7f3ff 0%, #d6c9ff 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 10px 28px -8px rgba(169,147,255,0.55), 0 0 0 1px rgba(201,184,255,0.35)",
            }}>
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load, as above */}
            <a href="/" style={{ ...cta, color: "#f5f3ff", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.11)" }}>
              Back to the scanner
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
