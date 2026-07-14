import type { MetricKind, MetricUnit, NormalizedMetric, NormalizedSnapshot } from '../../shared/schema';
import { toId } from './utils';
import type { DetectorCandidate } from './types';

function unitFor(candidate: DetectorCandidate): MetricUnit {
  if (candidate.kind === 'percent' || candidate.kind === 'progress') return 'percent';
  const signal = candidate.semanticSignals.find((item) => ['requests', 'credits', 'tokens'].includes(item));
  return (signal as MetricUnit | undefined) ?? 'custom';
}

function kindFor(unit: MetricUnit): MetricKind {
  return unit === 'percent' ? 'percent' : unit === 'custom' ? 'amount' : 'count';
}

function closestReset(candidate: DetectorCandidate, resets: DetectorCandidate[]): DetectorCandidate | null {
  return resets.find((reset) => reset.windowLabel === candidate.windowLabel) ?? resets[0] ?? null;
}

export function normalizeCandidates(
  providerId: string,
  displayName: string,
  candidates: DetectorCandidate[],
  capturedAt = new Date().toISOString(),
): NormalizedSnapshot {
  const metrics: NormalizedMetric[] = [];
  const resets = candidates.filter((candidate) => candidate.kind === 'reset');
  const accepted = candidates.filter((candidate) => candidate.kind !== 'reset');
  const seen = new Set<string>();
  for (const candidate of accepted) {
    const unit = unitFor(candidate);
    const kind = kindFor(unit);
    const reset = closestReset(candidate, resets);
    const label = candidate.label?.slice(0, 120) ?? `${candidate.windowLabel} quota`;
    const key = `${kind}:${candidate.windowLabel}:${candidate.value}:${candidate.total}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let used = candidate.used;
    let remaining = candidate.remaining;
    if (unit === 'percent' && candidate.value != null && used == null && remaining == null) remaining = candidate.value;
    metrics.push({
      id: `${toId(candidate.windowLabel)}-${toId(label).slice(0, 18)}`,
      label,
      kind,
      unit,
      window: { id: toId(candidate.windowLabel), label: candidate.windowLabel },
      used,
      remaining,
      total: candidate.total,
      resetAt: reset?.resetAt ?? candidate.resetAt,
      resetLabel: reset?.resetLabel ?? candidate.resetLabel,
      confidence: 'heuristic',
      evidence: {
        value: candidate.evidenceValue,
        label: candidate.label,
        reset: reset?.resetLabel ?? candidate.resetLabel,
        semanticSignals: candidate.semanticSignals,
      },
    });
  }
  return {
    providerId,
    displayName,
    capturedAt,
    source: metrics.length > 0 ? 'dom' : 'page_only',
    status: 'ok',
    metrics,
    warningReason: metrics.length > 0 ? null : 'No usage evidence was confidently detected on this page.',
    lastFailureReason: null,
  };
}
