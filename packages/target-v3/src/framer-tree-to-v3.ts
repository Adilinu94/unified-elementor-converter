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
  const root = parseFramerXml(normalizeLegacyXmlPayload(xml));
  return convertFramerTree(root.children).elements;
}

/**
 * Elementor read-backs can contain XML that was serialized once more as a
 * JSON string inside a text-editor setting. Decode only that exact shape;
 * ordinary XML and quoted user content must remain untouched.
 */
export function normalizeLegacyXmlPayload(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const decoded = JSON.parse(trimmed) as unknown;
      if (typeof decoded === 'string' && /<\/?[A-Za-z_][\w:.-]*\b[^>]*>/i.test(decoded)) {
        return decoded;
      }
    } catch {
      // Some Elementor read-backs contain only an embedded, partially escaped XML fragment.
    }
  }

  // Some read-backs escape only the XML attributes, not the complete payload.
  // Decode quotes while scanning tag text only; preserve visible text and URLs.
  if (/<[A-Za-z_][\w:.-]*\b/i.test(value) && /\\"/.test(value)) {
    let output = '';
    let inTag = false;
    let quote: '"' | "'" | undefined;
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index]!;
      const next = value[index + 1];
      if (!inTag && char === '<' && /[A-Za-z_]/.test(next ?? '')) inTag = true;
      if (inTag && char === '\\' && next === '"') {
        output += '"';
        index += 1;
        continue;
      }
      output += char;
      if (inTag && (char === '"' || char === "'") && value[index - 1] !== '\\') {
        if (quote === char) quote = undefined;
        else if (!quote) quote = char;
      }
      if (inTag && char === '>' && !quote) inTag = false;
    }
    return output.replace(/\\n(?=\s*<)/g, '\n');
  }
  return value;
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
  const tagRegex = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;
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
      id: attrs.id ?? attrs.nodeId ?? attrs['data-id'] ?? `${normalized}-${match.index}`,
      type: xmlNodeType(normalized),
      name: attrs.name ?? attrs.id ?? tagName,
      xmlTag: normalized,
      props: {
        ...attrs,
        ...inline,
        ...(attrs.controls ? { controlData: parseJsonAttribute(attrs.controls) } : {}),
        ...(attrs.inlineTextStyle ? { inlineTextStyleData: parseJsonAttribute(attrs.inlineTextStyle) } : {}),
        ...(attrs.backgroundImage ? { backgroundImageData: parseJsonAttribute(attrs.backgroundImage) } : {}),
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
  let index = 0;

  while (index < raw.length) {
    while (/\s/.test(raw[index] ?? '')) index++;
    if (index >= raw.length || raw[index] === '/') break;

    const keyStart = index;
    while (index < raw.length && /[:\w.-]/.test(raw[index]!)) index++;
    if (index === keyStart) {
      index++;
      continue;
    }
    const key = raw.slice(keyStart, index);
    while (/\s/.test(raw[index] ?? '')) index++;
    if (raw[index] !== '=') {
      index = keyStart + 1;
      continue;
    }
    index++;
    while (/\s/.test(raw[index] ?? '')) index++;

    const quote = raw[index];
    if (quote !== '"' && quote !== "'") {
      index++;
      continue;
    }
    index++;
    const valueStart = index;
    while (index < raw.length) {
      if (raw[index] === '\\' && raw[index + 1] === quote) {
        index += 2;
        continue;
      }
      if (raw[index] === quote && (index + 1 >= raw.length || /\s|\/|>/.test(raw[index + 1]!))) break;
      index++;
    }
    attrs[key] = decodeXmlText(raw.slice(valueStart, index));
    if (raw[index] === quote) index++;
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

function parseJsonAttribute(value: string): unknown {
  const candidates = [value, decodeXmlText(value)];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next representation; Proofly may entity-encode JSON quotes.
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function controlRecord(node: FramerNode): Record<string, unknown> | undefined {
  return asRecord(node.props['controlData']);
}

function findControlImage(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findControlImage(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of ['url', 'src']) {
    const candidate = stringValue(record[key]);
    if (candidate?.startsWith('http')) return candidate;
  }
  for (const child of Object.values(record)) {
    const found = findControlImage(child);
    if (found) return found;
  }
  return undefined;
}

function resolveColor(value: unknown): string | undefined {
  const direct = stringValue(value);
  if (!direct) return undefined;
  if (direct === 'transparent') return undefined;
  if (!direct.startsWith('{')) return direct;
  const parsed = parseJsonAttribute(direct);
  const record = asRecord(parsed);
  return stringValue(record?.['path']) ?? stringValue(record?.['light']);
}

function resolveImageUrl(node: FramerNode): string | undefined {
  return stringValue(node.props['src'])
    ?? findControlImage(node.props['backgroundImageData'])
    ?? findControlImage(node.props['controlData']);
}

function isCopyValue(key: string, value: string): boolean {
  const lowerKey = key.toLowerCase();
  return !/^(?:true|false|null|undefined)$/i.test(value)
    && !/^\d+(?:\.\d+)?$/.test(value)
    && !/^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}(?:t.*)?$/i.test(value)
    && !lowerKey.includes('variant')
    && !lowerKey.includes('color')
    && !lowerKey.includes('font')
    && !lowerKey.includes('style')
    && !lowerKey.includes('image')
    && !lowerKey.includes('url')
    && !lowerKey.includes('link')
    && !lowerKey.includes('path')
    && !lowerKey.includes('id')
    && !lowerKey.includes('type')
    && !lowerKey.includes('value')
    && !value.startsWith('/')
    && !value.startsWith('http')
    && !value.startsWith('rgb')
    && !value.startsWith('data:')
    && !value.startsWith('local-module:')
    && !value.startsWith('module:');
}

function resolveText(node: FramerNode): string | undefined {
  const direct = stringValue(node.props['text']);
  if (direct) return direct;
  const controls = controlRecord(node);
  if (!controls) return undefined;
  const values = Object.entries(controls)
    .map(([key, value]) => [key, stringValue(value)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
    .filter(([key, value]) => isCopyValue(key, value))
    .map(([, value]) => value)
    .filter((value) => !/^\{[^}]+\}$/.test(value));
  return values.length > 0 ? [...new Set(values)].join('\\n') : undefined;
}

interface ComponentContent {
  text?: string;
  href?: string;
  imageUrl?: string;
}

function componentContent(node: FramerNode): ComponentContent | undefined {
  if (!node.xmlTag?.startsWith('_')) return undefined;
  const imageUrl = resolveImageUrl(node);
  const href = resolveHref(node);
  const text = resolveText(node);
  if (!imageUrl && !href && !text) return undefined;
  return { text, href, imageUrl };
}

function resolveHref(node: FramerNode): string | undefined {
  const direct = stringValue(node.props['href']);
  if (direct) return direct;
  const controls = controlRecord(node);
  if (!controls) return undefined;
  const entries = Object.entries(controls);
  const isHrefValue = (value: unknown): value is string =>
    typeof value === 'string' && (value.startsWith('/') || value.startsWith('http'));
  for (const keyPattern of [/^href$/i, /^link$/i, /^destination$/i, /^route$/i, /^url$/i, /path/i]) {
    const preferred = entries.find(([key, value]) => keyPattern.test(key) && isHrefValue(value));
    if (preferred) return preferred[1] as string;
  }
  return entries.map(([, value]) => stringValue(value)).find(isHrefValue);
}

function inlineTextStyle(node: FramerNode): Record<string, unknown> | undefined {
  return asRecord(node.props['inlineTextStyleData']);
}

type ElementorDimensionUnit = 'px' | '%' | 'em' | 'rem' | 'vw' | 'vh';

function normalizeDimension(value: unknown, defaultUnit: ElementorDimensionUnit): { size: number; unit: ElementorDimensionUnit } | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { size: value, unit: defaultUnit };
  }
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(px|%|em|rem|vw|vh)?$/i);
  if (!match) return undefined;
  return {
    size: Number(match[1]),
    unit: (match[2]?.toLowerCase() as ElementorDimensionUnit | undefined) ?? defaultUnit,
  };
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

function isImageWidgetNode(node: FramerNode): boolean {
  return node.children.length === 0
    && Boolean(resolveImageUrl(node))
    && /image|photo|picture|logo|avatar|background/i.test(node.name);
}

function inferWidgetType(node: FramerNode): ElementorWidgetType {
  const name = node.name.toLowerCase();
  const type = node.type;

  if (type === 'image') return 'image';
  if (type === 'code') return 'html';
  if (name.includes('button') || name.includes('btn') || name.includes('cta')) return 'button';
  if (type === 'text' || resolveText(node)) {
    const style = inlineTextStyle(node);
    const fontSize = normalizeDimension(node.props['fontSize'], 'px')?.size
      ?? normalizeDimension(style?.['fontSize'], 'px')?.size
      ?? 16;
    return fontSize >= 24 || /^h[1-6]$/i.test(String(style?.['tag'] ?? ''))
      ? 'heading'
      : 'text-editor';
  }
  if (isImageWidgetNode(node)) return 'image';
  if (name.includes('icon')) return 'icon';
  if (name.includes('spacer') || name.includes('divider')) return 'spacer';
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
  const usedElementIds = new Set<string>();
  const usedCssIds = new Set<string>();

  function allocateElementId(source: string): string {
    const base = `el_${source.replace(/[^a-zA-Z0-9]/g, '').slice(0, 7) || 'node'}`;
    let candidate = base;
    let suffix = 2;
    while (usedElementIds.has(candidate)) candidate = `${base}_${suffix++}`;
    usedElementIds.add(candidate);
    return candidate;
  }

  function allocateCssId(source: string): string {
    const base = `framer-${source.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'node'}`;
    let candidate = base;
    let suffix = 2;
    while (usedCssIds.has(candidate)) candidate = `${base}-${suffix++}`;
    usedCssIds.add(candidate);
    return candidate;
  }

  function shouldSkip(node: FramerNode): boolean {
    return skipPatterns.some((p) => node.name.toLowerCase().includes(p.toLowerCase()));
  }

  function mapSettings(node: FramerNode, cssId = `framer-${node.id}`): Record<string, unknown> {
    const settings: Record<string, unknown> = {};
    const props = node.props;

    // Background color
    const backgroundColor = resolveColor(props['backgroundColor']);
    if (backgroundColor) settings['background_color'] = backgroundColor;

    const backgroundImage = resolveImageUrl(node);
    if (backgroundImage && node.type !== 'image') {
      settings['background_image'] = { url: backgroundImage, id: '' };
    }

    const style = inlineTextStyle(node);
    if (style) {
      settings['typography_typography'] = 'custom';
      const styleFontSize = normalizeDimension(style['fontSize'], 'px');
      if (styleFontSize) settings['typography_font_size'] = styleFontSize;
      const font = asRecord(style['font']);
      if (font?.['family']) settings['typography_font_family'] = font['family'];
      if (font?.['weight']) settings['typography_font_weight'] = String(font['weight']);
      const styleLineHeight = normalizeDimension(style['lineHeight'], '%');
      if (styleLineHeight) settings['typography_line_height'] = styleLineHeight;
      if (style['alignment']) settings['align'] = style['alignment'];
      const color = resolveColor(style['color']);
      if (color) settings['title_color'] = color;
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
      const textFontSize = normalizeDimension(props['fontSize'], 'px');
      if (textFontSize) settings['typography_font_size'] = textFontSize;
      if (props['fontFamily']) settings['typography_font_family'] = props['fontFamily'];
      if (props['fontWeight']) settings['typography_font_weight'] = String(props['fontWeight']);
      const textLineHeight = normalizeDimension(props['lineHeight'], 'px');
      if (textLineHeight) settings['typography_line_height'] = textLineHeight;
      if (props['color']) settings['title_color'] = resolveColor(props['color']);
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
    settings['_element_id'] = cssId;

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

    const id = allocateElementId(node.id);
    const cssId = allocateCssId(node.id);

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
          ...mapSettings(node, cssId),
          content_width: 'boxed',
          structure: '20',
        },
        elements: [{
          id: allocateElementId(`${node.id}-column`),
          elType: 'column',
          settings: {
            _column_size: 100,
            _element_id: allocateCssId(`${node.id}-column`),
          },
          elements: children,
        }],
      };
    }

    const component = componentContent(node);
    if (component && (component.imageUrl || component.href) && node.children.length === 0) {
      const componentElements: V3Element[] = [];
      const componentSettings = mapSettings(node, cssId);
      delete componentSettings.background_image;

      if (component.imageUrl) {
        componentElements.push({
          id: allocateElementId(`${node.id}-image`),
          elType: 'widget',
          widgetType: 'image',
          settings: {
            ...componentSettings,
            _element_id: allocateCssId(`${node.id}-image`),
            image: { url: component.imageUrl, id: '' },
          },
        });
      }
      if (component.href || component.text) {
        const textWidgetType = component.href ? 'button' : 'text-editor';
        const componentText = component.text ?? 'Open';
        componentElements.push({
          id: allocateElementId(`${node.id}-content`),
          elType: 'widget',
          widgetType: textWidgetType,
          settings: {
            ...componentSettings,
            _element_id: allocateCssId(`${node.id}-content`),
            ...(textWidgetType === 'button'
              ? {
                  text: componentText,
                  link: { url: component.href, is_external: '', nofollow: '' },
                }
              : { editor: componentText }),
          },
        });
      }
      containers++;
      convertedNodes++;
      return {
        id,
        elType: 'container',
        settings: { ...componentSettings, flex_direction: 'column' },
        isInner: depth > 0,
        elements: componentElements,
      };
    }

    // Leaf widget node
    if (node.type === 'text' || node.type === 'image' || node.type === 'code' ||
        isNamedWidgetPattern(node.name) || isImageWidgetNode(node) ||
        (node.children.length === 0 && Boolean(resolveText(node)))) {
      widgets++;
      convertedNodes++;
      const widgetType = inferWidgetType(node);
      const settings = mapSettings(node, cssId);

      // Widget-specific settings
      const text = resolveText(node);
      if (widgetType === 'heading' || widgetType === 'text-editor') {
        settings[widgetType === 'heading' ? 'title' : 'editor'] = text ?? node.name;
      }
      if (widgetType === 'image') {
        settings['image'] = { url: resolveImageUrl(node) ?? '', id: '' };
      }
      if (widgetType === 'button') {
        settings['text'] = text ?? node.name;
        settings['link'] = { url: resolveHref(node) ?? '#', is_external: '', nofollow: '' };
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
        settings: mapSettings(node, cssId),
        isInner: depth > 0,
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
      settings: {
        ...mapSettings(node, cssId),
        space: { size: (node.props['height'] as number) ?? 20, unit: 'px' },
      },
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
