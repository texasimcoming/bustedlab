import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Not found",
  robots: { index: false, follow: false },
};

// Any address that is not a page. Next's default 404 is an unstyled line of
// text; somebody following a mistyped link from a post should land somewhere
// that still looks like the product and offers the one thing it does.
export default function NotFound() {
  return (
    <main style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: "24px", fontFamily: "var(--font-sans), sans-serif", position: "relative", zIndex: 1,
    }}>
      <div style={{ textAlign: "center", maxWidth: "380px" }}>
        <div style={{
          fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10px",
          letterSpacing: "2.5px", color: "var(--text-3)", textTransform: "uppercase", marginBottom: "14px",
        }}>
          404 &middot; NOTHING AT THIS ADDRESS
        </div>
        <h1 style={{
          fontFamily: "var(--font-display), sans-serif", fontSize: "26px", fontWeight: "800",
          letterSpacing: "-0.8px", color: "var(--text)", marginBottom: "10px",
        }}>
          This page does not exist
        </h1>
        <p style={{ color: "var(--text-2)", fontSize: "14px", lineHeight: "1.6", marginBottom: "22px" }}>
          The link may be mistyped or cut short. The scanner is one tap away.
        </p>
        <Link href="/" className="btn-primary" style={{
          display: "inline-block", padding: "12px 30px", borderRadius: "10px", fontSize: "14px",
          fontWeight: "700", fontFamily: "var(--font-display), sans-serif", textDecoration: "none",
        }}>
          Run a scan
        </Link>
      </div>
    </main>
  );
}
