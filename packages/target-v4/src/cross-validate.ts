/**
 * V4 Cross-Validation (Phase 53).
 * Compares MCP-extracted tokens against local Framer CSS export
 * to detect discrepancies before build.
 * Ported from Framer-to-Elementor-V4-Pipeline/scripts/cross-validate-sources.ts
 */

// ============================================================================
// Types
// ============================================================================

export interface MCPColor {
  name?: string;
  label?: string;
  id?: string;
  hex?: string;
  value?: string;
  color?: string;
  path?: string;
}

export interface MCPFont {
  selector?: string;
  name?: string;
  family?: string;
  weight?: number;
}

export interface MCPData {
  colors?: MCPColor[];
  fonts?: MCPFont[];
  breakpoints?: Partial<Record<string, number>>;
}

export type CrossValidationCheckType =
  | 'COLOR_MATCH'
  | 'COLOR_MISMATCH'
  | 'COLOR_MISSING_IN_EXPORT'
  | 'FONT_MATCH'
  | 'FONT_MISMATCH'
  | 'FONT_MISSING_IN_EXPORT'
  | 'BREAKPOINT_MATCH'
  | 'BREAKPOINT_MISMATCH';

export interface CrossValidationResult {
  check: CrossValidationCheckType;
  token: string;
  mcp_value: string | null;
  export_value: string | null;
  result: 'MATCH' | 'MISMATCH' | 'MISSING_IN_EXPORT';
  note?: string;
}

export interface CrossValidationReport {
  meta: {
    generatedAt: string;
    mcpSource: string;
    exportSource: string;
    totalChecks: number;
    matches: number;
    mismatches: number;
    missing: number;
  };
  results: CrossValidationResult[];
  summary: {
    colorAccuracy: string;
    fontAccuracy: string;
    breakpointAccuracy: string;
    overallScore: number;
  };
}

// ============================================================================
// Color Normalization
// ============================================================================

/**
 * Normalize a color value to lowercase 6-digit hex.
 */
export function normalizeColorHex(value: string | null | undefined): string | null {
  if (!value) return null;
  let hex = value.trim().toLowerCase();

  // Already hex
  if (hex.startsWith('#')) {
    hex = hex.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    return hex.length === 6 ? `#${hex}` : null;
  }

  // rgb/rgba
  const rgbMatch = hex.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  return null;
}

// ============================================================================
// Cross-Validation
// ============================================================================

/**
 * Cross-validate MCP colors against export CSS colors.
 */
export function crossValidateColors(
  mcpColors: MCPColor[],
  exportColors: Map<string, string>,
): CrossValidationResult[] {
  const results: CrossValidationResult[] = [];

  for (const mcpColor of mcpColors) {
    const token = mcpColor.name || mcpColor.label || mcpColor.id || 'unknown';
    const mcpHex = normalizeColorHex(mcpColor.hex || mcpColor.value || mcpColor.color);
    const path = mcpColor.path || token;

    const exportValue = exportColors.get(path) || exportColors.get(token);
    const exportHex = normalizeColorHex(exportValue);

    if (!exportValue) {
      results.push({
        check: 'COLOR_MISSING_IN_EXPORT',
        token,
        mcp_value: mcpHex,
        export_value: null,
        result: 'MISSING_IN_EXPORT',
        note: `Color token "${token}" not found in export CSS`,
      });
    } else if (mcpHex === exportHex) {
      results.push({
        check: 'COLOR_MATCH',
        token,
        mcp_value: mcpHex,
        export_value: exportHex,
        result: 'MATCH',
      });
    } else {
      results.push({
        check: 'COLOR_MISMATCH',
        token,
        mcp_value: mcpHex,
        export_value: exportHex,
        result: 'MISMATCH',
        note: `MCP: ${mcpHex}, Export: ${exportHex}`,
      });
    }
  }

  return results;
}

/**
 * Cross-validate MCP fonts against export CSS fonts.
 */
