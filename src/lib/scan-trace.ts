import { AsyncLocalStorage } from "node:async_hooks";

/**
 * PROVIDER ERROR IS NOT "NOTHING FOUND".
 *
 * Before this, every outside call in the engine (the Claude API, Google Lens
 * through SerpApi and Serper, Shopping search, the Blob upload Lens needs)
 * swallowed its own failure and returned null, which the next layer read as
 * "no result". A 400 from the verification gate therefore looked exactly like
 * a gate that had judged every candidate "different", and the scan went on to
 * print an unverified closest match, or "no match found", for a product the
 * engine never actually got to look at. Both live reports came from that.
 *
 * Now each failure is said out loud at the moment it happens (one log line:
 * layer, provider, model, HTTP status and a truncated error body, never a key
 * or an image) and recorded against the scan it belongs to. When the scan
 * finishes, decideFailure() looks at what failed and what was still
 * established, and either lets the result stand or replaces it with "this
 * scan could not be completed". The route then answers that state without
 * consuming a free scan, without caching it, and counts it as scan_failed
 * with its reason.
 *
 * The record is per scan through AsyncLocalStorage, because one serverless
 * instance runs several scans at once and a module-level list would mix them.
 */

export type FailureLayer =
  | "extraction" // reading brand, name and price off the photo
  | "gate"       // the visual verification gate
  | "lens"       // reverse image search
  | "shopping"   // text shopping search and store discovery
  | "upload"     // the temporary public copy Lens needs
  | "text"       // reading a price off a product page's text
  | "query"      // writing a search query from page text
  | "retailer"   // direct-retailer price check
  | "link"       // merchant link resolution
  | "fx"         // exchange rates
  | "engine";    // an exception in the engine itself

/**
 * How much a failure matters, decided where it happens:
 *  critical  - the result cannot be trusted whatever else succeeded.
 *  identity  - matters unless the product was still verified some other way.
 *  advisory  - an enhancement was lost; the answer is still honest.
 */
export type Severity = "critical" | "identity" | "advisory";

export interface ProviderFailure {
  layer: FailureLayer;
  provider: string;
  model?: string;
  /** HTTP status, or 0 for a timeout, network error or unreadable answer. */
  status: number;
  kind: string;
  detail: string;
  severity: Severity;
}

export interface ScanFailure {
  /** The first layer whose failure decided it. Also the analytics reason. */
  reason: FailureLayer;
  /** Every deciding failure, as layer:provider[:model]:status[:kind when it is the account's]. */
  layers: string[];
}

/** One model call, as the API reported it. */
export interface ModelCallRecord {
  layer: FailureLayer;
  model: string;
  effort: string | null;
  ms: number;
  status: number;
  kind: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  stopReason?: string | null;
  /** Output tokens less an estimate of the visible answer: what the model spent thinking. */
  thinkingApprox?: number;
}

/** One search-provider request. Counted because SerpApi bills per search. */
export interface SearchCallRecord {
  layer: FailureLayer;
  provider: string;
  engine: string;
  ms: number;
  status: number;
}

/** A decision point in the scan, for the evaluation trace. */
export type TraceStep = { step: string } & Record<string, unknown>;

/**
 * Everything one scan did. The failures decide the scan (decideFailure); the
 * rest is a record of what ran, how long it took and what it cost, which the
 * operator evaluation path returns with the result and nothing else reads.
 */
export interface ScanTrace {
  startedAt: number;
  failures: ProviderFailure[];
  calls: ModelCallRecord[];
  searches: SearchCallRecord[];
  steps: TraceStep[];
}

const traces = new AsyncLocalStorage<ScanTrace>();

export async function runTraced<T>(fn: () => Promise<T>): Promise<{ value: T; failures: ProviderFailure[]; trace: ScanTrace }> {
  const trace: ScanTrace = { startedAt: Date.now(), failures: [], calls: [], searches: [], steps: [] };
  const value = await traces.run(trace, fn);
  return { value, failures: trace.failures, trace };
}

export function recordModelCall(call: ModelCallRecord): void {
  traces.getStore()?.calls.push(call);
}

export function recordSearchCall(call: SearchCallRecord): void {
  traces.getStore()?.searches.push(call);
}

/** Notes a decision for the evaluation trace. Bounded, and never an image. */
export function traceStep(step: string, data: Record<string, unknown> = {}): void {
  const trace = traces.getStore();
  if (!trace || trace.steps.length >= 60) return;
  trace.steps.push({ step, at: Date.now() - trace.startedAt, ...data });
}

/**
 * fetch, timed and counted against the running scan. Every search-provider
 * request goes through this, so a scan's trace says how many paid searches
 * it spent and where its time went.
 */
export async function searchFetch(
  layer: FailureLayer,
  provider: string,
  engine: string,
  input: string,
  init?: RequestInit
): Promise<Response> {
  const started = Date.now();
  try {
    const res = await fetch(input, init);
    recordSearchCall({ layer, provider, engine, ms: Date.now() - started, status: res.status });
    return res;
  } catch (err) {
    recordSearchCall({ layer, provider, engine, ms: Date.now() - started, status: 0 });
    throw err;
  }
}

