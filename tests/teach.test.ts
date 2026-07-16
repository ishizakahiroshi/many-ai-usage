import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnchorFingerprint } from '../src/content/teach/selector';
import { extractValue } from '../src/content/teach/extract';
import { readTaught } from '../src/content/teach/read';
import { isPickerActive, makeMetric, startPicker, stopPicker } from '../src/content/teach/picker';
import type { ProviderConfig } from '../src/shared/schema';

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

  it('keeps the picker open while multiple metrics are staged, then completes from the panel', async () => {
    document.body.innerHTML = '<section><h2>Weekly quota</h2><p id="weekly">62% remaining</p><h2>Credits</h2><p id="credits">18 credits remaining</p></section>';
    let pointed = document.querySelector('#weekly')!;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => pointed });
    const staged: ProviderConfig['metrics'] = [];
    const sendMessage = vi.fn(async (message: { type: string; metric?: ProviderConfig['metrics'][number] }) => {
      if (message.type === 'SAVE_METRIC' && message.metric) staged.push(message.metric);
      return { metrics: [...staged] };
    });
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage } };
    startPicker('fixture:continuous');
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 10, clientY: 10 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    pointed = document.querySelector('#credits')!;
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 20, clientY: 20 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const host = document.querySelector<HTMLElement>('[data-many-ai-usage-picker]')!;
    expect(host.shadowRoot?.querySelector('[data-count]')?.textContent).toBe('Saved: 2');
    expect(isPickerActive()).toBe(true);
    host.shadowRoot?.querySelector<HTMLButtonElement>('[data-action="done"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'DONE_TEACH', providerId: 'fixture:continuous' });
    expect(isPickerActive()).toBe(false);
  });

  it('treats Escape as cancel for the whole teach session', async () => {
    document.body.innerHTML = '<p>62% remaining</p>';
    const sendMessage = vi.fn(async () => ({ cancelled: true }));
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage } };
    startPicker('fixture:cancel');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'CANCEL_TEACH', providerId: 'fixture:cancel' });
    expect(isPickerActive()).toBe(false);
  });
});
