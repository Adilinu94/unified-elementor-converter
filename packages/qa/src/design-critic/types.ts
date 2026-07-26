/**
 * Design Critic Types (Phase 67).
 *
 * Finding schema and report types for the 3-layer Design Critic QA system.
 *
 * @module qa/design-critic/types
 */

export type CriticLayer = 'L1-rules' | 'L2-diff' | 'L3-vision';
export type FindingSeverity = 'critical' | 'major' | 'minor' | 'info';
export type DesignPrinciple =
  | 'spacing'
  | 'typography'
  | 'color'
  | 'components'
  | 'hierarchy'
  | 'overflow'
  | 'contrast'
  | 'alignment';

export interface DesignFinding {
  id: string;
  layer: CriticLayer;
  severity: FindingSeverity;
  principle: DesignPrinciple;
  section: string;
  selector: string;
  expected: string;
  actual: string;
  fixHint: string;
  /** Confidence 0-1 (L3 vision findings may have lower confidence). */
  confidence: number;
}

export interface DesignCritiqueReport {
  url: string;
  referenceUrl?: string;
  timestamp: string;
  layers: CriticLayer[];
  totalFindings: number;
  criticalCount: number;
  majorCount: number;
  minorCount: number;
  score: number; // 0-100, ≥85 = design OK
  passed: boolean;
  findings: DesignFinding[];
  layerScores: Record<CriticLayer, number>;
}

export interface CriticThresholds {
  bodyMinFontPx: number;
  buttonMinHeightPx: number;
  buttonMaxHeightPx: number;
  contrastAA: number;
  contrastAALarge: number;
  sectionMinPaddingPx: number;
  maxHorizontalOverflow: number;
  touchTargetMinPx: number;
}

export const DEFAULT_THRESHOLDS: CriticThresholds = {
  bodyMinFontPx: 16,
  buttonMinHeightPx: 40,
  buttonMaxHeightPx: 56,
  contrastAA: 4.5,
  contrastAALarge: 3,
  sectionMinPaddingPx: 40,
  maxHorizontalOverflow: 0,
  touchTargetMinPx: 44,
};

export interface ComputedStyleEntry {
  selector: string;
  styles: Record<string, string>;
  boundingBox: { x: number; y: number; width: number; height: number };
  textContent?: string;
}
