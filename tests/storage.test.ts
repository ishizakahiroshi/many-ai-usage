import { beforeEach, describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../src/shared/schema';
import { applyRegistryProviders, getProviders, initializeStorage, reorderProviders } from '../src/shared/storage';

function provider(id: string, order: number): ProviderConfig {
  return {
    schema: 'many-ai-usage.provider.v1',
    id,
    displayName: id,
    url: `https://${id.replace(':', '-')}.example/usage`,
    urlMatch: [`https://${id.replace(':', '-')}.example/*`],
    mode: 'auto',
    displayEnabled: true,
    refreshIntervalMinutes: 15,
    metrics: [],
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    order,
  };
}

describe('provider ordering persistence', () => {
  const state: Record<string, unknown> = {};

  beforeEach(() => {
    for (const key of Object.keys(state)) delete state[key];
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
    };
  });

  it('initializes with zero providers and a schema version', async () => {
    await initializeStorage();
    expect(state.providers).toEqual([]);
    expect(state.schemaVersion).toBe(1);
  });

  it('merges registry providers without overwriting existing entries', async () => {
    const existing = { ...provider('sample:one', 0), displayName: 'My custom label' };
    state.providers = [existing];
    const result = await applyRegistryProviders([provider('sample:one', 0), provider('sample:two', 1)]);
    const providers = await getProviders();
    expect(result).toEqual({ added: ['sample:two'], skipped: ['sample:one'] });
    expect(providers).toHaveLength(2);
    expect(providers[0].displayName).toBe('My custom label');
    expect(state.runtimeStates).toMatchObject({ 'sample:two': { status: 'needs_permission' } });
  });

  it('is idempotent when the same registry is applied twice', async () => {
    state.providers = [];
    const remote = [provider('sample:one', 0), provider('sample:two', 1)];
    await applyRegistryProviders(remote);
    const second = await applyRegistryProviders(remote);
    expect(second).toEqual({ added: [], skipped: ['sample:one', 'sample:two'] });
    expect(await getProviders()).toHaveLength(2);
  });

  it('persists the requested order and keeps provider order contiguous', async () => {
    state.providers = [provider('sample:one', 0), provider('sample:two', 1)];
    await reorderProviders(['sample:two', 'sample:one']);
    const providers = await getProviders();
    expect(providers.map((item) => item.id)).toEqual(['sample:two', 'sample:one']);
    expect(providers.map((provider) => provider.order)).toEqual([0, 1]);
  });
});
