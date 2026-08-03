/**
 * V3 Builder: SourceSpec → V3Element[]
 * KRITISCH: Output enthält NUR V3-Typen (container, section, column, widget).
 * NIEMALS e-flexbox, $$type, oder andere V4-Konstrukte.
 *
 * Enhanced with SiteSpec→V3BuilderResult path (Phase 7) and V1 PageData writer
 * with token constraints. Ported from site-clone-to-v3/src/builder/v3-builder.ts
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { selectSpecSections, type SourceSpec, type SectionSpec as CoreSectionSpec, type WidgetSpec as CoreWidgetSpec, type WidgetType, type BuildOptions } from '@elconv/core';
import type { SectionSpec as ClassifiedSectionSpec, WidgetSpec as ClassifiedWidgetSpec } from './classifier/types.js';
import { enforceColorsInSettings, type TokenConstraintSet } from '@elconv/core';
import type { V3Element, V3PageData } from './types.js';
import type { TokenDriftWarning } from '@elconv/core';
import {
  buildSection as buildSectionModel,
  isInnerSection,
  type BuiltSection,
  type SectionBase,
  type SectionStructureType,
  type MultiColumnSpec,
} from './section.js';
import {
  generateColumnCss,
  normalizeMultiColumn,
  validateMultiColumnLayout,
  type GapSpec,
  type MultiColumnLayout,
} from './multi-column.js';
import { sectionClassName } from './animation-injector.js';

/** Generate a V3-compatible 7-character hex element ID. */
export function v3Id(): string {
  return randomBytes(4).toString('hex').substring(0, 7);
}

let idCounter = 0;
function genId(): string {
  return `v3_${(++idCounter).toString(36)}_${Date.now().toString(36).slice(-4)}`;
}

/** Reset ID counter (for deterministic tests) */
export function resetIdCounter(): void {
  idCounter = 0;
}

/** Widget type mapping: SourceSpec WidgetType → V3 widgetType */
const WIDGET_MAP: Record<WidgetType, string> = {
  heading: 'heading',
  text: 'text-editor',
  image: 'image',
  button: 'button',
  icon: 'icon',
  video: 'video',
  divider: 'divider',
  spacer: 'spacer',
  html: 'html',
  form: 'form',
  accordion: 'accordion',
  container: 'container',
};

/**
 * Convert a version-agnostic SourceSpec into a V3 element tree.
 *
 * `options.sections` filters which sections are built (match by section id,
 * semanticRole or cssClass); without it every section is built. `strictness`,
 * `animations` and `fonts` are accepted for adapter parity — the plain builder
 * does not yet consume them (the URL pipeline does), so they are carried
 * through unchanged.
 */
export function buildV3Tree(spec: SourceSpec, options: BuildOptions = {}): V3Element[] {
  return selectSpecSections(spec, options.sections).map((section) => buildSection(section));
}

/**
 * Build full V3PageData with metadata.
 */
export function buildV3PageData(spec: SourceSpec, title?: string): V3PageData {
  const content = buildV3Tree(spec);
  const widgetCount = countWidgets(content);

  return {
    title: title ?? 'Converted Page',
    status: 'draft',
    type: 'page',
    content,
    version: '0.1.0',
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceUrl: spec.source.url ?? spec.source.xmlPath ?? spec.source.htmlPath ?? 'unknown',
      sectionCount: content.length,
      widgetCount,
    },
  };
}

function buildSection(section: CoreSectionSpec): V3Element {
  const sectionStyles: Record<string, unknown> = {};

  // Map section styles to Elementor V3 settings
  if (section.styles['background-color']) {
    sectionStyles.background_color = section.styles['background-color'];
  }
  if (section.styles['padding']) {
    sectionStyles.padding = { unit: 'px', ...parsePadding(section.styles['padding']) };
  }

  const widgets = section.widgets.map((w) => buildWidget(w));

  // Determine layout structure
  if (section.layout === 'single-column') {
    return {
      id: genId(),
      elType: 'container',
      settings: {
        content_width: 'boxed',
        flex_direction: 'column',
        ...sectionStyles,
      },
      elements: widgets,
      isInner: false,
    };
  }

  // Multi-column / grid / flex-row: wrap in container with columns
  const columns = section.columns ?? 2;
  const columnWidth = Math.floor(100 / columns);
  const columnElements: V3Element[] = [];

  for (let i = 0; i < columns; i++) {
    const colWidgets = widgets.filter((_, idx) => idx % columns === i);
    columnElements.push({
      id: genId(),
      elType: 'container',
      settings: {
        flex_direction: 'column',
        _inline_size: { unit: '%', size: columnWidth },
      },
      elements: colWidgets,
      isInner: true,
    });
  }

  return {
    id: genId(),
    elType: 'container',
    settings: {
      content_width: 'boxed',
      flex_direction: 'row',
      ...sectionStyles,
    },
    elements: columnElements,
    isInner: false,
  };
}

