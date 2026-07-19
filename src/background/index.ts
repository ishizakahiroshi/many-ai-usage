import type { RuntimeMessage, ProviderContext } from '../shared/messages';
import {
  isStale,
  makeRuntimeState,
  type MetricUnit,
  type NormalizedMetric,
  type NormalizedSnapshot,
  type ProviderConfig,
  type ProviderRuntimeState,
  type TaughtMetric,
} from '../shared/schema';
import {
  deleteProvider,
  clearSnapshot,
  getDashboard,
  getProvider,
  getRuntimeState,
  getSnapshot,
  initializeStorage,
  reorderProviders,
  setRuntimeState,
  setSnapshot,
  upsertProvider,
} from '../shared/storage';
import { diagLog, obsLog, perfLog, perfNow } from '../shared/perf';
import { matchesProviderUrl, originPattern } from '../shared/url';

const pendingRefreshes = new Map<string, number>();
type PickerMode = 'metrics' | 'reset';
export type LiveMetricRead = {
  value: number;
  used: number | null;
  remaining: number | null;
  total: number | null;
  unit: MetricUnit;
  evidence: string;
  semanticSignals: string[];
  resetLabel?: string | null;
  resetAt?: string | null;
};
type TeachSession = {
  providerId: string;
  returnTabId?: number;
  metricId?: string;
  pickerMode: PickerMode;
  /** True when teach opened a fresh tab — close it on Done/Cancel. False when reusing the user's tab. */
  closeTabOnExit: boolean;
  metrics: TaughtMetric[];
  liveReads: Record<string, LiveMetricRead>;
};

const pendingPickers = new Map<number, Omit<TeachSession, 'metrics' | 'liveReads'>>();
const teachSessions = new Map<number, TeachSession>();
const injectionInFlight = new Set<string>();

async function hasPermission(provider: ProviderConfig): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [originPattern(provider.url)] });
  } catch {
    return false;
  }
}

async function refreshStateForPermission(provider: ProviderConfig): Promise<void> {
  const state = await getRuntimeState(provider.id);
  const allowed = await hasPermission(provider);
  if (!allowed) {
    if (state.status !== 'needs_permission') await setRuntimeState({ ...state, status: 'needs_permission', errorLabel: 'Host permission is required to read this page.' });
    return;
  }
  if (state.status !== 'needs_permission') return;
  const snapshot = await getSnapshot(provider.id);
  await setRuntimeState({ ...state, status: snapshot ? 'ok' : 'never_seen', errorLabel: null });
}

async function updateFromSnapshot(providerId: string, snapshot: import('../shared/schema').NormalizedSnapshot): Promise<void> {
  const provider = await getProvider(providerId);
  if (!provider) return;
  const previous = await getSnapshot(providerId);
  const state = await getRuntimeState(providerId);
  // Grok (and similar): Done saves live click values, then CAPTURE_NOW often runs after the
  // usage sheet unmounts / navigates away and returns metrics:[]. Never wipe a good snapshot.
  const incomingEmpty = snapshot.metrics.length === 0;
  const previousHasData = (previous?.metrics.length ?? 0) > 0;
  if (incomingEmpty && previousHasData) {
    const consecutiveFailures = (state.consecutiveFailures ?? 0) + 1;
    const status = consecutiveFailures >= 3 ? 'needs_teaching' as const : 'warning' as const;
    diagLog('bg.snapshot.keep-previous', {
      providerId,
      previousMetrics: previous!.metrics.length,
      consecutiveFailures,
      status,
      incomingStatus: snapshot.status,
    });
    await setRuntimeState({
      ...state,
      lastAttemptAt: snapshot.capturedAt,
      lastFailureAt: snapshot.capturedAt,
      status,
      stale: false,
      confidence: state.confidence === 'none' ? 'taught' : state.confidence,
      retryAfter: null,
      pageBinding: 'bound',
      errorLabel: snapshot.warningReason
        ?? snapshot.lastFailureReason
        ?? 'Could not re-read the usage page; keeping the last known values. Open the registered usage URL and Refresh.',
      consecutiveFailures,
      // Keep lastSuccessAt / evidenceSummary from the successful teach/capture.
    });
    return;
  }

  await setSnapshot(snapshot);
  const confidence = snapshot.source === 'dom' ? 'heuristic' : snapshot.source === 'user_taught' ? 'taught' : 'none';
  const taughtReadFailed = provider.mode === 'taught' && (snapshot.metrics.length === 0 || snapshot.lastFailureReason != null);
  const consecutiveFailures = taughtReadFailed ? (state.consecutiveFailures ?? 0) + 1 : 0;
  const status = taughtReadFailed && consecutiveFailures >= 3
    ? 'needs_teaching' as const
    : snapshot.status === 'warning' || taughtReadFailed
      ? 'warning' as const
      : snapshot.status === 'no_data'
        ? 'error' as const
        : 'ok' as const;
  diagLog('bg.snapshot.write', {
    providerId,
    metrics: snapshot.metrics.length,
    status,
    taughtReadFailed,
  });
  const next: ProviderRuntimeState = {
    ...state,
    lastAttemptAt: snapshot.capturedAt,
    lastSuccessAt: taughtReadFailed ? state.lastSuccessAt : snapshot.capturedAt,
    lastFailureAt: taughtReadFailed ? snapshot.capturedAt : null,
    status,
    stale: false,
    confidence,
    evidenceSummary: snapshot.metrics.flatMap((metric) => [metric.evidence.value, ...metric.evidence.semanticSignals]).slice(0, 8),
    retryAfter: null,
    pageBinding: 'bound',
    errorLabel: snapshot.warningReason,
    consecutiveFailures,
  };
  await setRuntimeState(next);
}

