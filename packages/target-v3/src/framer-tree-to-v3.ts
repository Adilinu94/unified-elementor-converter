/**
 * Framer Tree → V3 Element Tree Converter (Phase 65).
 *
 * Generic converter that transforms parsed Framer XML/JSON node trees
 * into valid Elementor V3 element trees using the authoritative setting-map.
 * Replaces ad-hoc per-build scripts.
 *
 * @module target-v3/framer-tree-to-v3
 */

import type { V3Element } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface FramerNode {
  id: string;
  type: 'frame' | 'text' | 'image' | 'stack' | 'component' | 'page' | 'code';
  name: string;
  /** Original normalized XML tag used for safe malformed-input recovery. */
  xmlTag?: string;
  props: Record<string, unknown>;
  children: FramerNode[];
  /** Resolved component structure (if type=component). */
  resolvedChildren?: FramerNode[];
}

export interface ConversionOptions {
  /** Page ID for scoping. */
  pageId?: number;
  /** Maximum depth to convert (default: unlimited). */
  maxDepth?: number;
  /** Skip nodes matching these name patterns. */
  skipPatterns?: string[];
  /** Map of component IDs to their resolved structures. */
  componentMap?: Map<string, FramerNode[]>;
}

/**
 * Compatibility options retained for the skill-based Framer build command.
 * The current converter does not need a separate style registry, but accepting
 * these fields keeps the legacy orchestrator source-compatible.
 */
export interface FramerConvertOptions {
  textStyles?: Record<string, unknown>;
  colorStyles?: Record<string, unknown>;
}

/**
 * Convert the XML shape emitted by the Framer export tooling into the
 * converter's canonical FramerNode representation. This intentionally stays
 * local to target-v3 so the package does not acquire an extractor dependency.
 */
export function framerXmlToV3(xml: string, _styles: FramerConvertOptions = {}): V3Element[] {
  const root = parseFramerXml(xml);
  return convertFramerTree(root.children).elements;
}

/**
 * Legacy text post-processing hook. Text mapping is now performed by
 * convertFramerTree, so this is an explicit no-op rather than a second mapper.
 */
export function autoTextEditor(tree: V3Element[]): V3Element[] {
  return tree;
}

function parseFramerXml(xml: string): { children: FramerNode[] } {
  const root: FramerNode = {
    id: 'root',
    type: 'page',
    name: 'root',
    xmlTag: 'root',
    props: {},
    children: [],
  };
  const stack: FramerNode[] = [root];
  const tagRegex = /<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>/g;
  let match: RegExpExecArray | null;
  let previousTagEnd = 0;

  while ((match = tagRegex.exec(xml)) !== null) {
    appendXmlText(stack[stack.length - 1]!, xml.slice(previousTagEnd, match.index));
    previousTagEnd = tagRegex.lastIndex;
    const [, closing, tagName, rawAttrs, selfClosing] = match;
    if (closing) {
      const normalizedClosing = tagName.toLowerCase();
      let matchingIndex = -1;
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index]!.xmlTag === normalizedClosing) {
          matchingIndex = index;
          break;
        }
      }
      if (matchingIndex > 0) stack.splice(matchingIndex);
      continue;
    }

    const attrs = parseFramerXmlAttributes(rawAttrs);
    const normalized = tagName.toLowerCase();
    const inline = attrs.style ? parseInlineStyle(attrs.style) : {};
    const node: FramerNode = {
      id: attrs.id ?? attrs['data-id'] ?? `${normalized}-${match.index}`,
      type: xmlNodeType(normalized),
      name: attrs.name ?? attrs.id ?? tagName,
      xmlTag: normalized,
      props: {
        ...attrs,
        ...inline,
        ...(attrs['background-color'] || inline['background-color']
          ? { backgroundColor: attrs['background-color'] ?? inline['background-color'] }
          : {}),
        ...(attrs['font-size'] || inline['font-size']
          ? { fontSize: numericOrString(attrs['font-size'] ?? inline['font-size']!) }
          : {}),
        ...(attrs['font-family'] || inline['font-family']
          ? { fontFamily: attrs['font-family'] ?? inline['font-family'] }
          : {}),
        ...(attrs['font-weight'] || inline['font-weight']
          ? { fontWeight: numericOrString(attrs['font-weight'] ?? inline['font-weight']!) }
          : {}),
        ...(attrs['line-height'] || inline['line-height']
          ? { lineHeight: numericOrString(attrs['line-height'] ?? inline['line-height']!) }
          : {}),
        ...(attrs['flex-direction'] || inline['flex-direction']
          ? { stackDirection: attrs['flex-direction'] ?? inline['flex-direction'] }
          : {}),
        ...(attrs.text ? { text: decodeXmlText(attrs.text) } : {}),
        ...(attrs.src ? { src: attrs.src } : {}),
        ...(attrs.href ? { href: attrs.href } : {}),
      },
      children: [],
    };
    stack[stack.length - 1]!.children.push(node);

    if (!selfClosing) stack.push(node);
  }

  appendXmlText(stack[stack.length - 1]!, xml.slice(previousTagEnd));
  return root;
}

