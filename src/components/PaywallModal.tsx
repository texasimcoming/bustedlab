"use client";

import { useEffect, useRef, useState } from "react";

// The same instrument as the rest of the app, at its calmest: one line of
// light along the top edge, plain white type, the lumen button, and who
// handles the card said right under it. On a phone it rises from the bottom
// as a sheet, where the thumb already is; on a wide screen it sits centred.
// No red, no countdown, no badge near the price.
// Why the modal is open decides what its header and title may claim.
//  - remaining 0: the visitor hit the wall. The original copy, unchanged.
//  - remaining > 0: they chose to upgrade with free scans still in hand, and
//    telling them their allowance is spent would be false.
//  - freeTierPaused: the day's free capacity ran out for everyone. They
//    still have scans, and cannot use them until midnight UTC.
// Everything below the title - features, price, buttons - is the same in
// all three.
function headline(remaining: number, freeTierPaused: boolean) {
  if (freeTierPaused) {
    return { label: "FREE CAPACITY FULL TODAY", title: "Free scans are paused until midnight UTC", warning: true };
  }
  if (remaining <= 0) {
    return { label: "FREE ACCESS LIMIT REACHED", title: "Free scan allowance spent", warning: true };
  }
  return { label: "GET UNLIMITED ACCESS", title: "Skip the daily limit", warning: false };
}

