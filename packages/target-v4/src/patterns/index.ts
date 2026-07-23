/**
 * V4 Patterns Registry (Atomic).
 * EIGENE Implementierung — NICHT von V3 kopieren!
 * Uses e-flexbox + $$type styles + GC candidates.
 */

import { buildV4GlassHeader, resetV4GlassHeaderIds, type V4GlassHeaderOptions } from './glass-header.js';
import { buildV4StatRow, resetV4StatRowIds, type V4StatRowOptions, type V4StatItem } from './stat-row.js';
import type { V4TreeNode } from '../types.js';

export { buildV4GlassHeader, resetV4GlassHeaderIds, type V4GlassHeaderOptions };
export { buildV4StatRow, resetV4StatRowIds, type V4StatRowOptions, type V4StatItem };

/**
 * Pattern registry for dynamic pattern selection.
 */
export interface V4Pattern {
  name: string;
  description: string;
  build: (options: unknown) => V4TreeNode;
}

export const V4_PATTERNS: Record<string, V4Pattern> = {
  'glass-header': {
    name: 'glass-header',
    description: 'Atomic glassmorphism header with e-flexbox',
    build: (opts) => buildV4GlassHeader(opts as V4GlassHeaderOptions),
  },
  'stat-row': {
    name: 'stat-row',
    description: 'Atomic statistics row with e-flexbox',
    build: (opts) => buildV4StatRow(opts as V4StatRowOptions),
  },
};

/**
 * List available V4 pattern names.
 */
export function listV4Patterns(): string[] {
  return Object.keys(V4_PATTERNS);
}

/**
 * Reset all V4 pattern ID counters (for deterministic tests).
 */
export function resetAllV4PatternIds(): void {
  resetV4GlassHeaderIds();
  resetV4StatRowIds();
}
