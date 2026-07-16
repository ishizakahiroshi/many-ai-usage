import type { NormalizedMetric, NormalizedSnapshot, ProviderConfig, TaughtMetric } from '../../shared/schema';
import { extractValue, type ExtractedValue } from './extract';
import { findByFingerprint } from './selector';
import { parseResetText } from './reset';

export function resolveTaughtElement(document: Document, metric: TaughtMetric): Element | null {
  const anchor = metric.valueAnchor;
  if (!anchor) return null;
  for (const selector of anchor.selectors) {
    try {
      const element = document.querySelector(selector);
      if (element) return element;
    } catch {
      // A stale selector is expected after a page redesign; try the fingerprint below.
    }
  }
  return findByFingerprint(document, anchor);
}

function resolveAnchor(document: Document, anchor: NonNullable<TaughtMetric['resetAnchor']>): Element | null {
  for (const selector of anchor.selectors) {
    try {
      const element = document.querySelector(selector);
      if (element) return element;
    } catch {
      // Fall back to the fingerprint when a selector no longer parses or matches.
    }
  }
  return findByFingerprint(document, anchor);
}

function normalizedValues(metric: TaughtMetric, extracted: ExtractedValue): Pick<NormalizedMetric, 'used' | 'remaining' | 'total'> {
  const value = extracted.value;
  const interpretation = metric.interpretation ?? 'unknown';
  if (interpretation === 'used_percent' || interpretation === 'used_total') return { used: extracted.used ?? value, remaining: null, total: extracted.total };
  if (interpretation === 'remaining_percent' || interpretation === 'remaining_total') return { used: null, remaining: extracted.remaining ?? value, total: extracted.total };
  if (interpretation === 'absolute_value') return { used: null, remaining: value, total: extracted.total };
  return { used: extracted.used, remaining: extracted.remaining ?? (metric.unit === 'percent' ? value : null), total: extracted.total };
}

export function readTaught(document: Document, provider: ProviderConfig, now = Date.now()): NormalizedSnapshot {
  const metrics: NormalizedMetric[] = [];
  const missing: string[] = [];
  for (const taught of provider.metrics.filter((metric) => metric.enabled && metric.valueAnchor)) {
    const element = resolveTaughtElement(document, taught);
    if (!element) {
      missing.push(taught.label);
      continue;
    }
    const extracted = extractValue(element);
    if (extracted.value == null) {
      missing.push(taught.label);
      continue;
    }
    const values = normalizedValues(taught, extracted);
    const unit = taught.unit === 'custom' ? extracted.unit : taught.unit;
    const resetElement = taught.resetAnchor ? resolveAnchor(document, taught.resetAnchor) : null;
    const resetLabel = resetElement?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 180) ?? null;
    metrics.push({
      id: taught.metricId,
      label: taught.label,
      kind: taught.kind,
      unit,
      window: { id: taught.metricId, label: taught.windowLabel ?? taught.label },
      ...values,
      resetAt: resetLabel ? parseResetText(resetLabel, now) : null,
      resetLabel,
      confidence: 'taught',
      evidence: { value: extracted.evidence, label: taught.label, reset: resetLabel, semanticSignals: extracted.semanticSignals },
    });
  }
  const capturedAt = new Date(now).toISOString();
  const hasConfiguredMetrics = provider.metrics.some((metric) => metric.enabled && metric.valueAnchor);
  return {
    providerId: provider.id,
    displayName: provider.displayName,
    capturedAt,
    source: 'user_taught',
    status: metrics.length > 0 ? 'ok' : 'no_data',
    metrics,
    warningReason: metrics.length > 0 ? (missing.length ? `Re-teach needed for: ${missing.join(', ')}` : null) : hasConfiguredMetrics ? `Re-teach needed for: ${missing.join(', ')}` : 'No taught metrics have been configured.',
    lastFailureReason: metrics.length > 0 && missing.length ? `Unable to read: ${missing.join(', ')}` : null,
  };
}

export const detectTaughtUsage = readTaught;
export const readTaughtMetrics = readTaught;
