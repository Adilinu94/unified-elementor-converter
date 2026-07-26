/**
 * Spacing-Extractor (Phase 2.5).
 *
 * Section-Padding: median of padding-top on tall sections (min-height >= 400px)
 * Container-Width: mode of max-width on wrapper divs (between 400-2000px)
 *
 * Based on BAUPLAN §Phase 2.5 Step 5.
 */

import type { StyleNode } from './color-extractor.js';

export interface SpacingTokens {
  /** Vertical padding for sections (px). */
  sectionPadding: number;
  /** Container max-width (px). */
  containerWidth: number;
}

/** Parse a CSS length string to px. Handles "80px" and "5rem" (assuming 16px base). */
export function parsePx(value: string | undefined | null): number {
  if (!value) return 0;
  const trimmed = value.trim();
  const m = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(px|rem|em)?$/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? 'px').toLowerCase();
  if (unit === 'rem' || unit === 'em') return Math.round(n * 16);
  return Math.round(n);
}

/** Median of an array of numbers. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

/** Mode (most common value) of an array of numbers. */
export function mode(values: number[]): number | null {
  if (values.length === 0) return null;
  const freq: Record<number, number> = {};
  for (const v of values) freq[v] = (freq[v] ?? 0) + 1;
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  return sorted[0] ? parseInt(sorted[0][0], 10) : null;
}

/** Extract section-padding and container-width from style nodes. */
export function extractSpacingTokens(
  styles: StyleNode[],
  options: { minHeightPx?: number; minContainerWidth?: number; maxContainerWidth?: number } = {},
): SpacingTokens {
  const minHeightPx = options.minHeightPx ?? 400;
  const minContainerWidth = options.minContainerWidth ?? 400;
  const maxContainerWidth = options.maxContainerWidth ?? 2000;

  const sectionPaddings = styles
    .filter((n) => {
      const minH = parsePx(n.styles['min-height']);
      return minH >= minHeightPx;
    })
    .map((n) => parsePx(n.styles['padding-top']))
    .filter((v) => v > 0);

  const maxWidths = styles
    .map((n) => parsePx(n.styles['max-width']))
    .filter((v) => v >= minContainerWidth && v <= maxContainerWidth);

  return {
    sectionPadding: median(sectionPaddings) ?? 80,
    containerWidth: mode(maxWidths) ?? 1140,
  };
}
