/**
 * token-constraint.ts — Modul S1 (UMBAUPLAN.md §7), TS-side only.
 *
 * Constrains the builder to a curated, deduplicated set of design tokens
 * instead of letting it invent a new hex value for every slightly
 * different color it sees (e.g. 50 near-identical blues on a Framer page
 * becoming 50 different hex values in the Elementor JSON — token drift,
 * hard to re-brand later).
 *
 * Reuses `OklchColorToken` from `src/analyzer/token-extractor.ts` rather
 * than inventing a third color-token shape (see tokens.contract.ts for the
 * cross-agent reconciliation note). Distance calculation converts OKLCH's
 * polar (C, h) to Cartesian coordinates before taking a Euclidean distance
 * — a plain Euclidean sum over (L, C, h) would let hue (0-360°) dominate
 * over L/C (~0-1) and breaks at the 359°/0° wrap.
 */

import type { OklchColorToken } from '../analyzer/token-extractor.js';
import { rgbToOklch, hexToRgb, type Oklch } from '../analyzer/oklch-converter.js';
import type { TokenConstraintSet, SpacingToken, FontToken, ColorMatch } from '../contracts/tokens.contract.js';

export type { TokenConstraintSet, SpacingToken, FontToken, ColorMatch };

const DEFAULT_MIN_COLOR_FREQUENCY = 2;
const DEFAULT_MAX_SNAP_DISTANCE = 0.1;
const DEFAULT_RADII = [0, 4, 8, 12, 16, 24, 999];
const FALLBACK_SPACING_SCALE: SpacingToken[] = [
  { px: 0, name: 'none' },
  { px: 4, name: 'xs' },
  { px: 8, name: 'sm' },
  { px: 16, name: 'md' },
  { px: 24, name: 'lg' },
  { px: 32, name: 'xl' },
  { px: 48, name: '2xl' },
  { px: 64, name: '3xl' },
];
const SPACING_LABELS = ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'];

/** Euclidean distance between two OKLCH colors, via Cartesian (L, a, b) form. */
function oklchDistance(a: Oklch, b: Oklch): number {
  const hueA = (a.h * Math.PI) / 180;
  const hueB = (b.h * Math.PI) / 180;
  const ax = a.C * Math.cos(hueA);
  const ay = a.C * Math.sin(hueA);
  const bx = b.C * Math.cos(hueB);
  const by = b.C * Math.sin(hueB);
  return Math.sqrt((a.L - b.L) ** 2 + (ax - bx) ** 2 + (ay - by) ** 2);
}

/**
 * Clusters raw spacing values (padding/margin px, as observed on the source
 * page) into a small labeled scale: round to the nearest 4px, keep the most
 * frequent distinct values, sort ascending, always include 0. Falls back to
 * a standard 8-scale when too few distinct values were observed to detect
 * a real pattern.
 */
function detectSpacingScale(rawValuesPx: number[] = []): SpacingToken[] {
  if (rawValuesPx.length === 0) return FALLBACK_SPACING_SCALE;

  const rounded = rawValuesPx.map((v) => Math.round(v / 4) * 4).filter((v) => v >= 0);
  const counts = new Map<number, number>();
  for (const v of rounded) counts.set(v, (counts.get(v) ?? 0) + 1);

  const distinct = Array.from(counts.keys()).sort((a, b) => a - b);
  if (distinct.length < 2) return FALLBACK_SPACING_SCALE;

  const withZero = distinct[0] === 0 ? distinct : [0, ...distinct];
  const top = withZero.slice(0, SPACING_LABELS.length);
  return top.map((px, i) => ({ px, name: SPACING_LABELS[i] ?? `scale-${i}` }));
}

/**
 * Builds a constraint set from extracted tokens: filters out one-off colors
 * (frequency below `minColorFrequency`) so a rare gradient stop doesn't
 * pollute the palette, and derives a spacing scale from observed values.
 */
export function buildConstraintSet(
  colors: OklchColorToken[],
  fonts: FontToken[],
  minColorFrequency = DEFAULT_MIN_COLOR_FREQUENCY,
  rawSpacingValuesPx?: number[],
): TokenConstraintSet {
  const significantColors = colors.filter((c) => c.frequency >= minColorFrequency);
  return {
    colors: significantColors,
    fonts,
    spacing: detectSpacingScale(rawSpacingValuesPx),
    radii: DEFAULT_RADII,
    shadows: [],
  };
}

/**
 * Matches a raw hex color against the constraint set: exact match first,
 * then nearest-by-OKLCH-distance if within `maxSnapDistance`, otherwise no
 * match (the caller must decide whether to allow a new token or warn).
 */
export function enforceColor(
  rawColor: string,
  set: TokenConstraintSet,
  maxSnapDistance = DEFAULT_MAX_SNAP_DISTANCE,
): ColorMatch {
  const rgb = hexToRgb(rawColor);
  if (!rgb) {
    return { token: null, snapped: false, originalHex: rawColor, distance: Infinity };
  }

  const exact = set.colors.find((c) => c.hex.toLowerCase() === rawColor.toLowerCase());
  if (exact) {
    return { token: exact, snapped: false, originalHex: rawColor, distance: 0 };
  }

  const targetOklch = rgbToOklch(rgb);
  let best: OklchColorToken | null = null;
  let bestDistance = Infinity;
  for (const token of set.colors) {
    const distance = oklchDistance(targetOklch, token.oklch);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = token;
    }
  }

  if (best && bestDistance <= maxSnapDistance) {
    return { token: best, snapped: true, originalHex: rawColor, snappedHex: best.hex, distance: bestDistance };
  }

  return { token: null, snapped: false, originalHex: rawColor, distance: bestDistance };
}

const HEX_COLOR_RE = /^#[0-9a-f]{3,8}$/i;

export interface TokenDriftWarning {
  /** The settings key whose value was checked (e.g. "title_color"). */
  key: string;
  originalHex: string;
  snappedHex?: string;
  /** False when no token was close enough to match at all. */
  matched: boolean;
}

/**
 * Walks a flat settings object (as produced by the classifier for one
 * widget) and snaps any hex-color-looking VALUES to the constraint set.
 * Non-color values pass through untouched. Scans by value shape rather
 * than a fixed list of key names (e.g. "title_color") because the real
 * SettingsMap has no single well-known color key across widget types.
 */
export function enforceColorsInSettings(
  settings: Record<string, unknown>,
  set: TokenConstraintSet,
  maxSnapDistance = DEFAULT_MAX_SNAP_DISTANCE,
): { settings: Record<string, unknown>; warnings: TokenDriftWarning[] } {
  const result: Record<string, unknown> = { ...settings };
  const warnings: TokenDriftWarning[] = [];

  for (const [key, value] of Object.entries(settings)) {
    if (typeof value !== 'string' || !HEX_COLOR_RE.test(value)) continue;

    const match = enforceColor(value, set, maxSnapDistance);
    if (match.token) {
      result[key] = match.token.hex;
      if (match.snapped) {
        warnings.push({ key, originalHex: value, snappedHex: match.token.hex, matched: true });
      }
    } else {
      warnings.push({ key, originalHex: value, matched: false });
    }
  }

  return { settings: result, warnings };
}
