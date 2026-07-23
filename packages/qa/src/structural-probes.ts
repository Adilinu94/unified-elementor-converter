/**
 * Structural Probes — DOM structure validation.
 * Checks: shared IDs, element-count, nesting-depth, widget-type consistency.
 */

import type { StructuralProbe } from './types.js';

let probeIdCounter = 0;
function nextProbeId(): string {
  return `probe_${(++probeIdCounter).toString(36)}`;
}

export function resetProbeIds(): void {
  probeIdCounter = 0;
}

export interface ElementNode {
  id?: string;
  type: string;
  children?: ElementNode[];
}

/**
 * Check for duplicate/shared IDs in the element tree.
 */
export function probeSharedIds(elements: ElementNode[]): StructuralProbe {
  const ids = new Map<string, number>();

  function walk(nodes: ElementNode[]): void {
    for (const node of nodes) {
      if (node.id) {
        ids.set(node.id, (ids.get(node.id) ?? 0) + 1);
      }
      if (node.children) walk(node.children);
    }
  }

  walk(elements);

  const duplicates = [...ids.entries()].filter(([, count]) => count > 1);
  const passed = duplicates.length === 0;

  return {
    id: nextProbeId(),
    type: 'shared-id',
    passed,
    expected: 'All IDs unique',
    actual: passed ? 'All IDs unique' : `Duplicates: ${duplicates.map(([id, c]) => `${id}(×${c})`).join(', ')}`,
    message: passed
      ? 'No shared IDs detected'
      : `Found ${duplicates.length} shared ID(s): ${duplicates.map(([id]) => id).join(', ')}`,
  };
}

/**
 * Check element count matches expected.
 */
export function probeElementCount(elements: ElementNode[], expectedCount: number): StructuralProbe {
  let count = 0;

  function walk(nodes: ElementNode[]): void {
    for (const node of nodes) {
      count++;
      if (node.children) walk(node.children);
    }
  }

  walk(elements);
  const passed = count === expectedCount;

  return {
    id: nextProbeId(),
    type: 'element-count',
    passed,
    expected: expectedCount,
    actual: count,
    message: passed
      ? `Element count matches (${count})`
      : `Element count mismatch: expected ${expectedCount}, got ${count}`,
  };
}

/**
 * Check maximum nesting depth.
 */
export function probeNestingDepth(elements: ElementNode[], maxDepth: number): StructuralProbe {
  let deepest = 0;

  function walk(nodes: ElementNode[], depth: number): void {
    for (const node of nodes) {
      deepest = Math.max(deepest, depth);
      if (node.children) walk(node.children, depth + 1);
    }
  }

  walk(elements, 1);
  const passed = deepest <= maxDepth;

  return {
    id: nextProbeId(),
    type: 'nesting-depth',
    passed,
    expected: `≤ ${maxDepth}`,
    actual: deepest,
    message: passed
      ? `Nesting depth OK (${deepest}/${maxDepth})`
      : `Nesting too deep: ${deepest} levels (max ${maxDepth})`,
  };
}

/**
 * Check widget types are valid for target version.
 */
export function probeWidgetTypes(
  elements: ElementNode[],
  allowedTypes: string[],
): StructuralProbe {
  const invalid: string[] = [];

  function walk(nodes: ElementNode[]): void {
    for (const node of nodes) {
      if (!allowedTypes.includes(node.type)) {
        invalid.push(node.type);
      }
      if (node.children) walk(node.children);
    }
  }

  walk(elements);
  const passed = invalid.length === 0;
  const uniqueInvalid = [...new Set(invalid)];

  return {
    id: nextProbeId(),
    type: 'widget-type',
    passed,
    expected: allowedTypes.join(', '),
    actual: passed ? 'All types valid' : uniqueInvalid.join(', '),
    message: passed
      ? 'All widget types valid'
      : `Invalid widget types: ${uniqueInvalid.join(', ')}`,
  };
}

/**
 * Run all structural probes.
 */
export function runStructuralProbes(
  elements: ElementNode[],
  options: {
    expectedCount?: number;
    maxDepth?: number;
    allowedTypes?: string[];
  } = {},
): StructuralProbe[] {
  const probes: StructuralProbe[] = [probeSharedIds(elements)];

  if (options.expectedCount !== undefined) {
    probes.push(probeElementCount(elements, options.expectedCount));
  }
  if (options.maxDepth !== undefined) {
    probes.push(probeNestingDepth(elements, options.maxDepth));
  }
  if (options.allowedTypes) {
    probes.push(probeWidgetTypes(elements, options.allowedTypes));
  }

  return probes;
}
