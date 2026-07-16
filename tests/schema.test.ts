import { describe, expect, it } from 'vitest';
import { isStale, makeRuntimeState, parseProvidersRegistryResponse, safeParseProvider, type ProviderConfig } from '../src/shared/schema';

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
