/**
 * Cross-Validator — verifies extracted design tokens made it into the built tree.
 *
 * Catches the "drift" between what the extractor found on the source site
 * and what the builder actually wrote into the Elementor JSON. Guard checks
 * structural correctness; cross-validation checks semantic faithfulness.
 *
 * Produces a CrossValidationReport with per-check results and a drift counter.
 *
 * Usage:
 *   const report = crossValidate(tokens, v3Elements);
 *   await writeCrossValidationReport(report, './output/cross-validation-report.json');
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DesignTokens } from '@elconv/core';
import { findPrefixedBreakpointKeys, hasBreakpointSuffix } from '@elconv/core';

// Local structural shapes for the built trees. Defined here rather than
// imported from @elconv/target-v3 (V3Element) / @elconv/target-v4
// (V4AtomicElement) to avoid a project-reference cycle: target-v3 already
// depends on @elconv/qa, so qa must not depend back on the target packages.
interface V3Element {
  id: string;
  elType?: string;
  widgetType?: string;
  settings?: Record<string, unknown>;
  elements?: V3Element[];
  [key: string]: unknown;
}

interface V4AtomicElement {
  id: string;
  elements?: V4AtomicElement[];
  [key: string]: unknown;
}

// ============================================================================
// Types
// ============================================================================

export type CheckSeverity = 'error' | 'warning' | 'info';
export type CheckStatus = 'pass' | 'fail' | 'skip';

export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly severity: CheckSeverity;
  readonly message: string;
  readonly driftCount: number;
  readonly details?: readonly string[];
}

export interface CrossValidationReport {
  readonly generatedAt: string;
  readonly sourceUrl: string;
  readonly treeType: 'v3' | 'v4';
  /** Total number of failed/warning checks. */
  readonly totalDrift: number;
  readonly passed: boolean;
  readonly checks: readonly CheckResult[];
}

type AnyTree = V3Element[] | V4AtomicElement[];

// ============================================================================
// Helpers
// ============================================================================

function collectV3Elements(elements: V3Element[]): V3Element[] {
  const out: V3Element[] = [];
  function walk(els: V3Element[]): void {
    for (const el of els) {
      out.push(el);
      if (el.elements?.length) walk(el.elements);
    }
  }
  walk(elements);
  return out;
}

function collectV4Elements(elements: V4AtomicElement[]): V4AtomicElement[] {
  const out: V4AtomicElement[] = [];
  function walk(els: V4AtomicElement[]): void {
    for (const el of els) {
      out.push(el);
      if (el.elements?.length) walk(el.elements);
    }
  }
  walk(elements);
  return out;
}

/** Collect all string values from a nested object (for color/font searching). */
function collectStringValues(obj: unknown, depth = 0): string[] {
  if (depth > 10 || !obj || typeof obj !== 'object') return [];
  if (typeof obj === 'string') return [obj];
  const results: string[] = [];
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (typeof v === 'string') {
      results.push(v);
    } else if (typeof v === 'object' && v !== null) {
      results.push(...collectStringValues(v, depth + 1));
    }
  }
  return results;
}

