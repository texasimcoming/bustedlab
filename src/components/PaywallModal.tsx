"use client";

// Rebuilt to match the HUD language everywhere else in the app — corner
// brackets, monospace telemetry, dark scan-styled surface. The previous
// version was a generic centered modal with a lock emoji and a checkmark
// list, which broke the illusion at exactly the moment (the $4.99 ask)
// that most needs to feel like part of the same machine.
export default function PaywallModal({
  onClose, onCheckout, onLogin
}: {
  onClose: () => void;
  onCheckout: () => void;
  onLogin: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(5,5,10,0.88)",
        backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
        zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px", fontFamily: "'Inter', sans-serif",
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
            fontFamily: "monospace", fontSize: "10px", letterSpacing: "2px",
            color: "rgba(245,158,11,0.75)", textTransform: "uppercase",
          }}>
            FREE ACCESS LIMIT REACHED
          </span>
        </div>

        <div style={{ padding: "28px 28px 8px", position: "relative", zIndex: 1, textAlign: "center" }}>
          <h2 style={{
            fontFamily: "'Space Grotesk', sans-serif", fontSize: "24px", fontWeight: "800",
            letterSpacing: "-0.6px", color: "#eeeef6", marginBottom: "8px",
          }}>
            You've used your 2 daily scans
          </h2>
          <p style={{ color: "rgba(238,238,246,0.5)", fontSize: "14px", lineHeight: "1.6" }}>
            Unlock unlimited X-rays for a one-time $4.99 — no subscription, no renewal, no expiration.
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
              <span style={{ fontFamily: "monospace", fontSize: "12px", color: "rgba(238,238,246,0.6)", letterSpacing: "0.2px" }}>
                {f}
              </span>
            </div>
          ))}
        </div>

        <div style={{ padding: "20px 28px 28px", position: "relative", zIndex: 1 }}>
          <button
            onClick={onCheckout}
            className="btn-primary"
            style={{
              width: "100%", padding: "16px", borderRadius: "12px",
              fontSize: "16px", fontWeight: "700",
              fontFamily: "'Space Grotesk', sans-serif", marginBottom: "10px",
            }}
          >
            Unlock unlimited — $4.99
          </button>
          <button
            onClick={onLogin}
            style={{
              width: "100%", background: "none", border: "none",
              color: "rgba(238,238,246,0.35)", fontSize: "12px",
              cursor: "pointer", padding: "8px", fontFamily: "'Inter', sans-serif",
            }}
          >
            Already paid? Sign in with email
          </button>
        </div>
      </div>
    </div>
  );
}
