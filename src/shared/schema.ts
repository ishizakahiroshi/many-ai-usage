import * as v from 'valibot';
import { accountKeyHashPattern } from './account';

export const providerModes = ['auto', 'taught', 'embed'] as const;
export type ProviderMode = (typeof providerModes)[number];

export const runtimeStatuses = [
  'never_seen',
  'ok',
  'warning',
  'error',
  'stale',
  'needs_teaching',
  'needs_permission',
  'rate_limited',
] as const;
export type RuntimeStatus = (typeof runtimeStatuses)[number];

/**
 * Consecutive failed taught reads before a provider is downgraded from `warning` to
 * `needs_teaching`. One bad read is usually an SPA that unmounted the usage sheet, so the prompt
 * to re-teach only appears once the page has stayed unreadable.
 */
export const NEEDS_TEACHING_FAILURE_THRESHOLD = 3;

export const snapshotSources = ['dom', 'user_taught', 'page_only'] as const;
export type SnapshotSource = (typeof snapshotSources)[number];
export const snapshotStatuses = ['ok', 'warning', 'error', 'no_data'] as const;
export type SnapshotStatus = (typeof snapshotStatuses)[number];

export const metricKinds = ['percent', 'amount', 'count', 'status'] as const;
export type MetricKind = (typeof metricKinds)[number];
export const metricUnits = ['percent', 'requests', 'credits', 'tokens', 'dollars', 'sessions', 'custom'] as const;
export type MetricUnit = (typeof metricUnits)[number];

export interface AnchorFingerprint {
  selectors: string[];
  tagName?: string;
  role?: string;
  textFingerprint?: string;
  nearbyLabel?: string;
}

/**
 * Text-free locator used only for account identity elements.
 *
 * Metric anchors intentionally keep labels/fingerprints for resilient reads. Account anchors
 * must not: an aria-label, id, class, or nearby text can contain an email address. The selector
 * grammar below stores only a numeric DOM path rooted at the document element.
 */
export interface AccountAnchor {
  selector: string;
}

export const ACCOUNT_ANCHOR_SELECTOR_MAX_LENGTH = 768;
export const accountAnchorSelectorPattern = /^:root(?: > :nth-child\([1-9]\d{0,3}\)){1,32}$/;

export interface TaughtMetric {
  metricId: string;
  label: string;
  kind: MetricKind;
  unit: MetricUnit;
  windowLabel?: string;
  valueAnchor?: AnchorFingerprint;
  resetAnchor?: AnchorFingerprint;
  interpretation?: 'used_percent' | 'remaining_percent' | 'used_total' | 'remaining_total' | 'absolute_value' | 'reset_only' | 'unknown';
  enabled: boolean;
}

/** Max length of a browser-local custom icon data URL (resized PNG ~64×64 stays well under this). */
export const ICON_DATA_URL_MAX_LENGTH = 100_000;
/** Generous persistence/message bounds: large enough for real configs, finite for hostile input. */
export const PROVIDER_COLLECTION_MAX_LENGTH = 128;
export const PROVIDER_METRICS_MAX_LENGTH = 128;
export const SNAPSHOT_METRICS_MAX_LENGTH = 128;
export const PROVIDER_ID_MAX_LENGTH = 256;

export interface ProviderConfig {
  schema: 'many-ai-usage.provider.v1';
  id: string;
  displayName: string;
  url: string;
  urlMatch: string[];
  mode: ProviderMode;
  displayEnabled: boolean;
  refreshIntervalMinutes: number;
  metrics: TaughtMetric[];
  /** User-uploaded icon as a data URL. Never auto-fetched from the provider host (trademark / privacy). */
  iconDataUrl?: string;
  /**
   * Which account this entry stands for when several providers share one usage URL
   * (e.g. "personal" / "work"). Shown as the row label; the service name stays in displayName.
   */
  accountLabel?: string;
  /** Text-free structural path to the account identity (email / display name) on the page. */
  accountAnchor?: AccountAnchor;
  /** Salted hash of the account identity text. The raw text is never stored (see shared/account.ts). */
  accountKeyHash?: string;
  /** Firefox container (cookieStoreId) this account lives in. Never set on Chrome. */
  cookieStoreId?: string;
  createdAt: string;
  updatedAt: string;
  order: number;
}

export interface NormalizedMetric {
  id: string;
  label: string;
  kind: MetricKind;
  unit: MetricUnit;
  window: { id: string; label: string; durationMs?: number };
  used: number | null;
  remaining: number | null;
  total: number | null;
  resetAt: string | null;
  resetLabel: string | null;
  confidence: 'heuristic' | 'taught';
  evidence: {
    value: string;
    label: string | null;
    reset: string | null;
    semanticSignals: string[];
  };
}

