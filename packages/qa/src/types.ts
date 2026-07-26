/**
 * QA Types — Shared types for visual QA infrastructure.
 */

export interface ViewportSize {
  width: number;
  height: number;
  label: string;
}

export const VIEWPORTS: ViewportSize[] = [
  { width: 1440, height: 900, label: 'desktop' },
  { width: 768, height: 1024, label: 'tablet' },
  { width: 390, height: 844, label: 'mobile' },
];

export interface DiffRegion {
  id: string;
  semanticRole: string;
  x: number;
  y: number;
  width: number;
  height: number;
  diffPixels: number;
  diffPercent: number;
  severity: 'critical' | 'warning' | 'info';
}

export interface VisualDiffResult {
  viewport: ViewportSize;
  totalPixels: number;
  diffPixels: number;
  diffPercent: number;
  score: number;
  regions: DiffRegion[];
  screenshotPath?: string;
  diffImagePath?: string;
}

export interface StructuralProbe {
  id: string;
  type: 'shared-id' | 'element-count' | 'nesting-depth' | 'widget-type';
  passed: boolean;
  expected?: unknown;
  actual?: unknown;
  message: string;
}

export interface QaReport {
  targetUrl: string;
  referenceUrl?: string;
  timestamp: string;
  viewports: VisualDiffResult[];
  structuralProbes: StructuralProbe[];
  overallScore: number;
  passed: boolean;
  fixes?: FixAction[];
}

export interface FixAction {
  id: string;
  regionId: string;
  type: FixType;
  priority: number;
  description: string;
  cssProperty?: string;
  oldValue?: string;
  newValue?: string;
  applied: boolean;
  verified: boolean;
}

export type FixType =
  | 'color-mismatch'
  | 'layout-shift'
  | 'size-mismatch'
  | 'spacing-mismatch'
  | 'font-mismatch'
  | 'missing-element';

export interface FixPriorityQueue {
  fixes: FixAction[];
  maxPerRound: number;
}
