/**
 * Design-Token-Extractor (Phase 2.5 — orchestrator).
 *
 * Combines color-extractor, font-token-extractor, spacing-extractor
 * into a single DesignTokenSet consumed by:
 *   - Phase 5 (V3 Design-System-Sync)
 *   - Wizard Step 7 (Design-Token-Review)
 *
 * Pure function — no Playwright, no I/O. Inputs are the JSON files
 * produced by Sprint 2A-2C extractor stages.
 *
 * Based on BAUPLAN §Phase 2.5. Produces the shared-schemas/design-tokens.ts
 * shape (Phase 5 point 1) — see that file for why it's an array of tokens
 * rather than the old fixed-role record, and for the framer-v4-pipeline-v2
 * side of this shared shape.
 */

import {
  extractColorFrequency,
  clusterColors,
  assignSemanticNames,
  buildFrequencyLookup,
  type StyleNode,
  type SemanticColors,
} from './color-extractor.js';
import {
  extractFontTokens,
  type FontDetected,
} from './font-token-extractor.js';
import { extractSpacingTokens } from './spacing-extractor.js';
// The design-token shared schema (DesignToken/DesignTokenSet/SemanticRole) is
// canonically defined in @elconv/core (packages/core/src/types.ts). Import from
// there instead of the source repo's shared-schemas/ path — same shape, no dup.
import type { DesignToken, DesignTokenSet, SemanticRole } from '../types.js';

export interface DesignTokensInput {
  /** Output of styles.json: map viewport-label -> StyleNode[]. */
  styles: StyleNode[];
  /** Output of css-variables.json: --custom-prop -> resolved value. */
  cssVariables: Record<string, string>;
  /** Output of fonts-detected.json: intercepted font URLs. */
  fontsDetected: FontDetected[];
  /** Source URL (for context in output). */
  sourceUrl: string;
}

/** design-tokens.json: DesignTokenSet fields directly at top level, plus extraction metadata. */
export interface DesignTokens extends DesignTokenSet {
  $schema: string;
  source_url: string;
  extracted_at: string;
  user_overrides: Record<string, unknown>;
}

export interface DesignTokensOptions {
  maxColorClusters?: number;
  clusterThreshold?: number;
  minSectionHeightPx?: number;
}

// Canonical schema lives in WordPress_mcp_adrian/schemas/design-tokens.v1.schema.json
// (shared across all three pipeline repos). urn: identifier, not a fetchable URL —
// the schema file itself isn't hosted anywhere live, it's a checked-in reference copy.
const DEFAULT_SCHEMA = 'urn:novamira:design-tokens:v1';

const COLOR_ROLES: (keyof SemanticColors)[] = [
  'primary', 'secondary', 'background', 'surface', 'text', 'text-muted', 'border', 'accent',
];

/** Build a complete design-tokens.json from extractor outputs. */
export function buildDesignTokens(
  input: DesignTokensInput,
  options: DesignTokensOptions = {},
): DesignTokens {
  const maxClusters = options.maxColorClusters ?? 20;
  const clusterThreshold = options.clusterThreshold ?? 15;
  const minSectionHeightPx = options.minSectionHeightPx ?? 400;

  // 1) Color frequency
  const freq = extractColorFrequency(input.styles);

  // 2) Cluster
  const clusters = clusterColors(freq, {
    maxClusters,
    clusterThreshold,
  });

  // 3) Semantic names
  const semantic = assignSemanticNames(clusters, input.cssVariables);

  // 4) Build a lookup {hex -> count} for the output
  const lookup = buildFrequencyLookup(freq);

  // 5) Map semantic roles -> DesignToken[] (with frequency + css-var hint)
  const cssVarHints = trackCssVarHints(input.cssVariables);
  const colors = mapSemanticToTokens(semantic, lookup, cssVarHints);

  // 6) Fonts -> DesignToken[] (one entry per role that has a family, weight
  //    omitted since a role can have several — see file header trade-off note)
  const fontTokens = extractFontTokens(input.styles, input.fontsDetected);
  const fonts: DesignToken[] = [];
  for (const role of ['heading', 'body'] as const) {
    const f = fontTokens[role];
    if (f.family) {
      fonts.push({
        id: role,
        family: f.family,
        occurrences: 0,
        gv_id: null,
        role,
      });
    }
  }

  // 7) Spacing -> DesignToken[] (2 scalars, no per-value frequency tracked)
  const spacingTokens = extractSpacingTokens(input.styles, {
    minHeightPx: minSectionHeightPx,
  });
  const sizes: DesignToken[] = [
    { id: 'section-padding', px: spacingTokens.sectionPadding, occurrences: 0, gv_id: null },
    { id: 'container-width', px: spacingTokens.containerWidth, occurrences: 0, gv_id: null },
  ];

  return {
    $schema: DEFAULT_SCHEMA,
    source_url: input.sourceUrl,
    extracted_at: new Date().toISOString(),
    colors,
    fonts,
    sizes,
    user_overrides: {},
  };
}

/** Track which CSS-var matched which semantic role. */
function trackCssVarHints(
  cssVars: Record<string, string>,
): Record<keyof SemanticColors, string | null> {
  const out: Record<keyof SemanticColors, string | null> = {
    primary: null,
    secondary: null,
    background: null,
    surface: null,
    text: null,
    'text-muted': null,
    border: null,
    accent: null,
  };
  for (const [varName] of Object.entries(cssVars)) {
    const ln = varName.toLowerCase();
    if (/primary|brand|cta/.test(ln) && !out.primary) out.primary = varName;
    else if (/secondary/.test(ln) && !out.secondary) out.secondary = varName;
    else if (/background|\bbg\b(?!-)/.test(ln) && !out.background) out.background = varName;
    else if (/surface|card|panel/.test(ln) && !out.surface) out.surface = varName;
    else if (/text(?!-)/.test(ln) && !out.text) out.text = varName;
    else if (/muted|subtle|placeholder/.test(ln) && !out['text-muted']) out['text-muted'] = varName;
    else if (/border|divider|separator/.test(ln) && !out.border) out.border = varName;
    else if (/accent/.test(ln) && !out.accent) out.accent = varName;
  }
  return out;
}

/** Map {role: hex|null} -> DesignToken[] (skips roles with no detected color). */
function mapSemanticToTokens(
  semantic: SemanticColors,
  freq: Record<string, number>,
  cssVarHints: Record<keyof SemanticColors, string | null>,
): DesignToken[] {
  const out: DesignToken[] = [];
  for (const role of COLOR_ROLES) {
    const hex = semantic[role];
    if (!hex) continue;
    out.push({
      id: role,
      hex,
      occurrences: freq[hex] ?? 0,
      gv_id: null,
      css_var: cssVarHints[role],
      role: role as SemanticRole,
    });
  }
  return out;
}

/** Re-export of types and primitives for convenience. */
export type { StyleNode, ColorCluster, SemanticColors } from './color-extractor.js';
export type { FontTokens, FontToken, FontDetected } from './font-token-extractor.js';
export type { SpacingTokens } from './spacing-extractor.js';
export type { DesignToken, DesignTokenSet, SemanticRole } from '../types.js';
