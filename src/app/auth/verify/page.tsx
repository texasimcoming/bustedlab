import type { Metadata } from "next";
import { redirect } from "next/navigation";
import SubmitOnLoad from "./SubmitOnLoad";
import StatusPage from "@/components/StatusPage";

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
    <StatusPage label="SIGNING IN">
      <form id="sign-in" method="post" action="/api/auth/verify">
        <input type="hidden" name="token" value={token} />
        <h1 className="status-title">Signing you in</h1>
        <p className="status-text">One moment. If nothing happens, tap the button.</p>
        <button type="submit" className="btn-primary status-cta">Sign in</button>
      </form>
      <SubmitOnLoad formId="sign-in" />
    </StatusPage>
  );
}