async function updateFailure(providerId: string, reason: string): Promise<void> {
  const provider = await getProvider(providerId);
  const state = await getRuntimeState(providerId);
  const now = new Date().toISOString();
  const taughtFailure = provider?.mode === 'taught';
  const consecutiveFailures = taughtFailure ? (state.consecutiveFailures ?? 0) + 1 : state.consecutiveFailures ?? 0;
  const status = taughtFailure && consecutiveFailures >= 3 ? 'needs_teaching' as const : 'error' as const;
  await setRuntimeState({
    ...state,
    lastAttemptAt: now,
    lastFailureAt: now,
    status,
    errorLabel: reason,
    pageBinding: 'stale',
    consecutiveFailures,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function contentScriptReady(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return true;
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId: number): Promise<boolean> {
  if (await contentScriptReady(tabId)) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (await contentScriptReady(tabId)) return true;
      await delay(40 * (attempt + 1));
    }
    return false;
  } catch {
    return false;
  }
}

async function waitForTabComplete(tabId: number, timeoutMs = 12_000): Promise<chrome.tabs.Tab | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return tab;
    } catch {
      return null;
    }
    await delay(120);
  }
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

/**
 * Grok (and similar) only put usage numbers in the DOM when the registered entry URL is open
 * (e.g. ?_s=usage). Capturing on plain grok.com chat yields "not read" / re-teach forever.
 */
async function ensureTabOnProviderUsage(provider: ProviderConfig, tabId: number): Promise<boolean> {
  try {
    let tab = await chrome.tabs.get(tabId);
    if (isOnProviderUsageEntry(provider, tab.url)) {
      await delay(350);
      return true;
    }
    obsLog('bg.capture.navigate-usage', {
      tabId,
      providerId: provider.id,
      from: tab.url ?? null,
      to: provider.url,
    });
    await chrome.tabs.update(tabId, { url: provider.url, active: true, autoDiscardable: false });
    tab = (await waitForTabComplete(tabId)) ?? tab;
    // Usage sheets are often SPA-mounted after 'complete'.
    await delay(1_000);
    return matchesProviderUrl(provider, tab.url ?? '');
  } catch {
    return false;
  }
}

async function injectCapture(tabId: number, provider: ProviderConfig, force = false): Promise<boolean> {
  const key = `${tabId}:${provider.id}`;
  if (injectionInFlight.has(key)) return false;
  injectionInFlight.add(key);
  try {
    if (!(await hasPermission(provider))) return false;
    if (!(await ensureTabOnProviderUsage(provider, tabId))) return false;
    // Re-executing content.js creates a new isolate that used to delete the open picker host.
    if (!(await ensureContentScript(tabId))) return false;
    if (force) {
      await delay(250);
      await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_NOW' });
    }
    return true;
  } catch (error) {
    if (force) await updateFailure(provider.id, error instanceof Error ? error.message : 'Unable to inject content script');
    return false;
  } finally {
    injectionInFlight.delete(key);
  }
}

