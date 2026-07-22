/**
 * Viewport Matrix — Multi-Viewport Diff (#4).
 * Runs visual diff at 1440/768/390px and aggregates results.
 */

import type { ViewportSize, VisualDiffResult, DiffRegion } from './types.ts';
import { VIEWPORTS } from './types.ts';
import { calculateDiffScore, classifySeverity } from './visual-diff.ts';

export interface ViewportMatrixResult {
  viewports: VisualDiffResult[];
  overallScore: number;
  worstViewport: string;
  responsiveIssues: ResponsiveIssue[];
  passed: boolean;
}

export interface ResponsiveIssue {
  viewport: string;
  region: string;
  issue: string;
  severity: 'critical' | 'warning' | 'info';
}

/**
 * Responsive breakpoints for layout shift detection.
 */
export const RESPONSIVE_THRESHOLDS = {
  /** Max acceptable diff percent per viewport */
  maxDiffPercent: { desktop: 5, tablet: 8, mobile: 12 },
  /** Min score per viewport */
  minScore: { desktop: 90, tablet: 85, mobile: 80 },
};

/**
 * Create a diff region for a viewport.
 */
export function createViewportRegion(
  id: string,
  role: string,
  x: number,
  y: number,
  width: number,
  height: number,
  diffPercent: number,
): DiffRegion {
  return {
    id,
    semanticRole: role,
    x,
    y,
    width,
    height,
    diffPixels: Math.round(width * height * (diffPercent / 100)),
    diffPercent,
    severity: classifySeverity(diffPercent, role),
  };
}

/**
 * Detect responsive issues by comparing regions across viewports.
 */
export function detectResponsiveIssues(results: VisualDiffResult[]): ResponsiveIssue[] {
  const issues: ResponsiveIssue[] = [];

  for (const result of results) {
    const label = result.viewport.label as keyof typeof RESPONSIVE_THRESHOLDS.maxDiffPercent;
    const maxDiff = RESPONSIVE_THRESHOLDS.maxDiffPercent[label] ?? 10;

    for (const region of result.regions) {
      if (region.diffPercent > maxDiff) {
        issues.push({
          viewport: result.viewport.label,
          region: region.semanticRole,
          issue: `Diff ${region.diffPercent.toFixed(1)}% exceeds ${maxDiff}% threshold`,
          severity: region.severity,
        });
      }
    }
  }

  // Check for layout shifts between viewports
  const regionMap = new Map<string, Map<string, number>>();
  for (const result of results) {
    for (const region of result.regions) {
      if (!regionMap.has(region.semanticRole)) {
        regionMap.set(region.semanticRole, new Map());
      }
      regionMap.get(region.semanticRole)!.set(result.viewport.label, region.diffPercent);
    }
  }

  for (const [role, viewportDiffs] of regionMap) {
    const desktop = viewportDiffs.get('desktop') ?? 0;
    const mobile = viewportDiffs.get('mobile') ?? 0;
    if (mobile - desktop > 15) {
      issues.push({
        viewport: 'mobile',
        region: role,
        issue: `Layout shift: mobile diff ${mobile.toFixed(1)}% much worse than desktop ${desktop.toFixed(1)}%`,
        severity: 'warning',
      });
    }
  }

  return issues;
}

/**
 * Aggregate viewport results into a matrix result.
 */
export function aggregateViewportMatrix(results: VisualDiffResult[]): ViewportMatrixResult {
  const scores = results.map((r) => r.score);
  const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  let worstViewport = results[0]?.viewport.label ?? 'unknown';
  let worstScore = Infinity;
  for (const r of results) {
    if (r.score < worstScore) {
      worstScore = r.score;
      worstViewport = r.viewport.label;
    }
  }

  const responsiveIssues = detectResponsiveIssues(results);
  const minThreshold = RESPONSIVE_THRESHOLDS.minScore;
  const passed = results.every(
    (r) => r.score >= (minThreshold[r.viewport.label as keyof typeof minThreshold] ?? 80),
  );

  return {
    viewports: results,
    overallScore,
    worstViewport,
    responsiveIssues,
    passed,
  };
}

/**
 * Create mock viewport matrix for testing.
 */
export function createMockViewportMatrix(
  diffPercents: Record<string, number>,
  regions: DiffRegion[] = [],
): ViewportMatrixResult {
  const results: VisualDiffResult[] = VIEWPORTS.map((vp) => {
    const diffPercent = diffPercents[vp.label] ?? 0;
    const totalPixels = vp.width * vp.height;
    return {
      viewport: vp,
      totalPixels,
      diffPixels: Math.round(totalPixels * (diffPercent / 100)),
      diffPercent,
      score: calculateDiffScore(diffPercent),
      regions: regions.filter((r) => true), // all regions for each viewport in mock
    };
  });

  return aggregateViewportMatrix(results);
}

/**
 * Get viewport-specific recommendations.
 */
export function getViewportRecommendations(matrix: ViewportMatrixResult): string[] {
  const recs: string[] = [];

  for (const issue of matrix.responsiveIssues) {
    if (issue.severity === 'critical') {
      recs.push(`[${issue.viewport}] ${issue.region}: ${issue.issue} — immediate fix required`);
    } else if (issue.severity === 'warning') {
      recs.push(`[${issue.viewport}] ${issue.region}: ${issue.issue} — review recommended`);
    }
  }

  if (matrix.worstViewport !== 'desktop' && matrix.overallScore < 85) {
    recs.push(`Worst viewport is ${matrix.worstViewport} — prioritize responsive fixes`);
  }

  return recs;
}
