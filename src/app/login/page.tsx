"use client";

import { useState, Suspense } from "react";

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
        setError(d.error || "No paid account found for this email.");
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
      background: "var(--bg)", fontFamily: "'Inter', sans-serif",
      position: "relative",
    }}>
      {/* Ambient */}
      <div style={{
        position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)",
        width: "700px", height: "400px",
        background: "radial-gradient(ellipse at 50% 0%, rgba(123,94,167,0.08) 0%, transparent 65%)",
        pointerEvents: "none",
      }} />

      <div style={{ maxWidth: "400px", width: "100%", position: "relative", zIndex: 1 }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "9px", marginBottom: "8px" }}>
            <svg width="32" height="32" viewBox="0 0 28 28" fill="none">
              <rect width="28" height="28" rx="8" fill="url(#lgl)"/>
              <defs>
                <linearGradient id="lgl" x1="0" y1="0" x2="28" y2="28">
                  <stop stopColor="#9d7fd4"/>
                  <stop offset="1" stopColor="#7b5ea7"/>
                </linearGradient>
              </defs>
              <circle cx="14" cy="13" r="5" stroke="white" strokeWidth="2"/>
              <path d="M17.5 16.5L21 20" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: "700", fontSize: "20px", letterSpacing: "-0.5px",
              color: "var(--text)",
            }}>BustedLab</span>
          </div>
          <p style={{ fontSize: "14px", color: "var(--text-2)", lineHeight: "1.5" }}>
            Sign in to access your unlimited scans
          </p>
        </div>

        <div style={{
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: "20px", overflow: "hidden",
        }}>

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
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: "20px", fontWeight: "700", marginBottom: "8px",
              }}>Check your inbox</h2>
              <p style={{ color: "var(--text-2)", fontSize: "14px", lineHeight: "1.6" }}>
                A sign-in link is on its way to <strong style={{ color: "var(--text)" }}>{email}</strong>. Tap it to get in instantly.
              </p>
              <p style={{ color: "var(--text-3)", fontSize: "12px", marginTop: "16px" }}>
                Expires in 15 minutes. Check spam if it doesn't arrive.
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
                    style={{
                      width: "100%", padding: "12px 16px",
                      background: "var(--bg-glass)",
                      border: "1px solid var(--border-mid)",
                      borderRadius: "10px", color: "var(--text)",
                      fontSize: "14px", outline: "none",
                      fontFamily: "'Inter', sans-serif",
                      marginBottom: "10px", boxSizing: "border-box",
                    }}
                    onFocus={e => (e.target.style.borderColor = "var(--accent-2)")}
                    onBlur={e => (e.target.style.borderColor = "var(--border-mid)")}
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
                      width: "100%", padding: "13px",
                      borderRadius: "10px", fontSize: "14px",
                      fontWeight: "700",
                      fontFamily: "'Space Grotesk', sans-serif",
                      opacity: sending || !email ? 0.4 : 1,
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
          <a href="/" style={{ color: "var(--accent-bright)", textDecoration: "none" }}>
            Get access for $4.99
          </a>
        </p>

        <p style={{
          textAlign: "center", fontSize: "11px",
          color: "var(--text-3)", marginTop: "12px",
        }}>
          <a href="/terms" style={{ color: "var(--text-3)", textDecoration: "none" }}>Terms</a>
          {" "}&middot;{" "}
          <a href="/privacy" style={{ color: "var(--text-3)", textDecoration: "none" }}>Privacy</a>
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: "32px", height: "32px", borderRadius: "50%", border: "2px solid rgba(123,94,167,0.2)", borderTopColor: "#9d7fd4" }} className="animate-spin" />
      </div>
    }>
      <LoginInner />
    </Suspense>
  );
}
