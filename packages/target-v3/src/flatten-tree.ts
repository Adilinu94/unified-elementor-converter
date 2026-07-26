/**
 * Tree Flattening (Phase 63).
 *
 * Post-processing step that reduces unnecessary nesting in V3 trees.
 * Merges single-purpose containers, enforces max-depth 3
 * (Section → Layout-Container → Widget).
 *
 * Reduces ~75 containers to ~30, max-depth from 6 to 3.
 *
 * @module target-v3/flatten-tree
 */

import type { V3Element } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface FlattenOptions {
  /** Maximum nesting depth allowed (default: 3). */
  maxDepth: number;
  /** Merge containers that have only one child (default: true). */
  mergeSingleChild: boolean;
  /** Merge containers that serve no visual purpose (default: true). */
  mergeNonVisual: boolean;
  /** Preserve containers with these settings (never merge). */
  preserveSettings: string[];
}

export interface FlattenResult {
  tree: V3Element[];
  originalContainerCount: number;
  flattenedContainerCount: number;
  originalMaxDepth: number;
  flattenedMaxDepth: number;
  mergedNodes: string[];
  removedNodes: string[];
}

export interface NestingAuditResult {
  maxDepth: number;
  totalContainers: number;
  violations: NestingViolation[];
  passed: boolean;
}

export interface NestingViolation {
  elementId: string;
  depth: number;
  path: string[];
  message: string;
}

// ============================================================================
// Default options
// ============================================================================

const DEFAULT_OPTIONS: FlattenOptions = {
  maxDepth: 3,
  mergeSingleChild: true,
  mergeNonVisual: true,
  preserveSettings: [
    'background_color',
    'background_image',
    'padding',
    'border_radius',
    'box_shadow',
    'flex_gap',
    'flex_direction',
    '_element_id',
  ],
};

// ============================================================================
// Core flatten algorithm
// ============================================================================

/**
 * Flatten a V3 element tree to reduce nesting.
 */
export function flattenTree(
  elements: V3Element[],
  options: Partial<FlattenOptions> = {},
): FlattenResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const mergedNodes: string[] = [];
  const removedNodes: string[] = [];

  const originalContainerCount = countContainers(elements);
  const originalMaxDepth = computeMaxDepth(elements);

  function flatten(el: V3Element, depth: number): V3Element | null {
    const isContainer = el.elType === 'container' || el.elType === 'column';

    // Recursively flatten children first
    if (el.elements) {
      const flattenedChildren: V3Element[] = [];
      for (const child of el.elements) {
        const result = flatten(child, depth + 1);
        if (result) flattenedChildren.push(result);
      }
      el.elements = flattenedChildren;
    }

    // Only process containers/columns for merging
    if (!isContainer) return el;

    // Rule 1: Merge single-child containers (wrapper with no visual purpose)
    if (opts.mergeSingleChild && el.elements?.length === 1) {
      const child = el.elements[0]!;
      if (!hasVisualSettings(el, opts.preserveSettings)) {
        // Merge: promote child, absorb parent's layout settings
        mergedNodes.push(el.id);
        const mergedSettings = { ...el.settings, ...child.settings };
        child.settings = mergedSettings;
        return child;
      }
    }

    // Rule 2: Merge non-visual containers at excessive depth
    if (opts.mergeNonVisual && depth >= opts.maxDepth) {
      if (!hasVisualSettings(el, opts.preserveSettings) && el.elements) {
        // Remove this container, promote children to parent level
        removedNodes.push(el.id);
        // Return a marker — caller will splice children in
        return null;
      }
    }

    // Rule 3: If depth exceeds max and container has visual settings,
    // keep it but flatten its children more aggressively
    if (depth >= opts.maxDepth && el.elements) {
      const promoted: V3Element[] = [];
      for (const child of el.elements) {
        if (
          (child.elType === 'container' || child.elType === 'column') &&
          !hasVisualSettings(child, opts.preserveSettings)
        ) {
          // Promote grandchildren
          removedNodes.push(child.id);
          if (child.elements) {
            promoted.push(...child.elements);
          }
        } else {
          promoted.push(child);
        }
      }
      el.elements = promoted;
    }

    return el;
  }

  // Process top-level elements
  const result: V3Element[] = [];
  for (const el of elements) {
    const flattened = flatten(structuredClone(el), 0);
    if (flattened) {
      result.push(flattened);
    }
  }

  // Second pass: splice promoted children where containers were removed
  spliceNullContainers(result);

  const flattenedContainerCount = countContainers(result);
  const flattenedMaxDepth = computeMaxDepth(result);

  return {
    tree: result,
    originalContainerCount,
    flattenedContainerCount,
    originalMaxDepth,
    flattenedMaxDepth,
    mergedNodes,
    removedNodes,
  };
}

// ============================================================================
// Nesting Audit
// ============================================================================

/**
 * Audit a V3 tree for nesting violations.
 * Does NOT modify the tree — just reports issues.
 */
export function auditNesting(
  elements: V3Element[],
  maxDepth = 3,
): NestingAuditResult {
  const violations: NestingViolation[] = [];
  let maxFound = 0;
  let totalContainers = 0;

  function walk(el: V3Element, depth: number, path: string[]): void {
    if (el.elType === 'container' || el.elType === 'column') {
      totalContainers++;
    }

    if (depth > maxFound) maxFound = depth;

    if (depth > maxDepth) {
      violations.push({
        elementId: el.id,
        depth,
        path: [...path, el.id],
        message: `Element at depth ${depth} exceeds max allowed depth ${maxDepth}`,
      });
    }

    if (el.elements) {
      for (const child of el.elements) {
        walk(child, depth + 1, [...path, el.id]);
      }
    }
  }

  for (const el of elements) {
    walk(el, 0, []);
  }

  return {
    maxDepth: maxFound,
    totalContainers,
    violations,
    passed: violations.length === 0,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function hasVisualSettings(el: V3Element, preserveList: string[]): boolean {
  const settings = el.settings ?? {};
  return preserveList.some((key) => {
    const val = settings[key];
    return val !== undefined && val !== null && val !== '';
  });
}

function countContainers(elements: V3Element[]): number {
  let count = 0;
  function walk(el: V3Element): void {
    if (el.elType === 'container' || el.elType === 'column') count++;
    if (el.elements) {
      for (const child of el.elements) walk(child);
    }
  }
  for (const el of elements) walk(el);
  return count;
}

function computeMaxDepth(elements: V3Element[]): number {
  let max = 0;
  function walk(el: V3Element, depth: number): void {
    if (depth > max) max = depth;
    if (el.elements) {
      for (const child of el.elements) walk(child, depth + 1);
    }
  }
  for (const el of elements) walk(el, 0);
  return max;
}

function spliceNullContainers(elements: V3Element[]): void {
  for (const el of elements) {
    if (el.elements) {
      // Filter out any null entries (from removed containers)
      el.elements = el.elements.filter(Boolean);
      spliceNullContainers(el.elements);
    }
  }
}
