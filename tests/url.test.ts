import { describe, expect, it } from 'vitest';
import { sameOriginAndPath } from '../src/shared/url';

describe('registered URL matching', () => {
  it('ignores hash routes while keeping origin and path', () => {
    expect(sameOriginAndPath('https://example.com/usage#weekly', 'https://example.com/usage#monthly')).toBe(true);
    expect(sameOriginAndPath('https://example.com/usage', 'https://example.com/settings')).toBe(false);
  });
});
