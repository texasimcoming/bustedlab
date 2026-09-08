"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Suspense } from "react";

function SuccessInner() {
  const router = useRouter();
  useEffect(() => {
    setTimeout(() => router.push("/?payment=success"), 3000);
  }, [router]);

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
          fontFamily: "'Space Grotesk',sans-serif",
          fontSize: "26px", fontWeight: "700",
          color: "#eeeef8", letterSpacing: "-0.8px", marginBottom: "12px"
        }}>
          You're in.
        </h1>
        <p style={{ color: "rgba(238,238,248,0.55)", fontSize: "15px", lineHeight: "1.65" }}>
          Check your email - your access link just landed. Tap it to unlock unlimited scans on this device and every device you'll ever use.
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
