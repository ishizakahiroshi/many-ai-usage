import { beforeEach, describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../src/shared/schema';
import { accountSaltPattern } from '../src/shared/account';
import {
  applyStarterProviders,
  deleteProvider,
  getAccountSalt,
  getProviders,
  getRuntimeState,
  getSnapshot,
  initializeStorage,
  reorderProviders,
  upsertProvider,
} from '../src/shared/storage';

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
    expect(state.schemaVersion).toBe(3);
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

  it('single-flights concurrent salt creation and retries after a failed write', async () => {
    let setCalls = 0;
    let failFirst = true;
    (chrome.storage.local as unknown as { set: (values: Record<string, unknown>) => Promise<void> }).set = async (values) => {
      setCalls += 1;
      if (failFirst) {
        failFirst = false;
        throw new Error('synthetic storage failure');
      }
      Object.assign(state, values);
    };

    const first = getAccountSalt();
    const sameFlight = getAccountSalt();
    expect(sameFlight).toBe(first);
    await expect(first).rejects.toThrow('synthetic storage failure');

    const recovered = await getAccountSalt();
    expect(recovered).toMatch(accountSaltPattern);
    expect(state.accountSalt).toBe(recovered);
    expect(setCalls).toBe(2);
  });

  it('merges registry providers without overwriting existing entries', async () => {
    const existing = { ...provider('sample:one', 0), displayName: 'My custom label' };
    state.providers = [existing];
    const result = await applyStarterProviders([provider('sample:one', 0), provider('sample:two', 1)]);
    const providers = await getProviders();
    expect(result).toEqual({ added: ['sample:two'], skipped: ['sample:one'], replaced: [] });
    expect(providers).toHaveLength(2);
    expect(providers[0].displayName).toBe('My custom label');
    expect(state['runtimeState:sample:two']).toMatchObject({ status: 'needs_permission' });
  });

  it('is idempotent when the same registry is applied twice', async () => {
    state.providers = [];
    const remote = [provider('sample:one', 0), provider('sample:two', 1)];
    await applyStarterProviders(remote);
    const second = await applyStarterProviders(remote);
    expect(second).toEqual({ added: [], skipped: ['sample:one', 'sample:two'], replaced: [] });
    expect(await getProviders()).toHaveLength(2);
  });

  it('persists the requested order and keeps provider order contiguous', async () => {
    state.providers = [provider('sample:one', 0), provider('sample:two', 1)];
    await reorderProviders(['sample:two', 'sample:one']);
    const providers = await getProviders();
    expect(providers.map((item) => item.id)).toEqual(['sample:two', 'sample:one']);
    expect(providers.map((provider) => provider.order)).toEqual([0, 1]);
  });

  it('serializes reorder with starter import so neither update is lost', async () => {
    state.providers = [provider('sample:one', 0), provider('sample:two', 1)];
    let releaseFirstSet!: () => void;
    const firstSetGate = new Promise<void>((resolve) => { releaseFirstSet = resolve; });
    let providerSets = 0;
    (chrome.storage.local as unknown as { set: (values: Record<string, unknown>) => Promise<void> }).set = async (values) => {
      if (Object.hasOwn(values, 'providers') && providerSets++ === 0) await firstSetGate;
      Object.assign(state, values);
    };

    const reorder = reorderProviders(['sample:two', 'sample:one']);
    await Promise.resolve();
    const apply = applyStarterProviders([provider('sample:three', 0)]);
    releaseFirstSet();
    await Promise.all([reorder, apply]);

    expect((await getProviders()).map((item) => item.id)).toEqual(['sample:two', 'sample:one', 'sample:three']);
  });

  it('serializes delete with upsert so a removed peer is not resurrected', async () => {
    state.providers = [provider('sample:one', 0), provider('sample:two', 1)];
    let releaseFirstSet!: () => void;
    const firstSetGate = new Promise<void>((resolve) => { releaseFirstSet = resolve; });
    let providerSets = 0;
    (chrome.storage.local as unknown as { set: (values: Record<string, unknown>) => Promise<void> }).set = async (values) => {
      if (Object.hasOwn(values, 'providers') && providerSets++ === 0) await firstSetGate;
      Object.assign(state, values);
    };

    const deletion = deleteProvider('sample:one');
    await Promise.resolve();
    const upsert = upsertProvider({ ...provider('sample:two', 1), displayName: 'Updated two' });
    releaseFirstSet();
    await Promise.all([deletion, upsert]);

    expect((await getProviders()).map((item) => [item.id, item.displayName]))
      .toEqual([['sample:two', 'Updated two']]);
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

    expect(state.schemaVersion).toBe(3);
    expect(state.snapshots).toBeUndefined();
    expect(state.runtimeStates).toBeUndefined();
    expect(await getSnapshot('sample:one')).toMatchObject({ providerId: 'sample:one', status: 'ok' });
    expect(await getRuntimeState('sample:one')).toMatchObject({ providerId: 'sample:one', status: 'ok' });
  });

  it('removes every legacy account anchor field and requires a safe re-teach without losing metrics', async () => {
    const metric = {
      metricId: 'fixture-metric',
      label: 'Synthetic usage',
      kind: 'percent' as const,
      unit: 'percent' as const,
      valueAnchor: { selectors: ['#synthetic-usage'], nearbyLabel: 'Synthetic usage' },
      enabled: true,
    };
    state.providers = [{
      ...provider('sample:one', 0),
      metrics: [metric],
      accountAnchor: {
        selectors: ['span[aria-label="person-a@example.com"]'],
        textFingerprint: 'deadbeef',
        nearbyLabel: 'person-a@example.com',
      },
      accountKeyHash: 'a'.repeat(32),
    }];
    state.schemaVersion = 2;
    state['runtimeState:sample:one'] = {
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
    };

    await initializeStorage();

    const migrated = (state.providers as Array<Record<string, unknown>>)[0]!;
    expect(state.schemaVersion).toBe(3);
    expect(migrated.accountAnchor).toBeUndefined();
    expect(migrated.accountKeyHash).toBeUndefined();
    expect(migrated.metrics).toEqual([metric]);
    expect(state['runtimeState:sample:one']).toMatchObject({ status: 'needs_teaching', pageBinding: 'stale' });
    expect(JSON.stringify(state.providers)).not.toContain('person-a@example.com');

    const afterFirstMigration = structuredClone(state);
    await initializeStorage();
    expect(state).toEqual(afterFirstMigration);
  });
});
