/**
 * Component Detector — Phase 3 P1 Extension + Modul A2 Multi-Layer.
 *
 * Extends style-classifier with 7 additional layout patterns and provides
 * 3-layer consensus detection (Structure → Vision → Keyword).
 *
 * Portiert aus site-clone-to-v3/src/classifier/component-detector.ts (Phase 45).
 */
import type { ComputedStyleSnapshot, SectionInfo, ComponentDetectionResult } from '@elconv/core';
import type { V3LayoutPattern } from './types.js';
import { detectRepeatedStructures } from './detect-by-structure.js';
import { classifyByVision, type VisionCallFn } from './detect-by-vision.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempt to detect one of the 7 extended patterns (synchronous, keyword-based).
 */
export function detectComponent(
  section: SectionInfo,
  snap: ComputedStyleSnapshot,
  allSnapshots: ComputedStyleSnapshot[],
): V3LayoutPattern | null {
  const children = directChildren(section.selector, allSnapshots);

  if (isStats(section, snap, children)) return 'stats';
  if (isTestimonials(section, snap, children)) return 'testimonials';
  if (isPricing(section, snap, children)) return 'pricing';
  if (isFaq(section, snap, children)) return 'faq';
  if (isAccordion(section, snap, children)) return 'accordion';
  if (isTimeline(section, snap, children)) return 'timeline';
  if (isTabs(section, snap, children)) return 'tabs';

  return null;
}

// ---------------------------------------------------------------------------
// Modul A2 — Multi-Layer Component Detection (Konsens-Bildung)
// ---------------------------------------------------------------------------

export interface DetectionInput {
  section: SectionInfo;
  snapshots: ComputedStyleSnapshot[];
  pageScreenshotPath?: string;
  callVision?: VisionCallFn;
}

function detectByKeyword(
  section: SectionInfo,
  snap: ComputedStyleSnapshot,
  allSnapshots: ComputedStyleSnapshot[],
): { type: string; evidence: string } | null {
  const pattern = detectComponent(section, snap, allSnapshots);
  if (!pattern) return null;
  return { type: pattern, evidence: `Keyword-Match für Muster "${pattern}"` };
}

/**
 * Modul A2: 3-Schichten-Konsens-Bildung (Struktur → Vision → Keyword).
 */
export async function detectComponentMultiLayer(input: DetectionInput): Promise<ComponentDetectionResult> {
  const structResult = detectRepeatedStructures(input.section, input.snapshots);
  if (structResult && structResult.confidence >= 0.6) {
    return {
      type: structResult.type,
      confidence: structResult.confidence,
      evidence: structResult.evidence,
      layer: 'structure',
    };
  }

  if (input.pageScreenshotPath && input.callVision) {
    const visionResult = await classifyByVision(input.section, input.pageScreenshotPath, input.callVision);
    if (visionResult && visionResult.confidence >= 0.7) {
      return {
        type: visionResult.type,
        confidence: visionResult.confidence,
        evidence: visionResult.layoutDescription,
        layer: 'vision',
      };
    }
  }

  const keywordResult = detectByKeyword(input.section, input.snapshots[0], input.snapshots);
  if (keywordResult) {
    return { type: keywordResult.type, confidence: 0.3, evidence: keywordResult.evidence, layer: 'keyword' };
  }

  return { type: 'unknown', confidence: 0, evidence: 'keine Signale', layer: 'unknown' };
}

// ---------------------------------------------------------------------------
// Pattern detectors
// ---------------------------------------------------------------------------

function isStats(section: SectionInfo, snap: ComputedStyleSnapshot, children: ComputedStyleSnapshot[]): boolean {
  if (selectorHasAny(section.selector, ['stat', 'counter', 'metric', 'achievement', 'impact', 'count'])) return true;
  const display = snap.styles['display'];
  const colCount = children.length;
  if (colCount < 3 || colCount > 8) return false;
  const isRow =
    (display === 'flex' && snap.styles['flex-direction'] !== 'column') ||
    (display === 'grid' && countGridCols(snap.styles['grid-template-columns']) >= 3);
  if (!isRow) return false;
  return children.some((c) => {
    const fs = parsePx(c.styles['font-size']);
    return fs !== null && fs >= 32;
  });
}

