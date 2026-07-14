import { describe, expect, it } from 'vitest';
import { createAnchorFingerprint } from '../src/content/teach/selector';
import { extractValue } from '../src/content/teach/extract';
import { readTaught } from '../src/content/teach/read';
import type { ProviderConfig } from '../src/shared/schema';

describe('teach-mode pure functions', () => {
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
});
