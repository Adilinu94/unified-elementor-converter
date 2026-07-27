/**
 * Design Critic L1 Rules (Phase 67).
 *
 * Rule-based checks that run against computed styles without needing
 * a reference URL. Covers: spacing, typography, contrast, components, overflow.
 *
 * @module qa/design-critic/rules
 */

import type { ComputedStyleEntry, CriticThresholds, DesignFinding } from './types.js';
import { DEFAULT_THRESHOLDS } from './types.js';

let findingCounter = 0;

function nextId(): string {
  return `DC-${String(++findingCounter).padStart(3, '0')}`;
}

/** Reset counter (for tests). */
export function resetFindingCounter(): void {
  findingCounter = 0;
}

// ============================================================================
// Spacing rules
// ============================================================================

export function checkSpacing(
  entries: ComputedStyleEntry[],
  thresholds: CriticThresholds = DEFAULT_THRESHOLDS,
): DesignFinding[] {
  const findings: DesignFinding[] = [];

  for (const entry of entries) {
    const isSection = entry.selector.includes('section') || entry.selector.includes('e-con');
    if (!isSection) continue;

    const paddingTop = parseFloat(entry.styles['padding-top'] ?? '0');
    const paddingBottom = parseFloat(entry.styles['padding-bottom'] ?? '0');

    if (paddingTop < thresholds.sectionMinPaddingPx) {
      findings.push({
        id: nextId(),
        layer: 'L1-rules',
        severity: 'minor',
        principle: 'spacing',
        section: entry.selector,
        selector: entry.selector,
        expected: `padding-top ≥ ${thresholds.sectionMinPaddingPx}px`,
        actual: `padding-top: ${paddingTop}px`,
        fixHint: `Increase section padding-top to at least ${thresholds.sectionMinPaddingPx}px for visual breathing room`,
        confidence: 1,
      });
    }

    if (paddingBottom < thresholds.sectionMinPaddingPx) {
      findings.push({
        id: nextId(),
        layer: 'L1-rules',
        severity: 'minor',
        principle: 'spacing',
        section: entry.selector,
        selector: entry.selector,
        expected: `padding-bottom ≥ ${thresholds.sectionMinPaddingPx}px`,
        actual: `padding-bottom: ${paddingBottom}px`,
        fixHint: `Increase section padding-bottom to at least ${thresholds.sectionMinPaddingPx}px`,
        confidence: 1,
      });
    }
  }

  return findings;
}

// ============================================================================
// Typography rules
// ============================================================================

export function checkTypography(
  entries: ComputedStyleEntry[],
  thresholds: CriticThresholds = DEFAULT_THRESHOLDS,
): DesignFinding[] {
  const findings: DesignFinding[] = [];

  for (const entry of entries) {
    const fontSize = parseFloat(entry.styles['font-size'] ?? '16');
    const isBody = entry.selector === 'body' || entry.selector.includes('text-editor');

    if (isBody && fontSize < thresholds.bodyMinFontPx) {
      findings.push({
        id: nextId(),
        layer: 'L1-rules',
        severity: 'major',
        principle: 'typography',
        section: entry.selector,
        selector: entry.selector,
        expected: `font-size ≥ ${thresholds.bodyMinFontPx}px`,
        actual: `font-size: ${fontSize}px`,
        fixHint: `Body text below ${thresholds.bodyMinFontPx}px is hard to read. Increase font-size.`,
        confidence: 1,
      });
    }

    // Line height check (should be ≥ 1.2× font-size for body text)
    const lineHeight = parseFloat(entry.styles['line-height'] ?? '0');
    if (isBody && lineHeight > 0 && lineHeight < fontSize * 1.2) {
      findings.push({
        id: nextId(),
        layer: 'L1-rules',
        severity: 'minor',
        principle: 'typography',
        section: entry.selector,
        selector: entry.selector,
        expected: `line-height ≥ ${Math.round(fontSize * 1.2)}px (1.2× font-size)`,
        actual: `line-height: ${lineHeight}px`,
        fixHint: 'Increase line-height for better readability',
        confidence: 0.9,
      });
    }
  }

  return findings;
}

// ============================================================================
// Contrast rules (WCAG AA)
// ============================================================================

export function checkContrast(
  entries: ComputedStyleEntry[],
  thresholds: CriticThresholds = DEFAULT_THRESHOLDS,
): DesignFinding[] {
  const findings: DesignFinding[] = [];

  for (const entry of entries) {
    const color = entry.styles['color'];
    const bgColor = entry.styles['background-color'];
    if (!color || !bgColor) continue;

    const ratio = computeContrastRatio(color, bgColor);
    if (ratio === null) continue;

    const fontSize = parseFloat(entry.styles['font-size'] ?? '16');
    const isLarge = fontSize >= 24 || (fontSize >= 18.66 && entry.styles['font-weight'] === 'bold');
    const required = isLarge ? thresholds.contrastAALarge : thresholds.contrastAA;

    if (ratio < required) {
      findings.push({
        id: nextId(),
        layer: 'L1-rules',
        severity: ratio < 3 ? 'critical' : 'major',
        principle: 'contrast',
        section: entry.selector,
        selector: entry.selector,
        expected: `contrast ratio ≥ ${required}:1 (WCAG AA${isLarge ? ' large' : ''})`,
        actual: `contrast ratio: ${ratio.toFixed(2)}:1`,
        fixHint: `Increase contrast between text color and background. Current: ${ratio.toFixed(2)}:1, need: ${required}:1`,
        confidence: 1,
      });
    }
  }

  return findings;
}

