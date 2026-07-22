/**
 * Framer XML Extractor.
 * Parses Framer export XML into SourceSpec.
 * Ported ideas from Framer-to-Elementor-V4-Pipeline/scripts/convert-xml-to-v4.ts
 */

import { readFileSync } from 'node:fs';
import type { SourceSpec, SectionSpec, WidgetSpec, DesignTokenSet, DesignToken } from '@elconv/core';
import { EMPTY_DESIGN_TOKEN_SET } from '@elconv/core';
import type { ExtractorOptions, ExtractResult } from './types.ts';

let widgetId = 0;
function nextId(): string {
  return `fw_${(++widgetId).toString(36)}`;
}

interface FramerNode {
  type: string;
  name?: string;
  text?: string;
  styles: Record<string, string>;
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
  const root: FramerNode = { type: 'root', styles: {}, children: [] };
  const stack: FramerNode[] = [root];

  // Match opening tags, closing tags, and self-closing tags
  const tagRegex = /<(\/?)(\w+)([^>]*?)(\/?)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(xml)) !== null) {
    const [, isClosing, tagName, attrs, selfClosing] = match;

    if (isClosing) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const node: FramerNode = {
      type: tagName,
      name: extractXmlAttr(attrs, 'name') ?? extractXmlAttr(attrs, 'id'),
      styles: parseStyleAttr(attrs),
      children: [],
    };

    // Extract text content for Text nodes
    if (tagName === 'Text' || tagName === 'p' || tagName === 'h1' || tagName === 'h2' || tagName === 'h3') {
      const textMatch = xml.slice(match.index).match(/^<[^>]*>([^<]*)</);
      if (textMatch) node.text = textMatch[1].trim();
    }

    stack[stack.length - 1].children.push(node);

    if (!selfClosing) {
      stack.push(node);
    }
  }

  return root;
}

function buildSections(root: FramerNode): SectionSpec[] {
  const sections: SectionSpec[] = [];
  const topNodes = root.children.filter((n) =>
    ['Frame', 'Stack', 'Section', 'div', 'section'].includes(n.type),
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
  switch (node.type) {
    case 'Text':
    case 'p':
      return { id: nextId(), type: 'text', text: node.text ?? '', styles: node.styles };
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return { id: nextId(), type: 'heading', text: node.text ?? '', styles: node.styles };
    case 'Image':
    case 'img':
      return { id: nextId(), type: 'image', imageUrl: node.styles['src'] ?? '', styles: node.styles };
    case 'Button':
    case 'a':
      return { id: nextId(), type: 'button', text: node.text ?? node.name ?? 'Button', href: node.styles['href'] ?? '#', styles: node.styles };
    case 'Video':
      return { id: nextId(), type: 'video', href: node.styles['src'] ?? '', styles: node.styles };
    default:
      return null;
  }
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
  const regex = new RegExp(`${name}="([^"]*)"`, 'i');
  const m = attrs.match(regex);
  return m?.[1] ?? null;
}

function parseStyleAttr(attrs: string): Record<string, string> {
  const styles: Record<string, string> = {};
  const styleStr = extractXmlAttr(attrs, 'style');
  if (styleStr) {
    for (const decl of styleStr.split(';')) {
      const [prop, val] = decl.split(':').map((s) => s.trim());
      if (prop && val) styles[prop] = val;
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