function buildWidget(widget: CoreWidgetSpec): V3Element {
  const widgetType = WIDGET_MAP[widget.type] ?? 'html';
  const settings: Record<string, unknown> = {};

  switch (widget.type) {
    case 'heading':
      settings.title = widget.text ?? '';
      settings.header_size = inferHeadingSize(widget.styles);
      if (widget.styles['color']) settings.title_color = widget.styles['color'];
      if (widget.styles['font-family']) settings.typography_typography = 'custom';
      break;

    case 'text':
      settings.editor = widget.text ?? '';
      if (widget.styles['color']) settings.text_color = widget.styles['color'];
      break;

    case 'image':
      settings.image = { url: widget.imageUrl ?? '', id: '' };
      if (widget.styles['border-radius']) settings.image_border_radius = widget.styles['border-radius'];
      break;

    case 'button':
      settings.text = widget.text ?? 'Click';
      settings.link = { url: widget.href ?? '#', is_external: '', nofollow: '' };
      if (widget.styles['background-color']) settings.background_color = widget.styles['background-color'];
      if (widget.styles['color']) settings.button_text_color = widget.styles['color'];
      break;

    case 'icon':
      settings.selected_icon = { value: widget.text ?? 'fas fa-star', library: 'fa-solid' };
      break;

    case 'video':
      settings.video_type = 'youtube';
      settings.youtube_url = widget.href ?? '';
      break;

    case 'spacer':
      settings.space = { unit: 'px', size: parseInt(widget.styles['height'] ?? '40', 10) };
      break;

    case 'html':
      settings.html = widget.text ?? '';
      break;

    case 'container':
      // Nested container
      return {
        id: genId(),
        elType: 'container',
        settings: { flex_direction: 'column' },
        elements: (widget.children ?? []).map((c) => buildWidget(c)),
        isInner: true,
      };

    default:
      settings.html = widget.text ?? '';
      break;
  }

  return {
    id: genId(),
    elType: 'widget',
    widgetType,
    settings,
  };
}

function inferHeadingSize(styles: Record<string, string>): string {
  const fontSize = parseInt(styles['font-size'] ?? '32', 10);
  if (fontSize >= 48) return 'h1';
  if (fontSize >= 36) return 'h2';
  if (fontSize >= 28) return 'h3';
  if (fontSize >= 22) return 'h4';
  return 'h5';
}

