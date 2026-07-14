import * as v from 'valibot';

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
  selectors: v.array(v.string()),
  tagName: v.optional(v.string()),
  role: v.optional(v.string()),
  textFingerprint: v.optional(v.string()),
  nearbyLabel: v.optional(v.string()),
});

const taughtMetricSchema = v.object({
  metricId: v.string(),
  label: v.string(),
  kind: v.picklist(metricKinds),
  unit: v.picklist(metricUnits),
  windowLabel: v.optional(v.string()),
  valueAnchor: v.optional(anchorSchema),
  resetAnchor: v.optional(anchorSchema),
  interpretation: v.optional(v.picklist(['used_percent', 'remaining_percent', 'used_total', 'remaining_total', 'absolute_value', 'reset_only', 'unknown'] as const)),
  enabled: v.boolean(),
});

export const providerConfigSchema = v.object({
  schema: v.literal('many-ai-usage.provider.v1'),
  id: v.string(),
  displayName: v.string(),
  url: v.pipe(v.string(), v.url()),
  urlMatch: v.array(v.string()),
  mode: v.picklist(providerModes),
  displayEnabled: v.boolean(),
  refreshIntervalMinutes: v.pipe(v.number(), v.minValue(3), v.maxValue(240)),
  metrics: v.array(taughtMetricSchema),
  createdAt: v.pipe(v.string(), v.isoTimestamp()),
  updatedAt: v.pipe(v.string(), v.isoTimestamp()),
  order: v.number(),
});

const normalizedMetricSchema = v.object({
  id: v.string(),
  label: v.string(),
  kind: v.picklist(metricKinds),
  unit: v.picklist(metricUnits),
  window: v.object({ id: v.string(), label: v.string(), durationMs: v.optional(v.number()) }),
  used: v.nullable(v.number()),
  remaining: v.nullable(v.number()),
  total: v.nullable(v.number()),
  resetAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  resetLabel: v.nullable(v.string()),
  confidence: v.picklist(['heuristic', 'taught'] as const),
  evidence: v.object({
    value: v.string(),
    label: v.nullable(v.string()),
    reset: v.nullable(v.string()),
    semanticSignals: v.array(v.string()),
  }),
});

export const normalizedSnapshotSchema = v.object({
  providerId: v.string(),
  displayName: v.string(),
  capturedAt: v.pipe(v.string(), v.isoTimestamp()),
  source: v.picklist(snapshotSources),
  status: v.picklist(snapshotStatuses),
  metrics: v.array(normalizedMetricSchema),
  warningReason: v.nullable(v.string()),
  lastFailureReason: v.nullable(v.string()),
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

export function makeSampleProviders(now = new Date().toISOString()): ProviderConfig[] {
  return [
    {
      schema: 'many-ai-usage.provider.v1',
      id: 'sample:claude',
      displayName: 'Claude',
      url: 'https://claude.ai/new#settings/usage',
      urlMatch: ['https://claude.ai/new*'],
      mode: 'auto',
      displayEnabled: true,
      refreshIntervalMinutes: 15,
      metrics: [],
      createdAt: now,
      updatedAt: now,
      order: 0,
    },
    {
      schema: 'many-ai-usage.provider.v1',
      id: 'sample:codex',
      displayName: 'Codex',
      url: 'https://chatgpt.com/codex/cloud/settings/analytics#usage',
      urlMatch: ['https://chatgpt.com/codex/cloud/settings/analytics*'],
      mode: 'auto',
      displayEnabled: true,
      refreshIntervalMinutes: 15,
      metrics: [],
      createdAt: now,
      updatedAt: now,
      order: 1,
    },
  ];
}
