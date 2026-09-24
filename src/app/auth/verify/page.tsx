import type { Metadata } from "next";
import { redirect } from "next/navigation";
import SubmitOnLoad from "./SubmitOnLoad";

/**
 * Where every sign-in link opens.
 *
 * Opening it signs nobody in. Mail filters open links before people do, and
 * when this page was a redirect straight into the route that spent the
 * token, the filter was the one that signed in: the customer's click arrived
 * second and got "Link expired", and so did every replacement link. The
 * token now travels on to /api/auth/verify in a POST, which a real browser
 * sends straight away (SubmitOnLoad) and a link scanner does not send at all.
 * With scripts off, the button does the same thing.
 */
export const metadata: Metadata = {
  title: "Signing in",
  robots: { index: false, follow: false },
};

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) redirect("/?auth=failed");

  return (
    <main style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "#08080f", padding: "24px",
    }}>
      <form id="sign-in" method="post" action="/api/auth/verify" style={{ textAlign: "center", maxWidth: "360px" }}>
        <input type="hidden" name="token" value={token} />
        <h1 style={{
          fontFamily: "var(--font-display), sans-serif",
          fontSize: "24px", fontWeight: "700",
          color: "#eeeef8", letterSpacing: "-0.6px", marginBottom: "10px",
        }}>
          Signing you in
        </h1>
        <p style={{ color: "rgba(238,238,248,0.55)", fontSize: "15px", lineHeight: "1.6", marginBottom: "24px" }}>
          One moment. If nothing happens, tap the button.
        </p>
        <button type="submit" className="btn-primary" style={{
          padding: "14px 36px", borderRadius: "10px", fontSize: "15px", fontWeight: "700",
          fontFamily: "var(--font-display), sans-serif",
        }}>
          Sign in
        </button>
      </form>
      <SubmitOnLoad formId="sign-in" />
    </main>
  );
}
