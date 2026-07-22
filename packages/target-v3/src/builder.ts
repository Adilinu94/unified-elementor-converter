/**
 * V3 Builder: SourceSpec → V3Element[]
 * KRITISCH: Output enthält NUR V3-Typen (container, section, column, widget).
 * NIEMALS e-flexbox, $$type, oder andere V4-Konstrukte.
 */

import type { SourceSpec, SectionSpec, WidgetSpec, WidgetType } from '@elconv/core';
import type { V3Element, V3PageData } from './types.js';

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
 */
export function buildV3Tree(spec: SourceSpec): V3Element[] {
  return spec.sections.map((section) => buildSection(section));
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

function buildSection(section: SectionSpec): V3Element {
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

function buildWidget(widget: WidgetSpec): V3Element {
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
