"use client";
import { useEffect } from "react";
import { Suspense } from "react";

function SuccessInner() {
  useEffect(() => {
    // Lemon Squeezy's confirmation modal links here. If its button navigated
    // only the checkout iframe rather than the whole page - which is Lemon
    // Squeezy's choice, and could not be confirmed - this page would be
    // sitting inside the overlay. It moves itself to the top level instead,
    // so the buyer lands on a real page whichever way the button works.
    // next.config.ts allows this page, and only this page, to be framed by
    // this origin so that it can load long enough to do this.
    if (window.top && window.top !== window.self) {
      try {
        window.top.location.href = window.location.href;
        return;
      } catch {
        /* a cross-origin parent is refused by X-Frame-Options before this runs */
      }
    }
    // A full navigation, not router.push. The home page reads ?payment=success
    // when it first renders, and a client-side push renders it before the
    // address bar changes, so the buyer arrived home with no confirmation.
    // replace() keeps Back from landing here again and bouncing forward.
    const timer = setTimeout(() => window.location.replace("/?payment=success"), 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "#08080f", padding: "24px"
    }}>
      <div style={{ textAlign: "center", maxWidth: "400px" }}>
        <div style={{
          width: "64px", height: "64px", borderRadius: "50%",
          background: "rgba(16,217,160,0.1)", border: "2px solid rgba(16,217,160,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 24px", fontSize: "28px"
        }}>✓</div>
        <h1 style={{
          fontFamily: "var(--font-display), sans-serif",
          fontSize: "26px", fontWeight: "700",
          color: "#eeeef8", letterSpacing: "-0.8px", marginBottom: "12px"
        }}>
          You&apos;re in.
        </h1>
        <p style={{ color: "rgba(238,238,248,0.55)", fontSize: "15px", lineHeight: "1.65" }}>
          Unlimited scans are unlocking on this device. Your access link is in your inbox too, for any other device.
        </p>
        <p style={{
          color: "rgba(238,238,248,0.3)", fontSize: "13px", marginTop: "24px"
        }}>
          Redirecting you back...
        </p>
      </div>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<div style={{ background: "#08080f", minHeight: "100vh" }} />}>
      <SuccessInner />
    </Suspense>
  );
}
