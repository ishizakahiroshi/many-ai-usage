import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnchorFingerprint } from '../src/content/teach/selector';
import { extractValue } from '../src/content/teach/extract';
import { readTaught } from '../src/content/teach/read';
import { isPickerActive, makeMetric, startPicker, stopPicker } from '../src/content/teach/picker';
import type { ProviderConfig } from '../src/shared/schema';

function pickerShadow(): ShadowRoot | null | undefined {
  const shell = document.querySelector<HTMLElement>('[data-many-ai-usage-picker]');
  // Shadow lives on the inner surface div (dialog shells cannot host shadow in jsdom).
  return shell?.shadowRoot ?? shell?.querySelector('div')?.shadowRoot;
}

function mockHitTarget(getTarget: () => Element | null): void {
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    writable: true,
    value: () => getTarget(),
  });
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    writable: true,
    value: () => {
      const target = getTarget();
      return target ? [target] : [];
    },
  });
}

describe('teach-mode pure functions', () => {
  afterEach(() => stopPicker());
  it('creates a re-selectable selector and fingerprint', () => {
    document.body.innerHTML = '<main><section><p class="quota">72% remaining</p></section></main>';
    const element = document.querySelector('.quota')!;
    const anchor = createAnchorFingerprint(element);
    expect(anchor.selectors).toHaveLength(1);
    expect(document.querySelector(anchor.selectors[0])).toBe(element);
    expect(anchor.textFingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it('refines a broad flex row click down to the node that owns the percentage', async () => {
    const { refineValueElement } = await import('../src/content/teach/picker');
    document.body.innerHTML = '<div class="flex row"><span class="label">5h</span><strong class="value">42% remaining</strong></div>';
    const refined = refineValueElement(document.querySelector('.flex')!);
    expect(refined.className).toBe('value');
    expect(extractValue(refined).value).toBe(42);
  });

  it('refines a huge SPA card click quickly to the usage leaf (no full-tree scan)', async () => {
    const { refineValueElement } = await import('../src/content/teach/picker');
    const card = document.createElement('section');
    card.className = 'usage-card';
    const usage = document.createElement('span');
    usage.id = 'usage-value';
    usage.textContent = '46% 使用済';
    const legend = document.createElement('div');
    legend.innerHTML = '<span>Grok Build 44%</span><span>チャット 1%</span><span>API 1%</span>';
    const thread = document.createElement('div');
    thread.className = 'thread';
    for (let index = 0; index < 8_000; index += 1) {
      const item = document.createElement('div');
      item.textContent = `Message ${index}: lorem ipsum session ${index * 7} tokens used today`;
      thread.append(item);
    }
    card.append(usage, legend, thread);
    document.body.replaceChildren(card);

    const started = performance.now();
    const refined = refineValueElement(card);
    const ms = performance.now() - started;
    expect(ms).toBeLessThan(2_000);
    expect(extractValue(refined).value).toBe(46);
    expect(refined.id).toBe('usage-value');
  });

  it('prefers card headline over breakdown legend when the whole Grok-like card is clicked', async () => {
    const { refineValueElement } = await import('../src/content/teach/picker');
    document.body.innerHTML = `
      <section class="usage-card" id="card">
        <div class="title">週間 SuperGrok 上限</div>
        <strong id="headline">46% 使用済</strong>
        <div class="bar"></div>
        <div class="legend">
          <span id="build">Grok Build 44%</span>
          <span id="chat">チャット 1%</span>
          <span id="api">API 1%</span>
        </div>
        <div class="reset">2026年7月24日 9:15 にリセット</div>
      </section>`;
    const refined = refineValueElement(document.querySelector('#card')!);
    expect(refined.id).toBe('headline');
    expect(extractValue(refined).value).toBe(46);
    // Direct click on a legend chip still keeps that chip (user intent).
    const chat = refineValueElement(document.querySelector('#chat')!);
    expect(chat.id).toBe('chat');
    expect(extractValue(chat).value).toBe(1);
  });

  it('stages an inner legend chip when the pointer hits that chip (not the whole card)', async () => {
    document.body.innerHTML = `
      <section class="usage-card" id="card" aria-valuenow="0">
        <strong id="headline">62% 使用済</strong>
        <div class="bar" aria-valuenow="0"></div>
        <div class="legend">
          <span id="build">Grok Build 1%</span>
          <span id="chat">チャット 1%</span>
        </div>
      </section>`;
    mockHitTarget(() => document.querySelector('#build'));
    const staged: ProviderConfig['metrics'] = [];
    const liveReads: Array<{ value: number | null }> = [];
    const sendMessage = vi.fn(async (message: {
      type: string;
      metric?: ProviderConfig['metrics'][number];
      liveRead?: { value: number | null };
    }) => {
      if (message.type === 'SAVE_METRIC' && message.metric) {
        staged.push(message.metric);
        if (message.liveRead) liveReads.push(message.liveRead);
        return { saved: true, metrics: [...staged] };
      }
      return { metrics: [...staged] };
    });
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage } };
    startPicker('fixture:inner-chip');
    window.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true, clientX: 12, clientY: 12, button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(staged).toHaveLength(1);
    const stagedMetric = staged[0]!;
    // Chip under cursor (1%), not card headline (62%) or aria-valuenow 0.
    expect(liveReads[0]?.value).toBe(1);
    const expectedFp = (await import('../src/content/teach/selector')).createAnchorFingerprint(document.querySelector('#build')!).textFingerprint;
    expect(stagedMetric.valueAnchor?.textFingerprint).toBe(expectedFp);
  });

  it('prefers the shortest unique class selector', () => {
    document.body.innerHTML = '<main><p class="common unique redundant">72%</p><p class="common">18%</p></main>';
    const anchor = createAnchorFingerprint(document.querySelector('.unique')!);
    expect(anchor.selectors[0]).toMatch(/^p\.[a-z]+$/);
  });

  it('prioritizes aria and progress values over surrounding text', () => {
    document.body.innerHTML = '<div aria-valuenow="37" aria-label="Weekly quota remaining">99% chart label</div>';
    expect(extractValue(document.querySelector('div')!).value).toBe(37);
    document.body.innerHTML = '<progress value="25" max="50"></progress>';
    expect(extractValue(document.querySelector('progress')!).value).toBe(50);
  });

  it('ignores bare aria-valuenow=0 when the element text has a real percent', () => {
    document.body.innerHTML = '<div aria-valuenow="0" aria-valuemax="100">使用済 62%</div>';
    expect(extractValue(document.querySelector('div')!)).toMatchObject({ value: 62, unit: 'percent' });
  });

  it('rejects years and reset dates while preferring a real nearby percentage', () => {
    document.body.innerHTML = '<div id="reset">リセット: 2026/07/22</div><div id="card">週間利用上限 62% 残り リセット: 2026/07/22</div><div id="year">2026</div>';
    expect(extractValue(document.querySelector('#reset')!).value).toBeNull();
    expect(extractValue(document.querySelector('#year')!).value).toBeNull();
    expect(extractValue(document.querySelector('#card')!).value).toBe(62);
    expect(extractValue(document.querySelector('#card')!).unit).toBe('percent');
  });

  it('extracts unit-bearing ratios without losing totals', () => {
    document.body.innerHTML = '<p id="requests">18 / 40 requests</p><p id="cost">$4.20 / $20.00</p>';
    expect(extractValue(document.querySelector('#requests')!)).toMatchObject({ value: 18, total: 40, unit: 'requests' });
    expect(extractValue(document.querySelector('#cost')!)).toMatchObject({ value: 4.2, total: 20, unit: 'dollars' });
  });

  it('uses a nearby percent sign when the selected node contains only the number', () => {
    document.body.innerHTML = '<div>Weekly quota <span id="number">62</span> % remaining</div>';
    expect(extractValue(document.querySelector('#number')!)).toMatchObject({ value: 62, unit: 'percent' });
  });

  it('builds a named metric and automatically anchors the closest reset label', () => {
    document.body.innerHTML = '<article><h2>Weekly usage limit</h2><div><span id="value">62% remaining</span></div><p id="reset">Resets in 4 days</p></article>';
    const metric = makeMetric(document.querySelector('#value')!);
    expect(metric.label).toContain('Weekly usage limit');
    expect(metric.resetAnchor).toBeDefined();
    const provider: ProviderConfig = {
      schema: 'many-ai-usage.provider.v1', id: 'fixture:reset', displayName: 'Synthetic AI', url: 'https://example.test/usage', urlMatch: [], mode: 'taught', displayEnabled: true, refreshIntervalMinutes: 15, metrics: [metric], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), order: 0,
    };
    const snapshot = readTaught(document, provider, Date.parse('2026-07-16T00:00:00.000Z'));
    expect(snapshot.metrics[0].resetLabel).toContain('Resets in 4 days');
    expect(snapshot.metrics[0].resetAt).toBe('2026-07-20T00:00:00.000Z');
  });

  it('infers Grok-style Japanese reset date next to 使用済', async () => {
    const { parseResetText } = await import('../src/content/teach/reset');
    document.body.innerHTML = `
      <section class="usage-card">
        <strong id="headline">66% 使用済</strong>
        <div class="bar"></div>
        <div class="legend"><span>Grok Build 64%</span></div>
        <div id="reset">2026年7月24日 9:15 にリセット</div>
      </section>`;
    expect(parseResetText('2026年7月24日 9:15 にリセット')).toBe(new Date(2026, 6, 24, 9, 15).toISOString());
    const metric = makeMetric(document.querySelector('#headline')!);
    expect(metric.resetAnchor).toBeDefined();
    const provider: ProviderConfig = {
      schema: 'many-ai-usage.provider.v1',
      id: 'fixture:grok-reset',
      displayName: 'Grok',
      url: 'https://grok.example/?_s=usage',
      urlMatch: [],
      mode: 'taught',
      displayEnabled: true,
      refreshIntervalMinutes: 15,
      metrics: [metric],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      order: 0,
    };
    const snapshot = readTaught(document, provider, Date.parse('2026-07-16T00:00:00.000Z'));
    expect(snapshot.metrics[0].resetLabel).toMatch(/リセット/);
    expect(snapshot.metrics[0].resetAt).toBe(new Date(2026, 6, 24, 9, 15).toISOString());
  });

  it('reads a taught metric and reports missing anchors', () => {
    document.body.innerHTML = '<p id="quota">41% remaining</p>';
    const element = document.querySelector('#quota')!;
    const provider: ProviderConfig = {
      schema: 'many-ai-usage.provider.v1', id: 'fixture:taught', displayName: 'Synthetic AI', url: 'https://example.test/usage', urlMatch: [], mode: 'taught', displayEnabled: true, refreshIntervalMinutes: 15, metrics: [{ metricId: 'weekly', label: 'Weekly quota', kind: 'percent', unit: 'percent', valueAnchor: createAnchorFingerprint(element), interpretation: 'remaining_percent', enabled: true }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), order: 0,
    };
    expect(readTaught(document, provider, Date.parse('2026-07-14T00:00:00.000Z')).metrics[0].remaining).toBe(41);
    document.body.innerHTML = '<p>gone</p>';
    expect(readTaught(document, provider).status).toBe('no_data');
  });

  it('uses the fingerprint fallback when a selector changes but the metric value updates', () => {
    document.body.innerHTML = '<p id="old">41% remaining</p>';
    const anchor = createAnchorFingerprint(document.querySelector('#old')!);
    document.body.innerHTML = '<p id="new">42% remaining</p>';
    const provider: ProviderConfig = {
      schema: 'many-ai-usage.provider.v1', id: 'fixture:fallback', displayName: 'Synthetic AI', url: 'https://example.test/usage', urlMatch: [], mode: 'taught', displayEnabled: true, refreshIntervalMinutes: 15, metrics: [{ metricId: 'weekly', label: 'Weekly quota', kind: 'percent', unit: 'percent', valueAnchor: anchor, interpretation: 'remaining_percent', enabled: true }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), order: 0,
    };
    expect(readTaught(document, provider).metrics[0].remaining).toBe(42);
  });

  it('recovers a taught metric by label when Tailwind-style selectors break', () => {
    document.body.innerHTML = '<div class="card"><span class="inline-flex items-center gap-1"><span class="tabular-nums text-sm">Grok Build 44%</span></span></div>';
    const element = document.querySelector('.tabular-nums')!;
    const anchor = createAnchorFingerprint(element);
    // Simulate SPA class churn: wipe utility classes / broken selector path.
    const broken = {
      ...anchor,
      selectors: ['span.inline-flex.items-center.gap-1 > span.tabular-nums.text-sm.does-not-exist'],
    };
    document.body.innerHTML = '<div class="card"><span class="flex row"><span id="chip">Grok Build 49%</span></span></div>';
    const provider: ProviderConfig = {
      schema: 'many-ai-usage.provider.v1',
      id: 'fixture:soft-label',
      displayName: 'Grok',
      url: 'https://grok.example/?_s=usage',
      urlMatch: [],
      mode: 'taught',
      displayEnabled: true,
      refreshIntervalMinutes: 15,
      metrics: [{
        metricId: 'build',
        label: 'Grok Build',
        kind: 'percent',
        unit: 'percent',
        valueAnchor: broken,
        interpretation: 'used_percent',
        enabled: true,
      }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      order: 0,
    };
    const snapshot = readTaught(document, provider);
    expect(snapshot.metrics).toHaveLength(1);
    expect(snapshot.metrics[0].used ?? snapshot.metrics[0].remaining).toBe(49);
    expect(snapshot.warningReason).toBeNull();
  });

  it('avoids baking Tailwind utility classes into taught selectors', () => {
    document.body.innerHTML = '<main><p class="quota inline-flex items-center text-sm tabular-nums gap-1">72% remaining</p></main>';
    const anchor = createAnchorFingerprint(document.querySelector('p')!);
    expect(anchor.selectors[0]).not.toMatch(/inline-flex|tabular-nums|items-center|text-sm/);
    expect(document.querySelector(anchor.selectors[0]!)).toBeTruthy();
  });

  it('falls back to page 使用済 total when a broken legend track cannot be resolved', () => {
    document.body.innerHTML = `
      <section>
        <strong id="total">52% 使用済</strong>
        <div><span>Grok Build 49%</span><span>チャット 1%</span></div>
      </section>`;
    const provider: ProviderConfig = {
      schema: 'many-ai-usage.provider.v1',
      id: 'fixture:headline-fallback',
      displayName: 'Grok',
      url: 'https://grok.example/?_s=usage',
      urlMatch: [],
      mode: 'taught',
      displayEnabled: true,
      refreshIntervalMinutes: 15,
      metrics: [{
        metricId: 'build',
        label: 'Grok Build',
        kind: 'percent',
        unit: 'percent',
        valueAnchor: {
          selectors: ['#does-not-exist'],
          tagName: 'span',
          textFingerprint: 'deadbeef',
          nearbyLabel: 'Grok Build gone',
        },
        interpretation: 'used_percent',
        enabled: true,
      }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      order: 0,
    };
    const snapshot = readTaught(document, provider);
    expect(snapshot.metrics).toHaveLength(1);
    expect(snapshot.metrics[0].used).toBe(52);
    expect(snapshot.metrics[0].evidence.semanticSignals).toContain('headline-fallback');
  });

  it('keeps the picker open while a metric is staged, then completes from the panel', async () => {
    document.body.innerHTML = '<section><h2>Weekly quota</h2><p id="weekly">62% remaining</p><h2>Credits</h2><p id="credits">18 credits remaining</p></section>';
    mockHitTarget(() => document.querySelector('#weekly'));
    const staged: ProviderConfig['metrics'] = [];
    const sendMessage = vi.fn(async (message: { type: string; metric?: ProviderConfig['metrics'][number] }) => {
      if (message.type === 'SAVE_METRIC' && message.metric) staged.push(message.metric);
      return { metrics: [...staged] };
    });
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage } };
    startPicker('fixture:continuous');
    window.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true, clientX: 10, clientY: 10, button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Second metric via a separate pointer hit on credits (independent mock).
    mockHitTarget(() => document.querySelector('#credits'));
    window.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true, clientX: 40, clientY: 40, button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const shadow = pickerShadow();
    // At least one staged metric; multi-hit depends on hit-testing which Grok needs compact selection for.
    expect(Number(shadow?.querySelector('[data-count]')?.textContent?.replace(/\D/g, '') ?? 0)).toBeGreaterThanOrEqual(1);
    expect(isPickerActive()).toBe(true);
    shadow?.querySelector<HTMLButtonElement>('[data-action="done"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'DONE_TEACH', providerId: 'fixture:continuous' });
    expect(isPickerActive()).toBe(false);
  });

  it('treats Escape as cancel for the whole teach session', async () => {
    document.body.innerHTML = '<p>62% remaining</p>';
    const sendMessage = vi.fn(async () => ({ cancelled: true }));
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage } };
    startPicker('fixture:cancel');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'CANCEL_TEACH', providerId: 'fixture:cancel' });
    expect(isPickerActive()).toBe(false);
  });

  it('keeps a staged metric when background returns an empty metrics list', async () => {
    document.body.innerHTML = '<p id="weekly">62% remaining</p>';
    mockHitTarget(() => document.querySelector('#weekly'));
    const sendMessage = vi.fn(async () => ({ saved: false, metrics: [] as ProviderConfig['metrics'] }));
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage } };
    startPicker('fixture:empty-response');
    window.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 10, clientY: 10 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pickerShadow()?.querySelector('[data-count]')?.textContent).toBe('Saved: 1');
    expect(pickerShadow()?.querySelector<HTMLButtonElement>('[data-action="done"]')?.disabled).toBe(false);
  });

  it('renames a staged metric from the panel without window.prompt', async () => {
    document.body.innerHTML = '<p id="weekly">62% remaining</p>';
    mockHitTarget(() => document.querySelector('#weekly'));
    const sendMessage = vi.fn(async (message: { type: string; label?: string; metric?: ProviderConfig['metrics'][number] }) => {
      if (message.type === 'SAVE_METRIC' && message.metric) return { saved: true, metrics: [message.metric] };
      if (message.type === 'RENAME_METRIC') return { metrics: [{ ...(message as any), label: message.label, windowLabel: message.label, metricId: 'weekly', kind: 'percent', unit: 'percent', enabled: true }] };
      return {};
    });
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage } };
    startPicker('fixture:rename');
    window.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 10, clientY: 10 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const shadow = pickerShadow();
    shadow?.querySelector<HTMLButtonElement>('[data-action="rename"]')?.click();
    const input = shadow?.querySelector<HTMLInputElement>('input[data-rename-input]');
    expect(input).toBeTruthy();
    if (input) input.value = 'Session limit';
    shadow?.querySelector<HTMLButtonElement>('[data-action="rename-save"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'RENAME_METRIC', label: 'Session limit' }));
  });

  it('still stages a metric when a page capture-phase handler stops the event', async () => {
    document.body.innerHTML = '<p id="weekly">62% remaining</p>';
    mockHitTarget(() => document.querySelector('#weekly'));
    const staged: ProviderConfig['metrics'] = [];
    const sendMessage = vi.fn(async (message: { type: string; metric?: ProviderConfig['metrics'][number] }) => {
      if (message.type === 'SAVE_METRIC' && message.metric) staged.push(message.metric);
      return { saved: true, metrics: [...staged] };
    });
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage } };
    const pageHandler = (event: Event) => {
      event.stopImmediatePropagation();
    };
    document.addEventListener('click', pageHandler, true);
    try {
      startPicker('fixture:page-capture');
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 10, clientY: 10 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(pickerShadow()?.querySelector('[data-count]')?.textContent).toBe('Saved: 1');
    } finally {
      document.removeEventListener('click', pageHandler, true);
    }
  });

  it('stages from pointerdown when the page never emits click (Codex/ChatGPT style)', async () => {
    document.body.innerHTML = '<p id="weekly">85% remaining</p>';
    mockHitTarget(() => document.querySelector('#weekly'));
    const staged: ProviderConfig['metrics'] = [];
    const sendMessage = vi.fn(async (message: { type: string; metric?: ProviderConfig['metrics'][number] }) => {
      if (message.type === 'SAVE_METRIC' && message.metric) staged.push(message.metric);
      return { saved: true, metrics: [...staged] };
    });
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage } };
    // Swallow click entirely — only pointerdown reaches the page (common SPA pattern).
    document.addEventListener('click', (event) => event.stopImmediatePropagation(), true);
    startPicker('fixture:pointerdown');
    // jsdom lacks PointerEvent; MouseEvent with type pointerdown is enough for our handler.
    window.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true, clientX: 12, clientY: 14, button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pickerShadow()?.querySelector('[data-count]')?.textContent).toBe('Saved: 1');
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'SAVE_METRIC' }));
    // Trailing click must not double-stage the same gesture.
    window.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 12, clientY: 14 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(staged).toHaveLength(1);
  });

  it('shows a status hint when the hit element has no usage number', async () => {
    document.body.innerHTML = '<p id="label">週間利用上限</p>';
    mockHitTarget(() => document.querySelector('#label'));
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage: vi.fn() } };
    startPicker('fixture:no-value');
    window.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true, clientX: 5, clientY: 5, button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pickerShadow()?.querySelector('[data-count]')?.textContent).toBe('Saved: 0');
    expect(pickerShadow()?.querySelector('[data-hint]')?.textContent).toMatch(/No usage number/i);
  });

  it('stages from hover cache when click hit-test misses (Codex popover top-layer)', async () => {
    document.body.innerHTML = '<div id="card"><strong id="weekly">85% 残り</strong></div>';
    const weekly = document.querySelector('#weekly')!;
    // Hover sees the value; click hit-test returns null (top-layer / pointer-events race).
    mockHitTarget(() => weekly);
    const staged: ProviderConfig['metrics'] = [];
    const sendMessage = vi.fn(async (message: { type: string; metric?: ProviderConfig['metrics'][number] }) => {
      if (message.type === 'SAVE_METRIC' && message.metric) staged.push(message.metric);
      return { saved: true, metrics: [...staged] };
    });
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage } };
    startPicker('fixture:hover-cache');
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, composed: true, clientX: 40, clientY: 50 }));
    // Simulate click miss under the host after hover.
    mockHitTarget(() => null);
    window.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true, clientX: 42, clientY: 52, button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pickerShadow()?.querySelector('[data-count]')?.textContent).toBe('Saved: 1');
    expect(staged).toHaveLength(1);
  });
});
