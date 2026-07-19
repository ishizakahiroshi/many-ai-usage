import type { NormalizedMetric, NormalizedSnapshot, ProviderConfig, TaughtMetric } from '../../shared/schema';
import { diagLog } from '../../shared/perf';
import { extractValue, type ExtractedValue } from './extract';
import { findByFingerprint, findByLabelHint, findUsageHeadline } from './selector';
import { parseResetText } from './reset';

export function resolveTaughtElement(document: Document, metric: TaughtMetric): Element | null {
  const anchor = metric.valueAnchor;
  if (!anchor) return null;
  for (const selector of anchor.selectors) {
    try {
      const element = document.querySelector(selector);
      if (element && extractValue(element).value != null) return element;
    } catch {
      // A stale selector is expected after a page redesign; try the fingerprint below.
    }
  }
  const byFingerprint = findByFingerprint(document, anchor);
  if (byFingerprint && extractValue(byFingerprint).value != null) return byFingerprint;
  // Soft recovery: SPA class churn (Grok Tailwind) often breaks selectors; label text is stabler.
  const byLabel = findByLabelHint(document, [metric.label, anchor.nearbyLabel, metric.windowLabel], anchor.tagName)
    ?? findByLabelHint(document, [metric.label, anchor.nearbyLabel, metric.windowLabel]);
  if (byLabel && extractValue(byLabel).value != null) return byLabel;
  return byFingerprint ?? byLabel;
}

