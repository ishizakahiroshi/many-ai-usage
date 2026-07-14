export type CandidateKind = 'percent' | 'progress' | 'used_total' | 'reset';

export interface DetectorCandidate {
  kind: CandidateKind;
  value: number | null;
  used: number | null;
  remaining: number | null;
  total: number | null;
  label: string | null;
  windowLabel: string;
  resetAt: string | null;
  resetLabel: string | null;
  evidenceValue: string;
  semanticSignals: string[];
  confidence: number;
}
