"use client";

export default function StickyBar({
  remaining, isPaid, onScan, hasFile, onUpgrade
}: {
  remaining: number;
  isPaid: boolean;
  onScan: () => void;
  hasFile: boolean;
  onUpgrade: () => void;
}) {
  if (isPaid) {
    return (
      <div className="sticky-bar">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--green)" }} className="animate-pulse" />
          <span style={{ fontSize: "13px", color: "var(--text-2)" }}>Unlimited access active</span>
        </div>
        <button onClick={onScan} className="btn-primary"
          style={{ borderRadius: "10px", padding: "10px 20px", fontSize: "14px", fontWeight: "600", fontFamily: "'Space Grotesk', sans-serif" }}>
          {hasFile ? "Run X-ray" : "Upload first"}
        </button>
      </div>
    );
  }

  return (
    <div className="sticky-bar">
      <div>
        <div style={{ display: "flex", gap: "6px", marginBottom: "3px" }}>
          {[0, 1].map(i => (
            <div key={i} style={{
              width: "28px", height: "4px", borderRadius: "2px",
              background: i < remaining ? "var(--accent-2)" : "var(--border-mid)",
              transition: "background 0.3s ease"
            }} />
          ))}
        </div>
        <span style={{ fontSize: "11px", color: "var(--text-3)" }}>
          {remaining > 0 ? `${remaining} free scan${remaining !== 1 ? "s" : ""} left today` : "Free scans used"}
        </span>
      </div>
      {remaining > 0 ? (
        <button onClick={onScan} className="btn-primary"
          style={{ borderRadius: "10px", padding: "10px 20px", fontSize: "14px", fontWeight: "600", fontFamily: "'Space Grotesk', sans-serif" }}>
          {hasFile ? "Run X-ray" : "Upload first"}
        </button>
      ) : (
        <button onClick={onUpgrade} className="btn-primary"
          style={{ borderRadius: "10px", padding: "10px 20px", fontSize: "14px", fontWeight: "700", fontFamily: "'Space Grotesk', sans-serif" }}>
          Unlock $4.99
        </button>
      )}
    </div>
  );
}
