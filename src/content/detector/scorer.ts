import type { DetectorCandidate } from './types';

export function scoreCandidate(candidate: DetectorCandidate): number {
  return Math.max(0, Math.min(1, candidate.confidence));
}

export function acceptedCandidates(candidates: DetectorCandidate[], threshold = 0.6): DetectorCandidate[] {
  return candidates.filter((candidate) => scoreCandidate(candidate) >= threshold);
}