function appendXmlText(parent: FramerNode, raw: string): void {
  const text = decodeXmlText(raw).trim();
  if (!text) return;
  const current = parent.props.text;
  parent.props.text = typeof current === 'string' && current ? `${current} ${text}` : text;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function numericOrString(value: string): number | string {
  const numeric = Number(value.replace(/px$/i, '').trim());
  return Number.isFinite(numeric) && value.trim() !== '' ? numeric : value;
}

function parseFramerXmlAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([:\w.-]+)=(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(raw)) !== null) {
    attrs[match[1]!] = decodeXmlText(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

function parseInlineStyle(style: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const declaration of style.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const key = declaration.slice(0, separator).trim();
    const value = declaration.slice(separator + 1).trim();
    if (key && value) values[key] = value;
  }
  return values;
}

function xmlNodeType(tagName: string): FramerNode['type'] {
  if (tagName === 'text' || /^h[1-6]$/.test(tagName) || tagName === 'p') return 'text';
  if (tagName === 'image' || tagName === 'img') return 'image';
  if (tagName === 'stack') return 'stack';
  if (tagName === 'code') return 'code';
  if (tagName === 'component') return 'component';
  if (tagName === 'page') return 'page';
  return 'frame';
}

export interface ConversionResult {
  elements: V3Element[];
  stats: {
    totalNodes: number;
    convertedNodes: number;
    skippedNodes: number;
    sections: number;
    widgets: number;
    containers: number;
  };
  warnings: string[];
}

// ============================================================================
// Node type → Elementor mapping
// ============================================================================

type ElementorWidgetType = 'heading' | 'text-editor' | 'image' | 'button' | 'html' | 'icon' | 'spacer';

/**
 * Name patterns that always mean "this is one leaf widget", regardless of
 * whether the Framer node happens to have internal sub-elements (e.g. a
 * button component with a nested icon+label). Deliberately narrower than
 * inferWidgetType()'s own name matching: 'icon'/'spacer'/'divider' are
 * excluded here because a node with that name MAY legitimately have real
 * children worth preserving as a container — forcing it into a childless
 * leaf widget would silently drop them. See CRITICAL-FAILURE-POINTS.md.
 */
function isNamedWidgetPattern(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes('button') || lower.includes('btn') || lower.includes('cta');
}

function inferWidgetType(node: FramerNode): ElementorWidgetType {
  const name = node.name.toLowerCase();
  const type = node.type;

  if (type === 'text') {
    const fontSize = (node.props['fontSize'] as number) ?? 16;
    return fontSize >= 24 ? 'heading' : 'text-editor';
  }
  if (type === 'image') return 'image';
  if (name.includes('button') || name.includes('btn') || name.includes('cta')) return 'button';
  if (name.includes('icon')) return 'icon';
  if (name.includes('spacer') || name.includes('divider')) return 'spacer';
  if (type === 'code') return 'html';
  return 'text-editor';
}

function isSectionNode(node: FramerNode, depth: number): boolean {
  if (depth !== 0) return false;
  const name = node.name.toLowerCase();
  return (
    node.type === 'frame' || node.type === 'stack'
  ) && (
    name.includes('section') ||
    name.includes('hero') ||
    name.includes('header') ||
    name.includes('footer') ||
    name.includes('nav') ||
    name.includes('stats') ||
    name.includes('service') ||
    name.includes('team') ||
    name.includes('contact') ||
    name.includes('about') ||
    name.includes('process') ||
    node.children.length > 2
  );
}

// ============================================================================
// Core converter
// ============================================================================

/**
 * Convert a Framer node tree to Elementor V3 elements.
 */
export function convertFramerTree(
  nodes: FramerNode[],
  options: ConversionOptions = {},
): ConversionResult {
  const warnings: string[] = [];
  let totalNodes = 0;
  let convertedNodes = 0;
  let skippedNodes = 0;
  let sections = 0;
  let widgets = 0;
  let containers = 0;

  const skipPatterns = options.skipPatterns ?? [];
  const maxDepth = options.maxDepth ?? 20;

  function shouldSkip(node: FramerNode): boolean {
    return skipPatterns.some((p) => node.name.toLowerCase().includes(p.toLowerCase()));
  }

  function mapSettings(node: FramerNode): Record<string, unknown> {
    const settings: Record<string, unknown> = {};
    const props = node.props;

    // Background color
    if (props['backgroundColor'] && props['backgroundColor'] !== 'transparent') {
      settings['background_color'] = props['backgroundColor'];
    }

    // Padding
    const pt = props['paddingTop'] as number | undefined;
    const pr = props['paddingRight'] as number | undefined;
    const pb = props['paddingBottom'] as number | undefined;
    const pl = props['paddingLeft'] as number | undefined;
    if (pt || pr || pb || pl) {
      settings['padding'] = {
        top: pt ?? 0, right: pr ?? 0, bottom: pb ?? 0, left: pl ?? 0,
        unit: 'px', isLinked: false,
      };
    }

    // Flex direction (stacks)
    if (node.type === 'stack' && props['stackDirection']) {
      settings['flex_direction'] = props['stackDirection'] === 'horizontal' ? 'row' : 'column';
    }

    // Gap
    if (props['gap'] && typeof props['gap'] === 'number') {
      settings['flex_gap'] = { column: String(props['gap']), row: String(props['gap']), isLinked: true };
    }

    // Border radius
    if (props['borderRadius'] && typeof props['borderRadius'] === 'number') {
      settings['border_radius'] = {
        top: String(props['borderRadius']), right: String(props['borderRadius']),
        bottom: String(props['borderRadius']), left: String(props['borderRadius']),
        unit: 'px', isLinked: true,
      };
    }

    // Typography (text nodes)
    if (node.type === 'text') {
      settings['typography_typography'] = 'custom';
      if (props['fontSize']) settings['typography_font_size'] = { size: props['fontSize'], unit: 'px' };
      if (props['fontFamily']) settings['typography_font_family'] = props['fontFamily'];
      if (props['fontWeight']) settings['typography_font_weight'] = String(props['fontWeight']);
      if (props['lineHeight']) settings['typography_line_height'] = { size: props['lineHeight'], unit: 'px' };
      if (props['color']) settings['title_color'] = props['color'];
      if (props['textAlign']) settings['align'] = props['textAlign'];
    }

    // Width/height
    if (props['width'] && typeof props['width'] === 'number' && props['width'] > 0) {
      settings['width'] = { size: props['width'], unit: 'px' };
    }
    if (props['height'] && typeof props['height'] === 'number' && props['height'] > 0) {
      settings['min_height'] = { size: props['height'], unit: 'px' };
    }

    // Element ID for CSS targeting
    settings['_element_id'] = `framer-${node.id}`;

    return settings;
  }

  function convert(node: FramerNode, depth: number): V3Element | null {
    totalNodes++;

    if (shouldSkip(node)) {
      skippedNodes++;
      return null;
    }

    if (depth > maxDepth) {
      skippedNodes++;
      warnings.push(`Node "${node.name}" skipped: exceeds max depth ${maxDepth}`);
      return null;
    }

    const id = `el_${node.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 7)}`;

    // Section-level node
    if (isSectionNode(node, depth)) {
      sections++;
      convertedNodes++;
      const children = (node.resolvedChildren ?? node.children)
        .map((child) => convert(child, depth + 1))
        .filter((el): el is V3Element => el !== null);

      return {
        id,
        elType: 'section',
        settings: {
          ...mapSettings(node),
          content_width: 'boxed',
          structure: '20',
        },
        elements: [{
          id: `${id}_col`,
          elType: 'column',
          settings: { _column_size: 100 },
          elements: children,
        }],
      };
    }

    // Leaf widget node
    if (node.type === 'text' || node.type === 'image' || node.type === 'code' ||
        isNamedWidgetPattern(node.name)) {
      widgets++;
      convertedNodes++;
      const widgetType = inferWidgetType(node);
      const settings = mapSettings(node);

      // Widget-specific settings
      if (widgetType === 'heading' || widgetType === 'text-editor') {
        settings[widgetType === 'heading' ? 'title' : 'editor'] =
          (node.props['text'] as string) ?? node.name;
      }
      if (widgetType === 'image') {
        settings['image'] = { url: (node.props['src'] as string) ?? '', id: '' };
      }
      if (widgetType === 'button') {
        settings['text'] = (node.props['text'] as string) ?? node.name;
        settings['link'] = { url: (node.props['href'] as string) ?? '#', is_external: '', nofollow: '' };
      }

      return { id, elType: 'widget', widgetType, settings };
    }

    // Container node (frame/stack with children)
    if (node.children.length > 0 || node.resolvedChildren) {
      containers++;
      convertedNodes++;
      const children = (node.resolvedChildren ?? node.children)
        .map((child) => convert(child, depth + 1))
        .filter((el): el is V3Element => el !== null);

      return {
        id,
        elType: 'container',
        settings: mapSettings(node),
        elements: children,
      };
    }

    // Empty frame → spacer
    widgets++;
    convertedNodes++;
    return {
      id,
      elType: 'widget',
      widgetType: 'spacer',
      settings: { space: { size: (node.props['height'] as number) ?? 20, unit: 'px' } },
    };
  }

  const elements = nodes
    .map((node) => convert(node, 0))
    .filter((el): el is V3Element => el !== null);

  return {
    elements,
    stats: { totalNodes, convertedNodes, skippedNodes, sections, widgets, containers },
    warnings,
  };
}
