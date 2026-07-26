/**
 * Visual Diff — Region-aware Semantic Diff.
 * Verbesserung #1: DOM-Mapping: Pixel-Regionen → semantische Elemente.
 * Report: "Hero: Padding 12px zu klein" statt "Region (200,400): 847 diff px"
 */

import type { DiffRegion, VisualDiffResult, ViewportSize } from './types.js';

/**
 * Semantic region definitions for common page sections.
 */
export interface SemanticRegionDef {
  role: string;
  selector?: string;
  bounds?: { x: number; y: number; width: number; height: number };
}

const DEFAULT_REGIONS: SemanticRegionDef[] = [
  { role: 'header', bounds: { x: 0, y: 0, width: 1, height: 0.1 } },
  { role: 'hero', bounds: { x: 0, y: 0.1, width: 1, height: 0.4 } },
  { role: 'content', bounds: { x: 0, y: 0.5, width: 1, height: 0.35 } },
  { role: 'footer', bounds: { x: 0, y: 0.85, width: 1, height: 0.15 } },
];

/**
 * Calculate diff score from pixel difference percentage.
 * Score = 100 - (diffPercent * penalty)
 */
export function calculateDiffScore(diffPercent: number): number {
  const penalty = 2; // 2 points per 1% diff
  return Math.max(0, Math.round(100 - diffPercent * penalty));
}

/**
 * Classify diff severity based on percentage and region importance.
 */
export function classifySeverity(diffPercent: number, role: string): DiffRegion['severity'] {
  const criticalRoles = ['hero', 'header', 'cta'];
  const isCriticalRole = criticalRoles.includes(role);

  if (diffPercent > 10 || (isCriticalRole && diffPercent > 5)) return 'critical';
  if (diffPercent > 3 || (isCriticalRole && diffPercent > 2)) return 'warning';
  return 'info';
}

/**
 * Map pixel coordinates to semantic region.
 */
export function mapToSemanticRegion(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  regions: SemanticRegionDef[] = DEFAULT_REGIONS,
): string {
  const relX = x / viewportWidth;
  const relY = y / viewportHeight;

  for (const region of regions) {
    if (region.bounds) {
      const { x: rx, y: ry, width: rw, height: rh } = region.bounds;
      if (relX >= rx && relX < rx + rw && relY >= ry && relY < ry + rh) {
        return region.role;
      }
    }
  }
  return 'unknown';
}

/**
 * Generate human-readable diff message.
 * "Hero: Padding 12px zu klein" instead of "Region (200,400): 847 diff px"
 */
export function generateDiffMessage(region: DiffRegion): string {
  const severityIcon = region.severity === 'critical' ? '🔴' : region.severity === 'warning' ? '🟡' : '🔵';
  const roleName = region.semanticRole.charAt(0).toUpperCase() + region.semanticRole.slice(1);

  if (region.diffPercent > 10) {
    return `${severityIcon} ${roleName}: Significant visual difference (${region.diffPercent.toFixed(1)}%)`;
  }
  if (region.diffPercent > 5) {
    return `${severityIcon} ${roleName}: Moderate difference detected (${region.diffPercent.toFixed(1)}%)`;
  }
  return `${severityIcon} ${roleName}: Minor difference (${region.diffPercent.toFixed(1)}%)`;
}

/**
 * Aggregate diff results across regions.
 */
export function aggregateRegions(regions: DiffRegion[]): {
  totalDiffPixels: number;
  criticalCount: number;
  warningCount: number;
  worstRegion: DiffRegion | null;
} {
  let totalDiffPixels = 0;
  let criticalCount = 0;
  let warningCount = 0;
  let worstRegion: DiffRegion | null = null;

  for (const region of regions) {
    totalDiffPixels += region.diffPixels;
    if (region.severity === 'critical') criticalCount++;
    if (region.severity === 'warning') warningCount++;
    if (!worstRegion || region.diffPercent > worstRegion.diffPercent) {
      worstRegion = region;
    }
  }

  return { totalDiffPixels, criticalCount, warningCount, worstRegion };
}

/**
 * Create a mock visual diff result for testing.
 * In production, this would use pixelmatch + Playwright screenshots.
 */
export function createMockDiffResult(
  viewport: ViewportSize,
  diffPercent: number,
  regions: DiffRegion[] = [],
): VisualDiffResult {
  const totalPixels = viewport.width * viewport.height;
  const diffPixels = Math.round(totalPixels * (diffPercent / 100));

  return {
    viewport,
    totalPixels,
    diffPixels,
    diffPercent,
    score: calculateDiffScore(diffPercent),
    regions,
  };
}

/**
 * Compare two visual diff results and return improvement.
 */
export function compareDiffResults(before: VisualDiffResult, after: VisualDiffResult): {
  improved: boolean;
  scoreDelta: number;
  diffPercentDelta: number;
} {
  return {
    improved: after.score > before.score,
    scoreDelta: after.score - before.score,
    diffPercentDelta: after.diffPercent - before.diffPercent,
  };
}