export default function PaywallModal({
  onClose, onCheckout, onLogin, checkoutAvailable = true, remaining, freeTierPaused = false, provider,
}: {
  onClose: () => void;
  onCheckout: () => void;
  onLogin: () => void;
  checkoutAvailable?: boolean;
  /** Free scans the visitor has left today, as the server last reported. */
  remaining: number;
  freeTierPaused?: boolean;
  /** Who takes the payment, as /api/checkout reports it. */
  provider?: string;
}) {
  const head = headline(remaining, freeTierPaused);
  // Amber for a wall, the brand accent for a choice.
  const signal = head.warning ? "#f59e0b" : "#a993ff";

  // A modal nobody can see how to leave reads as a trap, and a trap is the
  // opposite of the trust a $4.99 ask depends on. Escape and a visible
  // close button, plus focus moved into the dialog so keyboard and screen
  // reader users land on it.
  //
  // Runs once per opening. onClose arrives as a new function on every render
  // of the page (which re-renders whenever its scan counter ticks), so it is
  // read through a ref: re-running this on each render would pull focus out
  // of the email field below while someone is typing in it.
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywall-title"
      className="sheet-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={dialogRef} tabIndex={-1} className="sheet">
        <div className="sheet-grip" aria-hidden="true" />

        {/* Header strip: why the sheet is open, and the way out. */}
        <div style={{
          padding: "16px 22px 12px",
          display: "flex", alignItems: "center", gap: "8px",
          position: "relative", zIndex: 1,
        }}>
          <div style={{
            width: "6px", height: "6px", borderRadius: "50%",
            background: signal, boxShadow: `0 0 6px ${signal}`,
          }} />
          <span style={{
            fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px", letterSpacing: "1.8px",
            color: head.warning ? "#fbbf24" : "#d6c9ff", textTransform: "uppercase",
          }}>
            {head.label}
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              margin: "-6px -8px -6px auto", width: "44px", height: "44px", borderRadius: "12px",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
              color: "rgba(245,243,255,0.78)", cursor: "pointer", padding: 0,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={{ padding: "8px 24px 4px", position: "relative", zIndex: 1, textAlign: "center" }}>
          <h2 id="paywall-title" className="balance" style={{
            fontSize: "26px", fontWeight: "750",
            letterSpacing: "-0.03em", lineHeight: "1.15", color: "#f5f3ff", marginBottom: "10px",
          }}>
            {head.title}
          </h2>
          <p className="balance" style={{ color: "var(--text-2)", fontSize: "14.5px", lineHeight: "1.55", maxWidth: "340px", margin: "0 auto" }}>
            One payment of $4.99. Unlimited scans. No subscription, no renewal, no expiration.
          </p>
        </div>

        {/* Feature readout — styled like the scan engine's own data nodes */}
        <div style={{ padding: "18px 24px 4px", position: "relative", zIndex: 1 }}>
          {[
            "Unlimited product scans",
            "Works on every device, forever",
            "Apple Pay & Google Pay accepted",
          ].map(f => (
            <div key={f} style={{
              display: "flex", alignItems: "center", gap: "11px",
              padding: "9px 12px", marginBottom: "5px", borderRadius: "11px",
              background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)",
            }}>
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
                <path d="M2 6.2L4.6 9L10 2.5" stroke="#10d9a0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ fontSize: "14px", color: "var(--text)", fontWeight: 500 }}>
                {f}
              </span>
            </div>
          ))}
        </div>

        <div style={{ padding: "18px 24px calc(22px + env(safe-area-inset-bottom, 0px))", position: "relative", zIndex: 1 }}>
          <button
            onClick={onCheckout}
            className="btn-primary"
            disabled={!checkoutAvailable}
            style={{
              width: "100%", minHeight: "56px", padding: "16px", borderRadius: "16px",
              fontSize: "16.5px", marginBottom: "10px",
            }}
          >
            {checkoutAvailable ? "Unlock unlimited access. $4.99" : "Checkout offline"}
          </button>
          {/* Who handles the card, said next to the button that asks for it.
              Only when it is true: the checkout link can also be Gumroad. */}
          {checkoutAvailable && provider === "lemonsqueezy" && (
            <p style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
              fontSize: "12.5px", color: "var(--text-2)", margin: "2px 0 4px",
            }}>
              <svg width="11" height="12" viewBox="0 0 11 12" fill="none" aria-hidden="true">
                <rect x="1" y="5" width="9" height="6.2" rx="1.4" stroke="currentColor" strokeWidth="1.2" />
                <path d="M3.2 5V3.6a2.3 2.3 0 0 1 4.6 0V5" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              Secure checkout by Lemon Squeezy.
            </p>
          )}
          {!checkoutAvailable && (
            // Better a closed door that says so than a button that opens a
            // dead tab. Shown whenever /api/checkout says it is not safe to
            // take money: no CHECKOUT_URL, a provider that contradicts the
            // link, or no webhook secret to verify the purchase with.
            <p style={{
              fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px", letterSpacing: "1px",
              color: "#fbbf24", textAlign: "center", marginBottom: "8px",
              textTransform: "uppercase",
            }}>
              Payment channel temporarily closed
            </p>
          )}
          <button
            onClick={onLogin}
            style={{
              width: "100%", background: "none", border: "none",
              color: "var(--text-2)", fontSize: "13.5px", textDecoration: "underline", textUnderlineOffset: "3px",
              cursor: "pointer", padding: "12px 8px", fontFamily: "var(--font-sans), sans-serif",
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
          fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px",
          letterSpacing: "1.2px", color: "#10d9a0", textTransform: "uppercase",
        }}>
          Logged. You will hear from us when the index expands.
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <p style={{
        fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px",
        letterSpacing: "1.1px", color: "rgba(245,243,255,0.7)", textTransform: "uppercase",
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
          className="field"
          style={{ flex: 1, minWidth: 0, padding: "10px 12px", fontSize: "13px" }}
        />
        <button
          type="submit"
          disabled={state === "sending" || !email}
          className="btn-ghost"
          style={{
            borderRadius: "12px", padding: "10px 14px", fontSize: "13px", fontWeight: "600",
            opacity: state === "sending" || !email ? 0.4 : 1,
          }}
        >
          {state === "sending" ? "..." : "Notify"}
        </button>
      </form>
      <p style={{
        fontSize: "11px", color: "var(--text-3)", marginTop: "7px",
        lineHeight: "1.5", textAlign: "center",
      }}>
        Product updates only. No sharing, no selling, unsubscribe any time.
      </p>
    </div>
  );
}
