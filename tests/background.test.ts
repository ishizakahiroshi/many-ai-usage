import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig, TaughtMetric } from '../src/shared/schema';

function provider(): ProviderConfig {
  return {
    schema: 'many-ai-usage.provider.v1',
    id: 'fixture:continuous',
    displayName: 'Synthetic AI',
    url: 'https://example.test/usage',
    urlMatch: ['https://example.test/usage*'],
    mode: 'auto',
    displayEnabled: true,
    refreshIntervalMinutes: 15,
    metrics: [],
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    order: 0,
  };
}

function metric(metricId: string, label: string): TaughtMetric {
  return { metricId, label, kind: 'percent', unit: 'percent', interpretation: 'remaining_percent', enabled: true, valueAnchor: { selectors: [`#${metricId}`] } };
}

describe('background continuous teach sessions', () => {
  let state: Record<string, any>;
  let updated: ((tabId: number, change: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void) | undefined;
  let background: typeof import('../src/background/index');
  let sendTabMessage: ReturnType<typeof vi.fn>;
  let createTab: ReturnType<typeof vi.fn>;
  let getTab: ReturnType<typeof vi.fn>;
  let removeTab: ReturnType<typeof vi.fn>;
  let updateTab: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    state = { providers: [provider()], snapshots: {}, runtimeStates: {}, schemaVersion: 1 };
    sendTabMessage = vi.fn(async () => ({ ok: true }));
    createTab = vi.fn(async () => ({ id: 99, url: 'https://example.test/usage' }));
    getTab = vi.fn(async (tabId: number) => ({ id: tabId, url: 'https://example.test/usage', status: 'loading' }));
    removeTab = vi.fn(async () => undefined);
    updateTab = vi.fn(async () => undefined);
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async (keys: string | string[]) => {
            const names = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(names.map((key) => [key, state[key]]));
          },
          set: async (values: Record<string, unknown>) => Object.assign(state, values),
        },
      },
      permissions: { contains: async () => true, request: async () => true },
      scripting: { executeScript: async () => [] },
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
        getURL: (path: string) => `chrome-extension://test/${path.replace(/^\//, '')}`,
      },
      windows: { update: vi.fn(async () => undefined) },
      tabs: {
        query: async () => [{ id: 5, active: true, url: 'https://example.test/usage' }, { id: 6, url: 'https://example.test/usage' }],
        create: createTab,
        get: getTab,
        sendMessage: sendTabMessage,
        remove: removeTab,
        update: updateTab,
        reload: vi.fn(async () => undefined),
        onUpdated: { addListener: (listener: typeof updated) => { updated = listener; } },
        onRemoved: { addListener: vi.fn() },
      },
    };
    background = await import('../src/background/index');
    await Promise.resolve();
  });

  async function openTeachSession(): Promise<void> {
    const result = await background.startPicker('fixture:continuous');
    expect(result).toEqual({ started: true, tabId: 99 });
    expect(createTab).toHaveBeenCalledWith({ url: 'https://example.test/usage', active: true });
    expect(sendTabMessage).not.toHaveBeenCalledWith(5, expect.objectContaining({ type: 'START_PICKER' }));
    updated?.(99, { status: 'complete' }, { id: 99, url: 'https://example.test/usage' } as chrome.tabs.Tab);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendTabMessage).toHaveBeenCalledWith(99, expect.objectContaining({ type: 'START_PICKER' }));
  }

  it('always opens a new tab even when matching tabs already exist', async () => {
    await openTeachSession();
  });

  it('stages multiple metrics, supports rename/remove, and commits only on Done', async () => {
    await openTeachSession();
    const sender = { tab: { id: 99 } } as chrome.runtime.MessageSender;
    await background.handleMessage({
      type: 'SAVE_METRIC',
      providerId: 'fixture:continuous',
      metric: metric('weekly', 'Weekly quota'),
      liveRead: { value: 62, used: null, remaining: 62, total: 100, unit: 'percent', evidence: '62%', semanticSignals: ['remaining'] },
    }, sender);
    await background.handleMessage({
      type: 'SAVE_METRIC',
      providerId: 'fixture:continuous',
      metric: metric('credits', 'Credits'),
      liveRead: { value: 18, used: null, remaining: 18, total: null, unit: 'credits', evidence: '18 credits', semanticSignals: ['remaining'] },
    }, sender);
    const renamed = await background.handleMessage({ type: 'RENAME_METRIC', providerId: 'fixture:continuous', metricId: 'credits', label: 'Remaining credits' }, sender) as { metrics: TaughtMetric[] };
    expect(renamed.metrics.map((item) => item.label)).toEqual(['Weekly quota', 'Remaining credits']);
    expect(state.providers[0].metrics).toHaveLength(0);
    await background.handleMessage({ type: 'REMOVE_METRIC', providerId: 'fixture:continuous', metricId: 'weekly' }, sender);
    await background.handleMessage({ type: 'DONE_TEACH', providerId: 'fixture:continuous' }, sender);
    expect(state.providers[0].mode).toBe('taught');
    expect(state.providers[0].metrics.map((item: TaughtMetric) => item.label)).toEqual(['Remaining credits']);
    expect(state.snapshots['fixture:continuous']?.metrics?.[0]?.remaining).toBe(18);
    expect(removeTab).toHaveBeenCalledWith(99);
    expect(updateTab).toHaveBeenCalledWith(5, { active: true });
  });

  it('discards every staged metric on Cancel', async () => {
    await openTeachSession();
    const sender = { tab: { id: 99 } } as chrome.runtime.MessageSender;
    await background.handleMessage({ type: 'SAVE_METRIC', providerId: 'fixture:continuous', metric: metric('weekly', 'Weekly quota') }, sender);
    await background.handleMessage({ type: 'CANCEL_TEACH', providerId: 'fixture:continuous' }, sender);
    expect(state.providers[0].metrics).toHaveLength(0);
    expect(removeTab).toHaveBeenCalledWith(99);
  });

  it('starts the picker immediately when the new tab is already complete', async () => {
    getTab.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: 'https://example.test/usage',
      status: 'complete',
    }));
    const result = await background.startPicker('fixture:continuous');
    expect(result).toEqual({ started: true, tabId: 99 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendTabMessage).toHaveBeenCalledWith(99, expect.objectContaining({ type: 'START_PICKER' }));
  });

  it('opens options by re-navigating an existing tab (zombie after extension reload)', async () => {
    const create = createTab;
    create.mockClear();
    const windowsUpdate = vi.fn(async () => undefined);
    (chrome as any).windows = { update: windowsUpdate };
    (chrome.tabs.query as any) = vi.fn(async () => [
      { id: 12, url: 'chrome-extension://test/options.html', windowId: 1, discarded: false },
    ]);
    (chrome.tabs.update as any) = updateTab;
    const result = await background.handleMessage({ type: 'OPEN_OPTIONS' });
    expect(result).toEqual({ opened: true, tabId: 12 });
    // Must set url every time so a dead post-reload options tab comes back to life.
    expect(updateTab).toHaveBeenCalledWith(12, expect.objectContaining({
      active: true,
      url: 'chrome-extension://test/options.html',
    }));
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a new options tab when none exist', async () => {
    createTab.mockClear();
    (chrome.tabs.query as any) = vi.fn(async () => []);
    const result = await background.handleMessage({ type: 'OPEN_OPTIONS' });
    expect(result).toEqual({ opened: true, tabId: 99 });
    expect(createTab).toHaveBeenCalledWith(expect.objectContaining({
      url: 'chrome-extension://test/options.html',
      active: true,
    }));
  });

  it('does not re-execute content.js after the teach session is already open', async () => {
    const executeScript = vi.fn(async () => []);
    (chrome as any).scripting.executeScript = executeScript;
    sendTabMessage.mockImplementation(async (_tabId: number, message: { type: string }) => {
      if (message.type === 'PING') return { ok: true };
      return { ok: true };
    });
    await openTeachSession();
    executeScript.mockClear();
    sendTabMessage.mockClear();
    // A second complete event (SPA / race) must not reinject or re-send START_PICKER.
    updated?.(99, { status: 'complete' }, { id: 99, url: 'https://example.test/usage' } as chrome.tabs.Tab);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(executeScript).not.toHaveBeenCalled();
    expect(sendTabMessage).not.toHaveBeenCalledWith(99, expect.objectContaining({ type: 'START_PICKER' }));
  });

  it('re-teaches only the reset anchor and supports direct rename from options', async () => {
    state.providers[0].metrics = [metric('weekly', 'Weekly quota')];
    const renamed = await background.handleMessage({ type: 'RENAME_METRIC', providerId: 'fixture:continuous', metricId: 'weekly', label: 'Weekly remaining' }) as { renamed: boolean };
    expect(renamed.renamed).toBe(true);
    expect(state.providers[0].metrics[0].label).toBe('Weekly remaining');
    await background.startPicker('fixture:continuous', 'weekly', undefined, 'reset');
    updated?.(99, { status: 'complete' }, { id: 99, url: 'https://example.test/usage' } as chrome.tabs.Tab);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const sender = { tab: { id: 99 } } as chrome.runtime.MessageSender;
    const resetAnchor = { selectors: ['#reset'], textFingerprint: '12345678' };
    await background.handleMessage({ type: 'SAVE_RESET_ANCHOR', providerId: 'fixture:continuous', metricId: 'weekly', resetAnchor }, sender);
    await background.handleMessage({ type: 'DONE_TEACH', providerId: 'fixture:continuous' }, sender);
    expect(state.providers[0].metrics[0]).toMatchObject({ label: 'Weekly remaining', resetAnchor });
    expect(sendTabMessage).toHaveBeenCalledWith(99, expect.objectContaining({ pickerMode: 'reset', metricId: 'weekly' }));
  });
});