function isTestimonials(section: SectionInfo, _snap: ComputedStyleSnapshot, children: ComputedStyleSnapshot[]): boolean {
  if (selectorHasAny(section.selector, ['testimonial', 'review', 'quote', 'feedback', 'client', 'customer'])) return true;
  const hasBlockquote = children.some((c) => c.tag === 'blockquote' || c.tag === 'q' || c.tag === 'cite');
  if (hasBlockquote) return true;
  return children.some((c) => {
    if (c.tag !== 'img') return false;
    const br = c.styles['border-radius'];
    if (!br) return false;
    if (br.includes('%')) return parseFloat(br) >= 40;
    return false;
  });
}

function isPricing(section: SectionInfo, snap: ComputedStyleSnapshot, children: ComputedStyleSnapshot[]): boolean {
  if (selectorHasAny(section.selector, ['pricing', 'price', 'plan', 'tier', 'package'])) return true;
  const display = snap.styles['display'];
  const colCount = children.length;
  if (colCount < 2 || colCount > 5) return false;
  const isMultiCol = display === 'grid' || (display === 'flex' && snap.styles['flex-direction'] !== 'column');
  if (!isMultiCol) return false;
  return children.some((c) => selectorHasAny(c.selector, ['price', 'plan', 'tier', 'card']));
}

function isFaq(section: SectionInfo, _snap: ComputedStyleSnapshot, children: ComputedStyleSnapshot[]): boolean {
  if (selectorHasAny(section.selector, ['faq', 'q-a', 'qa', 'questions', 'answer'])) return true;
  if (children.length < 4) return false;
  const headingTags = new Set(['h2', 'h3', 'h4', 'dt']);
  const headingCount = children.filter((c) => headingTags.has(c.tag)).length;
  return headingCount >= Math.ceil(children.length / 2);
}

function isAccordion(section: SectionInfo, _snap: ComputedStyleSnapshot, children: ComputedStyleSnapshot[]): boolean {
  if (selectorHasAny(section.selector, ['accordion', 'collapse', 'expandable', 'toggle', 'expand'])) return true;
  const detailsCount = children.filter((c) => c.tag === 'details' || c.tag === 'summary').length;
  return detailsCount >= 2;
}

function isTimeline(section: SectionInfo, snap: ComputedStyleSnapshot, children: ComputedStyleSnapshot[]): boolean {
  if (selectorHasAny(section.selector, ['timeline', 'steps', 'process', 'roadmap', 'history', 'milestone'])) return true;
  if (children.length < 3) return false;
  const isVertical = snap.styles['display'] === 'flex' && snap.styles['flex-direction'] === 'column';
  if (!isVertical) return false;
  const withLeftBorder = children.filter((c) => {
    const bl = c.styles['border-left'] ?? c.styles['border-left-width'];
    return bl && bl !== '0px' && bl !== 'none';
  }).length;
  return withLeftBorder >= Math.ceil(children.length / 2);
}

function isTabs(section: SectionInfo, snap: ComputedStyleSnapshot, children: ComputedStyleSnapshot[]): boolean {
  if (selectorHasAny(section.selector, ['tabs', 'tablist', 'tab-nav', 'tab-panel', 'tabpanel'])) return true;
  if (children.some((c) => selectorHasAny(c.selector, ['tab', 'nav-tab', 'tab-item']))) return true;
  const display = snap.styles['display'];
  const overflow = snap.styles['overflow'];
  if (display === 'flex' && overflow === 'hidden' && children.length >= 3 && children.length <= 7) {
    const widths = children.map((c) => parsePx(c.styles['width']) ?? 0).filter((w) => w > 0);
    if (widths.length >= 3) {
      const sorted = [...widths].sort((a, b) => a - b);
      const range = sorted[sorted.length - 1] - sorted[0];
      return range < 10;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function directChildren(parentSel: string, snapshots: ComputedStyleSnapshot[]): ComputedStyleSnapshot[] {
  const prefix = `${parentSel} > `;
  return snapshots.filter((s) => s.selector.startsWith(prefix));
}

function selectorHasAny(selector: string, keywords: string[]): boolean {
  const lower = selector.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

function parsePx(value: string | undefined): number | null {
  if (!value) return null;
  const m = value.match(/^(-?\d+(?:\.\d+)?)px$/);
  return m ? parseFloat(m[1]) : null;
}

function countGridCols(gridTemplateCols: string | undefined): number {
  if (!gridTemplateCols) return 0;
  const m = gridTemplateCols.match(/repeat\(\s*(\d+)\s*,/);
  if (m) return parseInt(m[1], 10);
  return gridTemplateCols.trim().split(/\s+/).length;
}
