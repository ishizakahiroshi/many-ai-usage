import type { MetricUnit } from '../../shared/schema';

export interface ExtractedValue {
  value: number | null;
  used: number | null;
  remaining: number | null;
  total: number | null;
  unit: MetricUnit;
  evidence: string;
  semanticSignals: string[];
}

const NUMBER = '-?\\d+(?:[,.]\\d+)?';

function numberValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(/,/g, '');
  const match = normalized.match(new RegExp(NUMBER));
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function unitFor(text: string): MetricUnit {
  if (/%/.test(text)) return 'percent';
  if (/\$|usd|dollar/i.test(text)) return 'dollars';
  if (/credit|クレジット/i.test(text)) return 'credits';
  if (/token|トークン/i.test(text)) return 'tokens';
  if (/request|リクエスト/i.test(text)) return 'requests';
  if (/session|セッション/i.test(text)) return 'sessions';
  return 'custom';
}

/** Extract one visible metric from a taught element. This function never performs I/O. */
export function extractValue(element: Element): ExtractedValue {
  const evidence = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const context = `${element.getAttribute('aria-label') ?? ''} ${evidence}`.trim();
  const unit = unitFor(context);
  const semanticSignals: string[] = [];
  if (/remaining|left|残り|剩余/i.test(context)) semanticSignals.push('remaining');
  if (/used|usage|使用|已用/i.test(context)) semanticSignals.push('used');

  const ariaValue = numberValue(element.getAttribute('aria-valuenow'));
  if (ariaValue != null) {
    const max = numberValue(element.getAttribute('aria-valuemax'));
    const value = max != null && max > 0 && unit !== 'percent' ? ariaValue : ariaValue;
    return { value, used: semanticSignals.includes('used') ? value : null, remaining: semanticSignals.includes('remaining') || unit === 'percent' ? value : null, total: max, unit: max != null && unit === 'custom' ? 'percent' : unit, evidence, semanticSignals: [...semanticSignals, 'aria-valuenow'] };
  }

  if (element instanceof HTMLElement && element.tagName.toLowerCase() === 'progress') {
    const value = numberValue(element.getAttribute('value'));
    const max = numberValue(element.getAttribute('max')) ?? 1;
    const percentage = value != null && max > 0 ? (value / max) * 100 : null;
    return { value: percentage, used: semanticSignals.includes('used') ? percentage : null, remaining: semanticSignals.includes('remaining') || !semanticSignals.includes('used') ? percentage : null, total: 100, unit: 'percent', evidence, semanticSignals: [...semanticSignals, 'progress'] };
  }

  const pair = context.match(new RegExp(`(${NUMBER})\\s*[/]\\s*(${NUMBER})`));
  const single = numberValue(context);
  const percent = context.match(new RegExp(`(${NUMBER})\\s*%`));
  const value = percent ? numberValue(percent[1]) : single;
  if (pair) {
    const first = numberValue(pair[1]);
    const total = numberValue(pair[2]);
    return { value: first, used: semanticSignals.includes('remaining') ? null : first, remaining: semanticSignals.includes('remaining') ? first : null, total, unit, evidence, semanticSignals: [...semanticSignals, 'used-total'] };
  }
  return { value, used: semanticSignals.includes('used') ? value : null, remaining: semanticSignals.includes('remaining') || unit === 'percent' ? value : null, total: unit === 'percent' ? 100 : null, unit, evidence, semanticSignals };
}

export const extractElementValue = extractValue;
export const extractMetricValue = extractValue;
