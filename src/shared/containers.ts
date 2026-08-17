/**
 * Firefox containers (contextualIdentities).
 *
 * A browser profile holds one session per site, so two accounts on the same service cannot be
 * open at once — except in Firefox, where each container keeps its own cookie jar. Pinning a
 * provider to a container lets the dashboard refresh every account on its own.
 *
 * Chrome has no equivalent API. Every call here degrades to "no containers", and the caller
 * must never pass a cookieStoreId to chrome.tabs.create there (Chrome rejects the property).
 */

export interface ContainerIdentity {
  cookieStoreId: string;
  name: string;
  color?: string;
}

/**
 * tabs.create with a container needs `cookies`; listing them needs `contextualIdentities`.
 * The cast is required because `contextualIdentities` is Firefox-only and therefore missing
 * from Chrome's ManifestPermissions union.
 */
export const CONTAINER_PERMISSIONS = {
  permissions: ['contextualIdentities', 'cookies'],
} as unknown as chrome.permissions.Permissions;

type ContextualIdentitiesApi = {
  query: (details: Record<string, unknown>) => Promise<ContainerIdentity[]>;
};

type MaybeContainerGlobals = {
  browser?: { contextualIdentities?: ContextualIdentitiesApi; runtime?: { getBrowserInfo?: unknown } };
  chrome?: { contextualIdentities?: ContextualIdentitiesApi };
};

function contextualIdentities(): ContextualIdentitiesApi | null {
  const globals = globalThis as MaybeContainerGlobals;
  return globals.browser?.contextualIdentities ?? globals.chrome?.contextualIdentities ?? null;
}

/**
 * True once the container API is reachable — which on Firefox also means the optional
 * permission was granted (the namespace stays undefined until then).
 */
export function supportsContainers(): boolean {
  return contextualIdentities() !== null;
}

/** getBrowserInfo exists only on Firefox, so it tells "could have containers" from "never will". */
export function isFirefox(): boolean {
  return typeof (globalThis as MaybeContainerGlobals).browser?.runtime?.getBrowserInfo === 'function';
}

export async function listContainers(): Promise<ContainerIdentity[]> {
  const api = contextualIdentities();
  if (!api) return [];
  try {
    const identities = await api.query({});
    return identities.map((identity) => ({
      cookieStoreId: identity.cookieStoreId,
      name: identity.name,
      color: identity.color,
    }));
  } catch {
    // Permission can be revoked between calls; treat it as "no containers configured".
    return [];
  }
}

export async function hasContainerPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.contains(CONTAINER_PERMISSIONS);
  } catch {
    return false;
  }
}

export async function requestContainerPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.request(CONTAINER_PERMISSIONS);
  } catch {
    return false;
  }
}

/** Read a tab's container id without depending on Chrome type definitions. */
export function tabCookieStoreId(tab: chrome.tabs.Tab | undefined | null): string | undefined {
  return (tab as (chrome.tabs.Tab & { cookieStoreId?: string }) | undefined | null)?.cookieStoreId;
}

/**
 * Tab creation properties for a provider. The cookieStoreId is attached only when the browser
 * actually supports containers — Chrome throws when it sees the property.
 */
export function tabCreateProperties(
  url: string,
  active: boolean,
  cookieStoreId?: string,
): chrome.tabs.CreateProperties {
  const base: chrome.tabs.CreateProperties = { url, active };
  if (!cookieStoreId || !supportsContainers()) return base;
  return { ...base, cookieStoreId } as chrome.tabs.CreateProperties;
}
