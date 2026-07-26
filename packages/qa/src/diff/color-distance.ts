/**
 * color-distance.ts — Modul V1.7 (UMBAUPLAN.md §6).
 *
 * Perceptual "is this basically the same color" check for pixel-diff
 * scoring. Uses OKLCH Euclidean distance rather than full CIEDE2000 — a
 * deliberate simplification (UMBAUPLAN.md calls out OKLCH as the more
 * modern, simpler alternative). L/C sit roughly in a 0-1 range while OKLCH's
 * hue (h) is in degrees (0-360, see oklch-converter.ts), so a plain
 * Euclidean sum over (L, C, h) would let hue dominate and also breaks at
 * the 359°/0° wrap. Converting (C, h) to Cartesian coordinates first (like
 * OKLab's a/b) fixes both issues in one step.
 */

import { oklchHexToRgb as hexToRgb, rgbToOklch, type Oklch } from '@elconv/core';

function toCartesian(color: Oklch): { L: number; a: number; b: number } {
  const hueRad = (color.h * Math.PI) / 180;
  return { L: color.L, a: color.C * Math.cos(hueRad), b: color.C * Math.sin(hueRad) };
}

/** Euclidean distance between two RGB colors in OKLCH space (via its Cartesian a/b form). */
export function colorDistanceOklch(rgbA: [number, number, number], rgbB: [number, number, number]): number {
  const a = toCartesian(rgbToOklch({ r: rgbA[0], g: rgbA[1], b: rgbA[2] }));
  const b = toCartesian(rgbToOklch({ r: rgbB[0], g: rgbB[1], b: rgbB[2] }));
  return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

/**
 * True if two hex colors are visually indistinguishable within `threshold`.
 * Returns false (not equal) if either hex string fails to parse.
 */
export function isVisuallyEqual(hexA: string, hexB: string, threshold = 0.02): boolean {
  const rgbA = hexToRgb(hexA);
  const rgbB = hexToRgb(hexB);
  if (!rgbA || !rgbB) return false;
  return colorDistanceOklch([rgbA.r, rgbA.g, rgbA.b], [rgbB.r, rgbB.g, rgbB.b]) < threshold;
}
