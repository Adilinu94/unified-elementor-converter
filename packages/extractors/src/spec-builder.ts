/**
 * spec-builder — converts extracted DOM + assets into a PageSpec (V2 Phase 2).
 *
 * Strategy:
 *   1. Take SectionInfo[] from detectSections() (already merged via mergeSmallSections()).
 *   2. For each section, classify its `kind` (hero / features / footer / etc.) by
 *      class-name heuristics (data-section, role, Bricks class, etc.).
 *   3. For each section, walk its children, detect headings/paragraphs/images/buttons
 *      via tag-name + class heuristics, and emit WidgetSpec entries.
 *   4. Combine with DesignTokens (resolved separately) into a PageSpec.
 *
 * This module does NOT touch the live DOM — it operates on the in-memory
 * SectionInfo + asset list produced by the extractor. That keeps it testable
 * with synthetic fixtures.
 */

import type {
  PageSpec,
  SectionSpec,
  SectionKind,
  WidgetSpec,
  WidgetKind,
  DesignTokensSnapshot,
} from './spec-schema.js';
import { emptyTokens } from './spec-schema.js';

export interface BuildSpecInput {
  sourceUrl: string;
  sections: Array<{
    section_id: string;
    selector: string;
    y_range: [number, number];
    layout: string;
    child_count: number;
    tag: string;
    id?: string;
    classes: string;
    /** Optional: resolved kind + widget list from a deeper DOM-walk. */
    resolved?: ResolvedSection;
  }>;
  tokens?: DesignTokensSnapshot;
  hasHeader?: boolean;
  hasFooter?: boolean;
  sourceFramework?: PageSpec['sourceFramework'];
  assetSummary?: PageSpec['assetSummary'];
}

export interface ResolvedSection {
  kind: SectionKind;
  widgets: Array<{
    kind: WidgetKind;
    widget_id: string;
    text?: string;
    asset?: string;
    href?: string;
    style?: Record<string, string>;
  }>;
  notes?: string[];
}

/** Heuristic classifier for a section based on its tag + classes. */
export function classifySectionKind(input: {
  tag: string;
  id?: string;
  classes: string;
  childCount: number;
}): SectionKind {
  const cls = (input.classes || '').toLowerCase();
  const id = (input.id || '').toLowerCase();
  if (input.tag === 'header' || cls.includes('header') || id.includes('header') || cls.includes('site-header'))
    return 'header';
  if (input.tag === 'footer' || cls.includes('footer') || id.includes('footer') || cls.includes('site-footer'))
    return 'footer';
  if (cls.includes('hero') || id.includes('hero')) return 'hero';
  if (cls.includes('feature') || id.includes('feature') || cls.includes('leistungen')) return 'features';
  if (cls.includes('cta') || id.includes('cta') || cls.includes('call-to-action') || cls.includes('banner')) return 'cta';
  if (cls.includes('testimonial') || cls.includes('review') || cls.includes('kundenstimme')) return 'testimonials';
  if (cls.includes('pricing') || cls.includes('preis') || cls.includes('tarif')) return 'pricing';
  if (cls.includes('team') || cls.includes('mitarbeiter')) return 'team';
  if (cls.includes('gallery') || cls.includes('galerie') || cls.includes('portfolio')) return 'gallery';
  if (cls.includes('contact') || cls.includes('kontakt') || cls.includes('form')) return 'contact';
  if (cls.includes('stat') || cls.includes('zahl') || cls.includes('counter')) return 'stats';
  if (cls.includes('faq') || cls.includes('frage')) return 'faq';
  return 'generic';
}

/** Generate a stable widget id within a section. */
function widgetId(sectionId: string, idx: number, kind: WidgetKind): string {
  return `${sectionId}-${kind}-${idx}`;
}

/** Convert a ResolvedSection into a SectionSpec. */
export function buildSectionSpec(
  section: BuildSpecInput['sections'][number],
): SectionSpec {
  const autoKind = classifySectionKind({
    tag: section.tag,
    id: section.id,
    classes: section.classes,
    childCount: section.child_count,
  });
  const resolved: ResolvedSection = section.resolved ?? {
    kind: autoKind,
    widgets: [],
    notes: [
      `auto-classified as "${autoKind}" from tag/classes (no deep walk)`,
    ],
  };

  const widgets: WidgetSpec[] = resolved.widgets.map((w, idx) => ({
    kind: w.kind,
    widget_id: w.widget_id || widgetId(section.section_id, idx, w.kind),
    text: w.text,
    asset: w.asset,
    href: w.href,
    style: w.style,
  }));

  return {
    section_id: section.section_id,
    kind: resolved.kind,
    y_range: section.y_range,
    selector: section.selector,
    widgets,
    notes: resolved.notes,
  };
}

/** Build a complete PageSpec from extracted inputs. */
export function buildPageSpec(input: BuildSpecInput): PageSpec {
  const warnings: string[] = [];
  const sections = input.sections.map((s) => buildSectionSpec(s));

  // Header/footer detection: any section already classified as such
  const hasHeader =
    input.hasHeader ?? sections.some((s) => s.kind === 'header');
  const hasFooter =
    input.hasFooter ?? sections.some((s) => s.kind === 'footer');

  if (!input.tokens) {
    warnings.push('No design tokens provided — using empty token snapshot');
  }

  return {
    schemaVersion: '2.0',
    sourceUrl: input.sourceUrl,
    extractedAt: new Date().toISOString(),
    sectionCount: sections.length,
    hasHeader,
    hasFooter,
    sourceFramework: input.sourceFramework ?? 'unknown',
    tokens: input.tokens ?? emptyTokens(),
    sections,
    assetSummary: input.assetSummary ?? { images: 0, svgs: 0, fonts: 0, favicons: 0 },
    warnings,
  };
}