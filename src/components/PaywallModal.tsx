"use client";

export default function PaywallModal({
  onClose, onCheckout, onLogin
}: {
  onClose: () => void;
  onCheckout: () => void;
  onLogin: () => void;
}) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(7,7,16,0.85)", backdropFilter:"blur(12px)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:"24px" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{ maxWidth:"420px", width:"100%", borderRadius:"20px", overflow:"hidden", border:"1px solid rgba(123,94,167,0.25)" }}>

        {/* Top */}
        <div style={{ background:"rgba(123,94,167,0.08)", borderBottom:"1px solid var(--border)", padding:"28px 28px 24px", textAlign:"center" }}>
          <div style={{ fontSize:"36px", marginBottom:"12px" }}>🔒</div>
          <h2 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:"22px", fontWeight:"800", letterSpacing:"-0.6px", marginBottom:"8px" }}>Free scans used up</h2>
          <p style={{ color:"var(--text-2)", fontSize:"14px", lineHeight:"1.6" }}>
            You've used your 2 free daily scans. Unlock unlimited for a one-time $4.99 - no subscription, no renewal.
          </p>
        </div>

        {/* Features */}
        <div style={{ padding:"20px 28px" }}>
          {["Unlimited product X-rays", "HD verdict cards built for sharing", "Works on every device, forever", "Apple Pay & Google Pay accepted"].map(f => (
            <div key={f} style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"10px" }}>
              <div style={{ width:"18px", height:"18px", borderRadius:"50%", background:"var(--green-dim)", border:"1px solid var(--green-border)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"10px", color:"var(--green)", flexShrink:0 }}>✓</div>
              <span style={{ fontSize:"14px", color:"var(--text-2)" }}>{f}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div style={{ padding:"0 28px 28px" }}>
          <button onClick={onCheckout} className="btn-primary" style={{ width:"100%", padding:"16px", borderRadius:"12px", fontSize:"16px", fontWeight:"700", fontFamily:"'Space Grotesk',sans-serif", marginBottom:"10px" }}>
            Unlock for $4.99 →
          </button>
          <button onClick={onLogin} style={{ width:"100%", background:"none", border:"none", color:"var(--text-3)", fontSize:"13px", cursor:"pointer", padding:"8px" }}>
            Already paid? Sign in with email
          </button>
        </div>
      </div>
    </div>
  );
}