export interface NormalizedSnapshot {
  providerId: string;
  displayName: string;
  capturedAt: string;
  source: SnapshotSource;
  status: SnapshotStatus;
  metrics: NormalizedMetric[];
  warningReason: string | null;
  lastFailureReason: string | null;
}

export interface ProviderRuntimeState {
  providerId: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  status: RuntimeStatus;
  stale: boolean;
  confidence: 'none' | 'heuristic' | 'taught';
  evidenceSummary: string[];
  retryAfter: string | null;
  pageBinding: 'unbound' | 'bound' | 'stale';
  errorLabel: string | null;
  consecutiveFailures?: number;
}

const anchorSchema = v.object({
  selectors: v.pipe(v.array(v.pipe(v.string(), v.maxLength(2_048))), v.maxLength(32)),
  tagName: v.optional(v.pipe(v.string(), v.maxLength(80))),
  role: v.optional(v.pipe(v.string(), v.maxLength(160))),
  textFingerprint: v.optional(v.pipe(v.string(), v.maxLength(512))),
  nearbyLabel: v.optional(v.pipe(v.string(), v.maxLength(512))),
});

const accountAnchorSchema = v.object({
  selector: v.pipe(
    v.string(),
    v.maxLength(ACCOUNT_ANCHOR_SELECTOR_MAX_LENGTH),
    v.regex(accountAnchorSelectorPattern),
  ),
});

const taughtMetricSchema = v.object({
  metricId: v.pipe(v.string(), v.maxLength(PROVIDER_ID_MAX_LENGTH)),
  label: v.pipe(v.string(), v.maxLength(200)),
  kind: v.picklist(metricKinds),
  unit: v.picklist(metricUnits),
  windowLabel: v.optional(v.pipe(v.string(), v.maxLength(200))),
  valueAnchor: v.optional(anchorSchema),
  resetAnchor: v.optional(anchorSchema),
  interpretation: v.optional(v.picklist(['used_percent', 'remaining_percent', 'used_total', 'remaining_total', 'absolute_value', 'reset_only', 'unknown'] as const)),
  enabled: v.boolean(),
});

export const providerConfigSchema = v.object({
  schema: v.literal('many-ai-usage.provider.v1'),
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(PROVIDER_ID_MAX_LENGTH)),
  displayName: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  url: v.pipe(v.string(), v.maxLength(4_096), v.url()),
  urlMatch: v.pipe(v.array(v.pipe(v.string(), v.maxLength(4_096))), v.maxLength(64)),
  mode: v.picklist(providerModes),
  displayEnabled: v.boolean(),
  refreshIntervalMinutes: v.pipe(v.number(), v.minValue(3), v.maxValue(240)),
  metrics: v.pipe(v.array(taughtMetricSchema), v.maxLength(PROVIDER_METRICS_MAX_LENGTH)),
  iconDataUrl: v.optional(v.pipe(
    v.string(),
    // svg+xml allowed for sample letter badges imported once from GitHub raw.
    v.regex(/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,/i),
    v.maxLength(ICON_DATA_URL_MAX_LENGTH),
  )),
  accountLabel: v.optional(v.pipe(v.string(), v.maxLength(80))),
  accountAnchor: v.optional(accountAnchorSchema),
  // Hash only — a provider carrying raw identity text must not validate.
  accountKeyHash: v.optional(v.pipe(v.string(), v.regex(accountKeyHashPattern))),
  cookieStoreId: v.optional(v.pipe(v.string(), v.maxLength(120))),
  createdAt: v.pipe(v.string(), v.isoTimestamp()),
  updatedAt: v.pipe(v.string(), v.isoTimestamp()),
  order: v.number(),
});

const providersRegistryItemSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  displayName: v.pipe(v.string(), v.minLength(1)),
  url: v.pipe(v.string(), v.url()),
  urlMatch: v.pipe(v.array(v.string()), v.minLength(1)),
  note: v.optional(v.string()),
});

const providersRegistrySchema = v.object({
  schema: v.literal('many-ai-usage.providers.v1'),
  updated: v.string(),
  providers: v.pipe(v.array(providersRegistryItemSchema), v.minLength(1)),
});

/** Max raw JSON body size for remote/paste starter packs (512 KiB). */
export const STARTER_PACK_MAX_BYTES = 512 * 1024;

const starterProviderSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  displayName: v.pipe(v.string(), v.minLength(1)),
  url: v.pipe(v.string(), v.url()),
  urlMatch: v.pipe(v.array(v.string()), v.minLength(1)),
  mode: v.optional(v.picklist(providerModes)),
  refreshIntervalMinutes: v.optional(v.pipe(v.number(), v.minValue(3), v.maxValue(240))),
  verifiedAt: v.optional(v.string()),
  note: v.optional(v.string()),
  /** Sample icon on GitHub raw (not base64). Fetched once on import into iconDataUrl. */
  iconUrl: v.optional(v.pipe(v.string(), v.url())),
  metrics: v.optional(v.array(taughtMetricSchema)),
});

