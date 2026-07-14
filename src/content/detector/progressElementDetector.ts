import { remainingWords, usedWords } from './i18n/labels';
import type { DetectorCandidate } from './types';
import { allElements, contextMeta, nearbyContext, numberValue } from './utils';

export function detectProgressElements(document: Document): DetectorCandidate[] {
  const candidates: DetectorCandidate[] = [];
  for (const element of allElements(document)) {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role');
    if (tag !== 'progress' && role !== 'progressbar' && role !== 'meter') continue;
    const max = numberValue(element.getAttribute('aria-valuemax')) ?? numberValue(element.getAttribute('max')) ?? 100;
    const raw = numberValue(element.getAttribute('aria-valuenow')) ?? numberValue(element.getAttribute('value'));
    if (raw == null || max <= 0) continue;
    const context = nearbyContext(element);
    const meta = contextMeta(context);
    const percentage = Math.max(0, Math.min(100, (raw / max) * 100));
    const isRemaining = remainingWords.test(context) || /quota|limit/i.test(context);
    const isUsed = usedWords.test(context);
    candidates.push({
      kind: 'progress',
      value: percentage,
      used: isUsed ? percentage : null,
      remaining: isRemaining || !isUsed ? percentage : null,
      total: 100,
      label: element.getAttribute('aria-label') ?? meta.label,
      windowLabel: meta.windowLabel,
      resetAt: null,
      resetLabel: null,
      evidenceValue: `${raw}/${max}`,
      semanticSignals: [...meta.semanticSignals, tag === 'progress' ? 'progress' : 'aria-progress'],
      confidence: Math.min(0.95, 0.68 + (role || tag === 'progress' ? 0.12 : 0) + (meta.semanticSignals.includes('window') ? 0.08 : 0) + (isRemaining || isUsed ? 0.08 : 0)),
    });
  }
  return candidates;
}
