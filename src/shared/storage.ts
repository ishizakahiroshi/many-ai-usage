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
const SNAPSHOTS_KEY = 'snapshots';
const RUNTIME_KEY = 'runtimeStates';
const VERSION_KEY = 'schemaVersion';

function localStorage(): chrome.storage.LocalStorageArea {
  return chrome.storage.local;
}

export async function initializeStorage(): Promise<void> {
  const result = await localStorage().get([PROVIDERS_KEY, VERSION_KEY]);
  const rawProviders = result[PROVIDERS_KEY];
  const patch: Record<string, unknown> = {};
  if (!Array.isArray(rawProviders)) patch[PROVIDERS_KEY] = [];
  if (typeof result[VERSION_KEY] !== 'number') patch[VERSION_KEY] = 1;
  if (Object.keys(patch).length > 0) await localStorage().set(patch);
}

export async function applyRegistryProviders(remote: ProviderConfig[]): Promise<{ added: string[]; skipped: string[] }> {
  const existingProviders = await getProviders();
  const existingIds = new Set(existingProviders.map((provider) => provider.id));
  const missing = remote.filter((provider) => !existingIds.has(provider.id));
  if (missing.length === 0) {
    return { added: [], skipped: remote.map((provider) => provider.id) };
  }
  const baseOrder = existingProviders.length;
  const additions = missing.map((provider, index) => ({ ...provider, order: baseOrder + index }));
  const nextProviders = [...existingProviders, ...additions];
  await localStorage().set({ [PROVIDERS_KEY]: nextProviders });
  const runtimeResult = await localStorage().get(RUNTIME_KEY);
  const runtimeStates = { ...(runtimeResult[RUNTIME_KEY] ?? {}) };
  for (const sample of additions) {
    if (!runtimeStates[sample.id]) {
      runtimeStates[sample.id] = makeRuntimeState(sample.id, 'needs_permission');
    }
  }
  await localStorage().set({ [RUNTIME_KEY]: runtimeStates });
  return {
    added: additions.map((provider) => provider.id),
    skipped: remote.filter((provider) => existingIds.has(provider.id)).map((provider) => provider.id),
  };
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
  const result = await localStorage().get([SNAPSHOTS_KEY, RUNTIME_KEY]);
  const snapshots = { ...(result[SNAPSHOTS_KEY] ?? {}) };
  const runtimeStates = { ...(result[RUNTIME_KEY] ?? {}) };
  delete snapshots[id];
  delete runtimeStates[id];
  await localStorage().set({ [PROVIDERS_KEY]: providers, [SNAPSHOTS_KEY]: snapshots, [RUNTIME_KEY]: runtimeStates });
}

export async function getSnapshot(id: string): Promise<NormalizedSnapshot | null> {
  const result = await localStorage().get(SNAPSHOTS_KEY);
  return safeParseSnapshot(result[SNAPSHOTS_KEY]?.[id])
}

export async function setSnapshot(snapshot: NormalizedSnapshot): Promise<void> {
  const result = await localStorage().get(SNAPSHOTS_KEY);
  const snapshots = { ...(result[SNAPSHOTS_KEY] ?? {}), [snapshot.providerId]: snapshot };
  await localStorage().set({ [SNAPSHOTS_KEY]: snapshots });
}

export async function clearSnapshot(id: string): Promise<void> {
  const result = await localStorage().get(SNAPSHOTS_KEY);
  const snapshots = { ...(result[SNAPSHOTS_KEY] ?? {}) };
  delete snapshots[id];
  await localStorage().set({ [SNAPSHOTS_KEY]: snapshots });
}

export async function getRuntimeState(id: string): Promise<ProviderRuntimeState> {
  const result = await localStorage().get(RUNTIME_KEY);
  return safeParseRuntimeState(result[RUNTIME_KEY]?.[id]) ?? makeRuntimeState(id);
}

export async function setRuntimeState(state: ProviderRuntimeState): Promise<void> {
  const result = await localStorage().get(RUNTIME_KEY);
  const runtimeStates = { ...(result[RUNTIME_KEY] ?? {}), [state.providerId]: state };
  await localStorage().set({ [RUNTIME_KEY]: runtimeStates });
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