async function sendStartPicker(tabId: number, providerId: string, metricId: string | undefined, pickerMode: PickerMode): Promise<boolean> {
  // Grok/Codex SPAs often need several inject+message attempts before the listener is live.
  for (let attempt = 0; attempt < 14; attempt += 1) {
    if (!(await ensureContentScript(tabId))) {
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      } catch {
        /* restricted page or missing host permission */
      }
      await delay(60 * (attempt + 1));
      continue;
    }
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'START_PICKER',
        providerId,
        metricId,
        pickerMode,
      }) as { ok?: boolean; pickerActive?: boolean } | undefined;
      if (response?.ok !== false) {
        obsLog('bg.teach.message-ok', { tabId, providerId, attempt, pickerActive: Boolean(response?.pickerActive) });
        return true;
      }
    } catch {
      // Force a fresh isolate next loop (previous inject may have died on SPA navigation).
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      } catch {
        /* ignore */
      }
      await delay(70 * (attempt + 1));
    }
  }
  return false;
}

/** Arm session + deliver START_PICKER. Only clears pending on success so SPA complete can retry. */
async function activatePickerOnTab(
  tabId: number,
  provider: ProviderConfig,
  pending: Omit<TeachSession, 'metrics' | 'liveReads'>,
): Promise<boolean> {
  teachSessions.set(tabId, {
    providerId: provider.id,
    returnTabId: pending.returnTabId,
    metricId: pending.metricId,
    pickerMode: pending.pickerMode,
    closeTabOnExit: pending.closeTabOnExit,
    metrics: [],
    liveReads: {},
  });
  obsLog('bg.teach.start-picker', {
    tabId,
    providerId: provider.id,
    closeTabOnExit: pending.closeTabOnExit,
  });
  const started = await sendStartPicker(tabId, provider.id, pending.metricId, pending.pickerMode);
  if (started) {
    pendingPickers.delete(tabId);
    return true;
  }
  obsLog('bg.teach.start-picker-failed', { tabId, providerId: provider.id });
  teachSessions.delete(tabId);
  return false;
}

async function handleProviderTabReady(tabId: number, currentUrl: string): Promise<void> {
  const providers = (await getDashboard()).providers;
  for (const provider of providers) {
    if (!matchesProviderUrl(provider, currentUrl)) continue;
    const pendingPicker = pendingPickers.get(tabId);
    // An open teach session must not be disturbed by later complete/SPA events.
    if (teachSessions.has(tabId) && !pendingPicker) continue;
    // Prefer starting the picker before heavy capture so the teach UI is not delayed/hidden.
    if (pendingPicker?.providerId === provider.id) {
      await activatePickerOnTab(tabId, provider, pendingPicker);
    } else {
      await injectCapture(tabId, provider);
    }
    if (pendingRefreshes.get(provider.id) === tabId) pendingRefreshes.delete(provider.id);
  }
}

async function findMatchingTab(provider: ProviderConfig): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => tab.id != null && tab.url && matchesProviderUrl(provider, tab.url)) ?? null;
}

async function refreshProvider(providerId: string): Promise<{ started: boolean; tabId?: number }> {
  const provider = await getProvider(providerId);
  if (!provider) return { started: false };
  const tab = await findMatchingTab(provider);
  if (tab?.id != null) {
    pendingRefreshes.set(providerId, tab.id);
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_NOW' });
    } catch {
      await injectCapture(tab.id, provider, true);
    }
    return { started: true, tabId: tab.id };
  }
  const created = await chrome.tabs.create({ url: provider.url, active: true });
  if (created.id != null) pendingRefreshes.set(providerId, created.id);
  return { started: created.id != null, tabId: created.id };
}

/** True when the open tab is already on the registered usage entry (incl. query like ?_s=usage). */
function isOnProviderUsageEntry(provider: ProviderConfig, currentUrl: string | undefined): boolean {
  if (!currentUrl) return false;
  try {
    const want = new URL(provider.url);
    const have = new URL(currentUrl);
    if (want.origin !== have.origin) return false;
    const wantPath = want.pathname.replace(/\/$/, '') || '/';
    const havePath = have.pathname.replace(/\/$/, '') || '/';
    if (wantPath !== havePath) return false;
    // Registered search (e.g. Grok ?_s=usage) must be present so the usage sheet is open.
    if (want.search && want.search !== have.search) return false;
    return true;
  } catch {
    return false;
  }
}

