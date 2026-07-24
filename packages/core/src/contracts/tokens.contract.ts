/**
 * tokens.contract.ts — Design-Token Constraint System API.
 *
 * Portiert aus site-clone-to-v3/src/contracts/tokens.contract.ts.
 * Monorepo-Anpassung: `Rgb`/`Oklch`/`OklchColorToken` werden hier KANONISCH
 * definiert (statt aus analyzer/token-extractor importiert). Der Analyzer
 * (Phase 36) importiert diese Typen aus @elconv/core (Contracts-First,
 * Portierungs-Regel 4). Die Shapes stammen 1:1 aus
 * site-clone-to-v3/src/analyzer/oklch-converter.ts + token-extractor.ts.
 */

/** sRGB-Farbe, Kanäle 0..255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Oklch-Farbe (perceptual uniform): L 0..1, C 0..0.4, h 0..360. */
export interface Oklch {
  L: number;
  C: number;
  h: number;
}

/** Ein aus der Analyse gewonnenes Farb-Token (hex + rgb + oklch + Metadaten). */
export interface OklchColorToken {
  hex: string;
  rgb: Rgb;
  oklch: Oklch;
  oklchCss: string;
  frequency: number;
  cssVar: string | null;
}

export interface SpacingToken {
  px: number;
  name?: string;
}

export interface FontToken {
  family: string;
  weight?: number;
}

export interface TokenConstraintSet {
  colors: OklchColorToken[];
  spacing: SpacingToken[];
  radii: number[];
  shadows: string[];
  fonts: FontToken[];
}

export interface ColorMatch {
  token: OklchColorToken | null;
  snapped: boolean;
  originalHex: string;
  snappedHex?: string;
  distance: number;
}

export type EnforceColorFn = (
  rawColor: string,
  set: TokenConstraintSet,
  maxSnapDistance?: number,
) => ColorMatch;

export type BuildConstraintSetFn = (
  colors: OklchColorToken[],
  fonts: FontToken[],
  minColorFrequency?: number,
  rawSpacingValuesPx?: number[],
) => TokenConstraintSet;
