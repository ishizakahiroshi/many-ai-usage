import { describe, expect, it } from 'vitest';
import { isStale, makeSampleProviders, makeRuntimeState, safeParseProvider } from '../src/shared/schema';

describe('provider schema', () => {
  it('accepts the two synthetic sample providers', () => {
    const providers = makeSampleProviders();
    expect(providers).toHaveLength(2);
    expect(safeParseProvider(providers[0])).toMatchObject({ id: 'sample:claude', order: 0 });
  });

  it('keeps the runtime status separate from page-only source', () => {
    expect(makeRuntimeState('sample:test', 'needs_permission').status).toBe('needs_permission');
  });
});

describe('stale boundary', () => {
  it('is fresh just before interval x2 and stale at the boundary', () => {
    const provider = makeSampleProviders()[0];
    const capturedAt = new Date('2026-07-14T00:00:00.000Z').toISOString();
    const snapshot = {
      providerId: provider.id,
      displayName: provider.displayName,
      capturedAt,
      source: 'dom' as const,
      status: 'ok' as const,
      metrics: [],
      warningReason: null,
      lastFailureReason: null,
    };
    const threshold = Date.parse(capturedAt) + provider.refreshIntervalMinutes * 2 * 60_000;
    expect(isStale(snapshot, provider, threshold - 1)).toBe(false);
    expect(isStale(snapshot, provider, threshold)).toBe(true);
  });
});