export async function startPicker(
  providerId: string,
  metricId?: string,
  sender?: chrome.runtime.MessageSender,
  pickerMode: PickerMode = 'metrics',
): Promise<{ started: boolean; tabId?: number; reason?: string }> {
  const provider = await getProvider(providerId);
  if (!provider) return { started: false, reason: 'provider_missing' };
  if (!(await hasPermission(provider))) {
    obsLog('bg.teach.no-permission', { providerId });
    return { started: false, reason: 'permission_denied' };
  }
  const active = sender?.tab?.id != null ? sender.tab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

  const arm = (tabId: number, closeTabOnExit: boolean) => {
    pendingPickers.set(tabId, {
      providerId,
      metricId,
      returnTabId: active?.id !== tabId ? active?.id : undefined,
      pickerMode,
      closeTabOnExit,
    });
  };

  /** Immediate start + delayed retries (Grok usage sheet / SPA hydration). */
  const kickUntilStarted = async (tabId: number): Promise<boolean> => {
    const pending = pendingPickers.get(tabId);
    if (!pending) return teachSessions.get(tabId)?.providerId === providerId;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete' && tab.url && matchesProviderUrl(provider, tab.url)) {
        if (await activatePickerOnTab(tabId, provider, pending)) return true;
      }
    } catch {
      /* tab may be mid-navigation */
    }
    for (const waitMs of [400, 1000, 2200]) {
      await delay(waitMs);
      if (teachSessions.get(tabId)?.providerId === providerId && !pendingPickers.has(tabId)) return true;
      const still = pendingPickers.get(tabId) ?? pending;
      pendingPickers.set(tabId, still);
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url && matchesProviderUrl(provider, tab.url)) {
          if (await activatePickerOnTab(tabId, provider, still)) return true;
        }
      } catch {
        /* ignore */
      }
    }
    return teachSessions.get(tabId)?.providerId === providerId && !pendingPickers.has(tabId);
  };

  // Prefer an already-open matching tab (user often has Grok usage open already).
  const existing = await findMatchingTab(provider);
  if (existing?.id != null) {
    const tabId = existing.id;
    arm(tabId, false);
    const onUsageEntry = isOnProviderUsageEntry(provider, existing.url);
    try {
      if (!onUsageEntry) {
        // Navigate to the registered usage URL so the sheet/modal is visible for teaching.
        await chrome.tabs.update(tabId, { url: provider.url, active: true, autoDiscardable: false });
      } else {
        await chrome.tabs.update(tabId, { active: true, autoDiscardable: false });
      }
      if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true });
    } catch {
      /* onUpdated will retry */
    }
    obsLog('bg.teach.reuse-tab', { tabId, providerId, navigated: !onUsageEntry });
    const ok = await kickUntilStarted(tabId);
    if (ok) return { started: true, tabId };
    // Fall through: open a fresh tab if the existing one never accepted START_PICKER.
    obsLog('bg.teach.reuse-failed-create-new', { tabId, providerId });
    pendingPickers.delete(tabId);
  }

  const created = await chrome.tabs.create({ url: provider.url, active: true });
  if (created.id == null) return { started: false, reason: 'tab_create_failed' };
  arm(created.id, true);
  obsLog('bg.teach.new-tab', { tabId: created.id, providerId });
  const ok = await kickUntilStarted(created.id);
  return ok
    ? { started: true, tabId: created.id }
    : { started: false, tabId: created.id, reason: 'content_script_unreachable' };
}

function stagedSession(message: { providerId: string }, sender?: chrome.runtime.MessageSender) {
  const tabId = sender?.tab?.id;
  if (tabId == null) return null;
  const session = teachSessions.get(tabId);
  return session?.providerId === message.providerId ? { tabId, session } : null;
}

function optionsPageUrl(providerId?: string): string {
  const base = chrome.runtime.getURL('options.html');
  if (!providerId) return base;
  return `${base}?provider=${encodeURIComponent(providerId)}`;
}

function isOptionsTabUrl(url: string | undefined): boolean {
  if (!url) return false;
  const base = optionsPageUrl();
  // Match options.html with or without query (trySamples=1) / hash.
  return url === base || url.startsWith(`${base}?`) || url.startsWith(`${base}#`);
}

async function findOptionsTabs(): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) => {
    // Discarded / mid-load tabs often expose pendingUrl instead of url.
    const candidate = tab.url ?? (tab as chrome.tabs.Tab & { pendingUrl?: string }).pendingUrl;
    return isOptionsTabUrl(candidate);
  });
}

