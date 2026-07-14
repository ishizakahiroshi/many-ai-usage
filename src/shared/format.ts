import type { NormalizedMetric, ProviderRuntimeState } from './schema';

export function remainingPercent(metric: NormalizedMetric): number | null {
  if (metric.unit === 'percent') {
    if (metric.remaining != null) return metric.remaining;
    if (metric.used != null && metric.total != null) return metric.total - metric.used;
  }
  if (metric.remaining != null && metric.total != null && metric.total > 0) return (metric.remaining / metric.total) * 100;
  return null;
}

export function formatMetric(metric: NormalizedMetric): string {
  if (metric.unit === 'percent') {
    const value = remainingPercent(metric);
    return value == null ? '—' : `${Math.round(value)}%`;
  }
  if (metric.remaining != null) return `${metric.remaining.toLocaleString()} ${metric.unit}`;
  if (metric.used != null && metric.total != null) return `${metric.used.toLocaleString()} / ${metric.total.toLocaleString()} ${metric.unit}`;
  return '—';
}

export function statusLabel(state: ProviderRuntimeState): string {
  return state.status.replaceAll('_', ' ');
}

export function ageLabel(value: string | null): string {
  if (!value) return 'not captured yet';
  const ageMs = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function resetLabel(metric: NormalizedMetric): string {
  if (metric.resetAt) return `reset ${new Date(metric.resetAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
  if (metric.resetLabel) return metric.resetLabel.replace(/\s+/g, ' ').slice(0, 24);
  return 'reset unknown';
}
