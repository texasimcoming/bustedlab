import type { Metadata } from "next";

/**
 * Where the unsubscribe link in a product update email opens. It asks
 * before removing anything: mail filters open every link in a message, and
 * a filter must never be the one that takes someone off the list. The
 * button posts the signed link to /api/notify/unsubscribe, which sends the
 * browser back here with the outcome.
 */
export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

const heading = {
  fontFamily: "var(--font-display), sans-serif",
  fontSize: "24px", fontWeight: "700",
  color: "#eeeef8", letterSpacing: "-0.6px", marginBottom: "10px",
} as const;
const body = { color: "rgba(238,238,248,0.55)", fontSize: "15px", lineHeight: "1.6", marginBottom: "24px" } as const;
const contact = <a href="mailto:privacy@bustedlab.com" style={{ color: "var(--accent-bright)" }}>privacy@bustedlab.com</a>;

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; token?: string; done?: string; invalid?: string; failed?: string }>;
}) {
  const { email, token, done, invalid, failed } = await searchParams;

  let content: React.ReactNode;
  if (done) {
    content = (
      <>
        <h1 style={heading}>You are unsubscribed</h1>
        <p style={body}>Your address is off the product update list and has been deleted. Nothing else about your account changes.</p>
      </>
    );
  } else if (invalid || !email || !token) {
    content = (
      <>
        <h1 style={heading}>This link did not work</h1>
        <p style={body}>It may have been cut short when it was copied. Email {contact} from the address you want removed and we will delete it.</p>
      </>
    );
  } else {
    const action = `/api/notify/unsubscribe?${new URLSearchParams({ email, token }).toString()}`;
    content = (
      <form method="post" action={action}>
        <h1 style={heading}>Unsubscribe from product updates?</h1>
        <p style={body}>
          {failed ? "That did not go through. Please try again. " : ""}
          <strong style={{ color: "#eeeef8" }}>{email}</strong> will be removed from the list and deleted.
        </p>
        <button type="submit" className="btn-primary" style={{
          padding: "14px 36px", borderRadius: "10px", fontSize: "15px", fontWeight: "700",
          fontFamily: "var(--font-display), sans-serif",
        }}>
          Unsubscribe
        </button>
      </form>
    );
  }

  return (
    <main style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "#08080f", padding: "24px",
    }}>
      <div style={{ textAlign: "center", maxWidth: "380px" }}>{content}</div>
    </main>
  );
}