const starterPackSchema = v.object({
  schema: v.literal('many-ai-usage.starter.v1'),
  updated: v.string(),
  note: v.optional(v.string()),
  source: v.optional(v.string()),
  providers: v.pipe(v.array(starterProviderSchema), v.minLength(1)),
});

export type StarterPack = v.InferOutput<typeof starterPackSchema>;

const REMOTE_URL_MAX_LENGTH = 2_048;
const REMOTE_PATTERN_LIMIT = 32;

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '127.0.0.1'
    || normalized === '[::1]';
}

function assertRemoteWebUrl(value: string): URL {
  if (value.length === 0 || value.length > REMOTE_URL_MAX_LENGTH) {
    throw new Error('Starter provider URL is too long');
  }
  const url = new URL(value);
  const allowed = url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHostname(url.hostname));
  if (!allowed || url.username || url.password) {
    throw new Error('Starter provider URL must use HTTPS (HTTP is limited to loopback hosts)');
  }
  return url;
}

function assertRemoteProviderNetworkPolicy(provider: { url: string; urlMatch: string[] }): void {
  const providerUrl = assertRemoteWebUrl(provider.url);
  if (provider.urlMatch.length === 0 || provider.urlMatch.length > REMOTE_PATTERN_LIMIT) {
    throw new Error('Starter provider URL patterns are outside the allowed bounds');
  }
  for (const pattern of provider.urlMatch) {
    if (pattern.length === 0 || pattern.length > REMOTE_URL_MAX_LENGTH) {
      throw new Error('Starter provider URL pattern is outside the allowed bounds');
    }
    const firstWildcard = pattern.indexOf('*');
    if (firstWildcard !== -1 && firstWildcard !== pattern.length - 1) {
      throw new Error('Starter provider URL pattern may only end with a wildcard');
    }
    const prefix = firstWildcard === -1 ? pattern : pattern.slice(0, -1);
    const patternUrl = assertRemoteWebUrl(prefix);
    if (patternUrl.origin !== providerUrl.origin) {
      throw new Error('Starter provider URL pattern must stay on the provider origin');
    }
    // `https://service.example*` compares equal by origin but is a host wildcard at match time.
    // Keep the validator and shared/url.ts on one rule: a wildcard only ever stands for a path.
    if (firstWildcard !== -1 && prefix.length <= patternUrl.origin.length) {
      throw new Error('Starter provider URL pattern wildcard must apply to the path');
    }
  }
}

const normalizedMetricSchema = v.object({
  id: v.pipe(v.string(), v.maxLength(PROVIDER_ID_MAX_LENGTH)),
  label: v.pipe(v.string(), v.maxLength(200)),
  kind: v.picklist(metricKinds),
  unit: v.picklist(metricUnits),
  window: v.object({
    id: v.pipe(v.string(), v.maxLength(PROVIDER_ID_MAX_LENGTH)),
    label: v.pipe(v.string(), v.maxLength(200)),
    durationMs: v.optional(v.number()),
  }),
  used: v.nullable(v.number()),
  remaining: v.nullable(v.number()),
  total: v.nullable(v.number()),
  resetAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  resetLabel: v.nullable(v.pipe(v.string(), v.maxLength(512))),
  confidence: v.picklist(['heuristic', 'taught'] as const),
  evidence: v.object({
    value: v.pipe(v.string(), v.maxLength(2_048)),
    label: v.nullable(v.pipe(v.string(), v.maxLength(512))),
    reset: v.nullable(v.pipe(v.string(), v.maxLength(512))),
    semanticSignals: v.pipe(v.array(v.pipe(v.string(), v.maxLength(128))), v.maxLength(32)),
  }),
});

export const normalizedSnapshotSchema = v.object({
  providerId: v.pipe(v.string(), v.minLength(1), v.maxLength(PROVIDER_ID_MAX_LENGTH)),
  displayName: v.pipe(v.string(), v.maxLength(200)),
  capturedAt: v.pipe(v.string(), v.isoTimestamp()),
  source: v.picklist(snapshotSources),
  status: v.picklist(snapshotStatuses),
  metrics: v.pipe(v.array(normalizedMetricSchema), v.maxLength(SNAPSHOT_METRICS_MAX_LENGTH)),
  warningReason: v.nullable(v.pipe(v.string(), v.maxLength(2_048))),
  lastFailureReason: v.nullable(v.pipe(v.string(), v.maxLength(2_048))),
});

