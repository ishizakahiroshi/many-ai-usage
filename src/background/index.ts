import type { RuntimeMessage, ProviderContext } from '../shared/messages';
import { sendMessage } from '../shared/runtime';
import { isStale, makeRuntimeState, type ProviderConfig, type ProviderRuntimeState } from '../shared/schema';
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
import { matchesProviderUrl, originPattern, sameOriginAndPath } from '../shared/url';

const pendingRefreshes = new Map<string, number>();
const pendingPickers = new Map<number, { providerId: string; metricId?: string }>();
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

async function injectCapture(tabId: number, provider: ProviderConfig, force = false): Promise<boolean> {
  const key = `${tabId}:${provider.id}`;
  if (injectionInFlight.has(key)) return false;
  injectionInFlight.add(key);
  try {
    if (!(await hasPermission(provider))) return false;
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    if (force) {
      await new Promise((resolve) => setTimeout(resolve, 50));
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

async function startPicker(providerId: string, metricId?: string): Promise<{ started: boolean; tabId?: number }> {
  const provider = await getProvider(providerId);
  if (!provider) return { started: false };
  const tab = await findMatchingTab(provider);
  if (tab?.id != null) {
    pendingPickers.set(tab.id, { providerId, metricId });
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'START_PICKER', providerId, metricId });
    } catch {
      await injectCapture(tab.id, provider);
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'START_PICKER', providerId, metricId });
      } catch {
        pendingPickers.delete(tab.id);
        return { started: false, tabId: tab.id };
      }
    }
    return { started: true, tabId: tab.id };
  }
  const created = await chrome.tabs.create({ url: provider.url, active: true });
  if (created.id != null) pendingPickers.set(created.id, { providerId, metricId });
  return { started: created.id != null, tabId: created.id };
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

async function handleMessage(message: RuntimeMessage, sender?: chrome.runtime.MessageSender): Promise<unknown> {
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
      return startPicker(message.providerId, message.metricId);
    case 'SAVE_TAUGHT_METRIC': {
      const provider = await getProvider(message.providerId);
      if (!provider) return { saved: false };
      const existingIndex = provider.metrics.findIndex((metric) => metric.metricId === message.metric.metricId || metric.label === message.metric.label);
      const metrics = existingIndex >= 0
        ? provider.metrics.map((metric, index) => index === existingIndex ? { ...message.metric, metricId: metric.metricId } : metric)
        : [...provider.metrics, message.metric];
      const now = new Date().toISOString();
      await upsertProvider({ ...provider, mode: 'taught', metrics, updatedAt: now });
      const state = await getRuntimeState(provider.id);
      await setRuntimeState({ ...state, status: 'never_seen', confidence: 'taught', errorLabel: null, consecutiveFailures: 0 });
      if (sender?.tab?.id != null) {
        try {
          await chrome.tabs.sendMessage(sender.tab.id, { type: 'CAPTURE_NOW' });
        } catch {
          // The picker tab may have navigated; the next visit/manual refresh will capture it.
        }
      }
      return { saved: true };
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
  const currentUrl = tab.url;
  void (async () => {
    const providers = (await getDashboard()).providers;
    for (const provider of providers) {
      if (!sameOriginAndPath(provider.url, currentUrl)) continue;
      await injectCapture(tabId, provider);
      const pendingPicker = pendingPickers.get(tabId);
      if (pendingPicker?.providerId === provider.id) {
        pendingPickers.delete(tabId);
        try { await chrome.tabs.sendMessage(tabId, { type: 'START_PICKER', providerId: provider.id, metricId: pendingPicker.metricId }); } catch { /* tab may still be initializing */ }
      }
      if (pendingRefreshes.get(provider.id) === tabId) pendingRefreshes.delete(provider.id);
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pendingPickers.delete(tabId);
  for (const [providerId, pendingTabId] of pendingRefreshes) {
    if (pendingTabId !== tabId) continue;
    pendingRefreshes.delete(providerId);
    void updateFailure(providerId, 'tab closed during refresh');
  }
});

void bootstrap();
