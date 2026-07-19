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

function isYear(value: number, raw: string): boolean {
  return /^\d{4}$/.test(raw.replace(/,/g, '')) && value >= 1900 && value <= 2100;
}

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

function preferredNumber(context: string): { value: number | null; unit: MetricUnit; pair?: [number, number] } {
  const percentMatches = Array.from(context.matchAll(new RegExp(`(${NUMBER})\\s*%`, 'g')));
  for (const match of percentMatches) {
    const value = numberValue(match[1]);
    if (value != null && value >= 0 && value <= 100 && !isYear(value, match[1])) return { value, unit: 'percent' };
  }
  const pair = context.match(new RegExp(`(?:\\$\\s*)?(${NUMBER})\\s*(?:/|of|out\\s+of)\\s*(?:\\$\\s*)?(${NUMBER})(?:\\s*(requests?|credits?|tokens?|sessions?|リクエスト|クレジット|トークン|セッション))?`, 'i'));
  if (pair) {
    const first = numberValue(pair[1]);
    const total = numberValue(pair[2]);
    if (first != null && total != null && !isYear(first, pair[1]) && !isYear(total, pair[2])) {
      return { value: first, unit: unitFor(context), pair: [first, total] };
    }
  }
  const unitMatch = context.match(new RegExp(`(?:\\$\\s*)?(${NUMBER})\\s*(requests?|credits?|tokens?|sessions?|usd|dollars?|リクエスト|クレジット|トークン|セッション)`, 'i'));
  if (unitMatch) {
    const value = numberValue(unitMatch[1]);
    if (value != null && !isYear(value, unitMatch[1])) return { value, unit: unitFor(unitMatch[0]) };
  }
  if (/(?:\b(?:reset|resets|renew|renews)\b|リセット|更新|下次)/i.test(context) && /\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}/.test(context)) {
    return { value: null, unit: unitFor(context) };
  }
  for (const match of context.matchAll(new RegExp(NUMBER, 'g'))) {
    const value = numberValue(match[0]);
    if (value != null && !isYear(value, match[0])) return { value, unit: unitFor(context) };
  }
  return { value: null, unit: unitFor(context) };
}

/** Extract one visible metric from a taught element. This function never performs I/O. */
export function extractValue(element: Element): ExtractedValue {
  const evidence = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const parent = element.parentElement;
  const parentEvidence = (parent?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const needsNearbyUnit = !/%|\$|\/|\b(?:requests?|credits?|tokens?|sessions?|usd|dollars?)\b|リクエスト|クレジット|トークン|セッション/i.test(evidence);
  const localParent = parent && !['body', 'html'].includes(parent.tagName.toLowerCase()) && parent.childElementCount <= 2;
  const nearby = needsNearbyUnit && localParent && parentEvidence !== evidence && parentEvidence.length <= 240 ? parentEvidence : '';
  const context = `${element.getAttribute('aria-label') ?? ''} ${evidence} ${nearby}`.trim();
  const preferred = preferredNumber(context);
  const unit = preferred.unit;
  const semanticSignals: string[] = [];
  if (/remaining|left|残り|剩余/i.test(context)) semanticSignals.push('remaining');
  if (/used|usage|使用|已用/i.test(context)) semanticSignals.push('used');

  const ariaValue = numberValue(element.getAttribute('aria-valuenow'));
  if (ariaValue != null) {
    // Chart shells often expose aria-valuenow="0" while the visible label says "62% 使用済".
    // Prefer the explicit percent text in that case; keep real aria values (e.g. 37) otherwise.
    const textHasBetterPercent = ariaValue === 0
      && preferred.value != null
      && preferred.value > 0
      && preferred.unit === 'percent';
    if (!textHasBetterPercent) {
      const max = numberValue(element.getAttribute('aria-valuemax'));
      const value = max != null && max > 0 && unit !== 'percent' ? ariaValue : ariaValue;
      return { value, used: semanticSignals.includes('used') ? value : null, remaining: semanticSignals.includes('remaining') || unit === 'percent' ? value : null, total: max, unit: max != null && unit === 'custom' ? 'percent' : unit, evidence, semanticSignals: [...semanticSignals, 'aria-valuenow'] };
    }
  }

  if (element instanceof HTMLElement && element.tagName.toLowerCase() === 'progress') {
    const value = numberValue(element.getAttribute('value'));
    const max = numberValue(element.getAttribute('max')) ?? 1;
    const percentage = value != null && max > 0 ? (value / max) * 100 : null;
    return { value: percentage, used: semanticSignals.includes('used') ? percentage : null, remaining: semanticSignals.includes('remaining') || !semanticSignals.includes('used') ? percentage : null, total: 100, unit: 'percent', evidence, semanticSignals: [...semanticSignals, 'progress'] };
  }

  const value = preferred.value;
  if (preferred.pair) {
    const [first, total] = preferred.pair;
    return { value: first, used: semanticSignals.includes('remaining') ? null : first, remaining: semanticSignals.includes('remaining') ? first : null, total, unit, evidence, semanticSignals: [...semanticSignals, 'used-total'] };
  }
  return { value, used: semanticSignals.includes('used') ? value : null, remaining: semanticSignals.includes('remaining') || unit === 'percent' ? value : null, total: unit === 'percent' ? 100 : null, unit, evidence, semanticSignals };
}

export const extractElementValue = extractValue;
export const extractMetricValue = extractValue;
