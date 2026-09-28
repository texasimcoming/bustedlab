/**
 * One /api/leaderboard request per page view, shared by every section of the
 * landing page that reads it: the boards, "What we catch" and the activity
 * toast.
 *
 * Asking for the same URL twice is not free even with the edge cache: the
 * response allows stale-while-revalidate, so the browser answers the second
 * ask from its own cache and then fetches it again in the background. A
 * request that has failed is not reused; the next caller tries again. After
 * REUSE_MS a caller gets a fresh request, so a tab left open does not show
 * the numbers it loaded with forever.
 */
const REUSE_MS = 60_000;

let shared: { at: number; data: Promise<unknown> } | null = null;

export function loadLeaderboard<T = unknown>(): Promise<T> {
  if (!shared || Date.now() - shared.at > REUSE_MS) {
    const data = fetch("/api/leaderboard").then(r => r.json());
    shared = { at: Date.now(), data };
    data.catch(() => {
      if (shared?.data === data) shared = null;
    });
  }
  return shared.data as Promise<T>;
}
