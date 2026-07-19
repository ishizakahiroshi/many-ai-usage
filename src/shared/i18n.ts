/**
 * Runtime locale loader.
 *
 * Language packs live under `locales/` (copied into the extension package at build).
 * To add a language: add `locales/<code>.json` and register it in `locales/catalog.json`.
 * No source change is required for the catalog entry beyond the new JSON files.
 *
 * UI locale preference is stored in chrome.storage.local under `uiLocale`.
 * Picker lives next to ⚙ options in the popup (and options header).
 */

export type MessageTable = Record<string, string>;

export interface LocaleMeta {
  label: string;
  file: string;
}

export interface LocaleCatalog {
  defaultLocale: string;
  locales: Record<string, LocaleMeta>;
}

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

export interface I18nState {
  locale: string;
  catalog: LocaleCatalog;
  messages: MessageTable;
  t: TranslateFn;
}

export interface InitI18nOptions {
  /** Preferred BCP 47 tag (e.g. chrome.i18n.getUILanguage() or navigator.language). */
  preferred?: string;
  /** When true (default), read chrome.storage.local uiLocale before browser language. */
  useStoredPreference?: boolean;
  /** Base URL ending with locales/ (default: chrome.runtime.getURL('locales/')). */
  baseUrl?: string;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Preloaded catalog (tests / offline). */
  catalog?: LocaleCatalog;
  /** Preloaded message tables keyed by locale code (tests). */
  packs?: Record<string, MessageTable>;
}

/** chrome.storage.local key for the user-picked UI language. */
export const UI_LOCALE_STORAGE_KEY = 'uiLocale';

const messageCache = new Map<string, MessageTable>();

export async function getStoredUiLocale(): Promise<string | undefined> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return undefined;
    const result = await chrome.storage.local.get(UI_LOCALE_STORAGE_KEY);
    const value = result[UI_LOCALE_STORAGE_KEY];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Persist UI language. Pass a catalog code (e.g. en / ja). */
export async function setStoredUiLocale(code: string): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [UI_LOCALE_STORAGE_KEY]: code });
}

export function createTranslator(messages: MessageTable, fallback?: MessageTable): TranslateFn {
  return (key, vars) => {
    let text = messages[key] ?? fallback?.[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  };
}

/** Match preferred tag against catalog keys (exact → language subtag → default). */
export function resolveLocale(preferred: string | undefined, catalog: LocaleCatalog): string {
  const codes = Object.keys(catalog.locales);
  if (codes.length === 0) return catalog.defaultLocale;
  if (preferred) {
    const normalized = preferred.trim().replaceAll('_', '-');
    const lower = normalized.toLowerCase();
    const exact = codes.find((code) => code.toLowerCase() === lower);
    if (exact) return exact;
    const lang = lower.split('-')[0] ?? '';
    const byLang = codes.find((code) => code.toLowerCase() === lang);
    if (byLang) return byLang;
  }
  if (catalog.locales[catalog.defaultLocale]) return catalog.defaultLocale;
  return codes[0]!;
}

export function detectPreferredLocale(): string {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
      return chrome.i18n.getUILanguage();
    }
  } catch {
    /* non-extension host */
  }
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
  return 'en';
}

function defaultLocalesBaseUrl(): string {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL('locales/');
    }
  } catch {
    /* ignore */
  }
  return 'locales/';
}

async function fetchJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url, { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error(`i18n load failed (${response.status}): ${url}`);
  return response.json() as Promise<T>;
}

export async function loadCatalog(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<LocaleCatalog> {
  const catalog = await fetchJson<LocaleCatalog>(new URL('catalog.json', baseUrl).href, fetchImpl);
  if (!catalog?.defaultLocale || !catalog.locales || typeof catalog.locales !== 'object') {
    throw new Error('Invalid locale catalog');
  }
  return catalog;
}

export async function loadLocaleMessages(
  locale: string,
  catalog: LocaleCatalog,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MessageTable> {
  const cached = messageCache.get(locale);
  if (cached) return cached;
  const meta = catalog.locales[locale];
  if (!meta?.file) throw new Error(`Unknown locale: ${locale}`);
  const messages = await fetchJson<MessageTable>(new URL(meta.file, baseUrl).href, fetchImpl);
  if (!messages || typeof messages !== 'object') throw new Error(`Invalid messages for ${locale}`);
  messageCache.set(locale, messages);
  return messages;
}

/** Clear runtime cache (tests). */
export function clearI18nCache(): void {
  messageCache.clear();
}

/**
 * Resolve locale, load packs, return translator.
 * Falls back to defaultLocale pack when the preferred pack is missing keys.
 *
 * Preference order: options.preferred → stored uiLocale → browser UI language → catalog default.
 */
export async function initI18n(options: InitI18nOptions = {}): Promise<I18nState> {
  const baseUrl = options.baseUrl ?? defaultLocalesBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;
  const useStored = options.useStoredPreference !== false;
  const stored = options.preferred == null && useStored ? await getStoredUiLocale() : undefined;
  const preferred = options.preferred ?? stored ?? detectPreferredLocale();

  let catalog = options.catalog;
  if (!catalog) {
    if (options.packs) {
      catalog = {
        defaultLocale: 'en',
        locales: Object.fromEntries(
          Object.keys(options.packs).map((code) => [code, { label: code, file: `${code}.json` }]),
        ),
      };
    } else {
      catalog = await loadCatalog(baseUrl, fetchImpl);
    }
  }

  const locale = resolveLocale(preferred, catalog);
  const defaultLocale = catalog.locales[catalog.defaultLocale] ? catalog.defaultLocale : locale;

  let messages: MessageTable;
  let fallback: MessageTable | undefined;

  if (options.packs) {
    messages = options.packs[locale] ?? options.packs[defaultLocale] ?? {};
    fallback = locale === defaultLocale ? undefined : options.packs[defaultLocale];
  } else {
    messages = await loadLocaleMessages(locale, catalog, baseUrl, fetchImpl);
    if (locale !== defaultLocale) {
      fallback = await loadLocaleMessages(defaultLocale, catalog, baseUrl, fetchImpl);
    }
  }

  return {
    locale,
    catalog,
    messages,
    t: createTranslator(messages, fallback),
  };
}

/** List registered locales from a catalog (for future language pickers). */
export function listLocales(catalog: LocaleCatalog): Array<{ code: string; label: string }> {
  return Object.entries(catalog.locales).map(([code, meta]) => ({
    code,
    label: meta.label || code,
  }));
}