// ============================================================================
// Component rules
// ============================================================================

export function checkComponents(
  entries: ComputedStyleEntry[],
  thresholds: CriticThresholds = DEFAULT_THRESHOLDS,
): DesignFinding[] {
  const findings: DesignFinding[] = [];

  for (const entry of entries) {
    const isButton = entry.selector.includes('button') || entry.selector.includes('btn');
    if (!isButton) continue;

    const height = entry.boundingBox.height;

    if (height < thresholds.buttonMinHeightPx) {
      findings.push({
        id: nextId(),
        layer: 'L1-rules',
        severity: 'major',
        principle: 'components',
        section: entry.selector,
        selector: entry.selector,
        expected: `button height ≥ ${thresholds.buttonMinHeightPx}px`,
        actual: `height: ${height}px`,
        fixHint: `Button too small for comfortable interaction. Min ${thresholds.buttonMinHeightPx}px.`,
        confidence: 1,
      });
    }

    if (height > thresholds.buttonMaxHeightPx) {
      findings.push({
        id: nextId(),
        layer: 'L1-rules',
        severity: 'minor',
        principle: 'components',
        section: entry.selector,
        selector: entry.selector,
        expected: `button height ≤ ${thresholds.buttonMaxHeightPx}px`,
        actual: `height: ${height}px`,
        fixHint: `Button unusually tall. Check padding/font-size.`,
        confidence: 0.8,
      });
    }

    // Touch target
    const width = entry.boundingBox.width;
    if (height < thresholds.touchTargetMinPx || width < thresholds.touchTargetMinPx) {
      findings.push({
        id: nextId(),
        layer: 'L1-rules',
        severity: 'major',
        principle: 'components',
        section: entry.selector,
        selector: entry.selector,
        expected: `touch target ≥ ${thresholds.touchTargetMinPx}×${thresholds.touchTargetMinPx}px`,
        actual: `${width}×${height}px`,
        fixHint: `Touch target too small for mobile. Min ${thresholds.touchTargetMinPx}px each dimension.`,
        confidence: 1,
      });
    }
  }

  return findings;
}

// ============================================================================
// Overflow rules
// ============================================================================

export function checkOverflow(
  entries: ComputedStyleEntry[],
  viewportWidth = 1440,
): DesignFinding[] {
  const findings: DesignFinding[] = [];

  for (const entry of entries) {
    const rightEdge = entry.boundingBox.x + entry.boundingBox.width;
    if (rightEdge > viewportWidth + 5) {
      findings.push({
        id: nextId(),
        layer: 'L1-rules',
        severity: 'critical',
        principle: 'overflow',
        section: entry.selector,
        selector: entry.selector,
        expected: `element right edge ≤ ${viewportWidth}px`,
        actual: `right edge: ${Math.round(rightEdge)}px (overflow: ${Math.round(rightEdge - viewportWidth)}px)`,
        fixHint: 'Horizontal overflow detected. Check width/max-width or add overflow-x:hidden.',
        confidence: 1,
      });
    }
  }

  return findings;
}

// ============================================================================
// Run all L1 rules
// ============================================================================

export function runAllL1Rules(
  entries: ComputedStyleEntry[],
  thresholds: CriticThresholds = DEFAULT_THRESHOLDS,
  viewportWidth = 1440,
): DesignFinding[] {
  resetFindingCounter();
  return [
    ...checkSpacing(entries, thresholds),
    ...checkTypography(entries, thresholds),
    ...checkContrast(entries, thresholds),
    ...checkComponents(entries, thresholds),
    ...checkOverflow(entries, viewportWidth),
  ];
}

// ============================================================================
// Contrast computation helpers
// ============================================================================

function computeContrastRatio(fg: string, bg: string): number | null {
  const fgLum = relativeLuminance(parseColor(fg));
  const bgLum = relativeLuminance(parseColor(bg));
  if (fgLum === null || bgLum === null) return null;
  const lighter = Math.max(fgLum, bgLum);
  const darker = Math.min(fgLum, bgLum);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(rgb: [number, number, number] | null): number | null {
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function parseColor(color: string): [number, number, number] | null {
  // rgb(r, g, b) or rgba(r, g, b, a)
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1]!), parseInt(rgbMatch[2]!), parseInt(rgbMatch[3]!)];
  }
  // #hex
  const hexMatch = color.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  return null;
}
