import { beforeEach, describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../src/shared/schema';
import { accountSaltPattern } from '../src/shared/account';
import { applyRegistryProviders, getAccountSalt, getProviders, getRuntimeState, getSnapshot, initializeStorage, reorderProviders } from '../src/shared/storage';

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
          remove: async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key];
          },
        },
      },
    };
  });

  it('initializes with zero providers and a schema version', async () => {
    await initializeStorage();
    expect(state.providers).toEqual([]);
    expect(state.schemaVersion).toBe(2);
  });

  it('does not create an account salt for installs that never use multi-account', async () => {
    await initializeStorage();
    expect(state.accountSalt).toBeUndefined();
  });

  it('creates the account salt once and keeps reusing it', async () => {
    const first = await getAccountSalt();
    const second = await getAccountSalt();
    expect(first).toMatch(accountSaltPattern);
    // Rotating the salt would orphan every stored account hash.
    expect(second).toBe(first);
    expect(state.accountSalt).toBe(first);
  });

  it('merges registry providers without overwriting existing entries', async () => {
    const existing = { ...provider('sample:one', 0), displayName: 'My custom label' };
    state.providers = [existing];
    const result = await applyRegistryProviders([provider('sample:one', 0), provider('sample:two', 1)]);
    const providers = await getProviders();
    expect(result).toEqual({ added: ['sample:two'], skipped: ['sample:one'] });
    expect(providers).toHaveLength(2);
    expect(providers[0].displayName).toBe('My custom label');
    expect(state['runtimeState:sample:two']).toMatchObject({ status: 'needs_permission' });
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

  it('migrates pre-v2 combined snapshots/runtimeStates objects to per-provider keys without losing data', async () => {
    // Simulate an existing install from before the per-provider-key change.
    state.providers = [provider('sample:one', 0)];
    state.schemaVersion = 1;
    state.snapshots = {
      'sample:one': {
        providerId: 'sample:one',
        displayName: 'sample:one',
        capturedAt: '2026-07-16T00:00:00.000Z',
        source: 'user_taught',
        status: 'ok',
        metrics: [],
        warningReason: null,
        lastFailureReason: null,
      },
    };
    state.runtimeStates = {
      'sample:one': {
        providerId: 'sample:one',
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
      },
    };

    await initializeStorage();

    expect(state.schemaVersion).toBe(2);
    expect(state.snapshots).toBeUndefined();
    expect(state.runtimeStates).toBeUndefined();
    expect(await getSnapshot('sample:one')).toMatchObject({ providerId: 'sample:one', status: 'ok' });
    expect(await getRuntimeState('sample:one')).toMatchObject({ providerId: 'sample:one', status: 'ok' });
  });
});
