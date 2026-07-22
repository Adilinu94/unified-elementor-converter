/**
 * V3 Container Normalize.
 * Fixes isInner flags and flex-row child widths before deploy.
 * Ported from site-clone-to-v3/src/builder/v3-container-normalize.ts
 */

import type { V3Element } from './types.js';

/**
 * Normalize a V3 container tree:
 * 1. Set isInner: true on all nested containers (depth > 0)
 * 2. Ensure flex-row children have _inline_size
 * 3. Remove isInner from top-level containers
 */
export function normalizeV3ContainerTree(tree: V3Element[]): V3Element[] {
  return tree.map((el, _idx) => normalizeElement(el, 0));
}

function normalizeElement(el: V3Element, depth: number): V3Element {
  const result = { ...el };

  if (result.elType === 'container') {
    // Top-level containers: isInner = false
    // Nested containers: isInner = true
    result.isInner = depth > 0;

    // If flex-row, ensure children have width
    const direction = (result.settings as Record<string, unknown>)?.flex_direction;
    if (direction === 'row' && result.elements) {
      const childCount = result.elements.length;
      const equalWidth = Math.floor(100 / childCount);
      result.elements = result.elements.map((child) => {
        if (child.elType === 'container' || child.elType === 'column') {
          const settings = { ...(child.settings as Record<string, unknown>) };
          if (!settings._inline_size) {
            settings._inline_size = { unit: '%', size: equalWidth };
          }
          return { ...child, settings };
        }
        return child;
      });
    }
  }

  // Recurse into children
  if (result.elements) {
    result.elements = result.elements.map((child) => normalizeElement(child, depth + 1));
  }

  return result;
}

/**
 * Find nested containers missing isInner: true
 */
export function findNestedContainersMissingIsInner(tree: V3Element[]): string[] {
  const issues: string[] = [];
  walkTree(tree, (el, depth) => {
    if (el.elType === 'container' && depth > 0 && !el.isInner) {
      issues.push(el.id);
    }
  });
  return issues;
}

/**
 * Find flex-row containers where children lack _inline_size
 */
export function findFlexRowStackRisks(tree: V3Element[]): string[] {
  const issues: string[] = [];
  walkTree(tree, (el) => {
    if (el.elType !== 'container' || !el.elements) return;
    const direction = (el.settings as Record<string, unknown>)?.flex_direction;
    if (direction !== 'row') return;

    for (const child of el.elements) {
      if (child.elType === 'container' || child.elType === 'column') {
        const size = (child.settings as Record<string, unknown>)?._inline_size;
        if (!size) {
          issues.push(child.id);
        }
      }
    }
  });
  return issues;
}

function walkTree(
  elements: V3Element[],
  fn: (el: V3Element, depth: number) => void,
  depth = 0,
): void {
  for (const el of elements) {
    fn(el, depth);
    if (el.elements) {
      walkTree(el.elements, fn, depth + 1);
    }
  }
}
