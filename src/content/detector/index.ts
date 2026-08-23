/**
 * Heuristic page analysis. NOT wired into the runtime as of v0.1: teach-mode replaced it, and
 * Auto mode now shows a page tile instead of guessing. The only importer is tests/detector.test.ts,
 * which keeps this as a regression reference for the synthetic fixtures. Do not assume a change
 * here affects what the extension reads — it does not until this module is re-connected.
 */
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
