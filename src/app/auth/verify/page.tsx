"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function VerifyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");

  useEffect(() => {
    if (!token) { router.push("/?auth=failed"); return; }
    // Redirect to the API which sets the cookie and redirects
    window.location.href = `/api/auth?token=${token}`;
  }, [token, router]);

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "#08080f"
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{
          width: "40px", height: "40px", borderRadius: "50%",
          border: "2.5px solid rgba(123,94,167,0.2)",
          borderTopColor: "#9d7fd4", margin: "0 auto 20px",
          animation: "spin 0.9s linear infinite"
        }} />
        <p style={{ color: "rgba(238,238,248,0.5)", fontSize: "15px" }}>
          Verifying your access...
        </p>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div style={{ background: "#08080f", minHeight: "100vh" }} />}>
      <VerifyInner />
    </Suspense>
  );
}
