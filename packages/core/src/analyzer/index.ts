/**
 * Public re-exports for the Analyzer module (Phase 2.5).
 */

export {
  buildDesignTokens,
  type DesignTokens,
  type DesignTokensInput,
  type DesignTokensOptions,
  type DesignToken,
} from './design-token-extractor.js';

export {
  extractColorFrequency,
  clusterColors,
  assignSemanticNames,
  buildFrequencyLookup,
  toHex,
  hexToRgb,
  hexDistance,
  luminance,
  saturation,
  COLOR_PROPS,
  type StyleNode,
  type ColorCluster,
  type SemanticColors,
} from './color-extractor.js';

export {
  extractFontTokens,
  mostCommon,
  resolveSource,
  HEADING_TAGS,
  BODY_TAGS,
  type FontTokens,
  // Aliased: the analyzer's font-extraction token {family:string|null; weights:number[]; source}
  // differs from the contracts' FontToken {family:string; weight?:number}. Both must
  // coexist in the @elconv/core barrel, so the analyzer one is re-exported as ExtractedFontToken.
  type FontToken as ExtractedFontToken,
  type FontDetected,
} from './font-token-extractor.js';

export {
  extractSpacingTokens,
  parsePx,
  median,
  mode,
  type SpacingTokens,
} from './spacing-extractor.js';

// V2 Phase 6: oklch-Converter
export {
  rgbToOklch,
  oklchToRgb,
  oklchRoundTripDelta,
  formatOklchCss,
  parseOklch,
  hexToRgb as oklchHexToRgb,
  rgbToHex as oklchRgbToHex,
  srgbToLinear,
  linearToSrgb,
  linearRgbToOklab,
  oklabToLinearRgb,
  oklabToOklch,
  oklchToOklab,
  clamp,
  type Rgb,
  type Oklab,
  type Oklch,
} from './oklch-converter.js';

// V2 Phase 6: Token-Extractor (oklch-aware colors + shadows + radii + type-scale)
export {
  extractTokens,
  extractOklchColorTokens,
  extractShadowTokens,
  extractRadiusTokens,
  extractTypeScaleTokens,
  detectTokenSource,
  parseBoxShadow,
  bucketize,
  bucketizeBy,
  type ExtractedTokens,
  type TokenExtractionOptions,
  type OklchColorToken,
  type ShadowToken,
  type RadiusToken,
  type TypeScaleToken,
} from './token-extractor.js';

// V2 Phase 6: Token-Resolver (semantic role → resolved hex/rgb/oklch + provenance)
export {
  resolveToken,
  resolveAll,
  resolvedHex,
  resolvedRgb,
  resolvedOklchCss,
  sourceOf,
  buildCustomCssForTokens,
  normalizeRoleName,
  findExtractedForRole,
  type ResolvedToken,
  type ResolverContext,
  type TokenSource,
} from './token-resolver.js';

// V2 Phase 6: Theme-Detector (light/dark/auto)
export {
  detectTheme,
  detectFromDataAttribute,
  detectFromClassList,
  detectFromMediaQuery,
  buildThemeConditionalCss,
  DEFAULT_THEME_ATTRIBUTES,
  DEFAULT_DARK_CLASSES,
  type ThemeMode,
  type ThemeDetection,
  type ThemeDetectorOptions,
} from './theme-detector.js';
