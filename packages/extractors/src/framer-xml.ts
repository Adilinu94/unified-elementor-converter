/**
 * Framer XML Extractor.
 * Parses Framer export XML into SourceSpec.
 * Ported ideas from Framer-to-Elementor-V4-Pipeline/scripts/convert-xml-to-v4.ts
 */

import { readFileSync } from 'node:fs';
import type { SourceSpec, SectionSpec, WidgetSpec, DesignTokenSet, DesignToken } from '@elconv/core';
import { EMPTY_DESIGN_TOKEN_SET } from '@elconv/core';
import type { ExtractorOptions, ExtractResult } from './types.js';

let widgetId = 0;
function nextId(): string {
  return `fw_${(++widgetId).toString(36)}`;
}

interface FramerNode {
  type: string;
  name?: string;
  text?: string;
  styles: Record<string, string>;
  attributes: Record<string, string>;
  children: FramerNode[];
}

/**
 * Extract a SourceSpec from a Framer XML export file.
 */
export async function extractFromFramerXml(xmlPath: string, _options?: ExtractorOptions): Promise<ExtractResult> {
  const start = Date.now();
  widgetId = 0;

  const xml = readFileSync(xmlPath, 'utf-8');
  const root = parseXml(xml);
  const sections = buildSections(root);
  const tokens = extractTokens(root);

  const spec: SourceSpec = {
    source: { type: 'framer-xml', xmlPath },
    tokens,
    sections,
    cssVars: {},
    warnings: [],
  };

  return { spec, durationMs: Date.now() - start };
}

/**
 * Simple XML parser for Framer export format.
 * Handles <Frame>, <Text>, <Image>, <Stack> elements.
 */
function parseXml(xml: string): FramerNode {
  const root: FramerNode = { type: 'root', styles: {}, attributes: {}, children: [] };
  const stack: FramerNode[] = [root];
  const tagRegex = /<(\/)?([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(xml)) !== null) {
    const [, isClosing, rawTagName, attrs, selfClosing] = match;
    const tagName = rawTagName.toLowerCase();

    if (isClosing) {
      // Recover from malformed exports without detaching the rest of the
      // document: close the nearest matching open tag and discard any
      // unclosed descendants above it.
      let matchingIndex = -1;
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index]!.type.toLowerCase() === tagName) {
          matchingIndex = index;
          break;
        }
      }
      if (matchingIndex > 0) stack.splice(matchingIndex);
      continue;
    }

    const controls = extractXmlAttr(attrs, 'controls');
    const node: FramerNode = {
      type: tagName,
      name: decodeXmlText(extractXmlAttr(attrs, 'name') ?? extractXmlAttr(attrs, 'id') ?? '' ) || undefined,
      styles: parseStyleAttr(attrs),
      attributes: {
        ...(controls ? { controls } : {}),
      },
      children: [],
    };

    // Text content is read from the immediate text run. Nested markup is
    // still handled by the stack parser, while entities are decoded once.
    if (['text', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
      const textMatch = xml.slice(match.index).match(/^<[^>]*>([^<]*)</);
      if (textMatch) node.text = decodeXmlText(textMatch[1]!).trim();
    }

    stack[stack.length - 1]!.children.push(node);

    if (!selfClosing) stack.push(node);
  }

  return root;
}

function buildSections(root: FramerNode): SectionSpec[] {
  const sections: SectionSpec[] = [];
  const topNodes = root.children.filter((n) =>
    ['frame', 'stack', 'section', 'div'].includes(n.type.toLowerCase()),
  );

  if (topNodes.length === 0) {
    // Fallback: treat all children as one section
    sections.push({
      id: 'sec_0',
      semanticRole: 'page',
      layout: 'single-column',
      widgets: flattenToWidgets(root.children),
      styles: root.styles,
    });
    return sections;
  }

  topNodes.forEach((node, idx) => {
    sections.push({
      id: `sec_${idx}`,
      semanticRole: inferRole(node.name ?? '', idx),
      cssClass: node.name,
      layout: detectFramerLayout(node),
      widgets: flattenToWidgets(node.children),
      styles: node.styles,
    });
  });

  return sections;
}

function flattenToWidgets(nodes: FramerNode[], depth = 0): WidgetSpec[] {
  if (depth > 5) return [];
  const widgets: WidgetSpec[] = [];

  for (const node of nodes) {
    const widget = nodeToWidget(node);
    if (widget) {
      widgets.push(widget);
    } else if (node.children.length > 0) {
      // Container-like node: recurse
      const childWidgets = flattenToWidgets(node.children, depth + 1);
      if (childWidgets.length > 0) {
        widgets.push({
          id: nextId(),
          type: 'container',
          styles: node.styles,
          children: childWidgets,
        });
      }
    }
  }

  return widgets;
}

