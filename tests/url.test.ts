import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../src/shared/schema';
import { matchesProviderUrl, matchesUrlPattern, sameOriginAndPath } from '../src/shared/url';

describe('registered URL matching', () => {
  it('ignores hash routes while keeping origin and path', () => {
    expect(sameOriginAndPath('https://example.com/usage#weekly', 'https://example.com/usage#monthly')).toBe(true);
    expect(sameOriginAndPath('https://example.com/usage', 'https://example.com/settings')).toBe(false);
  });

  it('matches registry wildcards and same-origin subpaths', () => {
    expect(matchesUrlPattern('https://claude.ai/*', 'https://claude.ai/settings/usage')).toBe(true);
    expect(matchesUrlPattern('https://claude.ai/*', 'https://chatgpt.com/')).toBe(false);
    const provider = {
      schema: 'many-ai-usage.provider.v1',
      id: 'sample:claude',
      displayName: 'Claude',
      url: 'https://claude.ai/settings/usage',
      urlMatch: ['https://claude.ai/*'],
      mode: 'taught',
      displayEnabled: true,
      refreshIntervalMinutes: 15,
      metrics: [],
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
      order: 0,
    } satisfies ProviderConfig;
    expect(matchesProviderUrl(provider, 'https://claude.ai/settings/usage')).toBe(true);
    expect(matchesProviderUrl(provider, 'https://claude.ai/settings')).toBe(true);
    expect(matchesProviderUrl(provider, 'https://example.com/settings/usage')).toBe(false);
  });
});
