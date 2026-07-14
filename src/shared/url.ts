import type { ProviderConfig } from './schema';

export function urlWithoutHash(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value.split('#', 1)[0];
  }
}

export function originPattern(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}/*`;
}

export function sameOriginAndPath(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

export function matchesProviderUrl(provider: ProviderConfig, currentUrl: string): boolean {
  if (!sameOriginAndPath(provider.url, currentUrl)) return false;
  return true;
}

export function originChanged(previous: string, next: string): boolean {
  try {
    return new URL(previous).origin !== new URL(next).origin;
  } catch {
    return previous !== next;
  }
}