/**
 * Focus an existing options tab, or open a fresh one.
 * Always re-navigates to the current extension URL: after chrome://extensions reload,
 * old options tabs still match the URL but show a dead "Extension page" error until refreshed.
 * chrome.runtime.openOptionsPage() can "succeed" while only focusing that zombie tab.
 */
export async function openOptionsPageReliable(providerId?: string): Promise<{ opened: boolean; tabId?: number }> {
  const startedAt = perfNow();
  const url = optionsPageUrl(providerId);
  const findStartedAt = perfNow();
  const allOptions = await findOptionsTabs();
  const existing = allOptions[0];
  const findMs = perfNow() - findStartedAt;
  obsLog('bg.openOptions.start', {
    optionsTabCount: allOptions.length,
    existingId: existing?.id ?? null,
    discarded: existing?.discarded ?? null,
    status: existing?.status ?? null,
    // Structural only — extension URL shape, not page content.
    hadUrl: Boolean(existing?.url),
    hadPendingUrl: Boolean((existing as chrome.tabs.Tab & { pendingUrl?: string } | undefined)?.pendingUrl),
    hasProvider: Boolean(providerId),
  });
  if (existing?.id != null) {
    try {
      // Force a live navigation every time (not only when discarded).
      await chrome.tabs.update(existing.id, { url, active: true, autoDiscardable: false });
      if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true });
      const payload = { path: 'update-existing', findMs: Math.round(findMs), tabId: existing.id, optionsTabCount: allOptions.length };
      obsLog('bg.openOptions.done', { ...payload, ms: Math.round(perfNow() - startedAt) });
      perfLog('bg.openOptions', startedAt, payload, 20);
      return { opened: true, tabId: existing.id };
    } catch (error) {
      obsLog('bg.openOptions.update-existing-failed', {
        tabId: existing.id,
        error: error instanceof Error ? error.name : 'unknown',
      });
      /* fall through and create */
    }
  }
  try {
    const created = await chrome.tabs.create({ url, active: true });
    const payload = { path: 'create', findMs: Math.round(findMs), tabId: created.id, optionsTabCount: allOptions.length };
    obsLog('bg.openOptions.done', { ...payload, ms: Math.round(perfNow() - startedAt) });
    perfLog('bg.openOptions', startedAt, payload, 20);
    return { opened: created.id != null, tabId: created.id };
  } catch {
    // Last resort for hosts that only allow the options API.
    try {
      await chrome.runtime.openOptionsPage();
      const payload = { path: 'openOptionsPage-api', findMs: Math.round(findMs) };
      obsLog('bg.openOptions.done', { ...payload, ms: Math.round(perfNow() - startedAt) });
      perfLog('bg.openOptions', startedAt, payload, 20);
      return { opened: true };
    } catch {
      obsLog('bg.openOptions.done', { path: 'failed', findMs: Math.round(findMs), ms: Math.round(perfNow() - startedAt) });
      perfLog('bg.openOptions', startedAt, { path: 'failed', findMs: Math.round(findMs) }, 0);
      return { opened: false };
    }
  }
}

async function restoreTeachOrigin(tabId: number, returnTabId: number | undefined, closeTabOnExit: boolean): Promise<void> {
  // Only close tabs we opened for teach — never kill the user's already-open Grok/Codex tab.
  if (closeTabOnExit) {
    try { await chrome.tabs.remove(tabId); } catch { /* The user may already have closed the picker tab. */ }
  }
  if (returnTabId != null && returnTabId !== tabId) {
    try {
      await chrome.tabs.update(returnTabId, { active: true });
      const tab = await chrome.tabs.get(returnTabId);
      if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
      return;
    } catch {
      /* Origin tab may be gone — fall back to options. */
    }
  }
  if (closeTabOnExit) await openOptionsPageReliable();
}

