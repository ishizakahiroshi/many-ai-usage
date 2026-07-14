import type { NormalizedSnapshot } from '../../shared/schema';
import { detectPercent } from './percentDetector';
import { detectProgressElements } from './progressElementDetector';
import { detectReset } from './resetDetector';
import { acceptedCandidates } from './scorer';
import { detectUsedTotal } from './usedTotalDetector';
import { normalizeCandidates } from './normalize';

export function detectUsage(document: Document, providerId: string, displayName: string, now = Date.now()): NormalizedSnapshot {
  const candidates = [
    ...detectPercent(document),
    ...detectProgressElements(document),
    ...detectUsedTotal(document),
    ...detectReset(document, now),
  ];
  return normalizeCandidates(providerId, displayName, acceptedCandidates(candidates), new Date(now).toISOString());
}
