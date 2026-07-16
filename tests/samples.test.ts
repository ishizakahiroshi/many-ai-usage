import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchProvidersRegistry, PROVIDERS_REGISTRY_URL, SAMPLE_PROVIDER_IDS } from '../src/shared/samples';

const registry = {
  schema: 'many-ai-usage.providers.v1',
  updated: '2026-07-16',
  providers: SAMPLE_PROVIDER_IDS.map((id, index) => ({
    id,
    displayName: `Synthetic ${index + 1}`,
    url: `https://sample-${index + 1}.example/usage`,
    urlMatch: [`https://sample-${index + 1}.example/*`],
  })),
};

afterEach(() => vi.unstubAllGlobals());

describe('sample provider fetch', () => {
  it('fetches the fixed registry URL and returns six validated providers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => registry });
    vi.stubGlobal('fetch', fetchMock);
    const providers = await fetchProvidersRegistry();
    expect(fetchMock).toHaveBeenCalledWith(PROVIDERS_REGISTRY_URL, { cache: 'no-store', credentials: 'omit' });
    expect(providers.map((provider) => provider.id)).toEqual(SAMPLE_PROVIDER_IDS);
  });

  it('reports an HTTP failure without returning fallback providers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(fetchProvidersRegistry()).rejects.toThrow('Sample registry request failed (503)');
  });
});
