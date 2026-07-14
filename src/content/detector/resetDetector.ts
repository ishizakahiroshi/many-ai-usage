import { resetWords } from './i18n/labels';
import type { DetectorCandidate } from './types';
import { allElements, contextMeta, nearbyContext } from './utils';

function parseRelativeReset(text: string, now = Date.now()): string | null {
  const inHours = text.match(/(?:in|within)\s+(\d+(?:\.\d+)?)\s*(h|hours?|時間)/i);
  if (inHours) return new Date(now + Number(inHours[1]) * 60 * 60_000).toISOString();
  const inMinutes = text.match(/(?:in|within)\s+(\d+)\s*(m|min|minutes?|分)/i);
  if (inMinutes) return new Date(now + Number(inMinutes[1]) * 60_000).toISOString();
  if (/tomorrow|明日|明天/i.test(text)) return new Date(now + 24 * 60 * 60_000).toISOString();
  return null;
}

export function detectReset(document: Document, now = Date.now()): DetectorCandidate[] {
  const candidates: DetectorCandidate[] = [];
  for (const element of allElements(document)) {
    const context = nearbyContext(element);
    if (!resetWords.test(context)) continue;
    const meta = contextMeta(context);
    candidates.push({
      kind: 'reset',
      value: null,
      used: null,
      remaining: null,
      total: null,
      label: meta.label,
      windowLabel: meta.windowLabel,
      resetAt: parseRelativeReset(context, now),
      resetLabel: context.slice(0, 180),
      evidenceValue: context.slice(0, 180),
      semanticSignals: meta.semanticSignals,
      confidence: Math.min(0.9, 0.58 + (meta.semanticSignals.includes('window') ? 0.14 : 0)),
    });
  }
  return candidates;
}
