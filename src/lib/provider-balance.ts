/**
 * What the search accounts have left, from their account endpoints. Both
 * lookups are free: neither spends a search or a credit. Only numbers are
 * returned, because an account payload can carry the key and the owner's
 * email. Read by /api/diagnose and /api/stats (and so by the watchdog and the
 * weekly brief).
 */
export interface Balance {
  known: boolean;
  left?: number;
  status?: number;
  detail?: string;
}

/** Serper's remaining credits. Its account endpoint is not in its public docs; production answers it (run 5). */
export async function serperCreditsLeft(): Promise<Balance & { fields?: Record<string, number> }> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return { known: false, detail: "SERPER_API_KEY is not set" };
  try {
    const res = await fetch("https://google.serper.dev/account", { headers: { "X-API-KEY": key }, signal: AbortSignal.timeout(6000) });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const fields = Object.fromEntries(Object.entries(body).filter(([, v]) => typeof v === "number")) as Record<string, number>;
    const balance = ["balance", "credits", "creditsLeft", "credits_left", "remaining"].map(k => body[k]).find(v => typeof v === "number");
    return res.ok && typeof balance === "number"
      ? { known: true, left: balance, fields }
      : { known: false, status: res.status, fields, detail: "the account endpoint gave no balance; see serper.dev" };
  } catch (err) {
    return { known: false, detail: String((err as Error)?.message || err).slice(0, 200) };
  }
}

/** SerpApi's remaining searches this month. */
export async function serpApiSearchesLeft(): Promise<Balance> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return { known: false, detail: "SERPAPI_KEY is not set" };
  try {
    const res = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(6000) });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const left = Number(body.total_searches_left ?? body.plan_searches_left);
    return res.ok && Number.isFinite(left) ? { known: true, left } : { known: false, status: res.status, detail: String(body.error || "no remaining count").slice(0, 200) };
  } catch (err) {
    return { known: false, detail: String((err as Error)?.message || err).slice(0, 200) };
  }
}