// Nothing secret or bulky reaches a log line: API keys are redacted by value
// and by shape, and anything that looks like base64 image data is dropped.
function scrub(text: string): string {
  let out = text;
  for (const name of ["ANTHROPIC_API_KEY", "SERPAPI_KEY", "SERPER_API_KEY", "BLOB_READ_WRITE_TOKEN"]) {
    const value = process.env[name];
    if (value && value.length >= 8) out = out.split(value).join("[redacted]");
  }
  return out
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/[A-Za-z0-9+/=]{120,}/g, "[data]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** One structured line per failed call, whether or not it was recovered. */
export function logProviderFailure(failure: Omit<ProviderFailure, "severity"> & { recovered?: boolean }): void {
  const fields = [
    `layer=${failure.layer}`,
    `provider=${failure.provider}`,
    failure.model ? `model=${failure.model}` : "",
    `status=${failure.status}`,
    `kind=${failure.kind}`,
    failure.recovered ? "recovered=true" : "",
    `error=${JSON.stringify(scrub(failure.detail || ""))}`,
  ].filter(Boolean);
  console.error(`[scan] provider call failed ${fields.join(" ")}`);
}

/** Records a failure against the running scan. Logged by the caller. */
export function recordProviderFailure(failure: ProviderFailure): void {
  traces.getStore()?.failures.push({ ...failure, detail: scrub(failure.detail || "") });
}

/** Whether this scan has already recorded a failure in `layer`. */
export function hasFailed(layer: FailureLayer, severity?: Severity): boolean {
  return (traces.getStore()?.failures || []).some(f => f.layer === layer && (!severity || f.severity === severity));
}

/**
 * Primary and backup providers for one layer. A provider that fails while
 * another one for the same layer ANSWERS (a result, or a genuine "no
 * results") has not cost the scan anything it can name: the layer was
 * served. So once any configured provider answers, the failures recorded
 * during this attempt in this layer stop deciding the scan (they stay in the
 * log). Without this, SerpApi running out of searches would turn every
 * honest "closest match" into "try again" for as long as it lasted, even
 * with Serper answering every request. An unconfigured provider is skipped
 * and is never an answer.
 */
export async function firstAnswer<T>(
  layer: FailureLayer,
  providers: { configured: boolean; run: () => Promise<T | null> }[],
  // Whether a provider that ANSWERED with nothing hands over to the next one
  // anyway. True for Lens, where the backup is a different index and cheap.
  // False for Shopping: the production evaluation found SerpApi's Google
  // Shopping fallback timing out at its 12 seconds on every one of 19 calls,
  // each one after Serper had already answered "no results" for the same
  // query, so it cost every such scan 12 seconds and bought nothing.
  { onEmpty = "next" }: { onEmpty?: "next" | "stop" } = {}
): Promise<{ value: T | null; index: number }> {
  const store = traces.getStore()?.failures;
  const start = store?.length ?? 0;
  let answered = false;
  const settle = () => {
    if (!answered || !store) return;
    for (const f of store.slice(start)) if (f.layer === layer && f.severity !== "critical") f.severity = "advisory";
  };
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    if (!provider.configured) continue;
    const before = store?.length ?? 0;
    const value = await provider.run();
    const failed = !!store && store.slice(before).some(f => f.layer === layer);
    if (!failed) answered = true;
    if (value) {
      settle();
      return { value, index: i };
    }
    if (!failed && onEmpty === "stop") break;
  }
  settle();
  return { value: null, index: -1 };
}

/** Both at once, for the common case. */
export function reportProviderFailure(failure: ProviderFailure): void {
  logProviderFailure(failure);
  recordProviderFailure(failure);
}

/**
 * Whether the scan stands. `verified` is true when the product was identified
 * by the gate (exact or likely), which is what an identity failure has to be
 * outweighed by.
 */
export function decideFailure(failures: ProviderFailure[], verified: boolean): ScanFailure | null {
  const deciding = failures.filter(f => f.severity === "critical" || (f.severity === "identity" && !verified));
  if (deciding.length === 0) return null;
  // The kind rides along when it names the account rather than the call
  // (a spend cap, no credit), so /api/stats says why at a glance.
  const layers = [...new Set(deciding.map(f =>
    [f.layer, f.provider, f.model, String(f.status), /spend_cap|credit_exhausted/.test(f.kind) ? f.kind : ""].filter(Boolean).join(":")
  ))];
  return { reason: deciding[0].layer, layers };
}

/** Reads a failed HTTP response's body for the log, bounded. */
export async function errorBody(res: Response): Promise<string> {
  try {
    return scrub(await res.text());
  } catch {
    return "";
  }
}

/**
 * The trace as the evaluation path returns it: every call and decision, plus
 * the totals an evaluation reports (time per layer, model spend, paid
 * searches by provider, thinking per call). Failure details are already
 * scrubbed; nothing here holds an image or a key.
 */
export function summarizeTrace(trace: ScanTrace) {
  const msByLayer: Record<string, number> = {};
  for (const c of trace.calls) msByLayer[`model:${c.layer}`] = (msByLayer[`model:${c.layer}`] || 0) + c.ms;
  for (const s of trace.searches) msByLayer[`search:${s.layer}`] = (msByLayer[`search:${s.layer}`] || 0) + s.ms;
  const searchesByProvider: Record<string, number> = {};
  for (const s of trace.searches) searchesByProvider[s.provider] = (searchesByProvider[s.provider] || 0) + 1;
  const thinking = trace.calls.map(c => c.thinkingApprox).filter((t): t is number => typeof t === "number");
  return {
    totalMs: Date.now() - trace.startedAt,
    claudeUsd: Math.round(trace.calls.reduce((sum, c) => sum + (c.costUsd || 0), 0) * 1_000_000) / 1_000_000,
    searchesByProvider,
    msByLayer,
    thinkingPerCall: thinking.length ? Math.round(thinking.reduce((a, b) => a + b, 0) / thinking.length) : null,
    calls: trace.calls,
    searches: trace.searches,
    failures: trace.failures,
    steps: trace.steps,
  };
}