function snapshotFromLiveReads(provider: ProviderConfig, session: TeachSession, now = new Date().toISOString()): NormalizedSnapshot | null {
  const metrics: NormalizedMetric[] = [];
  for (const taught of session.metrics) {
    const live = session.liveReads[taught.metricId];
    if (!live) continue;
    const interpretation = taught.interpretation ?? 'unknown';
    const used = interpretation === 'used_percent' || interpretation === 'used_total' ? live.used ?? live.value : live.used;
    const remaining = interpretation === 'remaining_percent' || interpretation === 'remaining_total' || interpretation === 'absolute_value' || taught.unit === 'percent'
      ? live.remaining ?? live.value
      : live.remaining;
    metrics.push({
      id: taught.metricId,
      label: taught.label,
      kind: taught.kind,
      unit: taught.unit === 'custom' ? live.unit : taught.unit,
      window: { id: taught.metricId, label: taught.windowLabel ?? taught.label },
      used,
      remaining,
      total: live.total ?? (taught.unit === 'percent' || live.unit === 'percent' ? 100 : null),
      resetAt: live.resetAt ?? null,
      resetLabel: live.resetLabel ?? null,
      confidence: 'taught',
      evidence: {
        value: live.evidence,
        label: taught.label,
        reset: live.resetLabel ?? null,
        semanticSignals: live.semanticSignals,
      },
    });
  }
  if (metrics.length === 0) return null;
  return {
    providerId: provider.id,
    displayName: provider.displayName,
    capturedAt: now,
    source: 'user_taught',
    status: 'ok',
    metrics,
    warningReason: null,
    lastFailureReason: null,
  };
}

async function saveCompletedTeach(tabId: number, session: TeachSession): Promise<boolean> {
  const provider = await getProvider(session.providerId);
  if (!provider || session.metrics.length === 0) return false;
  const metrics = [...provider.metrics];
  for (const staged of session.metrics) {
    const index = metrics.findIndex((metric) => metric.metricId === staged.metricId || metric.label === staged.label);
    if (index >= 0) metrics[index] = { ...staged, metricId: metrics[index].metricId };
    else metrics.push(staged);
  }
  const now = new Date().toISOString();
  const nextProvider = { ...provider, mode: 'taught' as const, metrics, updatedAt: now };
  await upsertProvider(nextProvider);
  // Persist values observed at click time so the dashboard is not empty when re-query fails on SPA pages.
  const liveSnapshot = snapshotFromLiveReads(nextProvider, session, now);
  if (liveSnapshot) {
    await updateFromSnapshot(nextProvider.id, liveSnapshot);
    diagLog('bg.teach.live-snapshot', {
      providerId: nextProvider.id,
      metrics: liveSnapshot.metrics.length,
    });
    // Optional background re-read. Do not await: Done must return to Settings quickly, and
    // updateFromSnapshot already refuses to wipe these live values with an empty capture.
    void chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_NOW' }).catch(() => {
      /* live snapshot already stored */
    });
  } else {
    const state = await getRuntimeState(provider.id);
    await setRuntimeState({ ...state, status: 'never_seen', confidence: 'taught', errorLabel: null, consecutiveFailures: 0 });
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_NOW' });
    } catch {
      /* no live values and capture unavailable */
    }
  }
  return true;
}

async function requestPermission(providerId: string): Promise<{ granted: boolean }> {
  const provider = await getProvider(providerId);
  if (!provider) return { granted: false };
  try {
    const granted = await chrome.permissions.request({ origins: [originPattern(provider.url)] });
    const snapshot = await getSnapshot(providerId);
    const state = await getRuntimeState(providerId);
    await setRuntimeState({ ...state, status: granted ? (snapshot ? 'ok' : 'never_seen') : 'needs_permission', errorLabel: granted ? null : 'Host permission was denied.' });
    return { granted };
  } catch (error) {
    await updateFailure(providerId, error instanceof Error ? error.message : 'Permission request failed');
    return { granted: false };
  }
}

async function syncPermission(providerId: string, granted: boolean): Promise<void> {
  const snapshot = await getSnapshot(providerId);
  const state = await getRuntimeState(providerId);
  await setRuntimeState({
    ...state,
    status: granted ? (snapshot ? 'ok' : 'never_seen') : 'needs_permission',
    errorLabel: granted ? null : 'Host permission was denied.',
  });
}

