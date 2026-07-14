import { beforeEach, describe, expect, it } from 'vitest';
import { makeSampleProviders } from '../src/shared/schema';
import { getProviders, reorderProviders } from '../src/shared/storage';

describe('provider ordering persistence', () => {
  const state: Record<string, unknown> = {};

  beforeEach(() => {
    state.providers = makeSampleProviders('2026-07-14T00:00:00.000Z');
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

  it('persists the requested order and keeps provider order contiguous', async () => {
    await reorderProviders(['sample:codex', 'sample:claude']);
    const providers = await getProviders();
    expect(providers.map((provider) => provider.id)).toEqual(['sample:codex', 'sample:claude']);
    expect(providers.map((provider) => provider.order)).toEqual([0, 1]);
  });
});
