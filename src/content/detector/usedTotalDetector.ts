import { quotaWords, usedWords } from './i18n/labels';
import type { DetectorCandidate } from './types';
import { allElements, contextMeta, nearbyContext, numberValue } from './utils';

export function detectUsedTotal(document: Document): DetectorCandidate[] {
  const candidates: DetectorCandidate[] = [];
  const seen = new Set<string>();
  for (const element of allElements(document)) {
    const context = nearbyContext(element);
    const matches = context.matchAll(/(?<![\d.])(\d[\d,]*(?:\.\d+)?)\s*(?:\/|of|out\s+of)\s*(\d[\d,]*(?:\.\d+)?)/gi);
    for (const match of matches) {
      const used = numberValue(match[1]);
      const total = numberValue(match[2]);
      if (used == null || total == null || total <= 0 || used > total) continue;
      const key = `${used}/${total}:${context}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const meta = contextMeta(context);
      const unit = /credit/i.test(context) ? 'credits' : /token/i.test(context) ? 'tokens' : /request/i.test(context) ? 'requests' : 'custom';
      candidates.push({
        kind: 'used_total',
        value: used,
        used,
        remaining: total - used,
        total,
        label: meta.label,
        windowLabel: meta.windowLabel,
        resetAt: null,
        resetLabel: null,
        evidenceValue: match[0],
        semanticSignals: [...meta.semanticSignals, unit],
        confidence: Math.min(0.92, 0.58 + (usedWords.test(context) ? 0.12 : 0) + (quotaWords.test(context) ? 0.12 : 0) + (meta.semanticSignals.includes('window') ? 0.08 : 0)),
      });
    }
  }
  return candidates;
}
