/**
 * Lightweight timing for freeze triage. Logs only when duration >= thresholdMs.
 * Prefix is stable so DevTools console can filter: many-ai-usage:perf
 *
 * Always-on breadcrumbs use obsLog → filter: many-ai-usage:obs
 * Dense teach/read triage uses diagLog → filter: many-ai-usage:diag
 * (no page text / usage numbers — timings and structural counts only).
 */
const ENABLED = true;
const DEFAULT_THRESHOLD_MS = 16;

export function perfNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Always-on triage breadcrumb (no duration threshold). */
export function obsLog(label: string, extra?: Record<string, unknown>): void {
  if (!ENABLED) return;
  if (extra) console.info(`[many-ai-usage:obs] ${label}`, extra);
  else console.info(`[many-ai-usage:obs] ${label}`);
}

/**
 * Dense diagnostics for teach/read failures (Grok marker / not-read).
 * Still structural only — never log evidence text or usage numbers.
 */
export function diagLog(label: string, extra?: Record<string, unknown>): void {
  if (!ENABLED) return;
  if (extra) console.info(`[many-ai-usage:diag] ${label}`, extra);
  else console.info(`[many-ai-usage:diag] ${label}`);
}

export function perfLog(label: string, startedAt: number, extra?: Record<string, unknown>, thresholdMs = DEFAULT_THRESHOLD_MS): number {
  if (!ENABLED) return 0;
  const ms = perfNow() - startedAt;
  if (ms < thresholdMs) return ms;
  const payload = extra ? { ms: Math.round(ms * 10) / 10, ...extra } : { ms: Math.round(ms * 10) / 10 };
  // info (not warn): Chrome's Errors panel treats console.warn as failures and confuses triage.
  console.info(`[many-ai-usage:perf] ${label}`, payload);
  return ms;
}

export async function perfAsync<T>(label: string, run: () => Promise<T>, extra?: Record<string, unknown>, thresholdMs = DEFAULT_THRESHOLD_MS): Promise<T> {
  const startedAt = perfNow();
  try {
    return await run();
  } finally {
    perfLog(label, startedAt, extra, thresholdMs);
  }
}
