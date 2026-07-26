/**
 * Runtime anti-contamination checks.
 * Called BEFORE any build or deploy to catch version mixing.
 *
 * KRITISCH: Diese Checks sind die letzte Verteidigungslinie.
 * Sie MÜSSEN vor jedem Deploy aufgerufen werden.
 */

import type { ElementorTarget } from './branded-types.js';

export class ContaminationError extends Error {
  constructor(
    public readonly target: ElementorTarget,
    public readonly found: string,
    public readonly path?: string,
  ) {
    super(
      `CONTAMINATION: Found "${found}" in ${target.toUpperCase()} tree` +
      (path ? ` at ${path}` : '') +
      `. This indicates V3/V4 mixing. Aborting.`,
    );
    this.name = 'ContaminationError';
  }
}

/** V4-only markers that must NEVER appear in a V3 tree */
const V4_MARKERS = [
  '$$type',
  'e-flexbox',
  'e-heading',
  'e-text',
  'e-button',
  'e-image',
  'e-div-block',
  'e-grid',
  'e-html',
  'global-color-variable',
  'global-font-variable',
];

/** V3-only markers that must NEVER appear in a V4 tree */
const V3_MARKERS = [
  '"elType":"container"',
  '"elType":"section"',
  '"elType":"column"',
  '"isInner":true',
  '"_element_width"',
  '"content_width"',
];

/**
 * Scan a tree (as JSON string) for cross-version contamination.
 * Throws ContaminationError if any marker from the WRONG version is found.
 *
 * @param tree - The element tree (will be JSON.stringify'd)
 * @param target - Which version this tree is supposed to be
 */
export function assertNoContamination(tree: unknown, target: ElementorTarget): void {
  const json = JSON.stringify(tree);

  if (target === 'v3') {
    for (const marker of V4_MARKERS) {
      if (json.includes(marker)) {
        throw new ContaminationError('v3', marker);
      }
    }
  }

  if (target === 'v4') {
    for (const marker of V3_MARKERS) {
      if (json.includes(marker)) {
        throw new ContaminationError('v4', marker);
      }
    }
  }
}

/**
 * Non-throwing version — returns list of violations.
 */
export function findContamination(tree: unknown, target: ElementorTarget): string[] {
  const json = JSON.stringify(tree);
  const violations: string[] = [];

  const markers = target === 'v3' ? V4_MARKERS : V3_MARKERS;
  for (const marker of markers) {
    if (json.includes(marker)) {
      violations.push(marker);
    }
  }
  return violations;
}
