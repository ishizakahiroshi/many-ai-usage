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

/** Match registry patterns such as `https://claude.ai/*` or exact provider URLs. */
export function matchesUrlPattern(pattern: string, currentUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1); // keep trailing slash intent: origin + /
      const base = new URL(prefix);
      return current.origin === base.origin && (current.pathname.startsWith(base.pathname) || base.pathname === '/');
    }
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return currentUrl.startsWith(prefix) || urlWithoutHash(currentUrl).startsWith(urlWithoutHash(prefix));
    }
    return sameOriginAndPath(pattern, currentUrl);
  } catch {
    return false;
  }
}

export function matchesProviderUrl(provider: ProviderConfig, currentUrl: string): boolean {
  if (sameOriginAndPath(provider.url, currentUrl)) return true;
  for (const pattern of provider.urlMatch ?? []) {
    if (matchesUrlPattern(pattern, currentUrl)) return true;
  }
  try {
    const registered = new URL(provider.url);
    const current = new URL(currentUrl);
    const registeredPath = registered.pathname.replace(/\/$/, '') || '/';
    if (registered.origin === current.origin && (current.pathname === registeredPath || current.pathname.startsWith(`${registeredPath}/`))) {
      return true;
    }
  } catch {
    /* ignore invalid URLs */
  }
  return false;
}

export function originChanged(previous: string, next: string): boolean {
  try {
    return new URL(previous).origin !== new URL(next).origin;
  } catch {
    return previous !== next;
  }
}
