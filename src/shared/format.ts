import type { TranslateFn } from './i18n';
import type { NormalizedMetric, ProviderRuntimeState, RuntimeStatus } from './schema';

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

export function statusLabel(state: ProviderRuntimeState, t?: TranslateFn): string {
  return runtimeStatusLabel(state.status, t);
}

export function runtimeStatusLabel(status: RuntimeStatus | string, t?: TranslateFn): string {
  if (t) {
    const key = `status.${status}`;
    const translated = t(key);
    if (translated !== key) return translated;
  }
  return String(status).replaceAll('_', ' ');
}

export function ageLabel(value: string | null, t?: TranslateFn): string {
  if (!value) return t ? t('format.notCapturedYet') : 'not captured yet';
  const ageMs = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return t ? t('format.justNow') : 'just now';
  if (minutes < 60) return t ? t('format.minutesAgo', { n: minutes }) : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t ? t('format.hoursAgo', { n: hours }) : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return t ? t('format.daysAgo', { n: days }) : `${days}d ago`;
}

export function resetLabel(metric: NormalizedMetric, t?: TranslateFn): string {
  if (metric.resetAt) {
    const when = new Date(metric.resetAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return t ? t('format.resetAt', { when }) : `reset ${when}`;
  }
  if (metric.resetLabel) return metric.resetLabel.replace(/\s+/g, ' ').slice(0, 24);
  return t ? t('format.resetUnknown') : 'reset unknown';
}
