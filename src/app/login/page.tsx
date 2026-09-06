"use client";

import { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

function LoginInner() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/";

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
              {/* OAuth buttons */}
              <div style={{ padding: "28px 28px 0" }}>

                {/* Google */}
                <button
                  onClick={() => signIn("google", { callbackUrl })}
                  style={{
                    width: "100%", padding: "14px 20px",
                    borderRadius: "12px", fontSize: "15px",
                    fontWeight: "600", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    gap: "12px", marginBottom: "10px",
                    background: "white", color: "#1f1f1f",
                    border: "none", transition: "all 0.18s ease",
                    fontFamily: "'Inter', sans-serif",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-1px)")}
                  onMouseLeave={e => (e.currentTarget.style.transform = "none")}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </button>

                {/* Apple */}
                <button
                  onClick={() => signIn("apple", { callbackUrl })}
                  style={{
                    width: "100%", padding: "14px 20px",
                    borderRadius: "12px", fontSize: "15px",
                    fontWeight: "600", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    gap: "12px", marginBottom: "24px",
                    background: "#000", color: "white",
                    border: "none", transition: "all 0.18s ease",
                    fontFamily: "'Inter', sans-serif",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-1px)")}
                  onMouseLeave={e => (e.currentTarget.style.transform = "none")}
                >
                  <svg width="18" height="22" viewBox="0 0 18 22" fill="white">
                    <path d="M14.92 11.58c-.02-2.38 1.94-3.52 2.02-3.58-1.1-1.61-2.81-1.83-3.42-1.86-1.46-.15-2.85.86-3.59.86-.74 0-1.88-.84-3.1-.82C5.1 6.2 3.45 7.14 2.53 8.64.67 11.7 2.06 16.25 3.88 18.76c.9 1.28 1.98 2.72 3.4 2.67 1.37-.06 1.88-.88 3.54-.88 1.65 0 2.12.88 3.56.85 1.47-.02 2.41-1.31 3.3-2.6 1.05-1.49 1.48-2.94 1.5-3.01-.03-.02-2.88-1.1-2.9-4.21h.04zM12.58 3.54C13.3 2.65 13.79 1.43 13.66 0c-1.14.05-2.53.76-3.34 1.65C9.56 2.5 8.97 3.77 9.13 4.98c1.27.1 2.57-.65 3.45-1.44z"/>
                  </svg>
                  Continue with Apple
                </button>

                {/* Divider */}
                <div style={{
                  display: "flex", alignItems: "center", gap: "12px",
                  marginBottom: "20px",
                }}>
                  <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
                  <span style={{ fontSize: "12px", color: "var(--text-3)" }}>or sign in with email</span>
                  <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
                </div>
              </div>

              {/* Magic link email form */}
              <div style={{ padding: "0 28px 28px" }}>
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
                    style={{
                      width: "100%", padding: "12px",
                      borderRadius: "10px", fontSize: "14px",
                      fontWeight: "600", cursor: "pointer",
                      background: "var(--bg-glass)",
                      color: "var(--text-2)",
                      border: "1px solid var(--border-mid)",
                      fontFamily: "'Inter', sans-serif",
                      opacity: sending || !email ? 0.5 : 1,
                      transition: "all 0.18s ease",
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