export const runtimeStateSchema = v.object({
  providerId: v.string(),
  lastAttemptAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  lastSuccessAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  lastFailureAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  status: v.picklist(runtimeStatuses),
  stale: v.boolean(),
  confidence: v.picklist(['none', 'heuristic', 'taught'] as const),
  evidenceSummary: v.array(v.string()),
  retryAfter: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  pageBinding: v.picklist(['unbound', 'bound', 'stale'] as const),
  errorLabel: v.nullable(v.string()),
  consecutiveFailures: v.optional(v.number()),
});

export function safeParseProvider(value: unknown): ProviderConfig | null {
  const result = v.safeParse(providerConfigSchema, value);
  return result.success ? result.output : null;
}

/** Provider configs arriving from starter/import messages must retain the remote-origin policy. */
export function safeParseRemoteProvider(value: unknown): ProviderConfig | null {
  const provider = safeParseProvider(value);
  if (!provider) return null;
  try {
    assertRemoteProviderNetworkPolicy(provider);
    return provider;
  } catch {
    return null;
  }
}

/** Runtime messages are not trusted by TypeScript; rebuild account anchors from one field only. */
export function safeParseAccountAnchor(value: unknown): AccountAnchor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'selector') return null;
  const result = v.safeParse(accountAnchorSchema, value);
  return result.success ? result.output : null;
}

export function parseProvidersRegistryResponse(raw: unknown, now = new Date().toISOString()): ProviderConfig[] {
  const registry = v.parse(providersRegistrySchema, raw);
  return registry.providers.map((provider, order) => {
    assertRemoteProviderNetworkPolicy(provider);
    return {
      schema: 'many-ai-usage.provider.v1' as const,
      id: provider.id,
      displayName: provider.displayName,
      url: provider.url,
      urlMatch: provider.urlMatch,
      mode: 'auto' as const,
      displayEnabled: true,
      refreshIntervalMinutes: 15,
      metrics: [],
      createdAt: now,
      updatedAt: now,
      order,
    };
  });
}

export interface ParsedStarterPack {
  providers: ProviderConfig[];
  /** Sample icon URLs keyed by provider id (hydrate to iconDataUrl on import only). */
  sampleIconUrls: Record<string, string>;
}

/**
 * Parse a community starter pack (URL + optional taught metrics + sample iconUrl).
 * Does not execute JSON as code — data only. Maps into storage ProviderConfig shape.
 * iconUrl is returned separately; callers fetch once and set iconDataUrl.
 */
export function parseStarterPackResponse(raw: unknown, now = new Date().toISOString()): ParsedStarterPack {
  const pack = v.parse(starterPackSchema, raw);
  const sampleIconUrls: Record<string, string> = {};
  const providers = pack.providers.map((provider, order) => {
    assertRemoteProviderNetworkPolicy(provider);
    if (provider.iconUrl) {
      // Allowed-host check lives in samples/icon so schema stays free of network policy.
      sampleIconUrls[provider.id] = provider.iconUrl;
    }
    const metrics = provider.metrics ?? [];
    const mode = provider.mode ?? (metrics.length > 0 ? 'taught' : 'auto');
    return {
      schema: 'many-ai-usage.provider.v1' as const,
      id: provider.id,
      displayName: provider.displayName,
      url: provider.url,
      urlMatch: provider.urlMatch,
      mode,
      displayEnabled: true,
      refreshIntervalMinutes: provider.refreshIntervalMinutes ?? 15,
      metrics,
      createdAt: now,
      updatedAt: now,
      order,
    };
  });
  return { providers, sampleIconUrls };
}

/** Reject oversized raw bodies before JSON.parse of paste/fetch text. */
export function assertStarterPackByteSize(rawText: string, maxBytes = STARTER_PACK_MAX_BYTES): void {
  const bytes = new TextEncoder().encode(rawText).byteLength;
  if (bytes > maxBytes) {
    throw new Error(`Starter pack is too large (${bytes} bytes; max ${maxBytes})`);
  }
}

export function safeParseSnapshot(value: unknown): NormalizedSnapshot | null {
  const result = v.safeParse(normalizedSnapshotSchema, value);
  return result.success ? result.output : null;
}

export function safeParseRuntimeState(value: unknown): ProviderRuntimeState | null {
  const result = v.safeParse(runtimeStateSchema, value);
  return result.success ? result.output : null;
}

export function isStale(snapshot: NormalizedSnapshot | null, provider: ProviderConfig, now = Date.now()): boolean {
  if (!snapshot) return false;
  const capturedAt = Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(capturedAt)) return true;
  return now - capturedAt >= provider.refreshIntervalMinutes * 2 * 60_000;
}

export function makeRuntimeState(providerId: string, status: RuntimeStatus = 'never_seen'): ProviderRuntimeState {
  return {
    providerId,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    status,
    stale: false,
    confidence: 'none',
    evidenceSummary: [],
    retryAfter: null,
    pageBinding: 'unbound',
    errorLabel: null,
    consecutiveFailures: 0,
  };
}
