/**
 * spec.json — Source-of-Truth schema (V2 Phase 2).
 *
 * Why JSON instead of markdown (V2 §5.5 Korrektur):
 *   - Builder, Auto-Fix-Loop, and Tests all need to consume this file.
 *     Markdown is hard to parse reliably; JSON + TypeScript gives us
 *     schema validation for free.
 *   - We can generate human-readable .md alongside .json for code review.
 *
 * The schema is intentionally minimal at the top level — it captures
 * "what to build" without prescribing "how to build it" (that's the V3-Builder's
 * job). Each section has a `kind` discriminator (hero / features / cta / etc.)
 * and a `widgets` array describing the visual children.
 *
 * Asset URLs in the spec MUST be local paths (not the original source URL) —
 * Phase 1 downloads assets BEFORE writing the spec (V2 §2.2 data flow).
 */

export type SectionKind =
  | 'hero'
  | 'features'
  | 'cta'
  | 'testimonials'
  | 'pricing'
  | 'team'
  | 'gallery'
  | 'contact'
  | 'stats'
  | 'faq'
  | 'header'
  | 'footer'
  | 'generic';

export type WidgetKind =
  | 'heading'
  | 'text'
  | 'button'
  | 'image'
  | 'video'
  | 'icon'
  | 'icon-box'
  | 'divider'
  | 'spacer'
  | 'form'
  | 'counter'
  | 'testimonial-card'
  | 'gallery-item'
  | 'nav-menu'
  | 'social-icons'
  | 'html';

export interface TokenRef {
  /** Path inside the DesignTokens, e.g. "colors.primary", "spacing.sectionY". */
  path: string;
  /** Optional fallback literal used if token resolution fails. */
  fallback?: string;
}

export interface WidgetSpec {
  kind: WidgetKind;
  /** Stable id within the section (used by V3-Builder for `_id`). */
  widget_id: string;
  /** Inner text content for heading/text/button. */
  text?: string;
  /** Local asset path (already downloaded) — relative to assets root. */
  asset?: string;
  /** href for button/link widgets. May be '#' for placeholder. */
  href?: string;
  /** Optional inline style overrides (any CSS property). */
  style?: Record<string, string>;
  /** Token references resolved at build time. */
  tokens?: Record<string, TokenRef>;
  /** Widget-specific options. */
  options?: Record<string, unknown>;
}

export interface SectionSpec {
  /** Stable id (matches SectionInfo.section_id from extractor). */
  section_id: string;
  kind: SectionKind;
  /** Y-range in the source page (px). */
  y_range: [number, number];
  /** DOM selector of the source element. */
  selector: string;
  /** Section-level style overrides. */
  style?: Record<string, string>;
  /** Token references for section-level styling. */
  tokens?: Record<string, TokenRef>;
  /** Children widgets in render order. */
  widgets: WidgetSpec[];
  /** Optional notes from auto-detection (e.g. "looks like hero because..."). */
  notes?: string[];
}

export interface DesignTokensSnapshot {
  colors: Record<string, string>;
  fonts: Record<string, string>;
  spacing: Record<string, string>;
  radii: Record<string, string>;
  shadows: Record<string, string>;
  /** Original CSS variable names if available. */
  cssVariables?: Record<string, string>;
}

export interface PageSpec {
  /** Schema version. Bump on breaking changes. */
  schemaVersion: '2.0';
  /** Source URL the spec was extracted from. */
  sourceUrl: string;
  /** ISO timestamp of extraction. */
  extractedAt: string;
  /** Total number of sections (including header/footer). */
  sectionCount: number;
  /** Whether the source page has an Elementor-friendly structure. */
  hasHeader: boolean;
  hasFooter: boolean;
  /** Detected framework (best-effort). */
  sourceFramework?: 'bricks' | 'elementor' | 'framer' | 'webflow' | 'next' | 'wordpress' | 'unknown';
  /** Resolved design tokens (Phase 6 output, included for builder convenience). */
  tokens: DesignTokensSnapshot;
  /** Sections in render order (top to bottom). */
  sections: SectionSpec[];
  /** Asset manifest summary (counts only). */
  assetSummary: {
    images: number;
    svgs: number;
    fonts: number;
    favicons: number;
  };
  /** Warnings generated during spec extraction (e.g. unresolved tokens). */
  warnings: string[];
}

/** Quick type guard for runtime validation in tests. */
export function isPageSpec(value: unknown): value is PageSpec {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === '2.0' &&
    typeof v.sourceUrl === 'string' &&
    typeof v.sectionCount === 'number' &&
    Array.isArray(v.sections) &&
    typeof v.tokens === 'object' &&
    Array.isArray(v.warnings)
  );
}

/** Empty DesignTokens snapshot — useful as a default. */
export function emptyTokens(): DesignTokensSnapshot {
  return { colors: {}, fonts: {}, spacing: {}, radii: {}, shadows: {} };
}