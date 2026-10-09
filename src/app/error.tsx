"use client";

import { useEffect } from "react";
import Link from "next/link";
import StatusPage from "@/components/StatusPage";

// A page that throws while rendering. Without this, Next replaces the whole
// screen with its generic "Application error" text, which to someone who
// arrived from a post reads as a dead site. This keeps the page on brand,
// offers a retry (most failures here are a dependency having a bad moment),
// and leaves the error in the console and the server logs.
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Page error:", error.digest || error.message);
  }, [error]);

  return (
    <StatusPage readout="ERR" label="SIGNAL LOST">
      <h1 className="status-title balance">Something broke on our side</h1>
      <p className="status-text">Not you, and nothing you did is lost. Try again in a moment.</p>
      <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
        <button onClick={reset} className="btn-primary status-cta">Try again</button>
        <Link href="/" className="btn-ghost status-cta">Back to the scanner</Link>
      </div>
    </StatusPage>
  );
}