function nodeToWidget(node: FramerNode): WidgetSpec | null {
  const component = parseComponentControls(node.attributes.controls);
  if (node.type.startsWith('_') || component) {
    const label = component?.label ?? node.text ?? node.name ?? node.type;
    if (component?.imageUrl && (component.label || component.href)) {
      const children: WidgetSpec[] = [
        { id: nextId(), type: 'image', imageUrl: component.imageUrl, styles: node.styles },
      ];
      if (component.href) {
        children.push({ id: nextId(), type: 'button', text: label, href: component.href, styles: node.styles });
      } else if (label) {
        children.push({ id: nextId(), type: 'text', text: label, styles: node.styles });
      }
      return { id: nextId(), type: 'container', styles: node.styles, children };
    }
    if (component?.href) {
      return { id: nextId(), type: 'button', text: label || 'Open', href: component.href, styles: node.styles };
    }
    if (component?.imageUrl) {
      return { id: nextId(), type: 'image', imageUrl: component.imageUrl, styles: node.styles };
    }
    return { id: nextId(), type: 'text', text: label, styles: node.styles };
  }

  switch (node.type.toLowerCase()) {
    case 'text':
    case 'p':
      return { id: nextId(), type: 'text', text: node.text ?? '', styles: node.styles };
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return { id: nextId(), type: 'heading', text: node.text ?? '', styles: node.styles };
    case 'image':
    case 'img':
      return { id: nextId(), type: 'image', imageUrl: node.styles['src'] ?? '', styles: node.styles };
    case 'button':
    case 'a':
      return { id: nextId(), type: 'button', text: node.text ?? node.name ?? 'Button', href: node.styles['href'] ?? '#', styles: node.styles };
    case 'video':
      return { id: nextId(), type: 'video', href: node.styles['src'] ?? '', styles: node.styles };
    default:
      return null;
  }
}

interface ComponentControlSummary {
  label?: string;
  href?: string;
  imageUrl?: string;
}

function parseComponentControls(raw: string | undefined): ComponentControlSummary | undefined {
  if (!raw) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(decodeXmlText(raw));
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const label = findControlString(record, ['label', 'text', 'title', 'name']);
  const href = findControlString(record, ['href', 'link', 'destination', 'route']);
  const imageUrl = findControlString(record, ['image', 'src', 'url'], true);
  return label || href || imageUrl ? { label, href, imageUrl } : undefined;
}

function findControlString(record: Record<string, unknown>, keys: string[], nestedOnly = false): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      if (key === 'url' && !/^https?:\/\//i.test(value)) continue;
      return value.trim();
    }
  }
  for (const value of Object.values(record)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const found = findControlString(value as Record<string, unknown>, keys, nestedOnly);
    if (found && (!nestedOnly || /^https?:\/\//i.test(found))) return found;
  }
  return undefined;
}

function extractTokens(root: FramerNode): DesignTokenSet {
  const colors: DesignToken[] = [];
  const colorCounts = new Map<string, number>();

  function walk(node: FramerNode) {
    for (const val of Object.values(node.styles)) {
      if (/^#[0-9a-fA-F]{3,6}$/.test(val)) {
        const hex = val.toLowerCase();
        colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + 1);
      }
    }
    node.children.forEach(walk);
  }
  walk(root);

  for (const [hex, count] of colorCounts) {
    if (count >= 2) {
      colors.push({ id: `fc_${hex.slice(1)}`, hex, occurrences: count, gv_id: null });
    }
  }

  return { ...EMPTY_DESIGN_TOKEN_SET, colors };
}

// --- Helpers ---

function extractXmlAttr(attrs: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = attrs.match(regex);
  return m ? decodeXmlText(m[1] ?? m[2] ?? '') : null;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseStyleAttr(attrs: string): Record<string, string> {
  const styles: Record<string, string> = {};
  const styleStr = extractXmlAttr(attrs, 'style');
  if (styleStr) {
    for (const decl of styleStr.split(';')) {
      const separator = decl.indexOf(':');
      if (separator < 0) continue;
      const prop = decl.slice(0, separator).trim().toLowerCase();
      const val = decl.slice(separator + 1).trim();
      if (prop && val) styles[prop] = decodeXmlText(val);
    }
  }
  // Also grab common Framer props
  const bg = extractXmlAttr(attrs, 'background') ?? extractXmlAttr(attrs, 'backgroundColor');
  if (bg) styles['background-color'] = bg;
  const src = extractXmlAttr(attrs, 'src');
  if (src) styles['src'] = src;
  const href = extractXmlAttr(attrs, 'href');
  if (href) styles['href'] = href;
  return styles;
}

function detectFramerLayout(node: FramerNode): SectionSpec['layout'] {
  const dir = node.styles['flex-direction'] ?? node.styles['flexDirection'];
  if (dir === 'row') return 'flex-row';
  const display = node.styles['display'];
  if (display === 'grid') return 'grid';
  if (node.children.length > 2) return 'multi-column';
  return 'single-column';
}

function inferRole(name: string, idx: number): string {
  const lower = name.toLowerCase();
  if (lower.includes('hero')) return 'hero';
  if (lower.includes('header') || lower.includes('nav')) return 'header';
  if (lower.includes('footer')) return 'footer';
  if (lower.includes('stat')) return 'stats';
  if (lower.includes('cta')) return 'cta';
  if (idx === 0) return 'hero';
  return `section_${idx}`;
}
