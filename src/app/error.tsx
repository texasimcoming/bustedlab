"use client";

import { useEffect } from "react";
import Link from "next/link";

// A page that throws while rendering. Without this, Next replaces the whole
// screen with its generic "Application error" text, which to someone who
// arrived from a post reads as a dead site. This keeps the page on brand,
// offers a retry (most failures here are a dependency having a bad moment),
// and leaves the error in the console and the server logs.
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Page error:", error.digest || error.message);
  }, [error]);

  return (
    <main style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: "24px", fontFamily: "var(--font-sans), sans-serif", position: "relative", zIndex: 1,
    }}>
      <div style={{ textAlign: "center", maxWidth: "380px" }}>
        <div style={{
          fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px",
          letterSpacing: "2.5px", color: "var(--text-3)", textTransform: "uppercase", marginBottom: "14px",
        }}>
          SIGNAL LOST
        </div>
        <h1 style={{
          fontFamily: "var(--font-display), sans-serif", fontSize: "30px", fontWeight: "760",
          letterSpacing: "-0.035em", color: "var(--text)", marginBottom: "10px",
        }}>
          Something broke on our side
        </h1>
        <p style={{ color: "var(--text-2)", fontSize: "14px", lineHeight: "1.6", marginBottom: "22px" }}>
          Not you, and nothing you did is lost. Try again in a moment.
        </p>
        <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={reset} className="btn-primary" style={{
            padding: "14px 32px", borderRadius: "14px", fontSize: "14px",
            fontWeight: "700", fontFamily: "var(--font-display), sans-serif",
          }}>
            Try again
          </button>
          <Link href="/" className="btn-ghost" style={{
            padding: "12px 22px", borderRadius: "10px", fontSize: "14px", textDecoration: "none",
            fontFamily: "var(--font-display), sans-serif",
          }}>
            Back to the scanner
          </Link>
        </div>
      </div>
    </main>
  );
}
