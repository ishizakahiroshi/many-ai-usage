import {
  makeRuntimeState,
  safeParseProvider,
  safeParseRuntimeState,
  safeParseSnapshot,
  type NormalizedSnapshot,
  type ProviderConfig,
  type ProviderRuntimeState,
} from './schema';

const PROVIDERS_KEY = 'providers';
// Legacy (pre schemaVersion 2) combined-object keys, kept only for one-time migration.
const LEGACY_SNAPSHOTS_KEY = 'snapshots';
const LEGACY_RUNTIME_KEY = 'runtimeStates';
const VERSION_KEY = 'schemaVersion';
const STORAGE_SCHEMA_VERSION = 2;

// snapshot:<id> / runtimeState:<id> are separate keys per provider (schemaVersion 2+) so that
// concurrent get-then-set on unrelated providers (e.g. refreshDashboard's parallel refreshes)
// can no longer clobber each other's write to one shared combined object.
function snapshotKey(id: string): string {
  return `snapshot:${id}`;
}

function runtimeStateKey(id: string): string {
  return `runtimeState:${id}`;
}

function localStorage(): chrome.storage.LocalStorageArea {
  return chrome.storage.local;
}

/** One-time migration from the pre-v2 combined `snapshots`/`runtimeStates` objects to per-provider keys. */
async function migrateToPerProviderKeys(): Promise<void> {
  const result = await localStorage().get([LEGACY_SNAPSHOTS_KEY, LEGACY_RUNTIME_KEY]);
  const legacySnapshots = (result[LEGACY_SNAPSHOTS_KEY] ?? {}) as Record<string, unknown>;
  const legacyRuntimeStates = (result[LEGACY_RUNTIME_KEY] ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [id, snapshot] of Object.entries(legacySnapshots)) patch[snapshotKey(id)] = snapshot;
  for (const [id, state] of Object.entries(legacyRuntimeStates)) patch[runtimeStateKey(id)] = state;
  if (Object.keys(patch).length > 0) await localStorage().set(patch);
  await localStorage().remove([LEGACY_SNAPSHOTS_KEY, LEGACY_RUNTIME_KEY]);
}

export async function initializeStorage(): Promise<void> {
  const result = await localStorage().get([PROVIDERS_KEY, VERSION_KEY]);
  const rawProviders = result[PROVIDERS_KEY];
  const patch: Record<string, unknown> = {};
  if (!Array.isArray(rawProviders)) patch[PROVIDERS_KEY] = [];
  const storedVersion = typeof result[VERSION_KEY] === 'number' ? result[VERSION_KEY] : 0;
  if (storedVersion < STORAGE_SCHEMA_VERSION) {
    if (storedVersion < 2) await migrateToPerProviderKeys();
    patch[VERSION_KEY] = STORAGE_SCHEMA_VERSION;
  }
  if (Object.keys(patch).length > 0) await localStorage().set(patch);
}

export type ApplyProvidersResult = { added: string[]; skipped: string[]; replaced: string[] };

/**
 * Merge remote/sample providers into local storage.
 * Default: add unknown ids only (never overwrite user teach / Re-teach).
 * With replaceExisting: overwrite matching ids' url/metrics/mode (opt-in only).
 */
export async function applyStarterProviders(
  remote: ProviderConfig[],
  options: { replaceExisting?: boolean } = {},
): Promise<ApplyProvidersResult> {
  const replaceExisting = options.replaceExisting === true;
  const existingProviders = await getProviders();
  const existingById = new Map(existingProviders.map((provider) => [provider.id, provider]));
  const added: string[] = [];
  const skipped: string[] = [];
  const replaced: string[] = [];
  const now = new Date().toISOString();
  let nextProviders = [...existingProviders];
  let baseOrder = existingProviders.length;

  for (const remoteProvider of remote) {
    const existing = existingById.get(remoteProvider.id);
    if (!existing) {
      nextProviders.push({ ...remoteProvider, order: baseOrder });
      baseOrder += 1;
      added.push(remoteProvider.id);
      continue;
    }
    if (!replaceExisting) {
      skipped.push(remoteProvider.id);
      continue;
    }
    nextProviders = nextProviders.map((provider) => {
      if (provider.id !== remoteProvider.id) return provider;
      return {
        ...provider,
        displayName: remoteProvider.displayName,
        url: remoteProvider.url,
        urlMatch: remoteProvider.urlMatch,
        mode: remoteProvider.mode,
        refreshIntervalMinutes: remoteProvider.refreshIntervalMinutes,
        metrics: remoteProvider.metrics,
        // Sample / starter icons hydrate into iconDataUrl; opt-in replace updates them too.
        ...(remoteProvider.iconDataUrl ? { iconDataUrl: remoteProvider.iconDataUrl } : {}),
        updatedAt: now,
      };
    });
    replaced.push(remoteProvider.id);
  }

  if (added.length === 0 && replaced.length === 0) {
    return { added: [], skipped, replaced: [] };
  }

  await localStorage().set({ [PROVIDERS_KEY]: nextProviders });
  // Per-provider keys: only touch the ids this call actually affects, never a shared object.
  const touchedIds = [...added, ...replaced];
  const existingResult = await localStorage().get(touchedIds.map(runtimeStateKey));
  await Promise.all(touchedIds.map(async (id) => {
    if (existingResult[runtimeStateKey(id)] === undefined) {
      await localStorage().set({ [runtimeStateKey(id)]: makeRuntimeState(id, 'needs_permission') });
    }
  }));
  return { added, skipped, replaced };
}

