/**
 * V4 Builder: SourceSpec → V4TreeNode[]
 * KRITISCH: Output enthält NUR V4-Typen (e-flexbox, e-heading, etc.)
 * mit $$type wrapped settings und styles{} maps.
 * NIEMALS elType: 'container' oder V3 widget names.
 */

import type { SourceSpec, SectionSpec, WidgetSpec, WidgetType } from '@elconv/core';
import type { V4TreeNode, V4StyleClass } from './types.js';
import { wrapSize, wrapColor, wrapImageSrc, wrapHtmlContent } from './framer-utils.js';
import { generateStyleId, resetStyleIdCounter } from './style-id.js';

let idCounter = 0;
function genId(): string {
  return `v4_${(++idCounter).toString(36)}_${Date.now().toString(36).slice(-4)}`;
}

export function resetV4IdCounter(): void {
  idCounter = 0;
  resetStyleIdCounter();
}

/** Widget type mapping: SourceSpec WidgetType → V4 type */
const WIDGET_MAP: Record<WidgetType, string> = {
  heading: 'e-heading',
  text: 'e-paragraph',
  image: 'e-image',
  button: 'e-button',
  icon: 'e-icon',
  video: 'e-video',
  divider: 'e-divider',
  spacer: 'e-spacer',
  html: 'e-html',
  form: 'e-form',
  accordion: 'e-div-block',
  container: 'e-flexbox',
};

/**
 * Convert a version-agnostic SourceSpec into a V4 Atomic tree.
 */
export function buildV4Tree(spec: SourceSpec): V4TreeNode[] {
  return spec.sections.map((section) => buildSection(section));
}

function buildSection(section: SectionSpec): V4TreeNode {
  const styleId = generateStyleId(section.semanticRole ?? 'section');
  const styles: Record<string, V4StyleClass> = {};

  // Build section-level style class
  const props: Record<string, unknown> = {};
  if (section.styles['background-color']) {
    props.background_color = wrapColor(section.styles['background-color']);
  }
  if (section.styles['padding']) {
    const px = parseInt(section.styles['padding'], 10) || 0;
    props.padding = wrapSize(px);
  }

  if (Object.keys(props).length > 0) {
    styles[styleId] = {
      id: styleId,
      label: section.semanticRole ?? 'section',
      type: 'class',
      variants: [{ meta: { breakpoint: null, state: null }, props, custom_css: null }],
    };
  }

  const children = section.widgets.map((w) => buildWidget(w));

  // Determine layout
  const isRow = section.layout === 'multi-column' || section.layout === 'grid' || section.layout === 'flex-row';

  return {
    type: 'e-flexbox',
    elType: 'e-flexbox',
    widgetType: 'e-flexbox',
    id: genId(),
    settings: {
      flex_direction: isRow ? 'row' : 'column',
      ...(section.columns ? { gap: wrapSize(16) } : {}),
    },
    styles,
    elements: children,
  };
}

function buildWidget(widget: WidgetSpec): V4TreeNode {
  const v4Type = WIDGET_MAP[widget.type] ?? 'e-html';
  const settings: Record<string, unknown> = {};
  const styles: Record<string, V4StyleClass> = {};
  const styleId = generateStyleId(widget.type);
  const props: Record<string, unknown> = {};

  switch (widget.type) {
    case 'heading':
      settings.title = widget.text ?? '';
      settings.tag = inferTag(widget.styles);
      if (widget.styles['color']) props.color = wrapColor(widget.styles['color']);
      if (widget.styles['font-size']) props.font_size = wrapSize(parseInt(widget.styles['font-size'], 10) || 32);
      break;

    case 'text':
      settings.content = widget.text ?? '';
      if (widget.styles['color']) props.color = wrapColor(widget.styles['color']);
      break;

    case 'image':
      settings.image = wrapImageSrc(widget.imageUrl ?? '');
      if (widget.styles['border-radius']) {
        const r = parseInt(widget.styles['border-radius'], 10) || 0;
        props.border_radius = wrapSize(r);
      }
      break;

    case 'button':
      settings.text = widget.text ?? 'Click';
      settings.link = { url: widget.href ?? '#' };
      if (widget.styles['background-color']) props.background_color = wrapColor(widget.styles['background-color']);
      if (widget.styles['color']) props.color = wrapColor(widget.styles['color']);
      break;

    case 'html':
      settings.html = wrapHtmlContent(widget.text ?? '');
      break;

    case 'spacer':
      props.height = wrapSize(parseInt(widget.styles['height'] ?? '40', 10));
      break;

    case 'container':
      return {
        type: 'e-flexbox',
        elType: 'e-flexbox',
        widgetType: 'e-flexbox',
        id: genId(),
        settings: { flex_direction: 'column' },
        styles: {},
        elements: (widget.children ?? []).map((c) => buildWidget(c)),
      };

    default:
      settings.content = widget.text ?? '';
      break;
  }

  if (Object.keys(props).length > 0) {
    styles[styleId] = {
      id: styleId,
      label: widget.type,
      type: 'class',
      variants: [{ meta: { breakpoint: null, state: null }, props, custom_css: null }],
    };
  }

  return {
    type: v4Type,
    elType: v4Type,
    widgetType: v4Type,
    id: genId(),
    settings,
    styles,
  };
}

function inferTag(styles: Record<string, string>): string {
  const fontSize = parseInt(styles['font-size'] ?? '32', 10);
  if (fontSize >= 48) return 'h1';
  if (fontSize >= 36) return 'h2';
  if (fontSize >= 28) return 'h3';
  if (fontSize >= 22) return 'h4';
  return 'h5';
}
