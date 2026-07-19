import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAllowedSampleIconUrl } from '../src/shared/icon';
import {
  fetchProvidersRegistry,
  fetchStarterPack,
  hydrateStarterSampleIcons,
  PROVIDERS_REGISTRY_URL,
  SAMPLE_PROVIDER_IDS,
  STARTER_PACK_URL,
} from '../src/shared/samples';
import type { ProviderConfig } from '../src/shared/schema';

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

const starter = {
  schema: 'many-ai-usage.starter.v1',
  updated: '2026-07-19',
  providers: [
    {
      id: 'sample:claude',
      displayName: 'Claude',
      url: 'https://claude.example/usage',
      urlMatch: ['https://claude.example/*'],
      iconUrl: 'https://raw.githubusercontent.com/ishizakahiroshi/many-ai-usage/main/resources/provider-sample-icons/claude.svg',
      metrics: [],
    },
    {
      id: 'sample:codex',
      displayName: 'Codex',
      url: 'https://codex.example/usage',
      urlMatch: ['https://codex.example/*'],
      metrics: [],
    },
  ],
};

function provider(id: string): ProviderConfig {
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
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
    order: 0,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('sample icon URL policy', () => {
  it('allows only ishizakahiroshi GitHub raw image paths', () => {
    expect(isAllowedSampleIconUrl(
      'https://raw.githubusercontent.com/ishizakahiroshi/many-ai-usage/main/resources/provider-sample-icons/claude.svg',
    )).toBe(true);
    expect(isAllowedSampleIconUrl('https://evil.example/icon.svg')).toBe(false);
    expect(isAllowedSampleIconUrl('https://raw.githubusercontent.com/other/repo/main/x.svg')).toBe(false);
    expect(isAllowedSampleIconUrl('https://raw.githubusercontent.com/ishizakahiroshi/many-ai-usage/main/x.txt')).toBe(false);
  });
});

describe('sample provider fetch', () => {
  it('fetches the fixed registry URL and returns six validated providers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => registry });
    vi.stubGlobal('fetch', fetchMock);
    const providers = await fetchProvidersRegistry();
    expect(fetchMock).toHaveBeenCalledWith(PROVIDERS_REGISTRY_URL, { cache: 'no-store', credentials: 'omit' });
    expect(providers.map((item) => item.id)).toEqual(SAMPLE_PROVIDER_IDS);
  });

  it('reports an HTTP failure without returning fallback providers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(fetchProvidersRegistry()).rejects.toThrow('Sample registry request failed (503)');
  });
});

describe('starter pack fetch', () => {
  it('fetches starter JSON and hydrates sample icons once', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === STARTER_PACK_URL) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(starter),
        };
      }
      if (url.includes('claude.svg')) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new TextEncoder().encode(svg).buffer,
        };
      }
      return { ok: false, status: 404 };
    });
    vi.stubGlobal('fetch', fetchMock);
    const providers = await fetchStarterPack();
    expect(fetchMock).toHaveBeenCalledWith(STARTER_PACK_URL, { cache: 'no-store', credentials: 'omit' });
    expect(providers).toHaveLength(2);
    expect(providers[0].iconDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(providers[1].iconDataUrl).toBeUndefined();
  });

  it('rejects disallowed sample icon hosts during hydrate', async () => {
    await expect(hydrateStarterSampleIcons(
      [provider('sample:evil')],
      { 'sample:evil': 'https://evil.example/x.svg' },
    )).rejects.toThrow('Sample icon URL is not allowed');
  });

  it('keeps the provider when a sample icon download fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await hydrateStarterSampleIcons(
      [provider('sample:claude')],
      {
        'sample:claude': 'https://raw.githubusercontent.com/ishizakahiroshi/many-ai-usage/main/resources/provider-sample-icons/claude.svg',
      },
    );
    expect(result[0].iconDataUrl).toBeUndefined();
  });
});
