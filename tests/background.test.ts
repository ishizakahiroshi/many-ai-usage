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
    state = { providers: [provider()], schemaVersion: 2 };
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
          remove: async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key];
          },
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
    // No open matching tab → create a dedicated teach tab (closeTabOnExit=true).
    (chrome.tabs.query as any) = vi.fn(async () => []);
    const result = await background.startPicker('fixture:continuous');
    expect(result).toEqual({ started: true, tabId: 99 });
    expect(createTab).toHaveBeenCalledWith({ url: 'https://example.test/usage', active: true });
    updated?.(99, { status: 'complete' }, { id: 99, url: 'https://example.test/usage' } as chrome.tabs.Tab);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendTabMessage).toHaveBeenCalledWith(99, expect.objectContaining({ type: 'START_PICKER' }));
  }

  it('opens a new teach tab when no matching tab exists', async () => {
    await openTeachSession();
  });

  it('reuses an open matching tab and does not close it on Done', async () => {
    (chrome.tabs.query as any) = vi.fn(async () => [
      { id: 5, active: true, url: 'https://example.test/usage', status: 'complete', windowId: 1 },
    ]);
    getTab.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: 'https://example.test/usage',
      status: 'complete',
      windowId: 1,
    }));
    removeTab.mockClear();
    createTab.mockClear();
    sendTabMessage.mockClear();
    const result = await background.startPicker('fixture:continuous');
    expect(result).toEqual({ started: true, tabId: 5 });
    expect(createTab).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendTabMessage).toHaveBeenCalledWith(5, expect.objectContaining({ type: 'START_PICKER' }));
    const sender = { tab: { id: 5 } } as chrome.runtime.MessageSender;
    await background.handleMessage({
      type: 'SAVE_METRIC',
      providerId: 'fixture:continuous',
      metric: metric('weekly', 'Weekly quota'),
      liveRead: { value: 62, used: null, remaining: 62, total: 100, unit: 'percent', evidence: '62%', semanticSignals: ['remaining'] },
    }, sender);
    await background.handleMessage({ type: 'DONE_TEACH', providerId: 'fixture:continuous' }, sender);
    expect(removeTab).not.toHaveBeenCalled();
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
    expect(state['snapshot:fixture:continuous']?.metrics?.[0]?.remaining).toBe(18);
    expect(removeTab).toHaveBeenCalledWith(99);
  });

  it('discards every staged metric on Cancel', async () => {
    await openTeachSession();
    const sender = { tab: { id: 99 } } as chrome.runtime.MessageSender;
    await background.handleMessage({ type: 'SAVE_METRIC', providerId: 'fixture:continuous', metric: metric('weekly', 'Weekly quota') }, sender);
    await background.handleMessage({ type: 'CANCEL_TEACH', providerId: 'fixture:continuous' }, sender);
    expect(state.providers[0].metrics).toHaveLength(0);
    expect(removeTab).toHaveBeenCalledWith(99);
  });

  it('keeps teach-time live values when a later empty CAPTURE_RESULT arrives', async () => {
    await openTeachSession();
    const sender = { tab: { id: 99 } } as chrome.runtime.MessageSender;
    await background.handleMessage({
      type: 'SAVE_METRIC',
      providerId: 'fixture:continuous',
      metric: metric('weekly', 'Weekly quota'),
      liveRead: {
        value: 66,
        used: 66,
        remaining: null,
        total: 100,
        unit: 'percent',
        evidence: '66% 使用済',
        semanticSignals: ['used'],
        resetLabel: '2026年7月24日 9:15 にリセット',
        resetAt: new Date(2026, 6, 24, 9, 15).toISOString(),
      },
    }, sender);
    await background.handleMessage({ type: 'DONE_TEACH', providerId: 'fixture:continuous' }, sender);
    expect(state['snapshot:fixture:continuous']?.metrics?.[0]?.used ?? state['snapshot:fixture:continuous']?.metrics?.[0]?.remaining).toBe(66);
    expect(state['snapshot:fixture:continuous']?.metrics?.[0]?.resetAt).toBe(new Date(2026, 6, 24, 9, 15).toISOString());
    expect(state['snapshot:fixture:continuous']?.metrics?.[0]?.resetLabel).toMatch(/リセット/);

    // Simulate Grok re-capture after the usage sheet is gone.
    await background.handleMessage({
      type: 'CAPTURE_RESULT',
      providerId: 'fixture:continuous',
      snapshot: {
        providerId: 'fixture:continuous',
        displayName: 'Synthetic AI',
        capturedAt: new Date().toISOString(),
        source: 'user_taught',
        status: 'no_data',
        metrics: [],
        warningReason: 'Re-teach needed for: Weekly quota.',
        lastFailureReason: null,
      },
    });

    expect(state['snapshot:fixture:continuous']?.metrics).toHaveLength(1);
    expect(state['snapshot:fixture:continuous']?.metrics?.[0]?.used ?? state['snapshot:fixture:continuous']?.metrics?.[0]?.remaining).toBe(66);
    expect(state['runtimeState:fixture:continuous']?.status).toBe('warning');
  });

  it('starts the picker immediately when the new tab is already complete', async () => {
    (chrome.tabs.query as any) = vi.fn(async () => []);
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

  it('GET_DASHBOARD marks stale providers without writing storage (no onChanged loop)', async () => {
    const setSpy = vi.fn(async (values: Record<string, unknown>) => Object.assign(state, values));
    (chrome.storage.local as unknown as { set: typeof setSpy }).set = setSpy;
    // Snapshot older than refreshIntervalMinutes * 2 (15m → 30m).
    state['snapshot:fixture:continuous'] = {
      providerId: 'fixture:continuous',
      displayName: 'Synthetic AI',
      capturedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      source: 'user_taught',
      status: 'ok',
      metrics: [],
      warningReason: null,
      lastFailureReason: null,
    };
    state['runtimeState:fixture:continuous'] = {
      providerId: 'fixture:continuous',
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      status: 'ok',
      stale: false,
      confidence: 'taught',
      evidenceSummary: [],
      retryAfter: null,
      pageBinding: 'bound',
      errorLabel: null,
      consecutiveFailures: 0,
    };

    setSpy.mockClear();
    const first = await background.handleMessage({ type: 'GET_DASHBOARD' }) as {
      runtimeStates: Record<string, { status: string; stale: boolean }>;
    };
    const second = await background.handleMessage({ type: 'GET_DASHBOARD' }) as {
      runtimeStates: Record<string, { status: string; stale: boolean }>;
    };

    expect(first.runtimeStates['fixture:continuous']).toMatchObject({ status: 'stale', stale: true });
    expect(second.runtimeStates['fixture:continuous']).toMatchObject({ status: 'stale', stale: true });
    // Two dashboard reads must not persist runtimeStates (would re-enter via options onChanged).
    expect(setSpy).not.toHaveBeenCalled();
    // Stored status stays as-is (response-only stale overlay).
    expect(state['runtimeState:fixture:continuous'].status).toBe('ok');
  });

  it('refreshes permitted providers before a popup dashboard is shown', async () => {
    sendTabMessage.mockImplementation(async (tabId: number, message: { type: string }) => {
      if (message.type === 'CAPTURE_NOW') {
        await background.handleMessage({
          type: 'CAPTURE_RESULT',
          providerId: 'fixture:continuous',
          snapshot: {
            providerId: 'fixture:continuous',
            displayName: 'Synthetic AI',
            capturedAt: new Date().toISOString(),
            source: 'user_taught',
            status: 'ok',
            metrics: [],
            warningReason: null,
            lastFailureReason: null,
          },
        }, { tab: { id: tabId } } as chrome.runtime.MessageSender);
      }
      return { ok: true };
    });

    const result = await background.handleMessage({ type: 'REFRESH_DASHBOARD' });

    expect(result).toEqual({ refreshed: 1, skipped: 0, timedOut: 0 });
    // providerId pins the capture so a shared usage URL cannot write into another account's entry.
    expect(sendTabMessage).toHaveBeenCalledWith(5, { type: 'CAPTURE_NOW', providerId: 'fixture:continuous' });
  });

  it('never redirects an ordinary matching chat tab during automatic capture', async () => {
    state.providers[0] = {
      ...provider(),
      urlMatch: ['https://example.test/*'],
    };
    getTab.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: 'https://example.test/chat',
      status: 'complete',
    }));
    updateTab.mockClear();
    sendTabMessage.mockClear();

    updated?.(55, { status: 'complete' }, { id: 55, url: 'https://example.test/chat' } as chrome.tabs.Tab);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateTab).not.toHaveBeenCalled();
    expect(sendTabMessage).not.toHaveBeenCalled();
  });

  it('uses a background usage tab instead of repurposing a matching chat tab for popup refresh', async () => {
    state.providers[0] = {
      ...provider(),
      urlMatch: ['https://example.test/*'],
    };
    (chrome.tabs.query as any) = vi.fn(async () => [{ id: 5, url: 'https://example.test/chat' }]);
    createTab.mockImplementation(async () => ({ id: 99, url: 'https://example.test/usage', status: 'complete' }));
    getTab.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 99 ? 'https://example.test/usage' : 'https://example.test/chat',
      status: 'complete',
    }));
    sendTabMessage.mockImplementation(async (tabId: number, message: { type: string }) => {
      if (message.type === 'CAPTURE_NOW') {
        await background.handleMessage({
          type: 'CAPTURE_RESULT',
          providerId: 'fixture:continuous',
          snapshot: {
            providerId: 'fixture:continuous',
            displayName: 'Synthetic AI',
            capturedAt: new Date().toISOString(),
            source: 'user_taught',
            status: 'ok',
            metrics: [],
            warningReason: null,
            lastFailureReason: null,
          },
        }, { tab: { id: tabId } } as chrome.runtime.MessageSender);
      }
      return { ok: true };
    });
    updateTab.mockClear();

    const result = await background.handleMessage({ type: 'REFRESH_DASHBOARD' });

    expect(result).toEqual({ refreshed: 1, skipped: 0, timedOut: 0 });
    expect(createTab).toHaveBeenCalledWith({ url: 'https://example.test/usage', active: false });
    expect(updateTab).not.toHaveBeenCalledWith(5, expect.objectContaining({ url: 'https://example.test/usage' }));
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

  it('opens options with provider deep-link when providerId is given', async () => {
    createTab.mockClear();
    (chrome.tabs.query as any) = vi.fn(async () => []);
    const result = await background.handleMessage({ type: 'OPEN_OPTIONS', providerId: 'sample:fable' });
    expect(result).toEqual({ opened: true, tabId: 99 });
    expect(createTab).toHaveBeenCalledWith(expect.objectContaining({
      url: 'chrome-extension://test/options.html?provider=sample%3Afable',
      active: true,
    }));
  });

  it('re-navigates existing options tab with provider deep-link', async () => {
    const windowsUpdate = vi.fn(async () => undefined);
    (chrome as any).windows = { update: windowsUpdate };
    (chrome.tabs.query as any) = vi.fn(async () => [
      { id: 12, url: 'chrome-extension://test/options.html', windowId: 1, discarded: false },
    ]);
    (chrome.tabs.update as any) = updateTab;
    updateTab.mockClear();
    const result = await background.handleMessage({ type: 'OPEN_OPTIONS', providerId: 'custom:abc' });
    expect(result).toEqual({ opened: true, tabId: 12 });
    expect(updateTab).toHaveBeenCalledWith(12, expect.objectContaining({
      active: true,
      url: 'chrome-extension://test/options.html?provider=custom%3Aabc',
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
    (chrome.tabs.query as any) = vi.fn(async () => []);
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

  it('keeps distinct metricIds with the same label on Done (no silent label-merge overwrite)', async () => {
    // Pre-existing taught metric (e.g. first column already saved earlier).
    const rolling = metric('taught-rolling', 'ローリング利用量');
    rolling.valueAnchor = {
      selectors: ['#rolling-value'],
      tagName: 'span',
      nearbyLabel: 'ローリング利用量0%',
    };
    state.providers[0].metrics = [rolling];
    await openTeachSession();
    const sender = { tab: { id: 99 } } as chrome.runtime.MessageSender;
    // Second column mis-labeled as the same display name but with a new metricId
    // (the historical bug path that wiped the first metric's selectors).
    const colliding = metric('taught-weekly-mislabel', 'ローリング利用量');
    colliding.valueAnchor = {
      selectors: ['section > div:nth-of-type(2)'],
      tagName: 'div',
      nearbyLabel: 'ローリング利用量0%週間利用量0%',
    };
    await background.handleMessage({
      type: 'SAVE_METRIC',
      providerId: 'fixture:continuous',
      metric: colliding,
      liveRead: { value: 0, used: 0, remaining: null, total: 100, unit: 'percent', evidence: '0%', semanticSignals: ['used'] },
    }, sender);
    await background.handleMessage({ type: 'DONE_TEACH', providerId: 'fixture:continuous' }, sender);
    const saved = state.providers[0].metrics as TaughtMetric[];
    expect(saved).toHaveLength(2);
    expect(saved.map((item) => item.metricId).sort()).toEqual(['taught-rolling', 'taught-weekly-mislabel']);
    const keptRolling = saved.find((item) => item.metricId === 'taught-rolling');
    expect(keptRolling?.valueAnchor?.selectors).toEqual(['#rolling-value']);
    expect(keptRolling?.valueAnchor?.tagName).toBe('span');
  });

  it('replaces an existing metric on re-teach when metricId matches', async () => {
    const original = metric('taught-rolling', 'ローリング利用量');
    original.valueAnchor = { selectors: ['#old'], tagName: 'span' };
    state.providers[0].metrics = [original];
    await openTeachSession();
    const sender = { tab: { id: 99 } } as chrome.runtime.MessageSender;
    const reteach = metric('taught-rolling', 'ローリング利用量');
    reteach.valueAnchor = { selectors: ['#new'], tagName: 'span' };
    await background.handleMessage({
      type: 'SAVE_METRIC',
      providerId: 'fixture:continuous',
      metric: reteach,
      liveRead: { value: 12, used: 12, remaining: null, total: 100, unit: 'percent', evidence: '12%', semanticSignals: ['used'] },
    }, sender);
    await background.handleMessage({ type: 'DONE_TEACH', providerId: 'fixture:continuous' }, sender);
    const saved = state.providers[0].metrics as TaughtMetric[];
    expect(saved).toHaveLength(1);
    expect(saved[0]?.metricId).toBe('taught-rolling');
    expect(saved[0]?.valueAnchor?.selectors).toEqual(['#new']);
  });

  describe('multi-account providers on one usage URL', () => {
    // Synthetic identities only — never a real account address.
    const IDENTITY_A = 'person-a@example.com';
    const IDENTITY_B = 'person-b@example.com';

    function secondAccount(): ProviderConfig {
      return { ...provider(), id: 'fixture:account-b', accountLabel: 'B', order: 1 };
    }

    async function teachIdentity(providerId: string, text: string): Promise<void> {
      await background.handleMessage({
        type: 'SAVE_ACCOUNT_ANCHOR',
        providerId,
        accountAnchor: { selectors: ['#account'] },
        text,
      }, { tab: { id: 5 } } as chrome.runtime.MessageSender);
    }

    it('offers every entry registered for the shared URL as a candidate', async () => {
      state.providers = [provider(), secondAccount()];
      const context = await background.handleMessage(
        { type: 'GET_PROVIDER_CONTEXT', url: 'https://example.test/usage' },
        { tab: { id: 5 } } as chrome.runtime.MessageSender,
      ) as { candidates: ProviderConfig[] };
      expect(context.candidates.map((item) => item.id)).toEqual(['fixture:continuous', 'fixture:account-b']);
    });

    it('stores only a hash of the taught identity, never the text', async () => {
      state.providers = [provider(), secondAccount()];
      const saved = await background.handleMessage({
        type: 'SAVE_ACCOUNT_ANCHOR',
        providerId: 'fixture:account-b',
        accountAnchor: { selectors: ['#account'] },
        text: IDENTITY_B,
      }, { tab: { id: 5 } } as chrome.runtime.MessageSender);
      expect(saved).toEqual({ saved: true });
      const stored = (state.providers as ProviderConfig[]).find((item) => item.id === 'fixture:account-b');
      expect(stored?.accountKeyHash).toMatch(/^[0-9a-f]{32}$/);
      expect(JSON.stringify(state)).not.toContain(IDENTITY_B);
    });

    it('resolves the shared URL to the account currently signed in', async () => {
      state.providers = [provider(), secondAccount()];
      await teachIdentity('fixture:continuous', IDENTITY_A);
      await teachIdentity('fixture:account-b', IDENTITY_B);
      const readings = [
        { providerId: 'fixture:continuous', text: IDENTITY_B },
        { providerId: 'fixture:account-b', text: IDENTITY_B },
      ];
      expect(await background.handleMessage({ type: 'RESOLVE_ACCOUNT', readings }))
        .toEqual({ providerId: 'fixture:account-b' });
    });

    it('refuses to guess when the page shows an unknown account', async () => {
      state.providers = [provider(), secondAccount()];
      await teachIdentity('fixture:continuous', IDENTITY_A);
      await teachIdentity('fixture:account-b', IDENTITY_B);
      const resolved = await background.handleMessage({
        type: 'RESOLVE_ACCOUNT',
        readings: [{ providerId: 'fixture:continuous', text: 'person-c@example.com' }],
      });
      expect(resolved).toEqual({ providerId: null });
    });

    it('keeps a container-pinned entry out of another container', async () => {
      state.providers = [
        { ...provider(), cookieStoreId: 'firefox-container-1' },
        { ...secondAccount(), cookieStoreId: 'firefox-container-2' },
      ];
      const context = await background.handleMessage(
        { type: 'GET_PROVIDER_CONTEXT', url: 'https://example.test/usage' },
        { tab: { id: 5, cookieStoreId: 'firefox-container-2' } } as unknown as chrome.runtime.MessageSender,
      ) as { candidates: ProviderConfig[] };
      expect(context.candidates.map((item) => item.id)).toEqual(['fixture:account-b']);
    });

    it('pins an explicit refresh to the entry it was requested for', async () => {
      state.providers = [provider(), secondAccount()];
      sendTabMessage.mockClear();
      await background.handleMessage({ type: 'REFRESH_PROVIDER', providerId: 'fixture:account-b' });
      expect(sendTabMessage).toHaveBeenCalledWith(5, { type: 'CAPTURE_NOW', providerId: 'fixture:account-b' });
    });

    it('lets Done finish a session where only the account was taught', async () => {
      await openTeachSession();
      const sender = { tab: { id: 99 } } as chrome.runtime.MessageSender;
      await background.handleMessage({
        type: 'SAVE_ACCOUNT_ANCHOR',
        providerId: 'fixture:continuous',
        accountAnchor: { selectors: ['#account'] },
        text: IDENTITY_A,
      }, sender);
      expect(await background.handleMessage({ type: 'DONE_TEACH', providerId: 'fixture:continuous' }, sender))
        .toEqual({ saved: true });
    });
  });
});
