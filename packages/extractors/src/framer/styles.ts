/**
 * Framer Style Extraction (Phase 51).
 * Extracts comprehensive style information from Framer HTML/CSS
 * including layout, spacing, colors, typography, and effects.
 * Ported from Framer-to-Elementor-V4-Pipeline/scripts/extract-framer-styles.ts
 */

// ============================================================================
// Types
// ============================================================================

export interface StyleDeclaration {
  property: string;
  value: string;
  important: boolean;
}

export interface StyleRule {
  selector: string;
  declarations: StyleDeclaration[];
  media?: string;
  specificity: number;
}

export interface ComputedElementStyle {
  selector: string;
  tag: string;
  classes: string[];
  styles: Record<string, string>;
  framerName?: string;
}

export interface LayoutStyle {
  display: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  gap?: string;
  padding?: string;
  margin?: string;
}

export interface TypographyStyle {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing?: string;
  textAlign?: string;
  color?: string;
}

export interface EffectStyle {
  boxShadow?: string;
  borderRadius?: string;
  opacity?: string;
  backdropFilter?: string;
  filter?: string;
}

export interface ElementStyleBundle {
  selector: string;
  layout: LayoutStyle;
  typography?: TypographyStyle;
  effects?: EffectStyle;
  background?: string;
  border?: string;
}

export interface StylesOutput {
  meta: {
    generatedAt: string;
    source: string;
    totalRules: number;
    totalElements: number;
  };
  rules: StyleRule[];
  elements: ComputedElementStyle[];
}

// ============================================================================
// CSS Parsing
// ============================================================================

/**
 * Parse CSS string into structured rules.
 */
export function parseCssRules(css: string): StyleRule[] {
  const rules: StyleRule[] = [];

  // First, extract non-media rules
  const cssWithoutMedia = css.replace(/@media[^{]+\{([\s\S]*?)\}\s*\}/g, (full, inner) => {
    const mediaQuery = full.match(/@media([^{]+)\{/)?.[1]?.trim() || '';
    const innerRules = parseRuleBlock(inner, mediaQuery);
    rules.push(...innerRules);
    return '';
  });

  // Parse remaining rules
  const regularRules = parseRuleBlock(cssWithoutMedia);
  rules.push(...regularRules);

  return rules;
}

function parseRuleBlock(css: string, media?: string): StyleRule[] {
  const rules: StyleRule[] = [];
  const ruleRe = /([^{}@]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRe.exec(css)) !== null) {
    const selector = match[1].trim();
    const body = match[2].trim();

    if (!selector || selector.startsWith('@')) continue;

    const declarations = parseDeclarations(body);
    if (declarations.length === 0) continue;

    rules.push({
      selector,
      declarations,
      media,
      specificity: calculateSpecificity(selector),
    });
  }

  return rules;
}

function parseDeclarations(body: string): StyleDeclaration[] {
  const declarations: StyleDeclaration[] = [];
  const declRe = /([a-zA-Z-]+)\s*:\s*([^;]+);?/g;
  let match: RegExpExecArray | null;

  while ((match = declRe.exec(body)) !== null) {
    const property = match[1].trim();
    let value = match[2].trim();
    const important = value.includes('!important');
    if (important) value = value.replace(/\s*!important\s*/, '').trim();

    declarations.push({ property, value, important });
  }

  return declarations;
}

function calculateSpecificity(selector: string): number {
  let specificity = 0;
  // IDs
  specificity += (selector.match(/#[a-zA-Z0-9_-]+/g) || []).length * 100;
  // Classes, attributes, pseudo-classes
  specificity += (selector.match(/\.[a-zA-Z0-9_-]+/g) || []).length * 10;
  specificity += (selector.match(/\[[^\]]+\]/g) || []).length * 10;
  specificity += (selector.match(/:[a-zA-Z-]+/g) || []).length * 10;
  // Elements
  specificity += (selector.match(/^[a-zA-Z]+|[\s>+~][a-zA-Z]+/g) || []).length;
  return specificity;
}

// ============================================================================
// Style Extraction
// ============================================================================

/**
 * Extract layout styles from declarations.
 */
export function extractLayoutStyle(declarations: StyleDeclaration[]): LayoutStyle {
  const props = declarationsToMap(declarations);
  return {
    display: props['display'] || 'block',
    flexDirection: props['flex-direction'],
    justifyContent: props['justify-content'],
    alignItems: props['align-items'],
    gap: props['gap'],
    padding: props['padding'],
    margin: props['margin'],
  };
}

/**
 * Extract typography styles from declarations.
 */
export function extractTypographyStyle(declarations: StyleDeclaration[]): TypographyStyle | undefined {
  const props = declarationsToMap(declarations);
  if (!props['font-family'] && !props['font-size']) return undefined;

  return {
    fontFamily: props['font-family'] || 'inherit',
    fontSize: props['font-size'] || 'inherit',
    fontWeight: props['font-weight'] || '400',
    lineHeight: props['line-height'] || 'normal',
    letterSpacing: props['letter-spacing'],
    textAlign: props['text-align'],
    color: props['color'],
  };
}

/**
 * Extract effect styles from declarations.
 */
export function extractEffectStyle(declarations: StyleDeclaration[]): EffectStyle | undefined {
  const props = declarationsToMap(declarations);
  const hasEffects = props['box-shadow'] || props['border-radius'] || props['backdrop-filter'] || props['filter'];
  if (!hasEffects) return undefined;

  return {
    boxShadow: props['box-shadow'],
    borderRadius: props['border-radius'],
    opacity: props['opacity'],
    backdropFilter: props['backdrop-filter'],
    filter: props['filter'],
  };
}

/**
 * Build a complete style bundle for an element.
 */
export function buildStyleBundle(selector: string, declarations: StyleDeclaration[]): ElementStyleBundle {
  const props = declarationsToMap(declarations);
  return {
    selector,
    layout: extractLayoutStyle(declarations),
    typography: extractTypographyStyle(declarations),
    effects: extractEffectStyle(declarations),
    background: props['background'] || props['background-color'],
    border: props['border'],
  };
}

// ============================================================================
// Framer-Specific Extraction
// ============================================================================

/**
 * Extract Framer element styles from HTML (data-framer-name elements).
 */
export function extractFramerElementStyles(html: string): ComputedElementStyle[] {
  const elements: ComputedElementStyle[] = [];
  const framerRe = /<([a-z]+)[^>]*data-framer-name=["']([^"']+)["'][^>]*class=["']([^"']*)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = framerRe.exec(html)) !== null) {
    const tag = match[1];
    const framerName = match[2];
    const classes = match[3].split(/\s+/).filter(Boolean);

    elements.push({
      selector: `[data-framer-name="${framerName}"]`,
      tag,
      classes,
      styles: {},
      framerName,
    });
  }

  return elements;
}

/**
 * Extract all styles from Framer HTML export.
 */
export function extractStylesFromHtml(html: string, source = 'html'): StylesOutput {
  // Extract CSS from <style> blocks
  const cssBlocks: string[] = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleRe.exec(html)) !== null) cssBlocks.push(m[1]);
  const css = cssBlocks.join('\n');

  const rules = parseCssRules(css);
  const elements = extractFramerElementStyles(html);

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      source,
      totalRules: rules.length,
      totalElements: elements.length,
    },
    rules,
    elements,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function declarationsToMap(declarations: StyleDeclaration[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const d of declarations) {
    map[d.property] = d.value;
  }
  return map;
}
