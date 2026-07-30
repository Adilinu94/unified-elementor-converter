/**
 * Section Render Check (Phase 61).
 *
 * After emitting each section, verifies that the rendered output matches
 * expected visual properties. If mismatch detected, generates CSS complement
 * automatically.
 *
 * @module target-v3/section-render-check
 */

import type { V3Element } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface ExpectedVisual {
  selector: string;
  styles: Record<string, string>;
}

export interface SectionRenderCheckInput {
  sectionId: string;
  sectionRole: string;
  element: V3Element;
  expectedVisuals: ExpectedVisual[];
  liveUrl: string;
}

export interface RenderMismatch {
  selector: string;
  property: string;
  expected: string;
  actual: string;
  cssComplement: string;
}

export interface SectionRenderCheckResult {
  sectionId: string;
  sectionRole: string;
  passed: boolean;
  mismatches: RenderMismatch[];
  cssComplementBlock: string | null;
  timestamp: string;
}

// ============================================================================
// Core logic
// ============================================================================

/**
 * Compare expected visuals against actual computed styles from live render.
 * Produces CSS complement for any mismatches.
 */
export function checkSectionRender(
  input: SectionRenderCheckInput,
  actualStyles: Map<string, Record<string, string>>,
): SectionRenderCheckResult {
  const mismatches: RenderMismatch[] = [];

  for (const visual of input.expectedVisuals) {
    const actual = actualStyles.get(visual.selector);
    if (!actual) {
      // Element not found — generate full CSS block
      for (const [prop, val] of Object.entries(visual.styles)) {
        mismatches.push({
          selector: visual.selector,
          property: prop,
          expected: val,
          actual: 'ELEMENT_NOT_FOUND',
          cssComplement: `${visual.selector} { ${prop}: ${val}; }`,
        });
      }
      continue;
    }

    for (const [prop, expectedVal] of Object.entries(visual.styles)) {
      const actualVal = actual[prop] ?? 'NOT_SET';
      if (!valuesMatch(prop, expectedVal, actualVal)) {
        mismatches.push({
          selector: visual.selector,
          property: prop,
          expected: expectedVal,
          actual: actualVal,
          cssComplement: `${visual.selector} { ${prop}: ${expectedVal}; }`,
        });
      }
    }
  }

  // Merge CSS complements into a single block
  const cssComplementBlock = mismatches.length > 0
    ? mergeCSSComplements(mismatches)
    : null;

  return {
    sectionId: input.sectionId,
    sectionRole: input.sectionRole,
    passed: mismatches.length === 0,
    mismatches,
    cssComplementBlock,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Extract expected visuals from a V3 element's settings.
 * Maps known settings to their expected CSS output.
 */
export function extractExpectedVisuals(element: V3Element, pageId: number): ExpectedVisual[] {
  const visuals: ExpectedVisual[] = [];
  const settings = element.settings ?? {};
  const baseSelector = `body.page-id-${pageId}`;

  // Background color
  if (settings['background_color'] && typeof settings['background_color'] === 'string') {
    visuals.push({
      selector: `${baseSelector} #${element.id}`,
      styles: { 'background-color': settings['background_color'] },
    });
  }

  // Typography (heading widget)
  if (element.widgetType === 'heading' && settings['typography_font_size']) {
    const fontSize = settings['typography_font_size'] as { size?: number; unit?: string };
    if (fontSize.size) {
      visuals.push({
        selector: `${baseSelector} #${element.id} .elementor-heading-title`,
        styles: { 'font-size': `${fontSize.size}${fontSize.unit ?? 'px'}` },
      });
    }
  }

  // Padding
  if (settings['padding']) {
    const padding = settings['padding'] as Record<string, unknown>;
    const styles: Record<string, string> = {};
    if (padding['top'] !== undefined) styles['padding-top'] = `${padding['top']}${padding['unit'] ?? 'px'}`;
    if (padding['bottom'] !== undefined) styles['padding-bottom'] = `${padding['bottom']}${padding['unit'] ?? 'px'}`;
    if (padding['left'] !== undefined) styles['padding-left'] = `${padding['left']}${padding['unit'] ?? 'px'}`;
    if (padding['right'] !== undefined) styles['padding-right'] = `${padding['right']}${padding['unit'] ?? 'px'}`;
    if (Object.keys(styles).length > 0) {
      visuals.push({ selector: `${baseSelector} #${element.id}`, styles });
    }
  }

  // Flex gap (container)
  if (element.elType === 'container' && settings['flex_gap']) {
    const gap = settings['flex_gap'] as { column?: string; row?: string };
    if (gap.column || gap.row) {
      visuals.push({
        selector: `${baseSelector} #${element.id} .e-con-inner`,
        styles: { gap: `${gap.row ?? gap.column ?? '0'}px ${gap.column ?? '0'}px` },
      });
    }
  }

  return visuals;
}

// ============================================================================
// MCP call builder
// ============================================================================

/**
 * Build the MCP call to render-check a section on the live site.
 */
export function buildRenderCheckCall(
  liveUrl: string,
  selectors: string[],
  properties: string[],
): { ability: string; params: Record<string, unknown> } {
  return {
    ability: 'novamira/execute-js',
    params: {
      url: liveUrl,
      code: `
        const selectors = ${JSON.stringify(selectors)};
        const props = ${JSON.stringify(properties)};
        const result = {};
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const cs = window.getComputedStyle(el);
            result[sel] = {};
            for (const p of props) { result[sel][p] = cs.getPropertyValue(p); }
          }
        }
        return result;
      `,
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

function valuesMatch(property: string, expected: string, actual: string): boolean {
  if (expected === actual) return true;
  // Normalize colors (rgb vs hex)
  if (property.includes('color')) {
    return normalizeColor(expected) === normalizeColor(actual);
  }
  // Multi-value shorthand (e.g. gap: "10px 5px") — compare each value separately
  const expParts = expected.trim().split(/\s+/);
  const actParts = actual.trim().split(/\s+/);
  if (expParts.length > 1 || actParts.length > 1) {
    if (expParts.length !== actParts.length) return false;
    return expParts.every((part, i) => valuesMatch(property, part, actParts[i]!));
  }

  // Numeric tolerance for px values
  const expNum = parseFloat(expected);
  const actNum = parseFloat(actual);
  if (!isNaN(expNum) && !isNaN(actNum)) {
    return Math.abs(expNum - actNum) <= 2;
  }
  return false;
}

function normalizeColor(color: string): string {
  // Simple hex → rgb normalization
  const hexMatch = color.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgb(${r},${g},${b})`;
  }
  return color.toLowerCase().replace(/\s/g, '');
}

function mergeCSSComplements(mismatches: RenderMismatch[]): string {
  const bySelector = new Map<string, string[]>();
  for (const m of mismatches) {
    const list = bySelector.get(m.selector) ?? [];
    list.push(`  ${m.property}: ${m.expected};`);
    bySelector.set(m.selector, list);
  }
  const blocks: string[] = [];
  for (const [selector, props] of bySelector) {
    blocks.push(`${selector} {\n${props.join('\n')}\n}`);
  }
  return blocks.join('\n\n');
}