/** @deprecated Prefer applyStarterProviders — same merge rules without replace. */
export async function applyRegistryProviders(remote: ProviderConfig[]): Promise<{ added: string[]; skipped: string[] }> {
  const result = await applyStarterProviders(remote);
  return { added: result.added, skipped: result.skipped };
}

export async function getProviders(): Promise<ProviderConfig[]> {
  const result = await localStorage().get(PROVIDERS_KEY);
  const providers = Array.isArray(result[PROVIDERS_KEY])
    ? result[PROVIDERS_KEY].map(safeParseProvider).filter((provider): provider is ProviderConfig => provider !== null)
    : [];
  return providers.sort((a, b) => a.order - b.order);
}

export async function getProvider(id: string): Promise<ProviderConfig | null> {
  return (await getProviders()).find((provider) => provider.id === id) ?? null;
}

export async function upsertProvider(provider: ProviderConfig): Promise<void> {
  const providers = await getProviders();
  const next = providers.some((item) => item.id === provider.id)
    ? providers.map((item) => (item.id === provider.id ? provider : item))
    : [...providers, { ...provider, order: provider.order ?? providers.length }];
  await localStorage().set({ [PROVIDERS_KEY]: next });
}

export async function deleteProvider(id: string): Promise<void> {
  const providers = (await getProviders()).filter((provider) => provider.id !== id);
  await localStorage().set({ [PROVIDERS_KEY]: providers });
  await localStorage().remove([snapshotKey(id), runtimeStateKey(id)]);
}

export async function getSnapshot(id: string): Promise<NormalizedSnapshot | null> {
  const result = await localStorage().get(snapshotKey(id));
  return safeParseSnapshot(result[snapshotKey(id)]);
}

export async function setSnapshot(snapshot: NormalizedSnapshot): Promise<void> {
  await localStorage().set({ [snapshotKey(snapshot.providerId)]: snapshot });
}

export async function clearSnapshot(id: string): Promise<void> {
  await localStorage().remove(snapshotKey(id));
}

export async function getRuntimeState(id: string): Promise<ProviderRuntimeState> {
  const result = await localStorage().get(runtimeStateKey(id));
  return safeParseRuntimeState(result[runtimeStateKey(id)]) ?? makeRuntimeState(id);
}

export async function setRuntimeState(state: ProviderRuntimeState): Promise<void> {
  await localStorage().set({ [runtimeStateKey(state.providerId)]: state });
}

export async function reorderProviders(ids: string[]): Promise<void> {
  const providers = await getProviders();
  const positions = new Map(ids.map((id, index) => [id, index]));
  const next = providers.map((provider, index) => ({ ...provider, order: positions.get(provider.id) ?? ids.length + index }));
  await localStorage().set({ [PROVIDERS_KEY]: next });
}

export async function getDashboard() {
  const providers = await getProviders();
  const snapshots = await Promise.all(providers.map(async (provider) => [provider.id, await getSnapshot(provider.id)] as const));
  const runtimeStates = await Promise.all(providers.map(async (provider) => [provider.id, await getRuntimeState(provider.id)] as const));
  return {
    providers,
    snapshots: Object.fromEntries(snapshots),
    runtimeStates: Object.fromEntries(runtimeStates),
  };
}
