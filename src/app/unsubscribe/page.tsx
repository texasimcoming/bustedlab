import type { Metadata } from "next";
import StatusPage from "@/components/StatusPage";

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
        <h1 className="status-title balance">You are unsubscribed</h1>
        <p className="status-text">Your address is off the product update list and has been deleted. Nothing else about your account changes.</p>
      </>
    );
  } else if (invalid || !email || !token) {
    content = (
      <>
        <h1 className="status-title balance">This link did not work</h1>
        <p className="status-text">It may have been cut short when it was copied. Email {contact} from the address you want removed and we will delete it.</p>
      </>
    );
  } else {
    const action = `/api/notify/unsubscribe?${new URLSearchParams({ email, token }).toString()}`;
    content = (
      <form method="post" action={action}>
        <h1 className="status-title balance">Unsubscribe from product updates?</h1>
        <p className="status-text">
          {failed ? "That did not go through. Please try again. " : ""}
          <strong style={{ color: "#f5f3ff" }}>{email}</strong> will be removed from the list and deleted.
        </p>
        <button type="submit" className="btn-primary status-cta">
          Unsubscribe
        </button>
      </form>
    );
  }

  return (
    <StatusPage label="PRODUCT UPDATES">
      {content}
    </StatusPage>
  );
}
