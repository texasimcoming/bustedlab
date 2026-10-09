"use client";

import { useState, Suspense } from "react";
import Link from "next/link";

function LoginInner() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setSent(true);
      } else {
        const d = await res.json();
        setError(d.error || "Could not send a link. Try again.");
      }
    } catch {
      setError("Something went wrong. Try again.");
    }
    setSending(false);
  };

  return (
    <main style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", padding: "24px",
      background: "var(--bg)", fontFamily: "var(--font-sans), sans-serif",
      position: "relative",
    }}>
      <div className="page-light" aria-hidden="true" />

      <div style={{ maxWidth: "400px", width: "100%", position: "relative", zIndex: 1 }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          {/* The same mark as every other page. This one used to draw its
              own magnifier glyph, so the one page that asks for an email
              address was the one page wearing a different logo. */}
          <Link href="/" aria-label="BustedLab home" style={{ display: "inline-flex", alignItems: "center", gap: "10px", marginBottom: "8px", textDecoration: "none" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-120.webp" alt="" width={36} height={36} style={{ borderRadius: "9px", display: "block", objectFit: "cover" }} />
            <span className="brand-wordmark" style={{ fontSize: "21px", color: "var(--text)" }}>BustedLab</span>
          </Link>
          <p style={{ fontSize: "14px", color: "var(--text-2)", lineHeight: "1.5" }}>
            Sign in to access your unlimited scans
          </p>
        </div>

        <div className="card" style={{ borderRadius: "22px", overflow: "hidden" }}>

          {sent ? (
            <div style={{ padding: "40px 28px", textAlign: "center" }}>
              <div style={{
                width: "56px", height: "56px", borderRadius: "50%",
                background: "var(--green-dim)", border: "1px solid var(--green-border)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 20px", fontSize: "24px",
              }}>
                ✓
              </div>
              <h2 style={{
                fontSize: "22px", fontWeight: "750", letterSpacing: "-0.03em", marginBottom: "8px",
              }}>Check your inbox</h2>
              <p style={{ color: "var(--text-2)", fontSize: "14px", lineHeight: "1.6" }}>
                If <strong style={{ color: "var(--text)" }}>{email}</strong> has access, a sign-in link is on its way. Tap it to get in.
              </p>
              <p style={{ color: "var(--text-3)", fontSize: "12px", marginTop: "16px" }}>
                Expires in 15 minutes. Check spam if it does not arrive.
              </p>
            </div>
          ) : (
            <>
              {/* Magic link email form */}
              <div style={{ padding: "28px 28px 28px" }}>
                <form onSubmit={handleMagicLink}>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    required
                    aria-label="Email address"
                    className="field"
                    style={{ width: "100%", padding: "14px 16px", fontSize: "15px", marginBottom: "10px" }}
                  />
                  {error && (
                    <p style={{
                      fontSize: "12px", color: "var(--red)",
                      marginBottom: "10px", lineHeight: "1.5",
                    }}>{error}</p>
                  )}
                  <button
                    type="submit"
                    disabled={sending || !email}
                    className="btn-primary"
                    style={{
                      width: "100%", minHeight: "52px", padding: "14px",
                      borderRadius: "14px", fontSize: "15.5px",
                      opacity: sending || !email ? 0.45 : 1,
                    }}
                  >
                    {sending ? "Sending..." : "Send sign-in link"}
                  </button>
                </form>
              </div>
            </>
          )}
        </div>

        <p style={{
          textAlign: "center", fontSize: "12px",
          color: "var(--text-3)", marginTop: "20px", lineHeight: "1.6",
        }}>
          Only paid users can sign in.{" "}
          <Link href="/" style={{ color: "var(--accent-bright)", textDecoration: "none", display: "inline-block", padding: "10px 2px", margin: "-10px 0" }}>
            Get access for $4.99
          </Link>
        </p>

        <p style={{
          textAlign: "center", fontSize: "12px",
          color: "var(--text-3)", marginTop: "4px",
        }}>
          <Link href="/terms" style={{ color: "var(--text-2)", textDecoration: "none", display: "inline-block", padding: "12px 10px" }}>Terms</Link>
          &middot;
          <Link href="/privacy" style={{ color: "var(--text-2)", textDecoration: "none", display: "inline-block", padding: "12px 10px" }}>Privacy</Link>
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: "32px", height: "32px", borderRadius: "50%", border: "2px solid rgba(138,111,240,0.2)", borderTopColor: "#a993ff" }} className="animate-spin" />
      </div>
    }>
      <LoginInner />
    </Suspense>
  );
}
