import { fetchSampleIconDataUrl, isAllowedSampleIconUrl } from './icon';
import {
  assertStarterPackByteSize,
  parseProvidersRegistryResponse,
  parseStarterPackResponse,
  type ProviderConfig,
} from './schema';

/** Legacy URL-only registry (kept for tests / older docs; UI uses starter pack). */
export const PROVIDERS_REGISTRY_URL = 'https://raw.githubusercontent.com/ishizakahiroshi/many-ai-cli/main/resources/usage-links/providers.json';

/**
 * Community starter pack (URL + optional taught metrics + sample iconUrl).
 * Same GitHub raw host as Try samples — no extra host_permission.
 */
export const STARTER_PACK_URL = 'https://raw.githubusercontent.com/ishizakahiroshi/many-ai-usage/main/resources/starter.json';

/** GitHub raw base for sample letter badges (not bundled in the extension). */
export const SAMPLE_ICON_BASE_URL = 'https://raw.githubusercontent.com/ishizakahiroshi/many-ai-usage/main/resources/provider-sample-icons';

export const USAGE_GUIDE_URL = 'https://ishizakahiroshi.com/articles/many-ai-usage/usage.html';
/** Store Support URL / contact landing (thin page; no ticket backend). */
export const SUPPORT_URL = 'https://ishizakahiroshi.com/articles/many-ai-usage/support.html';

export const SAMPLE_PROVIDER_IDS = [
  'sample:claude',
  'sample:codex',
  'sample:grok',
  'sample:copilot',
  'sample:cursor',
  'sample:ollama',
] as const;

export function isSampleProviderId(id: string): boolean {
  return (SAMPLE_PROVIDER_IDS as readonly string[]).includes(id);
}

export async function fetchProvidersRegistry(): Promise<ProviderConfig[]> {
  const response = await fetch(PROVIDERS_REGISTRY_URL, {
    cache: 'no-store',
    credentials: 'omit',
  });
  if (!response.ok) throw new Error(`Sample registry request failed (${response.status})`);
  return parseProvidersRegistryResponse(await response.json());
}

/**
 * Attach sample icons from iconUrl map into provider.iconDataUrl.
 * Failed individual icons are skipped (provider still imports without icon).
 */
export async function hydrateStarterSampleIcons(
  providers: ProviderConfig[],
  sampleIconUrls: Record<string, string>,
): Promise<ProviderConfig[]> {
  const entries = Object.entries(sampleIconUrls);
  if (entries.length === 0) return providers;

  for (const [id, url] of entries) {
    if (!isAllowedSampleIconUrl(url)) {
      throw new Error(`Sample icon URL is not allowed for ${id}`);
    }
  }

  const icons = await Promise.all(
    entries.map(async ([id, url]) => {
      try {
        const iconDataUrl = await fetchSampleIconDataUrl(url);
        return { id, iconDataUrl } as const;
      } catch {
        return { id, iconDataUrl: null } as const;
      }
    }),
  );
  const byId = new Map(icons.map((item) => [item.id, item.iconDataUrl]));
  return providers.map((provider) => {
    const iconDataUrl = byId.get(provider.id);
    if (!iconDataUrl) return provider;
    return { ...provider, iconDataUrl };
  });
}

async function loadStarterFromJson(json: unknown, now?: string): Promise<ProviderConfig[]> {
  const parsed = parseStarterPackResponse(json, now ?? new Date().toISOString());
  return hydrateStarterSampleIcons(parsed.providers, parsed.sampleIconUrls);
}

export async function fetchStarterPack(): Promise<ProviderConfig[]> {
  const response = await fetch(STARTER_PACK_URL, {
    cache: 'no-store',
    credentials: 'omit',
  });
  if (!response.ok) throw new Error(`Starter pack request failed (${response.status})`);
  const rawText = await response.text();
  assertStarterPackByteSize(rawText);
  let json: unknown;
  try {
    json = JSON.parse(rawText) as unknown;
  } catch {
    throw new Error('Starter pack response is not valid JSON');
  }
  return loadStarterFromJson(json);
}

/** Parse pasted starter JSON and fetch sample icons once (schema-validated; never eval). */
export async function parseStarterPackText(rawText: string, now = new Date().toISOString()): Promise<ProviderConfig[]> {
  assertStarterPackByteSize(rawText);
  let json: unknown;
  try {
    json = JSON.parse(rawText) as unknown;
  } catch {
    throw new Error('Pasted text is not valid JSON');
  }
  return loadStarterFromJson(json, now);
}
