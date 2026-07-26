/**
 * Geometry Probe — Structured Visual Feedback (Phase 64).
 *
 * Provides structured selector+expectedStyles → actual+diff+suggestedCSSFix
 * feedback that works for non-vision models. Replaces ad-hoc per-build probing.
 *
 * @module qa/geometry-probe
 */

// ============================================================================
// Types
// ============================================================================

export interface ProbeExpectation {
  selector: string;
  expectedStyles: Record<string, string>;
  /** Human-readable label for reporting. */
  label?: string;
}

export interface ProbeResult {
  selector: string;
  label: string;
  expected: Record<string, string>;
  actual: Record<string, string>;
  match: boolean;
  diffs: StyleDiff[];
  suggestedCSSFix: string | null;
}

export interface StyleDiff {
  property: string;
  expected: string;
  actual: string;
  /** Whether the difference is within tolerance. */
  withinTolerance: boolean;
}

export interface GeometryProbeReport {
  url: string;
  timestamp: string;
  totalProbes: number;
  passCount: number;
  failCount: number;
  results: ProbeResult[];
  score: number; // 0-100
}

export interface StructuralProbeDef {
  id: string;
  description: string;
  selector: string;
  check: 'exists' | 'not-exists' | 'style-match' | 'style-not-match' | 'count-range';
  expectedStyles?: Record<string, string>;
  countRange?: [number, number];
  severity: 'critical' | 'warning' | 'info';
}

export interface StructuralProbeResult {
  probeId: string;
  description: string;
  passed: boolean;
  severity: 'critical' | 'warning' | 'info';
  detail: string;
}

// ============================================================================
// Tolerance configuration
// ============================================================================

const DEFAULT_TOLERANCES: Record<string, number> = {
  'font-size': 2,       // px tolerance
  'line-height': 3,     // px tolerance
  'padding-top': 4,
  'padding-bottom': 4,
  'padding-left': 4,
  'padding-right': 4,
  'margin-top': 4,
  'margin-bottom': 4,
  'gap': 4,
  'width': 8,
  'height': 8,
  'border-radius': 2,
};

/** Parse a CSS numeric value to px number. */
function parsePx(value: string): number | null {
  const match = value.match(/^([\d.]+)\s*px$/);
  if (match) return parseFloat(match[1]!);
  const remMatch = value.match(/^([\d.]+)\s*rem$/);
  if (remMatch) return parseFloat(remMatch[1]!) * 16;
  const numMatch = value.match(/^([\d.]+)$/);
  if (numMatch) return parseFloat(numMatch[1]!);
  return null;
}

/** Check if two style values are within tolerance. */
export function isWithinTolerance(property: string, expected: string, actual: string): boolean {
  if (expected === actual) return true;

  const tolerance = DEFAULT_TOLERANCES[property];
  if (tolerance === undefined) return expected.toLowerCase() === actual.toLowerCase();

  const expPx = parsePx(expected);
  const actPx = parsePx(actual);
  if (expPx === null || actPx === null) return expected.toLowerCase() === actual.toLowerCase();

  return Math.abs(expPx - actPx) <= tolerance;
}

// ============================================================================
// Core probe logic
// ============================================================================

/**
 * Evaluate a single probe expectation against computed styles.
 * This is the pure logic — actual DOM access happens via MCP/browser.
 */
export function evaluateProbe(
  expectation: ProbeExpectation,
  computedStyles: Record<string, string>,
): ProbeResult {
  const diffs: StyleDiff[] = [];
  let allMatch = true;

  for (const [prop, expectedVal] of Object.entries(expectation.expectedStyles)) {
    const actualVal = computedStyles[prop] ?? 'NOT_FOUND';
    const withinTol = isWithinTolerance(prop, expectedVal, actualVal);
    if (!withinTol) allMatch = false;
    diffs.push({ property: prop, expected: expectedVal, actual: actualVal, withinTolerance: withinTol });
  }

  return {
    selector: expectation.selector,
    label: expectation.label ?? expectation.selector,
    expected: expectation.expectedStyles,
    actual: computedStyles,
    match: allMatch,
    diffs: diffs.filter((d) => !d.withinTolerance),
    suggestedCSSFix: allMatch ? null : buildCSSFix(expectation.selector, diffs),
  };
}

/**
 * Run multiple probes and produce a report.
 */
export function runGeometryProbes(
  url: string,
  expectations: ProbeExpectation[],
  computedStylesMap: Map<string, Record<string, string>>,
): GeometryProbeReport {
  const results: ProbeResult[] = [];

  for (const exp of expectations) {
    const styles = computedStylesMap.get(exp.selector) ?? {};
    results.push(evaluateProbe(exp, styles));
  }

  const passCount = results.filter((r) => r.match).length;
  const failCount = results.length - passCount;
  const score = results.length > 0 ? Math.round((passCount / results.length) * 100) : 100;

  return {
    url,
    timestamp: new Date().toISOString(),
    totalProbes: results.length,
    passCount,
    failCount,
    results,
    score,
  };
}

