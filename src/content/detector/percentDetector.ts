import { remainingWords, usedWords } from './i18n/labels';
import type { DetectorCandidate } from './types';
import { allElements, contextMeta, isLikelyYear, isResetDateMatch, nearbyContext, numberValue } from './utils';

export function detectPercent(document: Document): DetectorCandidate[] {
  const candidates: DetectorCandidate[] = [];
  const seen = new Set<string>();
  for (const element of allElements(document)) {
    const context = nearbyContext(element);
    const regex = /(?<![\d.])(\d{1,3}(?:\.\d+)?)\s*%/g;
    for (const match of context.matchAll(regex)) {
      const value = numberValue(match[1]);
      if (value == null || value < 0 || value > 100 || isLikelyYear(value, match[1]) || isResetDateMatch(context, match.index ?? 0, match[0])) continue;
      const key = `${value}:${context}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const meta = contextMeta(context);
      const isRemaining = remainingWords.test(context);
      const isUsed = usedWords.test(context);
      const confidence = Math.min(0.95,
        0.35 + (isRemaining || isUsed ? 0.22 : 0) + (meta.semanticSignals.includes('quota') ? 0.12 : 0) +
        (meta.semanticSignals.includes('window') ? 0.1 : 0) + (meta.semanticSignals.includes('reset') ? 0.07 : 0));
      candidates.push({
        kind: 'percent',
        value,
        used: isUsed ? value : null,
        remaining: isRemaining ? value : null,
        total: 100,
        label: meta.label,
        windowLabel: meta.windowLabel,
        resetAt: null,
        resetLabel: null,
        evidenceValue: match[0],
        semanticSignals: meta.semanticSignals,
        confidence,
      });
    }
  }
  return candidates;
}