function parsePadding(padding: string): Record<string, number> {
  const parts = padding.replace(/px/g, '').trim().split(/\s+/).map(Number);
  if (parts.length === 1) {
    return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
  }
  if (parts.length === 2) {
    return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
  }
  if (parts.length === 4) {
    return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
  }
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

function countWidgets(elements: V3Element[]): number {
  let count = 0;
  for (const el of elements) {
    if (el.elType === 'widget') count++;
    if (el.elements) count += countWidgets(el.elements);
  }
  return count;
}

// ============================================================================
// Phase 7 — SiteSpec → V3/V4 output (ported from v3-builder.ts)
// ============================================================================

export type OutputFormat = 'v3' | 'v4';

export interface V3BuilderOptions {
  format?: OutputFormat;
  flattenInnerSections?: boolean;
  defaultStructureType?: SectionStructureType;
  defaultGap?: GapSpec;
}

export interface SiteSpec {
  pages?: Array<SectionBase & { children?: SectionBase[] }>;
}

export interface V3BuilderMetadata {
  sectionCount: number;
  multiColumnCount: number;
  innerSectionCount: number;
  format: OutputFormat;
  generatedAt?: string;
}

export interface MultiColumnOutput {
  id: string;
  columns: number;
  ratio: string;
  css: string;
  gap: GapSpec;
}

export interface V3BuilderResult {
  format: OutputFormat;
  sections: BuiltSection[];
  metadata: V3BuilderMetadata;
}

export function buildSectionsFromSiteSpec(
  spec: SiteSpec,
  options: V3BuilderOptions = {},
): BuiltSection[] {
  const pages = spec.pages ?? [];
  const out: BuiltSection[] = [];
  for (const page of pages) {
    const structure = page.structure ?? options.defaultStructureType ?? 'content';
    const section = buildSectionModel({ ...page, structure });
    out.push(section);
    if (page.children && page.children.length > 0) {
      for (const child of page.children) {
        out.push(
          buildSectionModel({
            ...child,
            structure: child.structure ?? 'inner-section',
            parentSectionId: section.id,
          }),
        );
      }
    }
  }
  return out;
}

export function buildV3Output(spec: SiteSpec, options: V3BuilderOptions = {}): V3BuilderResult {
  const format: OutputFormat = options.format ?? 'v3';
  let sections = buildSectionsFromSiteSpec(spec, options);
  if (options.flattenInnerSections) {
    sections = flattenInnerSections(sections);
  }
  return {
    format,
    sections,
    metadata: {
      sectionCount: sections.length,
      multiColumnCount: sections.filter((s) => s.structure === 'multi-column' || s.columns > 1).length,
      innerSectionCount: sections.filter((s) => isInnerSection(s)).length,
      format,
      generatedAt: new Date().toISOString(),
    },
  };
}

export function buildMultiColumnOutput(
  id: string,
  layout: MultiColumnLayout,
): MultiColumnOutput {
  const normalized = normalizeMultiColumn(layout);
  const gap = layout.gap ?? { unit: 'px' as const, value: 20 };
  const css = generateColumnCss(normalized.columns, normalized.ratio, gap);
  return {
    id,
    columns: normalized.columns,
    ratio: normalized.ratio,
    css,
    gap,
  };
}

export function countSections(sections: BuiltSection[]): number {
  return sections.length;
}

export function flattenInnerSections(sections: BuiltSection[]): BuiltSection[] {
  const out: BuiltSection[] = [];
  for (const s of sections) {
    out.push(s);
    if (s.innerSections && s.innerSections.length > 0) {
      for (const inner of s.innerSections) {
        out.push(
          buildSectionModel({
            id: inner.id,
            structure: 'inner-section',
            parentSectionId: s.id,
            columns: inner.columns,
          }),
        );
      }
    }
  }
  return out;
}

export interface BuilderValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateBuilderResult(result: V3BuilderResult): BuilderValidationResult {
  const errors: string[] = [];
  if (!result.sections || result.sections.length === 0) {
    errors.push('sections array must not be empty');
  }
  const ids = new Set<string>();
  for (const s of result.sections) {
    if (!s.id) {
      errors.push('section.id is required');
    } else if (ids.has(s.id)) {
      errors.push(`Duplicate section id: ${s.id}`);
    } else {
      ids.add(s.id);
    }
  }
  for (const s of result.sections) {
    if (s.structure === 'multi-column' || s.columns > 1) {
      const layout: MultiColumnLayout = { columns: s.columns, ratio: '50-50' };
      const v = validateMultiColumnLayout(layout);
      if (!v.ok) {
        for (const err of v.errors) errors.push(`section ${s.id}: ${err}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export type { MultiColumnSpec };

// ============================================================================
// V1 — V3PageData writer (preserved for pipeline compatibility)
// ============================================================================

type SettingsMap = Record<string, unknown>;

const V3_VERSION = '0.4';

function applySettings(
  base: Record<string, unknown>,
  settings: SettingsMap,
  breakpoint: 'desktop' | 'tablet' | 'mobile',
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  const suffix = breakpoint === 'desktop' ? '' : `_${breakpoint}`;
  for (const [k, v] of Object.entries(settings)) {
    if (breakpoint === 'desktop') {
      result[k] = v;
    } else if (v !== undefined) {
      result[`${k}${suffix}`] = v;
    }
  }
  return result;
}

function buildWidgetV1(
  widget: ClassifiedWidgetSpec,
  breakpoint: 'desktop' | 'tablet' | 'mobile',
  tokenConstraints: TokenConstraintSet | undefined,
  warnings: TokenDriftWarning[],
): V3Element {
  let settings = applySettings({}, widget.settings as SettingsMap ?? {}, breakpoint);
  if (tokenConstraints) {
    const enforced = enforceColorsInSettings(settings, tokenConstraints);
    settings = enforced.settings;
    warnings.push(...enforced.warnings);
  }
  return {
    id: v3Id(),
    elType: 'widget',
    widgetType: widget.type,
    settings,
  };
}

function buildSectionV1(
  section: ClassifiedSectionSpec,
  breakpoint: 'desktop' | 'tablet' | 'mobile',
  tokenConstraints: TokenConstraintSet | undefined,
  warnings: TokenDriftWarning[],
): V3Element {
  const animationClass = sectionClassName(section.section_id);
  const flatWidgets: ClassifiedWidgetSpec[] = section.v3_section.columns.flatMap((c) => c.widgets);
  const widgets = flatWidgets.map((w) => buildWidgetV1(w, breakpoint, tokenConstraints, warnings));
  const layout: SettingsMap = section.v3_section.settings;
  const containerWidth = 1200;

  return {
    id: v3Id(),
    elType: 'section',
    settings: applySettings(
      {
        content_width: { size: containerWidth, unit: 'px' },
        gap: 'no',
        _css_classes: animationClass,
        custom_css: `.${animationClass} { animation-fill-mode: both; }`,
      },
      layout,
      breakpoint,
    ),
    elements: [
      {
        id: v3Id(),
        elType: 'column',
        settings: { _column_size: 100, _inline_size: null },
        elements: widgets,
      },
    ],
  };
}

export interface BuildV3PageDataOptions {
  /** When given, every widget's color settings are snapped to this set. */
  tokenConstraints?: TokenConstraintSet;
}

export function buildV3PageDataFromSections(
  sections: ClassifiedSectionSpec[],
  sourceUrl: string,
  title = 'Cloned Page',
  options: BuildV3PageDataOptions = {},
): V3PageData {
  const warnings: TokenDriftWarning[] = [];
  const content = sections.map((s) => buildSectionV1(s, 'desktop', options.tokenConstraints, warnings));
  return {
    title,
    status: 'draft',
    type: 'page',
    content,
    version: V3_VERSION,
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceUrl,
      sectionCount: sections.length,
      widgetCount: content.reduce(
        (sum, s) => sum + (s.elements?.[0]?.elements?.length ?? 0),
        0,
      ),
    },
  };
}

export async function writeV3PageData(
  pageData: V3PageData,
  outputPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(pageData, null, 2), 'utf-8');
}
