/**
 * Nesting Audit (Phase 63).
 *
 * QA-level nesting analysis that integrates with the QA pipeline.
 * Reports depth violations, container bloat, and suggests flattening.
 *
 * @module qa/nesting-audit
 */

// ============================================================================
// Types
// ============================================================================

export interface QaNestingNode {
  id: string;
  elType: string;
  widgetType?: string;
  children: QaNestingNode[];
  hasVisualSettings: boolean;
}

export interface QaNestingReport {
  maxDepth: number;
  totalNodes: number;
  containerCount: number;
  widgetCount: number;
  singleChildContainers: number;
  nonVisualContainers: number;
  depthViolations: DepthViolation[];
  flattenCandidates: FlattenCandidate[];
  score: number; // 0-100, higher = flatter
  passed: boolean;
  timestamp: string;
}

export interface DepthViolation {
  nodeId: string;
  depth: number;
  path: string[];
  severity: 'error' | 'warning';
}

export interface FlattenCandidate {
  nodeId: string;
  reason: 'single-child' | 'non-visual' | 'excessive-depth';
  depth: number;
  childCount: number;
}

// ============================================================================
// Configuration
// ============================================================================

const MAX_ALLOWED_DEPTH = 3;
const CONTAINER_BLOAT_THRESHOLD = 40; // max containers for a typical page

// ============================================================================
// Audit engine
// ============================================================================

/**
 * Run nesting audit on a parsed element tree.
 */
export function runNestingAudit(
  nodes: QaNestingNode[],
  maxDepth = MAX_ALLOWED_DEPTH,
): QaNestingReport {
  const depthViolations: DepthViolation[] = [];
  const flattenCandidates: FlattenCandidate[] = [];
  let maxFound = 0;
  let totalNodes = 0;
  let containerCount = 0;
  let widgetCount = 0;
  let singleChildContainers = 0;
  let nonVisualContainers = 0;

  function walk(node: QaNestingNode, depth: number, path: string[]): void {
    totalNodes++;
    const currentPath = [...path, node.id];

    if (depth > maxFound) maxFound = depth;

    const isContainer = node.elType === 'container' || node.elType === 'column';
    if (isContainer) {
      containerCount++;

      // Check single-child
      if (node.children.length === 1) {
        singleChildContainers++;
        if (!node.hasVisualSettings) {
          flattenCandidates.push({
            nodeId: node.id,
            reason: 'single-child',
            depth,
            childCount: node.children.length,
          });
        }
      }

      // Check non-visual
      if (!node.hasVisualSettings && node.children.length > 0) {
        nonVisualContainers++;
        if (node.children.length > 1) {
          flattenCandidates.push({
            nodeId: node.id,
            reason: 'non-visual',
            depth,
            childCount: node.children.length,
          });
        }
      }

      // Check excessive depth
      if (depth > maxDepth) {
        flattenCandidates.push({
          nodeId: node.id,
          reason: 'excessive-depth',
          depth,
          childCount: node.children.length,
        });
      }
    }

    if (node.elType === 'widget') {
      widgetCount++;
    }

    // Depth violations
    if (depth > maxDepth) {
      depthViolations.push({
        nodeId: node.id,
        depth,
        path: currentPath,
        severity: depth > maxDepth + 1 ? 'error' : 'warning',
      });
    }

    for (const child of node.children) {
      walk(child, depth + 1, currentPath);
    }
  }

  for (const node of nodes) {
    walk(node, 0, []);
  }

  // Score: penalize depth violations, container bloat, single-child wrappers
  const depthPenalty = depthViolations.length * 10;
  const bloatPenalty = containerCount > CONTAINER_BLOAT_THRESHOLD
    ? (containerCount - CONTAINER_BLOAT_THRESHOLD) * 2
    : 0;
  const wrapperPenalty = singleChildContainers * 5;
  const score = Math.max(0, 100 - depthPenalty - bloatPenalty - wrapperPenalty);

  return {
    maxDepth: maxFound,
    totalNodes,
    containerCount,
    widgetCount,
    singleChildContainers,
    nonVisualContainers,
    depthViolations,
    flattenCandidates,
    score,
    passed: depthViolations.filter((v) => v.severity === 'error').length === 0,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Convert a V3Element tree to QaNestingNode tree for audit.
 */
export function toNestingNodes(
  elements: Array<{
    id: string;
    elType: string;
    widgetType?: string;
    settings?: Record<string, unknown>;
    elements?: unknown[];
  }>,
): QaNestingNode[] {
  const VISUAL_SETTINGS = [
    'background_color', 'background_image', 'padding', 'margin',
    'border_radius', 'box_shadow', 'flex_gap', 'flex_direction',
  ];

  function convert(el: {
    id: string;
    elType: string;
    widgetType?: string;
    settings?: Record<string, unknown>;
    elements?: unknown[];
  }): QaNestingNode {
    const settings = el.settings ?? {};
    const hasVisual = VISUAL_SETTINGS.some((k) => {
      const v = settings[k];
      return v !== undefined && v !== null && v !== '';
    });

    return {
      id: el.id,
      elType: el.elType,
      widgetType: el.widgetType,
      hasVisualSettings: hasVisual,
      children: ((el.elements ?? []) as Array<{
        id: string;
        elType: string;
        widgetType?: string;
        settings?: Record<string, unknown>;
        elements?: unknown[];
      }>).map(convert),
    };
  }

  return elements.map(convert);
}
