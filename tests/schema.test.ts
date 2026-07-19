import { describe, expect, it } from 'vitest';
import {
  isStale,
  makeRuntimeState,
  parseProvidersRegistryResponse,
  parseStarterPackResponse,
  safeParseProvider,
  type ProviderConfig,
} from '../src/shared/schema';

function provider(): ProviderConfig {
  return {
    schema: 'many-ai-usage.provider.v1',
    id: 'sample:test',
    displayName: 'Synthetic AI',
    url: 'https://example.com/usage',
    urlMatch: ['https://example.com/*'],
    mode: 'auto',
    displayEnabled: true,
    refreshIntervalMinutes: 15,
    metrics: [],
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    order: 0,
  };
}

describe('provider schema', () => {
  it('accepts a normalized provider', () => {
    expect(safeParseProvider(provider())).toMatchObject({ id: 'sample:test', order: 0 });
  });

  it('accepts an optional user-uploaded icon data URL', () => {
    const withIcon = {
      ...provider(),
      iconDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    };
    expect(safeParseProvider(withIcon)?.iconDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('rejects non-image data URLs for icons', () => {
    expect(safeParseProvider({ ...provider(), iconDataUrl: 'data:text/plain;base64,YQ==' })).toBeNull();
  });

  it('keeps the runtime status separate from page-only source', () => {
    expect(makeRuntimeState('sample:test', 'needs_permission').status).toBe('needs_permission');
  });
});

describe('stale boundary', () => {
  it('is fresh just before interval x2 and stale at the boundary', () => {
    const item = provider();
    const capturedAt = new Date('2026-07-14T00:00:00.000Z').toISOString();
    const snapshot = {
      providerId: item.id,
      displayName: item.displayName,
      capturedAt,
      source: 'dom' as const,
      status: 'ok' as const,
      metrics: [],
      warningReason: null,
      lastFailureReason: null,
    };
    const threshold = Date.parse(capturedAt) + item.refreshIntervalMinutes * 2 * 60_000;
    expect(isStale(snapshot, item, threshold - 1)).toBe(false);
    expect(isStale(snapshot, item, threshold)).toBe(true);
  });
});

describe('remote providers registry', () => {
  const registry = {
    schema: 'many-ai-usage.providers.v1',
    updated: '2026-07-16',
    providers: [
      { id: 'sample:one', displayName: 'Synthetic One', url: 'https://one.example/usage', urlMatch: ['https://one.example/*'], note: 'fixture' },
      { id: 'sample:two', displayName: 'Synthetic Two', url: 'https://two.example/usage', urlMatch: ['https://two.example/*'] },
    ],
  };

  it('normalizes URL-only registry entries without selectors', () => {
    const providers = parseProvidersRegistryResponse(registry, '2026-07-16T00:00:00.000Z');
    expect(providers).toHaveLength(2);
    expect(providers[0]).toMatchObject({ id: 'sample:one', mode: 'auto', metrics: [], order: 0 });
    expect(providers[1]).toMatchObject({ id: 'sample:two', order: 1 });
  });

  it('rejects an unknown schema version', () => {
    expect(() => parseProvidersRegistryResponse({ ...registry, schema: 'many-ai-usage.providers.v2' })).toThrow();
  });

  it('rejects malformed provider data', () => {
    expect(() => parseProvidersRegistryResponse({ ...registry, providers: [{ id: '', displayName: 'Broken', url: 'not-a-url', urlMatch: [] }] })).toThrow();
  });
});

describe('starter pack schema', () => {
  const starter = {
    schema: 'many-ai-usage.starter.v1',
    updated: '2026-07-19',
    note: 'fixture',
    providers: [
      {
        id: 'sample:claude',
        displayName: 'Claude',
        url: 'https://claude.example/usage',
        urlMatch: ['https://claude.example/*'],
        mode: 'taught',
        verifiedAt: '2026-07-19',
        iconUrl: 'https://raw.githubusercontent.com/ishizakahiroshi/many-ai-usage/main/resources/provider-sample-icons/claude.svg',
        metrics: [
          {
            metricId: 'session',
            label: 'Session',
            kind: 'percent',
            unit: 'percent',
            windowLabel: '5h',
            valueAnchor: { selectors: [], nearbyLabel: 'セッション' },
            interpretation: 'used_percent',
            enabled: true,
          },
        ],
      },
      {
        id: 'sample:grok',
        displayName: 'Grok',
        url: 'https://grok.example/?_s=usage',
        urlMatch: ['https://grok.example/*'],
        metrics: [],
      },
    ],
  };

  it('normalizes metrics and collects sample icon URLs separately', () => {
    const parsed = parseStarterPackResponse(starter, '2026-07-19T00:00:00.000Z');
    expect(parsed.providers).toHaveLength(2);
    expect(parsed.providers[0]).toMatchObject({
      id: 'sample:claude',
      mode: 'taught',
      metrics: [{ metricId: 'session', enabled: true }],
    });
    expect(parsed.providers[0].iconDataUrl).toBeUndefined();
    expect(parsed.providers[1]).toMatchObject({ id: 'sample:grok', mode: 'auto', metrics: [] });
    expect(parsed.sampleIconUrls).toEqual({
      'sample:claude': 'https://raw.githubusercontent.com/ishizakahiroshi/many-ai-usage/main/resources/provider-sample-icons/claude.svg',
    });
  });

  it('rejects an unknown starter schema', () => {
    expect(() => parseStarterPackResponse({ ...starter, schema: 'many-ai-usage.starter.v0' })).toThrow();
  });
});
