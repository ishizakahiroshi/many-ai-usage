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
};
type TeachSession = {
  providerId: string;
  returnTabId?: number;
  metricId?: string;
  pickerMode: PickerMode;
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
  await setSnapshot(snapshot);
  const provider = await getProvider(providerId);
  if (!provider) return;
  const state = await getRuntimeState(providerId);
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

async function injectCapture(tabId: number, provider: ProviderConfig, force = false): Promise<boolean> {
  const key = `${tabId}:${provider.id}`;
  if (injectionInFlight.has(key)) return false;
  injectionInFlight.add(key);
  try {
    if (!(await hasPermission(provider))) return false;
    // Re-executing content.js creates a new isolate that used to delete the open picker host.
    if (!(await ensureContentScript(tabId))) return false;
    if (force) {
      await delay(50);
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
  if (!(await ensureContentScript(tabId))) return false;
  // Content script may not be listening on the first tick after executeScript.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'START_PICKER', providerId, metricId, pickerMode });
      return true;
    } catch {
      await delay(40 * (attempt + 1));
    }
  }
  return false;
}

async function handleProviderTabReady(tabId: number, currentUrl: string): Promise<void> {
  const providers = (await getDashboard()).providers;
  for (const provider of providers) {
    if (!matchesProviderUrl(provider, currentUrl)) continue;
    const pendingPicker = pendingPickers.get(tabId);
    // An open teach session must not be disturbed by later complete/SPA events.
    if (teachSessions.has(tabId) && !pendingPicker) continue;
    await injectCapture(tabId, provider);
    if (pendingPicker?.providerId === provider.id) {
      pendingPickers.delete(tabId);
      teachSessions.set(tabId, {
        providerId: provider.id,
        returnTabId: pendingPicker.returnTabId,
        metricId: pendingPicker.metricId,
        pickerMode: pendingPicker.pickerMode,
        metrics: [],
        liveReads: {},
      });
      const started = await sendStartPicker(tabId, provider.id, pendingPicker.metricId, pendingPicker.pickerMode);
      if (!started) teachSessions.delete(tabId);
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

export async function startPicker(providerId: string, metricId?: string, sender?: chrome.runtime.MessageSender, pickerMode: PickerMode = 'metrics'): Promise<{ started: boolean; tabId?: number }> {
  const provider = await getProvider(providerId);
  if (!provider) return { started: false };
  if (!(await hasPermission(provider))) return { started: false };
  const active = sender?.tab?.id != null ? sender.tab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const created = await chrome.tabs.create({ url: provider.url, active: true });
  if (created.id == null) return { started: false };
  pendingPickers.set(created.id, { providerId, metricId, returnTabId: active?.id, pickerMode });
  // tabs.create can finish loading before onUpdated('complete') is observed — kick picker if already ready.
  try {
    const tab = await chrome.tabs.get(created.id);
    if (tab.status === 'complete' && tab.url) await handleProviderTabReady(created.id, tab.url);
  } catch {
    /* onUpdated will retry when navigation completes */
  }
  return { started: true, tabId: created.id };
}

function stagedSession(message: { providerId: string }, sender?: chrome.runtime.MessageSender) {
  const tabId = sender?.tab?.id;
  if (tabId == null) return null;
  const session = teachSessions.get(tabId);
  return session?.providerId === message.providerId ? { tabId, session } : null;
}

function optionsPageUrl(): string {
  return chrome.runtime.getURL('options.html');
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
export async function openOptionsPageReliable(): Promise<{ opened: boolean; tabId?: number }> {
  const url = optionsPageUrl();
  const existing = (await findOptionsTabs())[0];
  if (existing?.id != null) {
    try {
      // Force a live navigation every time (not only when discarded).
      await chrome.tabs.update(existing.id, { url, active: true, autoDiscardable: false });
      if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true });
      return { opened: true, tabId: existing.id };
    } catch {
      /* fall through and create */
    }
  }
  try {
    const created = await chrome.tabs.create({ url, active: true });
    return { opened: created.id != null, tabId: created.id };
  } catch {
    // Last resort for hosts that only allow the options API.
    try {
      await chrome.runtime.openOptionsPage();
      return { opened: true };
    } catch {
      return { opened: false };
    }
  }
}

async function restoreTeachOrigin(tabId: number, returnTabId?: number): Promise<void> {
  try { await chrome.tabs.remove(tabId); } catch { /* The user may already have closed the picker tab. */ }
  if (returnTabId != null) {
    try {
      await chrome.tabs.update(returnTabId, { active: true });
      const tab = await chrome.tabs.get(returnTabId);
      if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
      return;
    } catch {
      /* Origin tab may be gone — fall back to options. */
    }
  }
  await openOptionsPageReliable();
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
      resetAt: null,
      resetLabel: null,
      confidence: 'taught',
      evidence: { value: live.evidence, label: taught.label, reset: null, semanticSignals: live.semanticSignals },
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
  if (liveSnapshot) await updateFromSnapshot(nextProvider.id, liveSnapshot);
  else {
    const state = await getRuntimeState(provider.id);
    await setRuntimeState({ ...state, status: 'never_seen', confidence: 'taught', errorLabel: null, consecutiveFailures: 0 });
  }
  try { await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_NOW' }); } catch { /* live snapshot already stored when available */ }
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
      const dashboard = await getDashboard();
      const providers = await Promise.all(dashboard.providers.map(async (provider) => {
        const snapshot = dashboard.snapshots[provider.id];
        const state = dashboard.runtimeStates[provider.id];
        if (snapshot && state.status !== 'needs_teaching' && isStale(snapshot, provider)) {
          const next = { ...state, stale: true, status: 'stale' as const };
          await setRuntimeState(next);
          return [provider.id, next] as const;
        }
        return [provider.id, state] as const;
      }));
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
      return openOptionsPageReliable();
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
        const recovered: TeachSession = { providerId: message.providerId, returnTabId: undefined, pickerMode: 'metrics', metrics: [], liveReads: {} };
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
    case 'DONE_TEACH': {
      const staged = stagedSession(message, sender);
      if (!staged) return { saved: false };
      const saved = await saveCompletedTeach(staged.tabId, staged.session);
      if (!saved) return { saved: false };
      teachSessions.delete(staged.tabId);
      await restoreTeachOrigin(staged.tabId, staged.session.returnTabId);
      return { saved: true };
    }
    case 'CANCEL_TEACH': {
      const staged = stagedSession(message, sender);
      if (!staged) return { cancelled: false };
      teachSessions.delete(staged.tabId);
      await restoreTeachOrigin(staged.tabId, staged.session.returnTabId);
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
