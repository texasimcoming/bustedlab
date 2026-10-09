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
      minHeight: "100vh", display: "flex", alignItems: "center", position: "relative",
      justifyContent: "center", background: "var(--bg)", padding: "24px"
    }}>
      <div className="page-light" aria-hidden="true" style={{ background: "radial-gradient(55% 55% at 50% 0%, rgba(16,217,160,0.14) 0%, transparent 75%)" }} />
      <div style={{ textAlign: "center", maxWidth: "400px", position: "relative", zIndex: 1 }}>
        {/* The end of the purchase is its peak: the mark locks in once, in
            the colour the site keeps for a real, confirmed price. */}
        <div className="success-mark" aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 12 12" fill="none">
            <path d="M2 6.2L4.6 9L10 2.5" stroke="#10d9a0" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 style={{
          fontSize: "34px", fontWeight: "760",
          color: "#f5f3ff", letterSpacing: "-0.04em", marginBottom: "12px"
        }}>
          You&apos;re in.
        </h1>
        <p style={{ color: "var(--text-2)", fontSize: "15.5px", lineHeight: "1.6" }}>
          Unlimited scans are unlocking on this device. Your access link is in your inbox too, for any other device.
        </p>
        <p style={{
          color: "var(--text-2)", fontSize: "13px", marginTop: "28px"
        }}>
          Redirecting you back...
        </p>
        {/* The three seconds before the redirect, drawn: the wait is
            visible and has an end. */}
        <div className="success-bar" aria-hidden="true"><span /></div>
      </div>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<div style={{ background: "var(--bg)", minHeight: "100vh" }} />}>
      <SuccessInner />
    </Suspense>
  );
}
