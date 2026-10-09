"use client";

// The last resort: an error in the root layout itself, where the page's own
// error boundary cannot render because the layout around it is what failed.
// It has to supply its own <html> and <body>, and it cannot rely on the
// layout's fonts or stylesheet, so everything here is inline.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#050409", color: "#f5f3ff", padding: "24px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}>
        <div style={{ textAlign: "center", maxWidth: "380px" }}>
          <h1 style={{ fontSize: "24px", fontWeight: 800, margin: "0 0 10px" }}>Something broke on our side</h1>
          <p style={{ color: "rgba(245,243,255,0.6)", fontSize: "14px", lineHeight: 1.6, margin: "0 0 22px" }}>
            Not you, and nothing you did is lost. Try again in a moment.
          </p>
          <button onClick={reset} style={{
            background: "linear-gradient(180deg, #f7f3ff, #d6c9ff)", color: "#0b0915", border: "none",
            padding: "14px 32px", borderRadius: "14px", fontSize: "14px", fontWeight: 700, cursor: "pointer",
          }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
