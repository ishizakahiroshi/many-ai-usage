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
  let removeTab: ReturnType<typeof vi.fn>;
  let updateTab: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    state = { providers: [provider()], snapshots: {}, runtimeStates: {}, schemaVersion: 1 };
    sendTabMessage = vi.fn(async () => ({ ok: true }));
    createTab = vi.fn(async () => ({ id: 99, url: 'https://example.test/usage' }));
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
      },
      tabs: {
        query: async () => [{ id: 5, active: true, url: 'https://example.test/usage' }, { id: 6, url: 'https://example.test/usage' }],
        create: createTab,
        sendMessage: sendTabMessage,
        remove: removeTab,
        update: updateTab,
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
    await background.handleMessage({ type: 'SAVE_METRIC', providerId: 'fixture:continuous', metric: metric('weekly', 'Weekly quota') }, sender);
    await background.handleMessage({ type: 'SAVE_METRIC', providerId: 'fixture:continuous', metric: metric('credits', 'Credits') }, sender);
    const renamed = await background.handleMessage({ type: 'RENAME_METRIC', providerId: 'fixture:continuous', metricId: 'credits', label: 'Remaining credits' }, sender) as { metrics: TaughtMetric[] };
    expect(renamed.metrics.map((item) => item.label)).toEqual(['Weekly quota', 'Remaining credits']);
    expect(state.providers[0].metrics).toHaveLength(0);
    await background.handleMessage({ type: 'REMOVE_METRIC', providerId: 'fixture:continuous', metricId: 'weekly' }, sender);
    await background.handleMessage({ type: 'DONE_TEACH', providerId: 'fixture:continuous' }, sender);
    expect(state.providers[0].mode).toBe('taught');
    expect(state.providers[0].metrics.map((item: TaughtMetric) => item.label)).toEqual(['Remaining credits']);
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