export function crossValidateFonts(
  mcpFonts: MCPFont[],
  exportFonts: Set<string>,
): CrossValidationResult[] {
  const results: CrossValidationResult[] = [];

  for (const mcpFont of mcpFonts) {
    const token = mcpFont.family || mcpFont.name || 'unknown';
    const normalizedToken = token.toLowerCase().replace(/["']/g, '');

    if (exportFonts.has(normalizedToken)) {
      results.push({
        check: 'FONT_MATCH',
        token,
        mcp_value: token,
        export_value: token,
        result: 'MATCH',
      });
    } else {
      results.push({
        check: 'FONT_MISSING_IN_EXPORT',
        token,
        mcp_value: token,
        export_value: null,
        result: 'MISSING_IN_EXPORT',
        note: `Font "${token}" not found in export CSS @font-face rules`,
      });
    }
  }

  return results;
}

/**
 * Cross-validate MCP breakpoints against export CSS media queries.
 */
export function crossValidateBreakpoints(
  mcpBreakpoints: Partial<Record<string, number>>,
  exportBreakpoints: Set<number>,
): CrossValidationResult[] {
  const results: CrossValidationResult[] = [];

  for (const [label, value] of Object.entries(mcpBreakpoints)) {
    if (value == null) continue;

    if (exportBreakpoints.has(value)) {
      results.push({
        check: 'BREAKPOINT_MATCH',
        token: label,
        mcp_value: `${value}px`,
        export_value: `${value}px`,
        result: 'MATCH',
      });
    } else {
      // Check for close match (±10px tolerance)
      const closeMatch = [...exportBreakpoints].find((bp) => Math.abs(bp - value) <= 10);
      if (closeMatch) {
        results.push({
          check: 'BREAKPOINT_MISMATCH',
          token: label,
          mcp_value: `${value}px`,
          export_value: `${closeMatch}px`,
          result: 'MISMATCH',
          note: `Close match: MCP ${value}px vs Export ${closeMatch}px`,
        });
      } else {
        results.push({
          check: 'BREAKPOINT_MISMATCH',
          token: label,
          mcp_value: `${value}px`,
          export_value: null,
          result: 'MISSING_IN_EXPORT',
          note: `Breakpoint ${value}px not found in export CSS`,
        });
      }
    }
  }

  return results;
}

// ============================================================================
// Main Cross-Validation
// ============================================================================

/**
 * Run full cross-validation between MCP data and export CSS.
 */
export function crossValidate(
  mcpData: MCPData,
  exportColors: Map<string, string>,
  exportFonts: Set<string>,
  exportBreakpoints: Set<number>,
  sources: { mcp: string; export: string },
): CrossValidationReport {
  const colorResults = crossValidateColors(mcpData.colors ?? [], exportColors);
  const fontResults = crossValidateFonts(mcpData.fonts ?? [], exportFonts);
  const breakpointResults = crossValidateBreakpoints(mcpData.breakpoints ?? {}, exportBreakpoints);

  const allResults = [...colorResults, ...fontResults, ...breakpointResults];

  const matches = allResults.filter((r) => r.result === 'MATCH').length;
  const mismatches = allResults.filter((r) => r.result === 'MISMATCH').length;
  const missing = allResults.filter((r) => r.result === 'MISSING_IN_EXPORT').length;

  const colorMatches = colorResults.filter((r) => r.result === 'MATCH').length;
  const fontMatches = fontResults.filter((r) => r.result === 'MATCH').length;
  const bpMatches = breakpointResults.filter((r) => r.result === 'MATCH').length;

  const overallScore = allResults.length > 0
    ? Math.round((matches / allResults.length) * 100)
    : 100;

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      mcpSource: sources.mcp,
      exportSource: sources.export,
      totalChecks: allResults.length,
      matches,
      mismatches,
      missing,
    },
    results: allResults,
    summary: {
      colorAccuracy: colorResults.length > 0 ? `${Math.round((colorMatches / colorResults.length) * 100)}%` : 'N/A',
      fontAccuracy: fontResults.length > 0 ? `${Math.round((fontMatches / fontResults.length) * 100)}%` : 'N/A',
      breakpointAccuracy: breakpointResults.length > 0 ? `${Math.round((bpMatches / breakpointResults.length) * 100)}%` : 'N/A',
      overallScore,
    },
  };
}

/**
 * Parse CSS string to extract colors, fonts, and breakpoints for cross-validation.
 */
export function parseExportCss(css: string): {
  colors: Map<string, string>;
  fonts: Set<string>;
  breakpoints: Set<number>;
} {
  const colors = new Map<string, string>();
  const fonts = new Set<string>();
  const breakpoints = new Set<number>();

  // Extract CSS variables (colors)
  const varRe = /--([a-zA-Z0-9_-]+)\s*:\s*(#[0-9a-fA-F]{3,6}|rgba?\([^)]+\))/g;
  let varMatch: RegExpExecArray | null;
  while ((varMatch = varRe.exec(css)) !== null) {
    colors.set(varMatch[1], varMatch[2]);
  }

  // Extract @font-face families
  const fontFaceRe = /@font-face\s*\{[^}]*font-family\s*:\s*["']?([^;"']+)["']?/g;
  let fontMatch: RegExpExecArray | null;
  while ((fontMatch = fontFaceRe.exec(css)) !== null) {
    fonts.add(fontMatch[1].trim().toLowerCase());
  }

  // Extract media query breakpoints
  const mediaRe = /@media[^{]*\(\s*(?:max|min)-width\s*:\s*(\d+)px\s*\)/g;
  let mediaMatch: RegExpExecArray | null;
  while ((mediaMatch = mediaRe.exec(css)) !== null) {
    breakpoints.add(parseInt(mediaMatch[1], 10));
  }

  return { colors, fonts, breakpoints };
}
