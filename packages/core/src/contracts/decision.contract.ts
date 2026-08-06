import type { ConfidentResult } from './shared.contract.js';

export type DecisionSource = 'dom' | 'css' | 'xml' | 'geometry' | 'heuristic' | 'vision' | 'ai';

export type DecisionStatus = 'ok' | 'uncertain' | 'unknown' | 'conflict' | 'unavailable' | 'failed';

export interface DecisionResult<T> extends ConfidentResult<T> {
  status: DecisionStatus;
  source: DecisionSource;
  reasons: string[];
  evidenceIds: string[];
  candidates?: Array<{ value: T; score: number; reasons: string[] }>;
  fallback?: {
    attempted: boolean;
    used: boolean;
    task?: string;
    provider?: string;
    promptVersion?: string;
    failureReason?: string;
  };
  warnings: string[];
}

export const LAYER_TO_SOURCE: Record<string, DecisionSource> = {
  structure: 'dom',
  vision: 'vision',
  keyword: 'heuristic',
  unknown: 'heuristic',
};

export function isConflict<T>(deterministicValue: T, aiValue: T, scoreDelta: number, threshold = 0.25): boolean {
  if (deterministicValue === aiValue) return false;
  return scoreDelta >= threshold;
}
