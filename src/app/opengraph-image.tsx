import { ImageResponse } from "next/og";

// The share card. Statically generated at build time, so it costs nothing per
// request and cannot fail under load. Every BustedLab link pasted into a
// message, a comment or a post renders this instead of a blank rectangle,
// which is the difference between a growth loop that closes and one that
// leaks at the last step.
export const alt = "BustedLab. They built the price. We built the scanner.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#07070e",
          padding: "64px 72px",
          position: "relative",
        }}
      >
        {/* Ambient field, same subliminal centre-glow as the site */}
        <div
          style={{
            position: "absolute",
            top: -220,
            left: 240,
            width: 720,
            height: 620,
            background: "radial-gradient(circle at center, rgba(123,94,167,0.30) 0%, rgba(7,7,14,0) 68%)",
            display: "flex",
          }}
        />

        {/* Corner brackets, the same motif the scan and verdict screens use */}
        <div style={{ position: "absolute", top: 34, left: 34, width: 44, height: 44, borderTop: "3px solid rgba(157,127,212,0.55)", borderLeft: "3px solid rgba(157,127,212,0.55)", display: "flex" }} />
        <div style={{ position: "absolute", top: 34, right: 34, width: 44, height: 44, borderTop: "3px solid rgba(157,127,212,0.55)", borderRight: "3px solid rgba(157,127,212,0.55)", display: "flex" }} />
        <div style={{ position: "absolute", bottom: 34, left: 34, width: 44, height: 44, borderBottom: "3px solid rgba(157,127,212,0.55)", borderLeft: "3px solid rgba(157,127,212,0.55)", display: "flex" }} />
        <div style={{ position: "absolute", bottom: 34, right: 34, width: 44, height: 44, borderBottom: "3px solid rgba(157,127,212,0.55)", borderRight: "3px solid rgba(157,127,212,0.55)", display: "flex" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: "#10d9a0", display: "flex" }} />
          <div style={{ fontSize: 20, letterSpacing: 6, color: "rgba(184,160,232,0.62)", textTransform: "uppercase", display: "flex" }}>
            BustedLab
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 76, fontWeight: 800, color: "#eeeef6", letterSpacing: -2.4, lineHeight: 1.06, display: "flex" }}>
            They built the price.
          </div>
          <div style={{ fontSize: 76, fontWeight: 800, color: "#b8a0e8", letterSpacing: -2.4, lineHeight: 1.06, marginTop: 6, display: "flex" }}>
            We built the scanner.
          </div>
          <div style={{ fontSize: 27, color: "rgba(238,238,246,0.5)", marginTop: 26, lineHeight: 1.45, display: "flex" }}>
            The source price, the asking price, and the gap between them.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ display: "flex", padding: "10px 20px", borderRadius: 8, background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)", color: "#ef4444", fontSize: 21, fontWeight: 700, letterSpacing: 3 }}>
              BUSTED
            </div>
            <div style={{ display: "flex", padding: "10px 20px", borderRadius: 8, background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.28)", color: "#f59e0b", fontSize: 21, fontWeight: 700, letterSpacing: 3 }}>
              OVERPRICED
            </div>
            <div style={{ display: "flex", padding: "10px 20px", borderRadius: 8, background: "rgba(16,217,160,0.10)", border: "1px solid rgba(16,217,160,0.26)", color: "#10d9a0", fontSize: 21, fontWeight: 700, letterSpacing: 3 }}>
              FAIR PRICE
            </div>
          </div>
          <div style={{ fontSize: 21, color: "rgba(238,238,246,0.3)", letterSpacing: 2, display: "flex" }}>
            bustedlab.com
          </div>
        </div>
      </div>
    ),
    size
  );
}
