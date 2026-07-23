/**
 * V3 Patterns Registry.
 * Widget-first patterns using native Elementor V3 widgets.
 * REGEL: Native widgets (image/heading/button), HTML nur ≤15% Budget.
 */

import { buildGlassHeader, resetGlassHeaderIds, type GlassHeaderOptions } from './glass-header.js';
import { buildStatRow, resetStatRowIds, type StatRowOptions, type StatItem } from './stat-row.js';
import { buildServiceCards, resetServiceCardsIds, type ServiceCardsOptions, type ServiceCard } from './service-cards.js';
import type { V3Element } from '../types.js';

export { buildGlassHeader, resetGlassHeaderIds, type GlassHeaderOptions };
export { buildStatRow, resetStatRowIds, type StatRowOptions, type StatItem };
export { buildServiceCards, resetServiceCardsIds, type ServiceCardsOptions, type ServiceCard };

/**
 * Pattern registry for dynamic pattern selection.
 */
export interface V3Pattern {
  name: string;
  description: string;
  build: (options: unknown) => V3Element;
}

export const V3_PATTERNS: Record<string, V3Pattern> = {
  'glass-header': {
    name: 'glass-header',
    description: 'Glassmorphism header with blur effect',
    build: (opts) => {
      const { buildGlassHeader } = require('./glass-header.ts');
      return buildGlassHeader(opts);
    },
  },
  'stat-row': {
    name: 'stat-row',
    description: 'Horizontal statistics row',
    build: (opts) => {
      const { buildStatRow } = require('./stat-row.ts');
      return buildStatRow(opts);
    },
  },
  'service-cards': {
    name: 'service-cards',
    description: 'Grid of service/feature cards',
    build: (opts) => {
      const { buildServiceCards } = require('./service-cards.ts');
      return buildServiceCards(opts);
    },
  },
};

/**
 * List available pattern names.
 */
export function listV3Patterns(): string[] {
  return Object.keys(V3_PATTERNS);
}

/**
 * Reset all pattern ID counters (for deterministic tests).
 */
export function resetAllV3PatternIds(): void {
  resetGlassHeaderIds();
  resetStatRowIds();
  resetServiceCardsIds();
}