// ============================================================================
// Structural Probes (predefined)
// ============================================================================

export const STRUCTURAL_PROBES: StructuralProbeDef[] = [
  {
    id: 'header-shell-transparent',
    description: 'Header has transparent/fixed positioning',
    selector: 'header, .site-header, .elementor-location-header',
    check: 'style-match',
    expectedStyles: { position: 'fixed' },
    severity: 'warning',
  },
  {
    id: 'header-visible',
    description: 'Header element exists and is visible',
    selector: 'header, .site-header, .elementor-location-header',
    check: 'exists',
    severity: 'critical',
  },
  {
    id: 'hero-media-side',
    description: 'Hero section has media element',
    selector: '[class*="hero"] img, [class*="hero"] video, [id*="hero"] img',
    check: 'exists',
    severity: 'warning',
  },
  {
    id: 'stats-centered',
    description: 'Stats section content is centered',
    selector: '[class*="stats"], [id*="stats"]',
    check: 'style-match',
    expectedStyles: { 'text-align': 'center' },
    severity: 'info',
  },
  {
    id: 'button-not-full-width',
    description: 'Buttons are not stretched to full width',
    selector: '.elementor-widget-button .elementor-button',
    check: 'style-not-match',
    expectedStyles: { width: '100%' },
    severity: 'warning',
  },
  {
    id: 'html-budget',
    description: 'HTML widgets do not exceed 15% of total widgets',
    selector: '.elementor-widget-html',
    check: 'count-range',
    countRange: [0, 5],
    severity: 'critical',
  },
  {
    id: 'image-widgets-present',
    description: 'Images use image widget, not <img> in html widget',
    selector: '.elementor-widget-html img',
    check: 'not-exists',
    severity: 'critical',
  },
  {
    id: 'no-horizontal-overflow',
    description: 'Page does not overflow horizontally',
    selector: 'body',
    check: 'style-match',
    expectedStyles: { 'overflow-x': 'hidden' },
    severity: 'critical',
  },
  {
    id: 'font-min-size',
    description: 'Body text is at least 16px',
    selector: 'body',
    check: 'style-match',
    expectedStyles: { 'font-size': '16px' },
    severity: 'warning',
  },
];

/**
 * Evaluate structural probes against a DOM snapshot.
 */
export function evaluateStructuralProbes(
  probeResults: Array<{ probeId: string; exists: boolean; count: number; styles: Record<string, string> }>,
): StructuralProbeResult[] {
  const results: StructuralProbeResult[] = [];

  for (const probeDef of STRUCTURAL_PROBES) {
    const domResult = probeResults.find((r) => r.probeId === probeDef.id);
    let passed = false;
    let detail = '';

    if (!domResult) {
      detail = 'Probe not executed';
      passed = probeDef.severity === 'info';
    } else {
      switch (probeDef.check) {
        case 'exists':
          passed = domResult.exists;
          detail = passed ? 'Element found' : 'Element NOT found';
          break;
        case 'not-exists':
          passed = !domResult.exists;
          detail = passed ? 'Element correctly absent' : 'Element should NOT exist';
          break;
        case 'style-match': {
          const styles = domResult.styles;
          passed = Object.entries(probeDef.expectedStyles ?? {}).every(
            ([k, v]) => styles[k] === v,
          );
          detail = passed ? 'Styles match' : `Styles mismatch: ${JSON.stringify(styles)}`;
          break;
        }
        case 'style-not-match': {
          const styles = domResult.styles;
          passed = !Object.entries(probeDef.expectedStyles ?? {}).every(
            ([k, v]) => styles[k] === v,
          );
          detail = passed ? 'Styles correctly differ' : 'Styles should NOT match';
          break;
        }
        case 'count-range': {
          const [min, max] = probeDef.countRange ?? [0, Infinity];
          passed = domResult.count >= min && domResult.count <= max;
          detail = `Count: ${domResult.count} (expected ${min}-${max})`;
          break;
        }
      }
    }

    results.push({ probeId: probeDef.id, description: probeDef.description, passed, severity: probeDef.severity, detail });
  }

  return results;
}

// ============================================================================
// Helpers
// ============================================================================

function buildCSSFix(selector: string, diffs: StyleDiff[]): string {
  const failedDiffs = diffs.filter((d) => !d.withinTolerance);
  if (failedDiffs.length === 0) return '';
  const props = failedDiffs.map((d) => `  ${d.property}: ${d.expected};`).join('\n');
  return `${selector} {\n${props}\n}`;
}

/**
 * Generate the MCP call to collect computed styles for a set of selectors.
 */
export function buildComputedStyleCollectionCall(
  url: string,
  selectors: string[],
): { ability: string; params: Record<string, unknown> } {
  return {
    ability: 'novamira/execute-js',
    params: {
      url,
      code: `
        const selectors = ${JSON.stringify(selectors)};
        const result = {};
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const cs = window.getComputedStyle(el);
            result[sel] = Object.fromEntries(
              Array.from(cs).map(p => [p, cs.getPropertyValue(p)])
            );
          }
        }
        return result;
      `,
    },
  };
}
