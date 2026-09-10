"use client";

import { useState } from "react";

// Rebuilt to match the HUD language everywhere else in the app — corner
// brackets, monospace telemetry, dark scan-styled surface. The previous
// version was a generic centered modal with a lock emoji and a checkmark
// list, which broke the illusion at exactly the moment (the $4.99 ask)
// that most needs to feel like part of the same machine.
export default function PaywallModal({
  onClose, onCheckout, onLogin, checkoutAvailable = true,
}: {
  onClose: () => void;
  onCheckout: () => void;
  onLogin: () => void;
  checkoutAvailable?: boolean;
}) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(5,5,10,0.88)",
        backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
        zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px", fontFamily: "var(--font-sans), sans-serif",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        maxWidth: "420px", width: "100%", borderRadius: "18px", overflow: "hidden",
        background: "#0d0d1c", border: "1px solid rgba(123,94,167,0.28)",
        position: "relative",
        boxShadow: "0 0 50px rgba(123,94,167,0.18), 0 24px 60px rgba(0,0,0,0.6)",
      }}>
        {/* Corner brackets — same motif as the scan/verdict screens */}
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ position: "absolute", top: "10px", left: "10px", zIndex: 2 }}>
          <path d="M1 8 L1 1 L8 1" stroke="#9d7fd4" strokeOpacity="0.6" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ position: "absolute", top: "10px", right: "10px", zIndex: 2 }}>
          <path d="M19 8 L19 1 L12 1" stroke="#9d7fd4" strokeOpacity="0.6" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ position: "absolute", bottom: "10px", left: "10px", zIndex: 2 }}>
          <path d="M1 12 L1 19 L8 19" stroke="#9d7fd4" strokeOpacity="0.6" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ position: "absolute", bottom: "10px", right: "10px", zIndex: 2 }}>
          <path d="M19 12 L19 19 L12 19" stroke="#9d7fd4" strokeOpacity="0.6" strokeWidth="1.5" strokeLinecap="round" />
        </svg>

        {/* Ambient glow, matching the scan surfaces */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse at 50% 0%, rgba(123,94,167,0.1) 0%, transparent 70%)",
        }} />

        {/* Header bar — same telemetry-strip pattern as VerdictCard */}
        <div style={{
          background: "linear-gradient(135deg, rgba(123,94,167,0.14) 0%, rgba(123,94,167,0.04) 100%)",
          borderBottom: "1px solid rgba(123,94,167,0.22)",
          padding: "14px 24px",
          display: "flex", alignItems: "center", gap: "8px",
          position: "relative", zIndex: 1,
        }}>
          <div style={{
            width: "6px", height: "6px", borderRadius: "50%",
            background: "#f59e0b", boxShadow: "0 0 6px #f59e0b",
          }} className="animate-pulse" />
          <span style={{
            fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10px", letterSpacing: "2px",
            color: "rgba(245,158,11,0.75)", textTransform: "uppercase",
          }}>
            FREE ACCESS LIMIT REACHED
          </span>
        </div>

        <div style={{ padding: "28px 28px 8px", position: "relative", zIndex: 1, textAlign: "center" }}>
          <h2 style={{
            fontFamily: "var(--font-display), sans-serif", fontSize: "24px", fontWeight: "800",
            letterSpacing: "-0.6px", color: "#eeeef6", marginBottom: "8px",
          }}>
            Free scan allowance spent
          </h2>
          <p style={{ color: "rgba(238,238,246,0.5)", fontSize: "14px", lineHeight: "1.6" }}>
            One payment of $4.99. Unlimited X-rays. No subscription, no renewal, no expiration.
          </p>
        </div>

        {/* Feature readout — styled like the scan engine's own data nodes */}
        <div style={{ padding: "18px 28px 4px", position: "relative", zIndex: 1 }}>
          {[
            "Unlimited product X-rays",
            "HD verdict cards built for sharing",
            "Works on every device, forever",
            "Apple Pay & Google Pay accepted",
          ].map(f => (
            <div key={f} style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "7px 10px", marginBottom: "4px", borderRadius: "7px",
              background: "rgba(123,94,167,0.05)",
            }}>
              <div style={{
                width: "5px", height: "5px", borderRadius: "50%",
                background: "#10d9a0", boxShadow: "0 0 5px rgba(16,217,160,0.6)", flexShrink: 0,
              }} />
              <span style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "12px", color: "rgba(238,238,246,0.6)", letterSpacing: "0.2px" }}>
                {f}
              </span>
            </div>
          ))}
        </div>

        <div style={{ padding: "20px 28px 28px", position: "relative", zIndex: 1 }}>
          <button
            onClick={onCheckout}
            className="btn-primary"
            disabled={!checkoutAvailable}
            style={{
              width: "100%", padding: "16px", borderRadius: "12px",
              fontSize: "16px", fontWeight: "700",
              fontFamily: "var(--font-display), sans-serif", marginBottom: "10px",
            }}
          >
            {checkoutAvailable ? "Unlock unlimited access. $4.99" : "Checkout offline"}
          </button>
          {!checkoutAvailable && (
            // Better a closed door that says so than a button that opens a
            // dead tab. This state appears only when CHECKOUT_URL is unset.
            <p style={{
              fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10px", letterSpacing: "1px",
              color: "rgba(245,158,11,0.6)", textAlign: "center", marginBottom: "8px",
              textTransform: "uppercase",
            }}>
              Payment channel temporarily closed
            </p>
          )}
          <button
            onClick={onLogin}
            style={{
              width: "100%", background: "none", border: "none",
              color: "rgba(238,238,246,0.35)", fontSize: "12px",
              cursor: "pointer", padding: "8px", fontFamily: "var(--font-sans), sans-serif",
            }}
          >
            Already paid? Sign in with email
          </button>

          {/* ── INTENT CAPTURE ──
              The person reading this used the product and ran out of it. If
              they close the tab without paying, they were previously gone
              permanently. This is the last moment they are reachable, and it
              is the highest-intent audience the product will ever have. The
              ask is deliberately not a second attempt at the sale: pushing
              the same $4.99 again after a decline converts nobody and costs
              the address too. */}
          <NotifyCapture />
        </div>
      </div>
    </div>
  );
}


