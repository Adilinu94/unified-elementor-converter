/**
 * design-tokens-adapter.ts — bridges the pipeline's real extraction output
 * (`DesignTokens`, from analyzer/design-token-extractor.ts — since Phase 5
 * point 1, this is shared-schemas/design-tokens.ts's `DesignTokenSet` shape:
 * an array of tokens, each optionally carrying a semantic `role`) into the
 * shape S1's buildConstraintSet() expects (`OklchColorToken[]` / `FontToken[]`,
 * from token-constraint.ts / tokens.contract.ts).
 *
 * Adapter approach chosen over running token-extractor.ts's extractTokens()
 * as a second extraction pass: converts only the already-extracted color/
 * font tokens, not a full raw re-extraction. No rawSpacingValuesPx is
 * passed — the extractor's size tokens are two scalars (section-padding,
 * container-width), not a sample bag suitable for detectSpacingScale(), so
 * the fallback 8-step scale in buildConstraintSet is used instead.
 */
import type { DesignTokens } from '../analyzer/design-token-extractor.js';
import type { OklchColorToken } from '../analyzer/token-extractor.js';
import { hexToRgb, rgbToOklch, formatOklchCss } from '../analyzer/oklch-converter.js';
import { buildConstraintSet, type TokenConstraintSet, type FontToken } from './token-constraint.js';

function colorTokenToOklch(hex: string, occurrences: number, cssVar: string | null): OklchColorToken | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const oklch = rgbToOklch(rgb);
  return { hex, rgb, oklch, oklchCss: formatOklchCss(oklch), frequency: occurrences, cssVar };
}

export function designTokensToConstraintSet(tokens: DesignTokens): TokenConstraintSet {
  const colors: OklchColorToken[] = [];
  for (const token of tokens.colors) {
    if (!token.hex) continue;
    const converted = colorTokenToOklch(token.hex, token.occurrences, token.css_var ?? null);
    if (converted) colors.push(converted);
  }

  const fonts: FontToken[] = [];
  for (const token of tokens.fonts) {
    if (!token.family) continue;
    fonts.push(token.weight !== undefined ? { family: token.family, weight: token.weight } : { family: token.family });
  }

  return buildConstraintSet(colors, fonts);
}
