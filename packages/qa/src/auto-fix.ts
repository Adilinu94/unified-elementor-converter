/**
 * Auto-Fix — Closed-Loop Auto-Fix with Priority Queue.
 * Verbesserung #2: Echte MCP-Fixer: color-mismatch→edit _color, layout-shift→padding, size-mismatch→width.
 * Verbesserung #3: Sortierung: critical × area_size. Max 3 Fixes/Round, dann Re-Measure.
 */

import type { FixAction, FixType, FixPriorityQueue, DiffRegion } from './types.ts';

let fixIdCounter = 0;
function nextFixId(): string {
  return `fix_${(++fixIdCounter).toString(36)}`;
}

export function resetFixIds(): void {
  fixIdCounter = 0;
}

/**
 * Fix type configurations with MCP ability mappings.
 */
export const FIX_CONFIGS: Record<FixType, {
  ability: string;
  cssProperty: string;
  priorityWeight: number;
}> = {
  'color-mismatch': { ability: 'edit-element-style', cssProperty: '_color', priorityWeight: 8 },
  'layout-shift': { ability: 'edit-element-style', cssProperty: 'padding', priorityWeight: 9 },
  'size-mismatch': { ability: 'edit-element-style', cssProperty: 'width', priorityWeight: 7 },
  'spacing-mismatch': { ability: 'edit-element-style', cssProperty: 'margin', priorityWeight: 6 },
  'font-mismatch': { ability: 'edit-element-style', cssProperty: 'font_size', priorityWeight: 5 },
  'missing-element': { ability: 'add-element', cssProperty: '', priorityWeight: 10 },
};

/**
 * Calculate fix priority based on severity and area size.
 * Priority = severity_weight × area_size_factor
 */
export function calculateFixPriority(
  type: FixType,
  region: DiffRegion,
): number {
  const config = FIX_CONFIGS[type];
  const severityWeight = region.severity === 'critical' ? 3 : region.severity === 'warning' ? 2 : 1;
  const areaFactor = Math.sqrt(region.width * region.height) / 100;
  return Math.round(config.priorityWeight * severityWeight * (1 + areaFactor));
}

/**
 * Create a fix action from a diff region.
 */
export function createFixAction(
  type: FixType,
  region: DiffRegion,
  oldValue?: string,
  newValue?: string,
): FixAction {
  const config = FIX_CONFIGS[type];
  return {
    id: nextFixId(),
    regionId: region.id,
    type,
    priority: calculateFixPriority(type, region),
    description: generateFixDescription(type, region, oldValue, newValue),
    cssProperty: config.cssProperty,
    oldValue,
    newValue,
    applied: false,
    verified: false,
  };
}

/**
 * Generate human-readable fix description.
 */
function generateFixDescription(
  type: FixType,
  region: DiffRegion,
  oldValue?: string,
  newValue?: string,
): string {
  const roleName = region.semanticRole.charAt(0).toUpperCase() + region.semanticRole.slice(1);

  switch (type) {
    case 'color-mismatch':
      return `${roleName}: Adjust color from ${oldValue ?? 'current'} to ${newValue ?? 'target'}`;
    case 'layout-shift':
      return `${roleName}: Fix layout shift with padding adjustment`;
    case 'size-mismatch':
      return `${roleName}: Adjust size from ${oldValue ?? 'current'} to ${newValue ?? 'target'}`;
    case 'spacing-mismatch':
      return `${roleName}: Fix spacing with margin adjustment`;
    case 'font-mismatch':
      return `${roleName}: Adjust font size`;
    case 'missing-element':
      return `${roleName}: Add missing element`;
    default:
      return `${roleName}: Apply fix`;
  }
}

/**
 * Create a priority queue from fix actions.
 * Sorts by priority descending (highest priority first).
 */
export function createPriorityQueue(fixes: FixAction[], maxPerRound = 3): FixPriorityQueue {
  const sorted = [...fixes].sort((a, b) => b.priority - a.priority);
  return { fixes: sorted, maxPerRound };
}

/**
 * Get the next batch of fixes to apply (max 3 per round).
 */
export function getNextBatch(queue: FixPriorityQueue): FixAction[] {
  const pending = queue.fixes.filter((f) => !f.applied);
  return pending.slice(0, queue.maxPerRound);
}

/**
 * Mark a fix as applied.
 */
export function markFixApplied(queue: FixPriorityQueue, fixId: string): void {
  const fix = queue.fixes.find((f) => f.id === fixId);
  if (fix) fix.applied = true;
}

/**
 * Mark a fix as verified (after re-measure).
 */
export function markFixVerified(queue: FixPriorityQueue, fixId: string): void {
  const fix = queue.fixes.find((f) => f.id === fixId);
  if (fix) fix.verified = true;
}

/**
 * Check if all fixes are applied and verified.
 */
export function isQueueComplete(queue: FixPriorityQueue): boolean {
  return queue.fixes.every((f) => f.applied && f.verified);
}

/**
 * Get remaining fixes count.
 */
export function getRemainingCount(queue: FixPriorityQueue): number {
  return queue.fixes.filter((f) => !f.applied || !f.verified).length;
}

/**
 * Infer fix type from diff region characteristics.
 */
export function inferFixType(region: DiffRegion, diffDetails?: {
  colorDiff?: boolean;
  sizeDiff?: boolean;
  positionDiff?: boolean;
}): FixType {
  if (diffDetails?.colorDiff) return 'color-mismatch';
  if (diffDetails?.sizeDiff) return 'size-mismatch';
  if (diffDetails?.positionDiff) return 'layout-shift';

  // Default inference based on region
  if (region.semanticRole === 'hero' || region.semanticRole === 'header') {
    return 'layout-shift';
  }
  return 'spacing-mismatch';
}
