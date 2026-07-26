/**
 * Token Pipeline — Framer → Kit + Fonts + WPCode (Phase 66).
 *
 * Takes Framer ColorStyles + TextStyles and produces three artifacts:
 * 1. Elementor Kit-Colors (via MCP set-active-kit)
 * 2. Fonts-Plugin entries (via MCP register-google-font)
 * 3. WPCode Font-Link snippet (via wpcode-helper)
 *
 * Reduces token setup from ~45 min manual to 1 script call.
 *
 * @module core/token-pipeline
 */

// ============================================================================
// Types
// ============================================================================

export interface FramerColorStyle {
  id: string;
  name: string;
  value: string; // hex or rgba
}

export interface FramerTextStyle {
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
}

export interface TokenPipelineInput {
  colorStyles: FramerColorStyle[];
  textStyles: FramerTextStyle[];
  /** Google Fonts base URL for link generation. */
  fontsBaseUrl?: string;
}

export interface KitColor {
  id: string;
  title: string;
  color: string;
}

export interface KitTypography {
  id: string;
  title: string;
  fontFamily: string;
  fontSize: { size: number; unit: string };
  fontWeight: string;
  lineHeight: { size: number; unit: string };
  letterSpacing: { size: number; unit: string };
}

export interface FontRegistration {
  family: string;
  weights: number[];
  googleFontsUrl: string;
}

export interface TokenPipelineOutput {
  kitColors: KitColor[];
  kitTypography: KitTypography[];
  fontRegistrations: FontRegistration[];
  wpcodeFontLink: string;
  mcpCalls: Array<{ ability: string; params: Record<string, unknown> }>;
  summary: {
    totalColors: number;
    totalTextStyles: number;
    uniqueFonts: number;
    estimatedSetupTimeSaved: string;
  };
}

// ============================================================================
// Pipeline
// ============================================================================

/**
 * Run the full token pipeline: Framer tokens → Elementor Kit + Fonts + WPCode.
 */
export function runTokenPipeline(input: TokenPipelineInput): TokenPipelineOutput {
  const kitColors = buildKitColors(input.colorStyles);
  const kitTypography = buildKitTypography(input.textStyles);
  const fontRegistrations = buildFontRegistrations(input.textStyles, input.fontsBaseUrl);
  const wpcodeFontLink = buildFontLinkSnippet(fontRegistrations);
  const mcpCalls = buildMcpCalls(kitColors, kitTypography, fontRegistrations, wpcodeFontLink);

  const uniqueFonts = new Set(input.textStyles.map((t) => t.fontFamily)).size;

  return {
    kitColors,
    kitTypography,
    fontRegistrations,
    wpcodeFontLink,
    mcpCalls,
    summary: {
      totalColors: kitColors.length,
      totalTextStyles: kitTypography.length,
      uniqueFonts,
      estimatedSetupTimeSaved: '~45 min → 1 call',
    },
  };
}

// ============================================================================
// Builders
// ============================================================================

function buildKitColors(colorStyles: FramerColorStyle[]): KitColor[] {
  return colorStyles.map((cs) => ({
    id: `color_${cs.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`,
    title: cs.name,
    color: cs.value,
  }));
}

function buildKitTypography(textStyles: FramerTextStyle[]): KitTypography[] {
  return textStyles.map((ts) => ({
    id: `typo_${ts.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`,
    title: ts.name,
    fontFamily: ts.fontFamily,
    fontSize: { size: ts.fontSize, unit: 'px' },
    fontWeight: String(ts.fontWeight),
    lineHeight: { size: ts.lineHeight, unit: 'px' },
    letterSpacing: { size: ts.letterSpacing, unit: 'px' },
  }));
}

function buildFontRegistrations(
  textStyles: FramerTextStyle[],
  baseUrl = 'https://fonts.googleapis.com/css2',
): FontRegistration[] {
  const fontMap = new Map<string, Set<number>>();

  for (const ts of textStyles) {
    const weights = fontMap.get(ts.fontFamily) ?? new Set();
    weights.add(ts.fontWeight);
    fontMap.set(ts.fontFamily, weights);
  }

  const registrations: FontRegistration[] = [];
  for (const [family, weights] of fontMap) {
    const sortedWeights = [...weights].sort((a, b) => a - b);
    const familyParam = family.replace(/\s+/g, '+');
    const weightParam = sortedWeights.join(';');
    registrations.push({
      family,
      weights: sortedWeights,
      googleFontsUrl: `${baseUrl}?family=${familyParam}:wght@${weightParam}&display=swap`,
    });
  }

  return registrations;
}

function buildFontLinkSnippet(registrations: FontRegistration[]): string {
  const preconnect = `<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`;
  const links = registrations.map((r) => `<link href="${r.googleFontsUrl}" rel="stylesheet">`);
  return `${preconnect}\n${links.join('\n')}`;
}

// ============================================================================
// MCP Call generation
// ============================================================================

function buildMcpCalls(
  kitColors: KitColor[],
  kitTypography: KitTypography[],
  fontRegistrations: FontRegistration[],
  wpcodeFontLink: string,
): Array<{ ability: string; params: Record<string, unknown> }> {
  const calls: Array<{ ability: string; params: Record<string, unknown> }> = [];

  // 1. Set Kit Colors
  calls.push({
    ability: 'novamira-adrianv2/set-active-kit',
    params: {
      section: 'colors',
      values: kitColors.map((c) => ({ id: c.id, title: c.title, color: c.color })),
    },
  });

  // 2. Set Kit Typography
  calls.push({
    ability: 'novamira-adrianv2/set-active-kit',
    params: {
      section: 'typography',
      values: kitTypography.map((t) => ({
        id: t.id,
        title: t.title,
        typography_typography: 'custom',
        typography_font_family: t.fontFamily,
        typography_font_size: t.fontSize,
        typography_font_weight: t.fontWeight,
        typography_line_height: t.lineHeight,
        typography_letter_spacing: t.letterSpacing,
      })),
    },
  });

  // 3. Register Google Fonts
  for (const reg of fontRegistrations) {
    calls.push({
      ability: 'novamira-adrianv2/register-google-font',
      params: { family: reg.family, weights: reg.weights },
    });
  }

  // 4. Create WPCode font-link snippet
  calls.push({
    ability: 'novamira-adrianv2/create-wpcode-snippet',
    params: {
      title: 'Elconv Google Fonts',
      code: wpcodeFontLink,
      code_type: 'html',
      location: 'site_wide_header',
      status: 'active',
      tags: ['elconv', 'fonts'],
      // NOTE: priority intentionally omitted
    },
  });

  return calls;
}