function NotifyCapture() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state !== "idle") return;
    setState("sending");
    try {
      await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Submitting the form IS the consent, and the label above the field
        // states what the address is used for.
        body: JSON.stringify({ email, source: "paywall", consent: true }),
      });
    } catch {
      /* The address is a nice-to-have. Never show this person an error. */
    }
    setState("done");
  };

  if (state === "done") {
    return (
      <div style={{
        marginTop: "14px", paddingTop: "14px", borderTop: "1px solid rgba(255,255,255,0.06)",
        textAlign: "center",
      }}>
        <p style={{
          fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10px",
          letterSpacing: "1.4px", color: "#10d9a0", textTransform: "uppercase",
        }}>
          Logged. You will hear from us when the index expands.
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <p style={{
        fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "9.5px",
        letterSpacing: "1.3px", color: "rgba(238,238,246,0.3)", textTransform: "uppercase",
        marginBottom: "8px", textAlign: "center",
      }}>
        Not ready? Get notified as the index grows
      </p>
      <form onSubmit={submit} style={{ display: "flex", gap: "6px" }}>
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com"
          aria-label="Email address for product updates"
          style={{
            flex: 1, minWidth: 0, background: "rgba(255,255,255,0.028)",
            border: "1px solid rgba(255,255,255,0.09)", borderRadius: "8px",
            padding: "9px 12px", color: "#eeeef6", fontSize: "13px", outline: "none",
            fontFamily: "var(--font-sans), sans-serif",
          }}
        />
        <button
          type="submit"
          disabled={state === "sending" || !email}
          className="btn-ghost"
          style={{
            borderRadius: "8px", padding: "9px 14px", fontSize: "13px",
            fontFamily: "var(--font-display), sans-serif", fontWeight: "600",
            opacity: state === "sending" || !email ? 0.4 : 1,
          }}
        >
          {state === "sending" ? "..." : "Notify"}
        </button>
      </form>
      <p style={{
        fontSize: "9.5px", color: "rgba(238,238,246,0.22)", marginTop: "7px",
        lineHeight: "1.5", textAlign: "center",
      }}>
        Product updates only. No sharing, no selling, unsubscribe any time.
      </p>
    </div>
  );
}
