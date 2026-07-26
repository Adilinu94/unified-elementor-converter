/**
 * Font-Token-Extractor (Phase 2.5).
 *
 * Heuristik:
 *   - Heading-Font: most common font-family on h1/h2/h3 elements
 *   - Body-Font: most common on p/span/li/a elements
 *   - Mono-Font: detected on <code> or font-family containing 'mono'
 *   - Weights: unique values from same element group
 *   - Source: from intercepted font URLs (google-fonts vs custom-woff2 vs system)
 *
 * Based on BAUPLAN §Phase 2.5 Step 4.
 */

import type { StyleNode } from './color-extractor.js';

export interface FontDetected {
  url: string;
  type: string;
  family?: string;
  weight?: number;
  style?: 'normal' | 'italic';
}

export interface FontToken {
  family: string | null;
  weights: number[];
  source: 'google-fonts' | 'custom-woff2' | 'system' | null;
}

export interface FontTokens {
  heading: FontToken;
  body: FontToken;
  mono: FontToken;
}

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const BODY_TAGS = new Set(['P', 'SPAN', 'LI', 'A', 'BUTTON', 'INPUT', 'TEXTAREA']);

export { HEADING_TAGS, BODY_TAGS };

/** Most common value in an array. */
export function mostCommon<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  const freq: Record<string, number> = {};
  for (const v of arr) {
    const k = String(v);
    freq[k] = (freq[k] ?? 0) + 1;
  }
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  return (sorted[0]?.[0] as T) ?? null;
}

/** Resolve the source of a font family from intercepted font URLs. */
export function resolveSource(
  family: string | null,
  intercepted: FontDetected[],
): 'google-fonts' | 'custom-woff2' | 'system' {
  if (!family) return 'system';
  const match = intercepted.find(
    (f) => f.family === family || f.url.toLowerCase().includes(encodeURIComponent(family.toLowerCase())),
  );
  if (!match) return 'system';
  if (match.url.includes('fonts.googleapis.com') || match.url.includes('fonts.gstatic.com')) {
    return 'google-fonts';
  }
  return 'custom-woff2';
}

/** Extract heading/body/mono font tokens from styles + intercepted fonts. */
export function extractFontTokens(
  styles: StyleNode[],
  fontsDetected: FontDetected[],
): FontTokens {
  // HEADING: most common font-family on H1-H6
  const headingFamilies = styles
    .filter((n) => HEADING_TAGS.has(n.tag.toUpperCase()))
    .map((n) => n.styles['font-family'])
    .filter(Boolean);
  const headingWeights = styles
    .filter((n) => HEADING_TAGS.has(n.tag.toUpperCase()))
    .map((n) => parseInt(n.styles['font-weight'] ?? '400', 10))
    .filter((w) => !isNaN(w) && w >= 100 && w <= 900);
  const headingFamily = mostCommon(headingFamilies);
  const headingWeightList = [...new Set(headingWeights)].sort((a, b) => a - b);

  // BODY: most common on p/span/li/a
  const bodyFamilies = styles
    .filter((n) => BODY_TAGS.has(n.tag.toUpperCase()))
    .map((n) => n.styles['font-family'])
    .filter(Boolean);
  const bodyWeights = styles
    .filter((n) => BODY_TAGS.has(n.tag.toUpperCase()))
    .map((n) => parseInt(n.styles['font-weight'] ?? '400', 10))
    .filter((w) => !isNaN(w) && w >= 100 && w <= 900);
  const bodyFamily = mostCommon(bodyFamilies);
  const bodyWeightList = [...new Set(bodyWeights)].sort((a, b) => a - b);

  // MONO: on code/pre, or family name contains 'mono'
  const monoFamilies = styles
    .filter((n) => {
      const tag = n.tag.toUpperCase();
      if (tag === 'CODE' || tag === 'PRE' || tag === 'KBD' || tag === 'SAMP') return true;
      const family = n.styles['font-family'] ?? '';
      return /mono|code|consolas|courier/i.test(family);
    })
    .map((n) => n.styles['font-family'])
    .filter(Boolean);
  const monoFamily = mostCommon(monoFamilies);
  const monoWeights = styles
    .filter((n) => {
      const family = n.styles['font-family'] ?? '';
      return monoFamily && family === monoFamily;
    })
    .map((n) => parseInt(n.styles['font-weight'] ?? '400', 10))
    .filter((w) => !isNaN(w) && w >= 100 && w <= 900);

  return {
    heading: {
      family: headingFamily,
      weights: headingWeightList,
      source: resolveSource(headingFamily, fontsDetected),
    },
    body: {
      family: bodyFamily,
      weights: bodyWeightList,
      source: resolveSource(bodyFamily, fontsDetected),
    },
    mono: {
      family: monoFamily,
      weights: [...new Set(monoWeights)].sort((a, b) => a - b),
      source: resolveSource(monoFamily, fontsDetected),
    },
  };
}
