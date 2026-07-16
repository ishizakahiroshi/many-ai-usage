import { parseProvidersRegistryResponse, type ProviderConfig } from './schema';

export const PROVIDERS_REGISTRY_URL = 'https://raw.githubusercontent.com/ishizakahiroshi/many-ai-cli/main/resources/usage-links/providers.json';
export const USAGE_GUIDE_URL = 'https://ishizakahiroshi.github.io/articles/many-ai-usage/usage.html';
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