export async function handleMessage(message: RuntimeMessage, sender?: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case 'GET_DASHBOARD': {
      const startedAt = perfNow();
      const dashboard = await getDashboard();
      // Pure read: mark stale in the response only.
      // Never write storage here — options/popup listen to chrome.storage.onChanged and call
      // GET_DASHBOARD again, so setRuntimeState on every stale provider was an infinite loop
      // that freezes the whole browser when Settings opens with any aged snapshot.
      const providers = dashboard.providers.map((provider) => {
        const snapshot = dashboard.snapshots[provider.id];
        const state = dashboard.runtimeStates[provider.id];
        if (snapshot && state.status !== 'needs_teaching' && isStale(snapshot, provider)) {
          return [provider.id, { ...state, stale: true, status: 'stale' as const }] as const;
        }
        return [provider.id, state] as const;
      });
      perfLog('bg.GET_DASHBOARD', startedAt, { providerCount: dashboard.providers.length }, 30);
      return { ...dashboard, runtimeStates: Object.fromEntries(providers) };
    }
    case 'GET_PROVIDER_CONTEXT': {
      const provider = (await (async () => {
        const providers = (await getDashboard()).providers;
        return providers.find((item) => matchesProviderUrl(item, message.url)) ?? null;
      })());
      if (!provider) return null;
      return { provider, permissionGranted: await hasPermission(provider) } satisfies ProviderContext;
    }
    case 'CAPTURE_RESULT':
      await updateFromSnapshot(message.providerId, message.snapshot);
      pendingRefreshes.delete(message.providerId);
      return { ok: true };
    case 'CAPTURE_FAILURE':
      await updateFailure(message.providerId, message.reason);
      return { ok: false };
    case 'REFRESH_PROVIDER':
      return refreshProvider(message.providerId);
    case 'OPEN_PROVIDER': {
      const provider = await getProvider(message.providerId);
      if (!provider) return { opened: false };
      const tab = await chrome.tabs.create({ url: provider.url, active: true });
      return { opened: tab.id != null, tabId: tab.id };
    }
    case 'OPEN_OPTIONS':
      return openOptionsPageReliable(message.providerId);
    case 'REQUEST_PERMISSION':
      return requestPermission(message.providerId);
    case 'SYNC_PERMISSION':
      await syncPermission(message.providerId, message.granted);
      return { synced: true };
    case 'UPSERT_PROVIDER':
      {
      const previous = await getProvider(message.provider.id);
      await upsertProvider(message.provider);
      if (previous && previous.url !== message.provider.url) await clearSnapshot(message.provider.id);
      if (message.permissionGranted) await syncPermission(message.provider.id, true);
      else await setRuntimeState({ ...makeRuntimeState(message.provider.id, 'needs_permission'), errorLabel: 'Host permission is required to read this page.' });
      return { saved: true };
      }
    case 'DELETE_PROVIDER':
      await deleteProvider(message.providerId);
      return { deleted: true };
    case 'REORDER_PROVIDERS':
      await reorderProviders(message.ids);
      return { reordered: true };
    case 'START_PICKER':
      return startPicker(message.providerId, message.metricId, sender, message.pickerMode);
    case 'SAVE_METRIC': {
      let staged = stagedSession(message, sender);
      // Recover a teach session if the tab still has the picker but pendingPicker was lost (SPA reloads, race on tabs.create).
      if (!staged && sender?.tab?.id != null) {
        const recovered: TeachSession = {
          providerId: message.providerId,
          returnTabId: undefined,
          pickerMode: 'metrics',
          closeTabOnExit: false,
          metrics: [],
          liveReads: {},
        };
        teachSessions.set(sender.tab.id, recovered);
        staged = { tabId: sender.tab.id, session: recovered };
      }
      if (!staged) return { saved: false, metrics: [] };
      const index = staged.session.metrics.findIndex((metric) => metric.metricId === message.metric.metricId);
      if (index >= 0) staged.session.metrics[index] = message.metric;
      else staged.session.metrics.push(message.metric);
      if (message.liveRead && message.liveRead.value != null) {
        staged.session.liveReads[message.metric.metricId] = {
          value: message.liveRead.value,
          used: message.liveRead.used,
          remaining: message.liveRead.remaining,
          total: message.liveRead.total,
          unit: message.liveRead.unit,
          evidence: message.liveRead.evidence,
          semanticSignals: message.liveRead.semanticSignals,
          resetLabel: message.liveRead.resetLabel ?? null,
          resetAt: message.liveRead.resetAt ?? null,
        };
      }
      return { saved: true, metrics: staged.session.metrics };
    }
    case 'SAVE_RESET_ANCHOR': {
      const staged = stagedSession(message, sender);
      if (!staged || staged.session.pickerMode !== 'reset' || staged.session.metricId !== message.metricId) return { saved: false, metrics: [] };
      const provider = await getProvider(message.providerId);
      const existing = provider?.metrics.find((metric) => metric.metricId === message.metricId);
      if (!existing) return { saved: false, metrics: [] };
      staged.session.metrics = [{ ...existing, resetAnchor: message.resetAnchor }];
      teachSessions.set(staged.tabId, staged.session);
      return { saved: true, metrics: staged.session.metrics };
    }
    case 'RENAME_METRIC': {
      const staged = stagedSession(message, sender);
      const label = message.label.trim().slice(0, 80);
      if (!label) return { renamed: false, metrics: staged?.session.metrics ?? [] };
      if (staged) {
        staged.session.metrics = staged.session.metrics.map((metric) => metric.metricId === message.metricId ? { ...metric, label, windowLabel: label } : metric);
        teachSessions.set(staged.tabId, staged.session);
        return { renamed: true, metrics: staged.session.metrics };
      }
      const provider = await getProvider(message.providerId);
      if (!provider || !provider.metrics.some((metric) => metric.metricId === message.metricId)) return { renamed: false, metrics: [] };
      const metrics = provider.metrics.map((metric) => metric.metricId === message.metricId ? { ...metric, label, windowLabel: label } : metric);
      await upsertProvider({ ...provider, metrics, updatedAt: new Date().toISOString() });
      const snapshot = await getSnapshot(provider.id);
      if (snapshot) {
        await setSnapshot({
          ...snapshot,
          metrics: snapshot.metrics.map((metric) => metric.id === message.metricId ? { ...metric, label, window: { ...metric.window, label } } : metric),
        });
      }
      return { renamed: true, metrics };
    }
    case 'REMOVE_METRIC': {
      const staged = stagedSession(message, sender);
      if (staged) {
        staged.session.metrics = staged.session.metrics.filter((metric) => metric.metricId !== message.metricId);
        delete staged.session.liveReads[message.metricId];
        teachSessions.set(staged.tabId, staged.session);
        return { removed: true, metrics: staged.session.metrics };
      }
      const provider = await getProvider(message.providerId);
      if (!provider) return { removed: false };
      const metrics = provider.metrics.filter((metric) => metric.metricId !== message.metricId);
      if (metrics.length === provider.metrics.length) return { removed: false };
      await upsertProvider({ ...provider, metrics, updatedAt: new Date().toISOString() });
      await clearSnapshot(provider.id);
      const state = await getRuntimeState(provider.id);
      await setRuntimeState({ ...state, status: 'never_seen', errorLabel: null });
      return { removed: true };
    }
    case 'RESET_TEACH': {
      const provider = await getProvider(message.providerId);
      if (!provider) return { reset: false };
      // Drop broken taught anchors so the next Track starts clean (user is stuck on "Grok Build not read").
      await upsertProvider({
        ...provider,
        metrics: [],
        mode: 'auto',
        updatedAt: new Date().toISOString(),
      });
      await clearSnapshot(provider.id);
      const state = await getRuntimeState(provider.id);
      await setRuntimeState({
        ...state,
        status: 'never_seen',
        errorLabel: null,
        consecutiveFailures: 0,
        stale: false,
        confidence: 'none',
      });
      obsLog('bg.teach.reset', { providerId: provider.id });
      return { reset: true };
    }
    case 'DONE_TEACH': {
      const staged = stagedSession(message, sender);
      if (!staged) return { saved: false };
      const saved = await saveCompletedTeach(staged.tabId, staged.session);
      if (!saved) return { saved: false };
      teachSessions.delete(staged.tabId);
      await restoreTeachOrigin(staged.tabId, staged.session.returnTabId, staged.session.closeTabOnExit);
      return { saved: true };
    }
    case 'CANCEL_TEACH': {
      const staged = stagedSession(message, sender);
      if (!staged) return { cancelled: false };
      teachSessions.delete(staged.tabId);
      await restoreTeachOrigin(staged.tabId, staged.session.returnTabId, staged.session.closeTabOnExit);
      return { cancelled: true };
    }
    case 'CAPTURE_NOW':
      if (sender?.tab?.id == null) return { ok: false };
      return { ok: true };
  }
}

async function bootstrap(): Promise<void> {
  await initializeStorage();
  const providers = await (await getDashboard()).providers;
  await Promise.all(providers.map(refreshStateForPermission));
}

chrome.runtime.onInstalled.addListener(() => void bootstrap());
chrome.runtime.onStartup.addListener(() => void bootstrap());
chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse).catch((error) => sendResponse({ error: String(error) }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  void handleProviderTabReady(tabId, tab.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pendingPickers.delete(tabId);
  teachSessions.delete(tabId);
  for (const [providerId, pendingTabId] of pendingRefreshes) {
    if (pendingTabId !== tabId) continue;
    pendingRefreshes.delete(providerId);
    void updateFailure(providerId, 'tab closed during refresh');
  }
});

void bootstrap();