function normalizeHex(hex: string): string {
  return hex.toLowerCase().replace(/^#/, '');
}

// ============================================================================
// Check 1 — Color drift
// ============================================================================

/**
 * Verify that non-null color tokens from DesignTokens appear somewhere in the
 * built tree's settings/styles. Flags colors that were extracted but never
 * referenced in the output.
 */
function checkColorDrift(tokens: DesignTokens, tree: AnyTree): CheckResult {
  const name = 'CV1:color-drift';

  const extractedColors: Array<{ role: string; hex: string }> = [];
  for (const token of tokens.colors) {
    if (token.hex) {
      extractedColors.push({ role: token.role ?? token.id, hex: normalizeHex(token.hex) });
    }
  }

  if (extractedColors.length === 0) {
    return { name, status: 'skip', severity: 'info', message: 'No color tokens extracted', driftCount: 0 };
  }

  // Collect all string values from the tree settings/styles
  const treeStrings = new Set<string>();
  const elements = Array.isArray(tree) ? tree : [];
  for (const el of elements) {
    for (const v of collectStringValues(el)) {
      treeStrings.add(v.toLowerCase().replace(/^#/, ''));
    }
  }

  const missing: string[] = [];
  for (const { role, hex } of extractedColors) {
    const shortHex = hex.slice(0, 6); // match both #rrggbb and #rrggbbaa
    if (![...treeStrings].some((s) => s.includes(shortHex))) {
      missing.push(`${role}: #${hex}`);
    }
  }

  const driftCount = missing.length;
  if (driftCount > 0) {
    return {
      name,
      status: 'fail',
      severity: 'warning',
      message: `${driftCount}/${extractedColors.length} extracted color(s) not found in tree`,
      driftCount,
      details: missing,
    };
  }

  return {
    name,
    status: 'pass',
    severity: 'info',
    message: `All ${extractedColors.length} extracted color(s) referenced in tree`,
    driftCount: 0,
  };
}

// ============================================================================
// Check 2 — Font-stack consistency
// ============================================================================

/**
 * Verify that the extracted heading/body/mono font families appear in the
 * built tree. A font referenced in tokens but absent from the tree means the
 * builder substituted the system default instead of the site's actual font.
 */
function checkFontDrift(tokens: DesignTokens, tree: AnyTree): CheckResult {
  const name = 'CV2:font-stack-drift';

  const extractedFonts: Array<{ role: string; family: string }> = [];
  for (const token of tokens.fonts) {
    if (token.family) {
      extractedFonts.push({ role: token.role ?? token.id, family: token.family.toLowerCase() });
    }
  }

  if (extractedFonts.length === 0) {
    return { name, status: 'skip', severity: 'info', message: 'No font tokens extracted', driftCount: 0 };
  }

  const treeStrings = collectStringValues(tree).map((s) => s.toLowerCase());

  const missing: string[] = [];
  for (const { role, family } of extractedFonts) {
    const found = treeStrings.some((s) => s.includes(family));
    if (!found) {
      missing.push(`${role}: "${family}"`);
    }
  }

  const driftCount = missing.length;
  if (driftCount > 0) {
    return {
      name,
      status: 'fail',
      severity: 'warning',
      message: `${driftCount}/${extractedFonts.length} font(s) not found in tree`,
      driftCount,
      details: missing,
    };
  }

  return {
    name,
    status: 'pass',
    severity: 'info',
    message: `All ${extractedFonts.length} font(s) referenced in tree`,
    driftCount: 0,
  };
}

// ============================================================================
// Check 3 — WP-Media-ID coverage (V3)
// ============================================================================

/**
 * Verify that V3 image widgets have WP attachment IDs set.
 * An image without an ID means it was inserted as a raw URL (no WP media
 * upload happened), which breaks srcset, lazy-loading, and WebP variants.
 */
function checkImageMediaIds(tree: V3Element[]): CheckResult {
  const name = 'CV3:image-media-ids';

  const all = collectV3Elements(tree);
  const imageWidgets = all.filter((el) => el.elType === 'widget' && el.widgetType === 'image');

  if (imageWidgets.length === 0) {
    return { name, status: 'skip', severity: 'info', message: 'No image widgets in tree', driftCount: 0 };
  }

  const noId: string[] = [];
  for (const w of imageWidgets) {
    const img = (w.settings?.['image'] ?? {}) as Record<string, unknown>;
    const id = img['id'];
    if (!id || id === 0) {
      const url = typeof img['url'] === 'string' ? img['url'] : '(no url)';
      noId.push(`${w.id}: ${url.slice(0, 60)}`);
    }
  }

  const driftCount = noId.length;
  if (driftCount > 0) {
    return {
      name,
      status: 'fail',
      severity: 'warning',
      message: `${driftCount}/${imageWidgets.length} image widget(s) missing WP attachment ID`,
      driftCount,
      details: noId,
    };
  }

  return {
    name,
    status: 'pass',
    severity: 'info',
    message: `All ${imageWidgets.length} image widget(s) have WP attachment IDs`,
    driftCount: 0,
  };
}

// ============================================================================
// Check 4 — Breakpoint variant coverage
// ============================================================================

/**
 * Verify that the tree has responsive overrides for all sections.
 * A site that uses mobile breakpoints on the source but only desktop in the
 * output will look broken on phones.
 *
 * Distinguishes two very different failures:
 *   - a section genuinely has no responsive override (info/warning)
 *   - a section has overrides written with the invalid `tablet_`/`mobile_`
 *     PREFIX, which Elementor stores but never renders (critical drift)
 * Before P5 both looked identical here, so a fully mis-wired tree was reported
 * as merely "desktop-only". See BAUPLAN-v6.0 §11.2.
 */
function checkBreakpointVariants(tree: V3Element[]): CheckResult {
  const name = 'CV4:breakpoint-variants';

  const sections = collectV3Elements(tree).filter((el) => el.elType === 'section');

  if (sections.length === 0) {
    return { name, status: 'skip', severity: 'info', message: 'No sections in tree', driftCount: 0 };
  }

  const noResponsive: string[] = [];
  const prefixMisuse: string[] = [];
  for (const s of sections) {
    const settings = s.settings ?? {};
    const prefixed = findPrefixedBreakpointKeys(settings);
    if (prefixed.length > 0) {
      prefixMisuse.push(`${s.id}: ${prefixed.slice(0, 3).join(', ')}`);
    }
    if (!Object.keys(settings).some(hasBreakpointSuffix)) {
      noResponsive.push(s.id);
    }
  }

  // Mis-wired overrides outrank "no overrides" — the data exists but is dead.
  if (prefixMisuse.length > 0) {
    return {
      name,
      status: 'fail',
      severity: 'error',
      message:
        `${prefixMisuse.length}/${sections.length} section(s) use the tablet_/mobile_ prefix ` +
        'instead of the _tablet/_mobile suffix — Elementor ignores these overrides',
      driftCount: prefixMisuse.length,
      details: prefixMisuse.slice(0, 5),
    };
  }

  const driftCount = noResponsive.length;

  // Warning only — not all sections need responsive overrides
  if (driftCount === sections.length) {
    return {
      name,
      status: 'fail',
      severity: 'warning',
      message: `No sections have responsive overrides (all ${sections.length} desktop-only)`,
      driftCount,
      details: noResponsive.slice(0, 5),
    };
  }

  if (driftCount > 0) {
    return {
      name,
      status: 'fail',
      severity: 'info',
      message: `${driftCount}/${sections.length} section(s) have no responsive overrides`,
      driftCount,
      details: noResponsive.slice(0, 5),
    };
  }

  return {
    name,
    status: 'pass',
    severity: 'info',
    message: `All ${sections.length} section(s) have responsive overrides`,
    driftCount: 0,
  };
}

// ============================================================================
// Check 5 — GV-ID drift (V4 only)
// ============================================================================

/**
 * Verify that any global-variable $$type references in the V4 tree have
 * non-empty value IDs. An empty or zero-length GV-ID means the variable
 * binding was lost during tree construction and the element will render
 * without the intended design token.
 */
function checkGvIdDrift(tree: V4AtomicElement[]): CheckResult {
  const name = 'CV5:gv-id-drift';

  const all = collectV4Elements(tree);
  const emptyGvIds: string[] = [];

  function scanForGv(obj: unknown, elementId: string, path: string): void {
    if (!obj || typeof obj !== 'object') return;
    const record = obj as Record<string, unknown>;

    if (record['$$type'] === 'global-variable') {
      const id = record['id'] ?? record['value'];
      if (!id || (typeof id === 'string' && id.trim() === '')) {
        emptyGvIds.push(`${elementId} at ${path}`);
      }
      return;
    }

    for (const [k, v] of Object.entries(record)) {
      if (k !== 'elements') scanForGv(v, elementId, `${path}.${k}`);
    }
  }

  for (const el of all) {
    scanForGv(el.settings, el.id, 'settings');
    scanForGv(el.styles, el.id, 'styles');
  }

  const driftCount = emptyGvIds.length;
  if (driftCount > 0) {
    return {
      name,
      status: 'fail',
      severity: 'error',
      message: `${driftCount} global-variable reference(s) with empty ID (GV-ID drift)`,
      driftCount,
      details: emptyGvIds.slice(0, 5),
    };
  }

  return {
    name,
    status: 'pass',
    severity: 'info',
    message: 'No GV-ID drift detected',
    driftCount: 0,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Run all cross-validation checks for a V3 tree.
 *
 * @param tokens  - DesignTokens produced by the extractor phase
 * @param tree    - V3Element[] (content array from V3PageData)
 * @param sourceUrl - Source URL for report metadata
 */
export function crossValidateV3(
  tokens: DesignTokens,
  tree: V3Element[],
  sourceUrl = '',
): CrossValidationReport {
  const checks: CheckResult[] = [
    checkColorDrift(tokens, tree),
    checkFontDrift(tokens, tree),
    checkImageMediaIds(tree),
    checkBreakpointVariants(tree),
  ];

  const totalDrift = checks.reduce((sum, c) => sum + c.driftCount, 0);
  const passed = checks.every((c) => c.status !== 'fail' || c.severity === 'info');

  return {
    generatedAt: new Date().toISOString(),
    sourceUrl,
    treeType: 'v3',
    totalDrift,
    passed,
    checks,
  };
}

/**
 * Run all cross-validation checks for a V4 tree.
 *
 * @param tokens  - DesignTokens produced by the extractor phase
 * @param tree    - V4AtomicElement[] from V4BuildPlan.elements
 * @param sourceUrl - Source URL for report metadata
 */
export function crossValidateV4(
  tokens: DesignTokens,
  tree: V4AtomicElement[],
  sourceUrl = '',
): CrossValidationReport {
  const checks: CheckResult[] = [
    checkColorDrift(tokens, tree),
    checkFontDrift(tokens, tree),
    checkGvIdDrift(tree),
  ];

  const totalDrift = checks.reduce((sum, c) => sum + c.driftCount, 0);
  const passed = checks.every((c) => c.status !== 'fail' || c.severity === 'info');

  return {
    generatedAt: new Date().toISOString(),
    sourceUrl,
    treeType: 'v4',
    totalDrift,
    passed,
    checks,
  };
}

/**
 * Write a CrossValidationReport to disk as JSON.
 */
export async function writeCrossValidationReport(
  report: CrossValidationReport,
  outputPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf-8');
}

/**
 * Format a CrossValidationReport for CLI output.
 */
export function formatCrossValidationReport(report: CrossValidationReport): string {
  const status = report.passed ? '✅ PASSED' : '❌ FAILED';
  const lines: string[] = [
    `Cross-Validation [${report.treeType.toUpperCase()}] — ${status}`,
    `  Source: ${report.sourceUrl || '(none)'}`,
    `  Total drift: ${report.totalDrift}`,
    '',
  ];

  for (const check of report.checks) {
    const icon =
      check.status === 'pass' ? '✓' : check.status === 'skip' ? '–' : check.severity === 'error' ? '✗' : '⚠';
    lines.push(`  ${icon} [${check.name}] ${check.message}`);
    if (check.details?.length) {
      for (const d of check.details.slice(0, 3)) {
        lines.push(`    ↳ ${d}`);
      }
    }
  }

  return lines.join('\n');
}