function resolvePath(document: Document, metric: TaughtMetric): {
  element: Element | null;
  path: 'selector' | 'fingerprint' | 'label' | 'none';
} {
  const anchor = metric.valueAnchor;
  if (!anchor) return { element: null, path: 'none' };
  for (const selector of anchor.selectors) {
    try {
      const element = document.querySelector(selector);
      if (element && extractValue(element).value != null) return { element, path: 'selector' };
    } catch {
      /* stale */
    }
  }
  const byFingerprint = findByFingerprint(document, anchor);
  if (byFingerprint && extractValue(byFingerprint).value != null) {
    return { element: byFingerprint, path: 'fingerprint' };
  }
  const byLabel = findByLabelHint(document, [metric.label, anchor.nearbyLabel, metric.windowLabel], anchor.tagName)
    ?? findByLabelHint(document, [metric.label, anchor.nearbyLabel, metric.windowLabel]);
  if (byLabel && extractValue(byLabel).value != null) return { element: byLabel, path: 'label' };
  return { element: byFingerprint ?? byLabel, path: byFingerprint || byLabel ? 'fingerprint' : 'none' };
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

function looksLikeBreakdownChip(text: string): boolean {
  const compact = text.replace(/\s+/g, ' ').trim();
  return /\d+(?:[.,]\d+)?\s*%/.test(compact)
    && /(?:Grok\s*Build|チャット|Chat\b|API\b|Code\s*Review|コードレビュー)/i.test(compact);
}

function labelLooksLikeBreakdown(label: string): boolean {
  return /(?:Grok\s*Build|チャット|Chat\b|API\b|Code\s*Review|コードレビュー)/i.test(label);
}

function normalizedValues(metric: TaughtMetric, extracted: ExtractedValue, headlineFallback: boolean): Pick<NormalizedMetric, 'used' | 'remaining' | 'total'> {
  const value = extracted.value;
  if (headlineFallback) {
    // Page totals like「52% 使用済」should surface as used%, not the old broken legend label semantics.
    if (extracted.semanticSignals.includes('used') || /使用済|使用済み|used/i.test(extracted.evidence)) {
      return { used: extracted.used ?? value, remaining: null, total: extracted.total ?? 100 };
    }
    if (extracted.semanticSignals.includes('remaining') || /残り|remaining/i.test(extracted.evidence)) {
      return { used: null, remaining: extracted.remaining ?? value, total: extracted.total ?? 100 };
    }
  }
  const interpretation = metric.interpretation ?? 'unknown';
  if (interpretation === 'used_percent' || interpretation === 'used_total') return { used: extracted.used ?? value, remaining: null, total: extracted.total };
  if (interpretation === 'remaining_percent' || interpretation === 'remaining_total') return { used: null, remaining: extracted.remaining ?? value, total: extracted.total };
  if (interpretation === 'absolute_value') return { used: null, remaining: value, total: extracted.total };
  return { used: extracted.used, remaining: extracted.remaining ?? (metric.unit === 'percent' ? value : null), total: extracted.total };
}

export function readTaught(document: Document, provider: ProviderConfig, now = Date.now()): NormalizedSnapshot {
  const metrics: NormalizedMetric[] = [];
  const missing: string[] = [];
  let usedHeadlineFallback = false;
  const taughtList = provider.metrics.filter((metric) => metric.enabled && metric.valueAnchor);
  diagLog('read.start', {
    providerId: provider.id,
    taughtCount: taughtList.length,
    href: typeof location !== 'undefined' ? `${location.pathname}${location.search}` : '',
    bodyChildren: document.body?.childElementCount ?? 0,
  });
  for (const taught of taughtList) {
    const resolved = resolvePath(document, taught);
    let element = resolved.element;
    let resolveVia: 'selector' | 'fingerprint' | 'label' | 'headline' | 'none' = resolved.path;
    let headlineFallback = false;
    let extracted = element ? extractValue(element) : null;
    const preferHeadline = !element
      || extracted?.value == null
      || labelLooksLikeBreakdown(taught.label)
      || (extracted ? looksLikeBreakdownChip(extracted.evidence) : false);
    if (preferHeadline) {
      // Legend chips (Grok Build / チャット / API) are not the SuperGrok total the user wants.
      const headline = findUsageHeadline(document);
      if (headline) {
        const headlineExtracted = extractValue(headline);
        if (headlineExtracted.value != null) {
          element = headline;
          extracted = headlineExtracted;
          headlineFallback = true;
          usedHeadlineFallback = true;
          resolveVia = 'headline';
        }
      }
    }
    diagLog('read.metric', {
      labelLen: taught.label.length,
      labelIsBreakdown: labelLooksLikeBreakdown(taught.label),
      resolveVia,
      preferHeadline,
      valuePresent: extracted?.value != null,
      unit: extracted?.unit ?? null,
      hasPercent: extracted ? /%/.test(extracted.evidence) : false,
      hasUsedWord: extracted ? /使用済|使用済み|used/i.test(extracted.evidence) : false,
      evidenceLen: extracted?.evidence.length ?? 0,
      selectorCount: taught.valueAnchor?.selectors.length ?? 0,
    });
    if (!element || !extracted || extracted.value == null) {
      missing.push(taught.label);
      continue;
    }
    const values = normalizedValues(taught, extracted, headlineFallback);
    const unit = taught.unit === 'custom' ? extracted.unit : taught.unit;
    const resetElement = taught.resetAnchor ? resolveAnchor(document, taught.resetAnchor) : null;
    const resetLabel = resetElement?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 180) ?? null;
    const displayLabel = headlineFallback
      ? (extracted.evidence.replace(/\s+/g, ' ').trim().slice(0, 40) || taught.label)
      : taught.label;
    metrics.push({
      id: taught.metricId,
      label: displayLabel,
      kind: taught.kind,
      unit,
      window: { id: taught.metricId, label: taught.windowLabel ?? displayLabel },
      ...values,
      resetAt: resetLabel ? parseResetText(resetLabel, now) : null,
      resetLabel,
      confidence: headlineFallback ? 'heuristic' : 'taught',
      evidence: {
        value: extracted.evidence,
        label: displayLabel,
        reset: resetLabel,
        semanticSignals: headlineFallback
          ? [...extracted.semanticSignals, 'headline-fallback']
          : extracted.semanticSignals,
      },
    });
  }
  const capturedAt = new Date(now).toISOString();
  const warningParts: string[] = [];
  if (missing.length) {
    warningParts.push(`Re-teach needed for: ${missing.join(', ')}. Open the registered usage URL so the values are visible on the page.`);
  }
  if (usedHeadlineFallback) {
    warningParts.push('Used page total as a temporary fallback. Delete broken tracks and teach the big total for a clean setup.');
  }
  const status = metrics.length > 0 ? (missing.length || usedHeadlineFallback ? 'warning' : 'ok') : 'no_data';
  diagLog('read.done', {
    providerId: provider.id,
    status,
    metricCount: metrics.length,
    missingCount: missing.length,
    usedHeadlineFallback,
  });
  return {
    providerId: provider.id,
    displayName: provider.displayName,
    capturedAt,
    source: 'user_taught',
    status,
    metrics,
    warningReason: warningParts.length ? warningParts.join(' ') : null,
    lastFailureReason: metrics.length > 0 && missing.length
      ? `Unable to read: ${missing.join(', ')}. Open the usage sheet first (registered URL), then Refresh.`
      : null,
  };
}

export const detectTaughtUsage = readTaught;
export const readTaughtMetrics = readTaught;
