/**
 * HTML Parser Extractor.
 * Parses static HTML files into SourceSpec.
 * Uses regex-based parsing (no browser needed for static HTML).
 */

import { readFileSync } from 'node:fs';
import type { SourceSpec, SectionSpec, WidgetSpec, DesignTokenSet, DesignToken } from '@elconv/core';
import { EMPTY_DESIGN_TOKEN_SET } from '@elconv/core';
import type { ExtractorOptions, ExtractResult } from './types.js';

let widgetId = 0;
function nextWidgetId(): string {
  return `hw_${(++widgetId).toString(36)}`;
}

/**
 * Extract a SourceSpec from a local HTML file.
 */
export async function extractFromHtml(htmlPath: string, _options?: ExtractorOptions): Promise<ExtractResult> {
  const start = Date.now();
  widgetId = 0;

  const html = readFileSync(htmlPath, 'utf-8');
  const sections = parseSections(html);
  const cssVars = extractCssVars(html);
  const tokens = extractTokensFromCss(html);

  const spec: SourceSpec = {
    source: { type: 'html-export', htmlPath },
    tokens,
    sections,
    cssVars,
    warnings: [],
  };

  return { spec, durationMs: Date.now() - start };
}

function parseSections(html: string): SectionSpec[] {
  const sections: SectionSpec[] = [];

  // Detect sections by <section> tags or top-level <div> with class hints
  const sectionRegex = /<section[^>]*>([\s\S]*?)<\/section>/gi;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = sectionRegex.exec(html)) !== null) {
    const content = match[1];
    const openTag = match[0].split('>')[0];
    const cssClass = extractAttr(openTag, 'class') ?? `section_${idx}`;
    const widgets = parseWidgets(content);

    sections.push({
      id: `sec_${idx}`,
      semanticRole: inferSemanticRole(cssClass, idx),
      cssClass,
      layout: detectLayout(openTag + content),
      widgets,
      styles: extractInlineStyles(openTag),
    });
    idx++;
  }

  // Fallback: if no <section> tags, treat body as single section
  if (sections.length === 0) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch?.[1] ?? html;
    sections.push({
      id: 'sec_0',
      semanticRole: 'page',
      layout: 'single-column',
      widgets: parseWidgets(bodyContent),
      styles: {},
    });
  }

  return sections;
}

function parseWidgets(html: string): WidgetSpec[] {
  const widgets: WidgetSpec[] = [];

  // Headings
  const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  let m: RegExpExecArray | null;
  while ((m = headingRegex.exec(html)) !== null) {
    widgets.push({
      id: nextWidgetId(),
      type: 'heading',
      text: stripTags(m[2]).trim(),
      styles: { 'font-size': `${Math.max(48 - (parseInt(m[1]) - 1) * 8, 16)}px` },
    });
  }

  // Paragraphs
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  while ((m = pRegex.exec(html)) !== null) {
    const text = stripTags(m[1]).trim();
    if (text) {
      widgets.push({ id: nextWidgetId(), type: 'text', text, styles: {} });
    }
  }

  // Images
  const imgRegex = /<img[^>]*>/gi;
  while ((m = imgRegex.exec(html)) !== null) {
    widgets.push({
      id: nextWidgetId(),
      type: 'image',
      imageUrl: extractAttr(m[0], 'src') ?? '',
      styles: {},
    });
  }

  // Buttons / Links styled as buttons
  const btnRegex = /<(?:button|a)[^>]*class="[^"]*btn[^"]*"[^>]*>([\s\S]*?)<\/(?:button|a)>/gi;
  while ((m = btnRegex.exec(html)) !== null) {
    widgets.push({
      id: nextWidgetId(),
      type: 'button',
      text: stripTags(m[1]).trim(),
      href: extractAttr(m[0], 'href') ?? '#',
      styles: {},
    });
  }

  return widgets;
}

function extractCssVars(html: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const varRegex = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = varRegex.exec(html)) !== null) {
    vars[`--${m[1]}`] = m[2].trim();
  }
  return vars;
}

function extractTokensFromCss(html: string): DesignTokenSet {
  const colors: DesignToken[] = [];
  const hexRegex = /#[0-9a-fA-F]{3,6}/g;
  const colorCounts = new Map<string, number>();
  let m: RegExpExecArray | null;

  while ((m = hexRegex.exec(html)) !== null) {
    const hex = m[0].toLowerCase();
    colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + 1);
  }

  for (const [hex, count] of colorCounts) {
    if (count >= 2) {
      colors.push({ id: `color_${hex.slice(1)}`, hex, occurrences: count, gv_id: null });
    }
  }

  return { ...EMPTY_DESIGN_TOKEN_SET, colors };
}

// --- Helpers ---

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function extractAttr(tag: string, attr: string): string | null {
  const regex = new RegExp(`${attr}="([^"]*)"`, 'i');
  const m = tag.match(regex);
  return m?.[1] ?? null;
}

function extractInlineStyles(tag: string): Record<string, string> {
  const style = extractAttr(tag, 'style');
  if (!style) return {};
  const styles: Record<string, string> = {};
  for (const decl of style.split(';')) {
    const [prop, val] = decl.split(':').map((s) => s.trim());
    if (prop && val) styles[prop] = val;
  }
  return styles;
}

function detectLayout(html: string): SectionSpec['layout'] {
  if (html.includes('display: grid') || html.includes('display:grid')) return 'grid';
  if (html.includes('display: flex') || html.includes('display:flex')) return 'flex-row';
  const colCount = (html.match(/class="[^"]*col/g) ?? []).length;
  if (colCount >= 2) return 'multi-column';
  return 'single-column';
}

function inferSemanticRole(cssClass: string, idx: number): string {
  const lower = cssClass.toLowerCase();
  if (lower.includes('hero')) return 'hero';
  if (lower.includes('header') || lower.includes('nav')) return 'header';
  if (lower.includes('footer')) return 'footer';
  if (lower.includes('stat')) return 'stats';
  if (lower.includes('service') || lower.includes('feature')) return 'services';
  if (lower.includes('cta') || lower.includes('call')) return 'cta';
  if (idx === 0) return 'hero';
  return `section_${idx}`;
}
