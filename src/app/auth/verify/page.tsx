import { redirect } from "next/navigation";

/**
 * Magic-link landing.
 *
 * This used to be a client component that mounted, painted a spinner, ran an
 * effect and then assigned window.location to the API route: a full client
 * bundle, a render, and a visible delay to perform a redirect the server can
 * do in one hop with no JavaScript at all. Sign-in now works with scripts
 * blocked, and the flash of "Verifying your access..." is gone because there
 * is nothing left to verify on the client.
 *
 * New magic links point straight at /api/auth. This route stays so that links
 * already sitting in inboxes keep working.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) redirect("/?auth=failed");
  redirect(`/api/auth?token=${encodeURIComponent(token)}`);
}
