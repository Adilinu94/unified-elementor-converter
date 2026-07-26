/**
 * convert-xml-to-v4.ts  —  Phase 2: Framer XML → Elementor V4 Widget-Tree
 * TypeScript version of convert-xml-to-v4.js
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  normalizeHex, resolveCssVar, generateStyleId, sanitizeStyleId, isValidStyleId,
  wrapSize, wrapUnitless, wrapDimensions, wrapBorderRadius, wrapGvColor, wrapGvFont,
  wrapColor, wrapType, wrapImageSrc, isDimensionValue, wrapImage, wrapHtmlContent,
  wrapClasses,
} from './lib/framer-utils.js';
import type { DesignToken } from '../src/shared-schemas/design-tokens.js';
import { buildStyleClass } from './lib/v4-tree-builder.js';

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    xml:             { type: 'string' },
    'xml-string':    { type: 'string' },
    tokens:          { type: 'string' },
    fonts:           { type: 'string' },
    'image-map':     { type: 'string' },
    'style-map':     { type: 'string' },
    output:          { type: 'string' },
    validate:        { type: 'boolean', default: false },
    verbose:         { type: 'boolean', default: false },
    'gc':            { type: 'boolean', default: false },
    'gc-output':     { type: 'string' },
    'gc-min-dups':   { type: 'string', default: '2' },
    'tokens-report': { type: 'boolean', default: false },
    'pro-fallback':  { type: 'boolean', default: true },
    'is-pro-active': { type: 'string', default: '' },
    'framer-url':    { type: 'string' },
    'framer-html':   { type: 'string' },
    'theme-defaults': { type: 'string' },
    'prefer-gc':     { type: 'boolean', default: false },
  },
  strict: false,
});

const isProActive = String(args['is-pro-active'] || '').toLowerCase() === 'true';
const proFallbackEnabled = args['pro-fallback'] !== false;
const preferGcForBackground = args['prefer-gc'] === true;
const pendingGcCandidates: Array<Record<string, unknown>> = [];

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node scripts/convert-xml-to-v4.js [--help for options]');
  console.log('Run with --help for full usage.'); process.exit(0);
}

const log = (...m: string[]) => { if (args.verbose) process.stderr.write('[verbose] ' + m.join(' ') + '\n'); };
const warn = (m: string) => process.stderr.write(`⚠ ${m}\n`);

if (!args.xml && !args['xml-string']) {
  process.stderr.write('Error: --xml oder --xml-string erforderlich\n'); process.exit(2);
}

// ─────────────────────────────────────────────
// XML TOKENIZER
// ─────────────────────────────────────────────

interface TagToken {
  type: 'open' | 'close' | 'selfclose' | 'text';
  tagName?: string;
  attrs?: Record<string, string>;
  value?: string;
}

function tokenizeXml(xml: string): TagToken[] {
  const tokens: TagToken[] = [];
  let i = 0;

  while (i < xml.length) {
    if (xml[i] !== '<') {
      const textStart = i;
      while (i < xml.length && xml[i] !== '<') i++;
      const text = xml.slice(textStart, i).replace(/\s+/g, ' ').trim();
      if (text) tokens.push({ type: 'text', value: text });
      continue;
    }

    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i); i = end >= 0 ? end + 2 : xml.length; continue;
    }
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i); i = end >= 0 ? end + 3 : xml.length; continue;
    }
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i);
      const cdata = end >= 0 ? xml.slice(i + 9, end) : '';
      if (cdata.trim()) tokens.push({ type: 'text', value: cdata.trim() });
      i = end >= 0 ? end + 3 : xml.length; continue;
    }

    i++;

    const isClose = i < xml.length && xml[i] === '/';
    if (isClose) i++;

    const nameStart = i;
    while (i < xml.length && /[A-Za-z0-9_:-]/.test(xml[i])) i++;
    const tagName = xml.slice(nameStart, i);
    if (!tagName) { i++; continue; }

    if (isClose) {
      while (i < xml.length && xml[i] !== '>') i++;
      i++;
      tokens.push({ type: 'close', tagName });
      continue;
    }

    const attrs: Record<string, string> = {};
    while (i < xml.length) {
      while (i < xml.length && /[\s\r\n]/.test(xml[i])) i++;
      if (i >= xml.length || xml[i] === '>' || (xml[i] === '/' && xml[i + 1] === '>')) break;
      if (xml.startsWith('<!--', i)) {
        const end = xml.indexOf('-->', i);
        i = end >= 0 ? end + 3 : xml.length;
        continue;
      }

      const attrStart = i;
      while (i < xml.length && xml[i] !== '=' && xml[i] !== '>' && !/[\s\r\n]/.test(xml[i])) i++;
      const attrName = xml.slice(attrStart, i).trim();

      if (xml[i] === '=') {
        i++;
        if (i < xml.length && (xml[i] === '"' || xml[i] === "'")) {
          const q = xml[i]; i++;
          const valStart = i;
          while (i < xml.length && xml[i] !== q) i++;
          if (attrName) attrs[attrName] = xml.slice(valStart, i);
          i++;
        }
      } else if (attrName) {
        attrs[attrName] = 'true';
      }
    }

    const isSelfClose = i < xml.length && xml[i] === '/';
    if (isSelfClose) i++;
    if (i < xml.length && xml[i] === '>') i++;

    tokens.push({ type: isSelfClose ? 'selfclose' : 'open', tagName, attrs });
  }

  return tokens;
}

// ─────────────────────────────────────────────
// TREE BUILDER
// ─────────────────────────────────────────────

interface XmlAstNode {
  tagName: string;
  attrs: Record<string, string>;
  children: XmlAstNode[];
  _textContent?: string;
}

function buildTree(tokens: TagToken[]): XmlAstNode[] {
  const root: XmlAstNode = { tagName: '_root', attrs: {}, children: [] };
  const stack: XmlAstNode[] = [root];
  let pendingText = '';
  for (const tok of tokens) {
    if (tok.type === 'text') {
      pendingText += tok.value || '';
    } else if (tok.type === 'close') {
      if (pendingText.trim() && stack.length > 1) {
        stack[stack.length - 1]._textContent = (stack[stack.length - 1]._textContent || '') + pendingText.trim();
      }
      pendingText = '';
      if (stack.length > 1) stack.pop();
    } else {
      pendingText = '';
      const node: XmlAstNode = { tagName: tok.tagName || '', attrs: tok.attrs || {}, children: [] };
      stack[stack.length - 1].children.push(node);
      if (tok.type === 'open') stack.push(node);
    }
  }
  return root.children;
}

// ─────────────────────────────────────────────
// WIDGET TYPE DETERMINATION
// ─────────────────────────────────────────────

const SVG_NATIVE_TAGS = new Set([
  'svg', 'circle', 'ellipse', 'rect', 'path', 'polygon', 'polyline',
  'line', 'g', 'defs', 'use', 'symbol', 'text', 'tspan', 'mask',
  'clippath', 'lineargradient', 'radialgradient', 'stop', 'pattern',
]);

const COMPONENT_TYPE_MAP: Record<string, string> = {
  'heading': 'e-heading',
  'paragraph': 'e-paragraph',
  'button': 'e-button',
  'cta': 'e-button',
  'image': 'e-image',
  'img': 'e-image',
  'divider': 'e-divider',
  'card': 'e-flexbox',
  'stats': 'e-flexbox',
  'testimonial': 'e-flexbox',
  'hero': 'e-flexbox',
  'section': 'e-flexbox',
};

function determineWidgetType(attrs: Record<string, string>, xmlNode?: XmlAstNode): string {
  const name = (attrs.name || '').toLowerCase();
  const tagName = (xmlNode?.tagName || '').toLowerCase();

  if (attrs.display === 'grid') return 'e-div-block';
  if (attrs['grid-template-columns'] || attrs['grid-template-rows']) return 'e-div-block';

  if (attrs.componentId || attrs.componentName) return 'e-component';

  for (const [pattern, widgetType] of Object.entries(COMPONENT_TYPE_MAP)) {
    if (name === pattern || name.includes(pattern)) {
      if (widgetType === 'e-button' && !attrs.href && name !== 'button' && name !== 'cta') break;
      if (widgetType === 'e-image' && !attrs.backgroundImage && !attrs.src) break;
      return widgetType;
    }
  }

  const rawTagName = (xmlNode?.tagName || '');
  if (SVG_NATIVE_TAGS.has(rawTagName.toLowerCase()) && rawTagName === rawTagName.toLowerCase()) {
    return 'e-svg';
  }

  if (attrs.href || name.includes('button') || name.includes('cta')) return 'e-button';

  const hasText = attrs.text !== undefined || xmlNode?._textContent;
  if (hasText) {
    if (/\bh[1-6]\b|heading/.test(name)) return 'e-heading';
    if (/\bbody|paragraph|text|description|content/.test(name)) return 'e-paragraph';
    return 'e-heading';
  }
  if (attrs.backgroundImage || attrs.src) return 'e-image';

  const childCount = (xmlNode?.children || []).filter(c => c.tagName && c.tagName !== '_root').length;
  if (childCount >= 2) {
    if (/\b(grid|gallery|cards|stats|features|logos|columns)\b/.test(name)) {
      return 'e-div-block';
    }
    const childNames = (xmlNode?.children || [])
      .filter(c => c.tagName && c.tagName !== '_root')
      .map(c => (c.attrs?.name || '').toLowerCase().replace(/\d+$/, ''))
      .filter(n => n);
    const uniqueNames = new Set(childNames);
    if (childCount >= 3 && uniqueNames.size <= 2) {
      return 'e-div-block';
    }
  }

  return 'e-flexbox';
}

function determineHtmlTag(attrs: Record<string, string>): string {
  const name = (attrs.name || '').toLowerCase();
  if (/\bh1\b|heading.?1|title/.test(name))   return 'h1';
  if (/\bh2\b|heading.?2/.test(name))          return 'h2';
  if (/\bh3\b|heading.?3/.test(name))          return 'h3';
  if (/\bh4\b|heading.?4/.test(name))          return 'h4';
  if (/\bh5\b|heading.?5/.test(name))          return 'h5';
  if (/\bh6\b|heading.?6/.test(name))          return 'h6';
  if (/paragraph|body|text/.test(name))         return 'p';
  return 'h2';
}

// ─────────────────────────────────────────────
// CONTAINER-TAG REMAPPER
// ─────────────────────────────────────────────

const CONTAINER_TAG_REMAPPINGS: Record<string, string> = {
  'nav':     'header',
  'main':    'section',
  'span':    'div',
};

const CONTAINER_TAG_ENUMS: Record<string, string[]> = {
  'e-flexbox':   ['div', 'header', 'section', 'article', 'aside', 'footer', 'a', 'button'],
  'e-div-block': ['div', 'header', 'section', 'article', 'aside', 'footer', 'span'],
};

function sanitizeContainerTag(framerTag: string, widgetType: string): string {
  const raw = String(framerTag || '').toLowerCase().trim();
  if (!raw) return widgetType === 'e-div-block' ? 'div' : 'section';

  const allowed = CONTAINER_TAG_ENUMS[widgetType]
    ?? (widgetType === 'e-div-block' ? CONTAINER_TAG_ENUMS['e-div-block'] : CONTAINER_TAG_ENUMS['e-flexbox']);

  if (allowed.includes(raw)) return raw;

  const remapped = CONTAINER_TAG_REMAPPINGS[raw];
  if (remapped && allowed.includes(remapped)) return remapped;

  if (allowed.includes('div')) return 'div';
  return allowed[0];
}

function wrapLink(href: string, targetBlank = false): Record<string, unknown> {
  const value: Record<string, unknown> = {
    destination: { '$$type': 'url', value: href || '' },
    tag: { '$$type': 'string', value: 'a' },
  };
  if (targetBlank) value.isTargetBlank = { '$$type': 'boolean', value: true };
  return { '$$type': 'link', value };
}

function serializeSvgNode(xmlNode: XmlAstNode): string {
  const { tagName, attrs, children } = xmlNode;
  if (!tagName || tagName === '_root') return '';
  const attrStr = Object.entries(attrs || {})
    .filter(([k]) => k !== 'name' && k !== 'nodeId')
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`)
    .join(' ');
  const childContent = (children || []).map(serializeSvgNode).join('');
  if (childContent || tagName.toLowerCase() !== 'circle') {
    return `<${tagName}${attrStr ? ' ' + attrStr : ''}>${childContent}</${tagName}>`;
  }
  return `<${tagName}${attrStr ? ' ' + attrStr : ''}/>`;
}

// ─────────────────────────────────────────────
// COLOR RESOLUTION
// ─────────────────────────────────────────────

const warnings: string[] = [];

interface TokenMapping {
  colors?: DesignToken[];
  fonts?: Record<string, { gv_id?: string; family?: string }>;
  [key: string]: unknown;
}

interface FontResolution {
  fonts?: Array<{ family: string; gv_id?: string }>;
}

interface StyleMap {
  textStyles?: Record<string, { fontSize?: string; fontWeight?: string; fontFamily?: string; lineHeight?: string; letterSpacing?: string; color?: string }>;
  colorStyles?: Record<string, string>;
}

interface ThemeDefaults {
  heading?: Record<string, string>;
  body?: Record<string, string>;
}

function resolveColor(value: string | null, tokenMapping: TokenMapping | null): Record<string, unknown> | null {
  if (!value) return null;
  const resolved = resolveCssVar(value, tokenMapping as Record<string, unknown> | null);
  if (!resolved) {
    const hex = normalizeHex(value);
    if (hex) { warn(`Hardcoded hex used: ${hex} (no token match)`); return wrapColor(hex); }
    return null;
  }
  if (resolved.gvId) return wrapGvColor(resolved.gvId);
  if (resolved.hex) {
    warn(`Token found but no gv_id for value: ${value} → ${resolved.hex}`);
    return wrapColor(resolved.hex);
  }
  return null;
}

function resolveFont(family: string, tokenMapping: TokenMapping | null, fontResolution: FontResolution | null): Record<string, unknown> | null {
  if (!family) return null;
  if (tokenMapping?.fonts?.[family]?.gv_id) return wrapGvFont(tokenMapping.fonts[family].gv_id!);
  if (typeof tokenMapping?.fonts?.[family] === 'string') return wrapGvFont(tokenMapping.fonts[family] as string);
  if (typeof tokenMapping?.[family] === 'string' && (tokenMapping[family] as string).startsWith('e-gv-'))
    return wrapGvFont(tokenMapping[family] as string);
  if (typeof tokenMapping?.[family.toLowerCase?.()] === 'string' && (tokenMapping[family.toLowerCase()] as string).startsWith('e-gv-'))
    return wrapGvFont(tokenMapping[family.toLowerCase()] as string);
  const fontEntry = (fontResolution?.fonts || []).find(f => f.family === family);
  if (fontEntry?.gv_id) return wrapGvFont(fontEntry.gv_id);
  warn(`Font '${family}' not found in token-mapping or font-resolution. Using string fallback.`);
  return wrapType('string', family);
}

// ─────────────────────────────────────────────
// IMAGE URL RESOLUTION
// ─────────────────────────────────────────────

function extractImageUrl(imageAttr: string): string | null {
  if (!imageAttr) return null;
  const raw = String(imageAttr).trim();
  const urlMatch = raw.match(/url\(['"]?([^'")\s]+)['"]?\)/i);
  return urlMatch ? urlMatch[1] : raw;
}

interface ImageMap {
  images?: Record<string, number>;
  videos?: Record<string, number>;
  assets?: Array<{ url?: string; filename?: string; wp_media_id?: number; id?: number }>;
  [url: string]: unknown;
}

function findImageMapEntry(url: string, imageMap: Record<string, unknown> | null): unknown {
  if (!url || !imageMap) return null;
  const filename = url.split('/').pop()?.split('?')[0];
  if (imageMap[url]) return imageMap[url];
  const images = imageMap.images as Record<string, unknown> | undefined;
  if (images?.[filename!]) return images[filename!];
  const videos = imageMap.videos as Record<string, unknown> | undefined;
  if (videos?.[filename!]) return videos[filename!];
  const assets = imageMap.assets as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(assets)) {
    return assets.find(a => a.url === url || a.filename === filename) || null;
  }
  const imagesArr = imageMap.images as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(imagesArr)) {
    return imagesArr.find(a => a.url === url || a.filename === filename) || null;
  }
  return null;
}

function resolveImageSrc(bgImageAttr: string, imageMap: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!bgImageAttr) return null;
  const url = extractImageUrl(bgImageAttr);
  if (!url) return null;
  const entry = findImageMapEntry(url, imageMap) as Record<string, number | string> | null;
  if (entry?.wp_media_id) return wrapImageSrc({ id: String(entry.wp_media_id) });
  if (entry?.id) return wrapImageSrc({ id: String(entry.id) });
  return wrapImageSrc({ url });
}

function resolveLineHeight(lineHeight: string): Record<string, unknown> | null {
  if (!lineHeight) return null;
  const raw = String(lineHeight).trim();
  if (/^-?[\d.]+$/.test(raw)) return wrapUnitless(raw);
  if (/^-?[\d.]+%$/.test(raw)) return wrapUnitless(parseFloat(raw) / 100);
  return wrapSize(raw);
}

// ─────────────────────────────────────────────
// PROPERTY MAPPER
// ─────────────────────────────────────────────

function detectGridLayout(xmlNode: XmlAstNode, attrs: Record<string, string>): string | null {
  if (attrs['grid-template-columns']) return attrs['grid-template-columns'];
  if (attrs['grid-template-rows']) return null;
  const childCount = (xmlNode?.children || []).filter(c => c.tagName && c.tagName !== '_root').length;
  if (childCount < 2) return null;
  if (childCount === 2) return '1fr 1fr';
  if (childCount === 3) return '1fr 1fr 1fr';
  if (childCount === 4) return '1fr 1fr 1fr 1fr';
  return 'repeat(auto-fit, minmax(250px, 1fr))';
}

function buildStyleProps(
  attrs: Record<string, string>,
  widgetType: string,
  tokenMapping: TokenMapping | null,
  fontResolution: FontResolution | null,
  imageMap: Record<string, unknown> | null,
  xmlNode: XmlAstNode | null,
  styleMap: StyleMap | null,
  elementId: string | null,
  themeDefaults: ThemeDefaults | null,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const { stackDirection, stackGap, padding, maxWidth, width, height,
          backgroundColor, 'background-color': bgColor,
          borderRadius, 'border-radius': borderRadiusAlt,
          position, top, right, bottom, left,
          color, 'font-family': fontFamily, 'font-size': fontSize,
          'font-weight': fontWeight, 'line-height': lineHeight,
          'letter-spacing': letterSpacing, opacity,
          inlineTextStyle } = attrs as Record<string, string | undefined>;

  let resolvedStyle: StyleMap['textStyles'] extends Record<string, infer T> ? T : Record<string, string> | null = null;
  if (inlineTextStyle && styleMap?.textStyles?.[inlineTextStyle]) {
    resolvedStyle = styleMap.textStyles[inlineTextStyle] as Record<string, string>;
  }

  if (widgetType === 'e-div-block') {
    const gridColumns = detectGridLayout(xmlNode!, attrs);
    if (gridColumns) {
      props['display'] = wrapType('string', 'grid');
      props['grid-template-columns'] = wrapType('string', gridColumns);
    } else {
      props['display'] = wrapType('string', 'block');
    }
    if (stackGap) props['gap'] = wrapSize(stackGap);
    if (padding) props['padding'] = wrapDimensions(padding);
    if (maxWidth && isDimensionValue(maxWidth)) props['max-width'] = wrapSize(maxWidth);
    if (width && isDimensionValue(width)) props['width'] = wrapSize(width);
    if (height && isDimensionValue(height)) props['height'] = wrapSize(height);

    const bgVal = backgroundColor || bgColor;
    if (bgVal) {
      const resolvedColor = resolveColor(bgVal, tokenMapping);
      if (resolvedColor) {
        if (!preferGcForBackground) {
          props['background'] = { '$$type': 'background', value: { color: resolvedColor } };
        } else if (elementId) {
          pendingGcCandidates.push({
            category: 'background',
            id: elementId,
            prop: 'background',
            value: { '$$type': 'background', value: { color: resolvedColor } },
          });
        }
      }
    }
  }

  if (widgetType === 'e-flexbox' || widgetType === 'e-button') {
    props['display'] = wrapType('string', 'flex');
    if (stackDirection) {
      props['flex-direction'] = stackDirection === 'vertical' ? 'column' : 'row';
    }
    if (stackGap) props['gap'] = wrapSize(stackGap);
    if (padding) props['padding'] = wrapDimensions(padding);
    if (maxWidth && isDimensionValue(maxWidth)) props['max-width'] = wrapSize(maxWidth);
    if (width && isDimensionValue(width)) props['width'] = wrapSize(width);
    if (height && isDimensionValue(height)) props['height'] = wrapSize(height);

    const bgVal = backgroundColor || bgColor;
    if (bgVal) {
      const resolvedColor = resolveColor(bgVal, tokenMapping);
      if (resolvedColor) {
        if (!preferGcForBackground) {
          props['background'] = { '$$type': 'background', value: { color: resolvedColor } };
        } else if (elementId) {
          pendingGcCandidates.push({
            category: 'background',
            id: elementId,
            prop: 'background',
            value: { '$$type': 'background', value: { color: resolvedColor } },
          });
        }
      }
    }
  }

  if (widgetType === 'e-heading' || widgetType === 'e-paragraph') {
    const res = resolvedStyle as Record<string, string> | null;
    const effFontSize = fontSize || res?.fontSize;
    const effFontWeight = fontWeight || res?.fontWeight;
    const effLineHeight = lineHeight || res?.lineHeight;
    const effLetterSpacing = letterSpacing || res?.letterSpacing;
    const effFontFamily = fontFamily || res?.fontFamily;
    const effColor = color || res?.color;

    if (effFontSize) props['font-size'] = wrapSize(effFontSize);
    if (effFontWeight) props['font-weight'] = wrapType('string', effFontWeight);
    if (effLineHeight) props['line-height'] = resolveLineHeight(effLineHeight);
    if (effLetterSpacing) props['letter-spacing'] = wrapSize(effLetterSpacing);
    if (effFontFamily) {
      const resolvedFont = resolveFont(effFontFamily.split(',')[0].trim().replace(/['"]/g, ''), tokenMapping, fontResolution);
      if (resolvedFont) props['font-family'] = resolvedFont;
    }
    if (effColor) {
      const resolvedColor = resolveColor(effColor, tokenMapping);
      if (resolvedColor) props['color'] = resolvedColor;
    }
  }

  if (widgetType === 'e-image') {
    if (width && isDimensionValue(width)) props['width'] = wrapSize(width);
    if (height && isDimensionValue(height)) props['height'] = wrapSize(height);
  }

  const br = borderRadius || borderRadiusAlt;
  if (br) props['border-radius'] = wrapBorderRadius(br);

  if (position) {
    const hasExplicitOffsets = top !== undefined || right !== undefined || bottom !== undefined || left !== undefined;
    if (position !== 'absolute' || hasExplicitOffsets) {
      props['position'] = wrapType('string', position);
      if (top !== undefined) props['top'] = wrapSize(top);
      if (right !== undefined) props['right'] = wrapSize(right);
      if (bottom !== undefined) props['bottom'] = wrapSize(bottom);
      if (left !== undefined) props['left'] = wrapSize(left);
    }
  }

  if (opacity !== undefined) props['opacity'] = wrapUnitless(opacity);

  if (Object.keys(props).length === 0) {
    if (widgetType === 'e-heading' || widgetType === 'e-paragraph') {
      const textStyles = styleMap?.textStyles ? Object.entries(styleMap.textStyles) : [];
      let chosenStyle: Record<string, string> | null = null;

      if (textStyles.length > 0) {
        const withPx = textStyles
          .map(([name, s]) => ({ name, style: s, px: s.fontSize ? parseFloat(s.fontSize) : 0 }))
          .filter(e => e.px > 0)
          .sort((a, b) => a.px - b.px);

        const nodeName = (xmlNode?.attrs?.name as string || xmlNode?.attrs?.id as string || '').toLowerCase();
        const isHeading = /heading|title|h[1-6]|display|hero|header/i.test(nodeName);
        const isBody = /body|text|para|caption|label|note|small/i.test(nodeName);

        if (withPx.length > 0) {
          if (widgetType === 'e-heading' || isHeading) {
            chosenStyle = withPx[withPx.length - 1].style as Record<string, string>;
            log(`RC-11 smart fallback (heading): ${withPx[withPx.length - 1].name} ${withPx[withPx.length - 1].px}px`);
          } else if (isBody || widgetType === 'e-paragraph') {
            chosenStyle = withPx[0].style as Record<string, string>;
            log(`RC-11 smart fallback (body): ${withPx[0].name} ${withPx[0].px}px`);
          } else {
            const mid = Math.floor(withPx.length / 2);
            chosenStyle = withPx[mid].style as Record<string, string>;
            log(`RC-11 smart fallback (mid): ${withPx[mid].name} ${withPx[mid].px}px`);
          }
        }
      }

      if (chosenStyle) {
        if ((chosenStyle as Record<string, string>).fontFamily) {
          const ff = ((chosenStyle as Record<string, string>).fontFamily).split(',')[0].trim().replace(/['"]/g, '');
          const resolvedFont = resolveFont(ff, tokenMapping, fontResolution);
          props['font-family'] = resolvedFont || wrapType('string', ff);
        }
        if ((chosenStyle as Record<string, string>).fontSize) props['font-size'] = wrapSize((chosenStyle as Record<string, string>).fontSize);
        if ((chosenStyle as Record<string, string>).fontWeight) props['font-weight'] = wrapType('string', String((chosenStyle as Record<string, string>).fontWeight));
        if ((chosenStyle as Record<string, string>).lineHeight) props['line-height'] = resolveLineHeight((chosenStyle as Record<string, string>).lineHeight);
        if ((chosenStyle as Record<string, string>).color) {
          const c = resolveColor((chosenStyle as Record<string, string>).color, tokenMapping);
          if (c) props['color'] = c;
        }
      } else {
        const themeKey = widgetType === 'e-heading' ? 'heading' : 'body';
        const themeDefault = themeDefaults?.[themeKey];

        if (themeDefault) {
          log(`RC-11 Theme-Default (${themeKey}): aus --theme-defaults statt hartkodiertem Fallback`);
          if (themeDefault.fontFamily) {
            const ff = String(themeDefault.fontFamily).split(',')[0].trim().replace(/['"]/g, '');
            const resolvedFont = resolveFont(ff, tokenMapping, fontResolution);
            props['font-family'] = resolvedFont || wrapType('string', ff);
          }
          if (themeDefault.fontSize) props['font-size'] = wrapSize(themeDefault.fontSize);
          if (themeDefault.fontWeight) props['font-weight'] = wrapType('string', String(themeDefault.fontWeight));
          if (themeDefault.lineHeight) props['line-height'] = resolveLineHeight(themeDefault.lineHeight);
          if (themeDefault.color) {
            const c = resolveColor(themeDefault.color, tokenMapping);
            if (c) props['color'] = c;
          }
          if (!props['font-family']) props['font-family'] = wrapType('string', 'Inter');
          if (!props['font-size']) props['font-size'] = wrapSize(widgetType === 'e-heading' ? '32px' : '16px');
          if (!props['color']) props['color'] = wrapColor(widgetType === 'e-heading' ? '#111111' : '#444444');
        } else {
          if (widgetType === 'e-heading') {
            props['font-family'] = wrapType('string', 'Inter');
            props['font-size'] = wrapSize('32px');
            props['font-weight'] = wrapType('string', '600');
            props['color'] = wrapColor('#111111');
          } else {
            props['font-family'] = wrapType('string', 'Inter');
            props['font-size'] = wrapSize('16px');
            props['line-height'] = wrapUnitless(1.6);
            props['color'] = wrapColor('#444444');
          }
        }
      }
    } else if (widgetType === 'e-button') {
      props['color'] = wrapColor('#ffffff');
    }
  }

  return props;
}

// ─────────────────────────────────────────────
// ID GENERATION
// ─────────────────────────────────────────────

const usedStyleIds = new Map<string, number>();
const usedWidgetIds = new Map<string, number>();

function uniqueStyleId(name: string): string {
  const base = sanitizeStyleId(name) || generateStyleId(name);
  const n = (usedStyleIds.get(base) || 0) + 1;
  usedStyleIds.set(base, n);
  return n === 1 ? base : `${base}${n}`;
}

function uniqueWidgetId(raw: string): string {
  const base = raw.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'node';
  const n = (usedWidgetIds.get(base) || 0) + 1;
  usedWidgetIds.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

// ─────────────────────────────────────────────
// PASS-THROUGH FLATTENING
// ─────────────────────────────────────────────

function isPassThroughContainer(xmlNode: XmlAstNode, widgetType: string): boolean {
  if (widgetType !== 'e-flexbox') return false;
  const { attrs } = xmlNode;
  const meaningfulChildren = (xmlNode.children || []).filter(c => c.tagName && c.tagName !== '_root');
  if (meaningfulChildren.length !== 1) return false;
  const hasMeaningfulLayout = attrs.stackGap || attrs.padding || attrs.maxWidth
    || attrs.backgroundColor || attrs['background-color']
    || attrs.borderRadius || attrs['border-radius'];
  if (hasMeaningfulLayout) return false;
  if (attrs.position && attrs.position !== 'absolute') return false;
  if (attrs.width && attrs.width !== '100%' && attrs.width !== '100vw') return false;
  if (attrs.height && attrs.height !== '100%' && attrs.height !== '100vh') return false;
  return true;
}

interface ResolvedNode { node: XmlAstNode; depth: number }

function resolvePassThrough(xmlNode: XmlAstNode, depth: number): ResolvedNode[] {
  const widgetType = determineWidgetType(xmlNode.attrs, xmlNode);
  if (!isPassThroughContainer(xmlNode, widgetType)) {
    return [{ node: xmlNode, depth }];
  }
  log(`[${'  '.repeat(depth)}] FLATTENED pass-through: ${xmlNode.attrs.name || 'unnamed'}`);
  const meaningful = (xmlNode.children || []).filter(c => c.tagName && c.tagName !== '_root');
  return resolvePassThrough(meaningful[0], depth);
}

// ─────────────────────────────────────────────
// EXTRACT COMPONENT TEXT (Bug 8)
// ─────────────────────────────────────────────

function extractComponentText(attrs: Record<string, string>): string | undefined {
  if (!attrs.componentId && !attrs.variant) return undefined;
  let bestText: string | undefined = undefined;

  for (const [key, val] of Object.entries(attrs)) {
    if (['componentId', 'variant', 'name', 'id', 'nodeId', 'tag', 'href',
          'target', 'layout', 'overflow', 'position', 'opacity'].includes(key)) continue;
    if (/^[A-Z]/.test(key)) continue;

    const str = String(val).trim();
    if (str.length < 3) continue;
    if (str === 'true' || str === 'false') continue;
    if (str.startsWith('http') || str.startsWith('/') || str.startsWith('#')) continue;
    if (/^-?\d*\.?\d+$/.test(str)) continue;
    if (/^[a-zA-Z0-9_-]{8,15}$/.test(str) && !str.includes(' ')) continue;
    if (str.includes('/>') || str.includes('</') || /^[a-zA-Z]+="[^"]*"(\s+[a-zA-Z]+="[^"]*")*\s*\/?>/.test(str) || /\w+="[^"]*"/.test(str)) continue;

    if (!bestText || str.length > bestText.length) {
      bestText = str;
    }
  }

  return bestText;
}

// ─────────────────────────────────────────────
// V4 NODE CONVERSION
// ─────────────────────────────────────────────

interface V4Element {
  type: string;
  elType: string;
  widgetType: string;
  id: string;
  settings: Record<string, unknown>;
  styles: Record<string, unknown>;
  elements?: V4Element[];
}

function convertNode(
  xmlNode: XmlAstNode,
  tokenMapping: TokenMapping | null,
  fontResolution: FontResolution | null,
  imageMap: Record<string, unknown> | null,
  depth = 0,
  styleMap: StyleMap | null = null,
  themeDefaults: ThemeDefaults | null = null,
): V4Element | null {
  const { attrs } = xmlNode;
  const compText = extractComponentText(attrs);
  const textContent = compText !== undefined
    ? compText
    : (attrs.text !== undefined ? attrs.text : (xmlNode._textContent || undefined));
  const enrichedAttrs = textContent !== undefined ? { ...attrs, text: textContent } : attrs;

  const name = attrs.name || `node-${depth}`;
  const nodeId = attrs.nodeId || attrs.id;
  const widgetType = determineWidgetType(enrichedAttrs, xmlNode);
  const styleId = uniqueStyleId(name);
  const rawId = nodeId || name;
  const widgetId = uniqueWidgetId(rawId);

  log(`[${'  '.repeat(depth)}] ${name} → ${widgetType} (${styleId})`);

  const props = buildStyleProps(
    enrichedAttrs, widgetType, tokenMapping, fontResolution,
    imageMap, xmlNode, styleMap, widgetId, themeDefaults,
  );

  const settings: Record<string, unknown> = {
    classes: wrapClasses([styleId]),
  };

  if (widgetType === 'e-flexbox') {
    settings.tag = sanitizeContainerTag(attrs.tag || (depth === 0 ? 'section' : 'div'), 'e-flexbox');
  }

  if (widgetType === 'e-div-block') {
    settings.tag = sanitizeContainerTag(attrs.tag || 'div', 'e-div-block');
  }

  if (widgetType === 'e-button') {
    settings.tag = attrs.tag || (attrs.href ? 'a' : 'button');
    settings.text = wrapHtmlContent(textContent || name || '');
    if (attrs.href) settings.link = wrapLink(attrs.href, attrs.target === '_blank');
  }

  if (widgetType === 'e-heading') {
    settings.tag = determineHtmlTag(enrichedAttrs) as string;
    settings.title = wrapHtmlContent(textContent || '');
  }

  if (widgetType === 'e-paragraph') {
    settings.paragraph = wrapHtmlContent(textContent || '');
  }

  if (widgetType === 'e-image') {
    const imgSrc = resolveImageSrc(attrs.backgroundImage || attrs.src, imageMap);
    if (imgSrc) settings['image'] = wrapImage(imgSrc);
    else settings['image'] = wrapImage(wrapImageSrc({ id: '0' }));
  }

  if (widgetType === 'e-svg') {
    settings['svg-icon'] = { '$$type': 'string', value: serializeSvgNode(xmlNode) };
    if (attrs.width) settings.width = wrapSize(attrs.width);
    if (attrs.height) settings.height = wrapSize(attrs.height);
  }

  if (widgetType === 'e-component') {
    settings.tag = attrs.tag || 'div';
    settings['component-id'] = wrapType('string', attrs.componentId || attrs.componentName || '');
    if (attrs.componentOverrides) {
      try {
        const overrides = typeof attrs.componentOverrides === 'string'
          ? JSON.parse(attrs.componentOverrides)
          : attrs.componentOverrides;
        for (const [key, val] of Object.entries(overrides as Record<string, unknown>)) {
          settings[`property-${key}`] = wrapType('string', String(val));
        }
      } catch { /* ignore parse errors */ }
    }
  }

  const baseVariant = {
    meta: { breakpoint: null, state: null },
    props: Object.keys(props).length > 0 ? props : {},
    custom_css: null,
  };

  const styles = {
    [styleId]: buildStyleClass({ id: styleId, label: 'local', variants: [baseVariant] }),
  };

  const rawChildren = widgetType === 'e-svg'
    ? []
    : (xmlNode.children || []).filter(c => c.tagName && c.tagName !== '_root');

  const v4Children: V4Element[] = [];
  for (const child of rawChildren) {
    const resolved = resolvePassThrough(child, depth + 1);
    for (const r of resolved) {
      const converted = convertNode(r.node, tokenMapping, fontResolution, imageMap, r.depth, styleMap, themeDefaults);
      if (converted) v4Children.push(converted);
    }
  }

  const ATOMIC_ELEMENT_TYPES = new Set(['e-flexbox', 'e-div-block']);
  const elType = ATOMIC_ELEMENT_TYPES.has(widgetType) ? widgetType : 'widget';

  const node: V4Element = { type: widgetType, elType, widgetType, id: widgetId, settings, styles };
  if (v4Children.length > 0) node.elements = v4Children;

  return node;
}

// ─────────────────────────────────────────────
// C6: TOKEN-TO-GV SUBSTITUTION PASS
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// RC-13: TOKEN USAGE ANALYZER
// ─────────────────────────────────────────────

interface TokenUsageReport {
  hardcoded_colors: Map<string, { value: string; count: number; elements: string[]; prop: string }>;
  hardcoded_fonts: Map<string, { value: string; count: number; elements: string[] }>;
  hardcoded_sizes: Map<string, { prop: string; value: string; count: number }>;
  total_elements: number;
  total_hardcoded: number;
  suggestions: Array<{ type: string; severity: 'high' | 'medium'; value: string; occurrences: number; action: string }>;
  summary?: {
    unique_colors: number;
    unique_fonts: number;
    unique_sizes: number;
    total_hardcoded_values: number;
    high_severity_suggestions: number;
    medium_severity_suggestions: number;
  };
}

function analyzeTokenUsage(treeNodes: V4Element[] | V4Element): TokenUsageReport {
  const report: TokenUsageReport = {
    hardcoded_colors: new Map(),
    hardcoded_fonts: new Map(),
    hardcoded_sizes: new Map(),
    total_elements: 0,
    total_hardcoded: 0,
    suggestions: [],
  };

  function walk(node: Record<string, unknown>): void {
    if (!node || typeof node !== 'object') return;
    if (node.widgetType || node.elType) {
      report.total_elements++;
    }

    const styles = node.styles as Record<string, Record<string, unknown>> | undefined;
    for (const [, styleDef] of Object.entries(styles || {})) {
      const variants = styleDef.variants as Array<Record<string, unknown>> | undefined;
      for (const variant of (variants || [])) {
        const vProps = variant.props as Record<string, Record<string, unknown>> | undefined;
        if (!vProps) continue;
        for (const [prop, value] of Object.entries(vProps)) {
          if (!value || typeof value !== 'object') continue;

          if (value['$$type'] === 'color') {
            const hex = ((value.value as Record<string, unknown>)?.hex || value.value || '').toString();
            if (hex && !hex.startsWith('e-gv-') && !hex.startsWith('var(')) {
              const key = hex.slice(0, 7);
              if (!report.hardcoded_colors.has(key)) {
                report.hardcoded_colors.set(key, { value: hex, count: 0, elements: [], prop });
              }
              const entry = report.hardcoded_colors.get(key)!;
              entry.count++;
              if (entry.elements.length < 5) entry.elements.push((node.id || node.widgetType || '?') as string);
              report.total_hardcoded++;
            }
          }

          if (prop === 'font-family') {
            if (value['$$type'] === 'string') {
              const family = (value.value || '').toString();
              if (family && !family.startsWith('e-gv-') && !family.startsWith('var(')) {
                if (!report.hardcoded_fonts.has(family)) {
                  report.hardcoded_fonts.set(family, { value: family, count: 0, elements: [] });
                }
                const entry = report.hardcoded_fonts.get(family)!;
                entry.count++;
                if (entry.elements.length < 5) entry.elements.push((node.id || node.widgetType || '?') as string);
                report.total_hardcoded++;
              }
            }
          }

          if (prop === 'font-size' || prop === 'width' || prop === 'height' || prop === 'gap' || prop === 'padding') {
            if (value['$$type'] === 'size') {
              const sizeVal = ((value.value as Record<string, unknown>)?.size || value.value || '').toString();
              const pxMatch = sizeVal.match(/^(\d+)px$/);
              if (pxMatch) {
                const px = parseInt(pxMatch[1], 10);
                if (px >= 16 && px % 4 === 0) {
                  const key = `${prop}:${sizeVal}`;
                  if (!report.hardcoded_sizes.has(key)) {
                    report.hardcoded_sizes.set(key, { prop, value: sizeVal, count: 0 });
                  }
                  report.hardcoded_sizes.get(key)!.count++;
                }
              }
            }
          }
        }
      }
    }

    const children = (node.elements as Record<string, unknown>[]) || [];
    for (const child of children) walk(child);
  }

  const roots = Array.isArray(treeNodes) ? treeNodes : [treeNodes];
  for (const root of roots) walk(root as unknown as Record<string, unknown>);

  const colorEntries = [...report.hardcoded_colors.entries()]
    .sort((a, b) => b[1].count - a[1].count);
  const fontEntries = [...report.hardcoded_fonts.entries()]
    .sort((a, b) => b[1].count - a[1].count);

  for (const [, data] of colorEntries) {
    if (data.count >= 2) {
      report.suggestions.push({
        type: 'color',
        severity: data.count >= 3 ? 'high' : 'medium',
        value: data.value,
        occurrences: data.count,
        action: `Erstelle e-gv-color Variable für ${data.value} (${data.count}x verwendet). Ersetze alle Hardcodes mit var(--gv-<id>).`,
      });
    }
  }

  for (const [, data] of fontEntries) {
    if (data.count >= 2) {
      report.suggestions.push({
        type: 'font',
        severity: data.count >= 3 ? 'high' : 'medium',
        value: data.value,
        occurrences: data.count,
        action: `Erstelle e-gv-font Variable für "${data.value}" (${data.count}x verwendet).`,
      });
    }
  }

  report.summary = {
    unique_colors: report.hardcoded_colors.size,
    unique_fonts: report.hardcoded_fonts.size,
    unique_sizes: report.hardcoded_sizes.size,
    total_hardcoded_values: report.total_hardcoded,
    high_severity_suggestions: report.suggestions.filter(s => s.severity === 'high').length,
    medium_severity_suggestions: report.suggestions.filter(s => s.severity === 'medium').length,
  };

  return report;
}

function findGvIdForHex(hex: string, tokenMapping: TokenMapping | null): string | null {
  if (!hex || !tokenMapping) return null;
  const normHex = hex.replace('#', '').toLowerCase();
  for (const [, data] of Object.entries(tokenMapping.colors || {})) {
    const dataHex = (data.hex || '').replace('#', '').toLowerCase();
    if (dataHex === normHex && data.gv_id) return data.gv_id;
  }
  return null;
}

function findGvIdForFont(family: string, tokenMapping: TokenMapping | null): string | null {
  if (!family || !tokenMapping) return null;
  const normFamily = family.replace(/['"]/g, '').toLowerCase().trim();
  for (const [, data] of Object.entries(tokenMapping.fonts || {})) {
    const dataFamily = (data.family || '').replace(/['"]/g, '').toLowerCase().trim();
    if (dataFamily === normFamily && data.gv_id) return data.gv_id;
  }
  return null;
}

function substituteTokensWithGvIds(tree: V4Element[] | V4Element, tokenMapping: TokenMapping | null): { tree: typeof tree; substitutions: number } {
  if (!tokenMapping) return { tree, substitutions: 0 };
  let substitutions = 0;

  function walkNode(node: Record<string, unknown>): void {
    if (!node || typeof node !== 'object') return;
    const styles = node.styles as Record<string, Record<string, unknown>> | undefined;
    if (styles) {
      for (const [, styleDef] of Object.entries(styles)) {
        const variants = styleDef.variants as Array<Record<string, unknown>> | undefined;
        for (const variant of (variants || [])) {
          if (!variant.props) continue;
          for (const [prop, value] of Object.entries(variant.props as Record<string, Record<string, unknown>>)) {
            if (!value || typeof value !== 'object') continue;
            if (value['$$type'] === 'color') {
              const hex = typeof value.value === 'string' ? value.value : null;
              if (!hex || !hex.startsWith('#')) continue;
              const gvId = findGvIdForHex(hex, tokenMapping);
              if (gvId) {
                (variant.props as Record<string, Record<string, unknown>>)[prop] = wrapGvColor(gvId);
                substitutions++;
              }
            }
            if (prop === 'font-family' && value['$$type'] === 'string') {
              const family = value.value;
              if (!family) continue;
              const gvId = findGvIdForFont(family as string, tokenMapping);
              if (gvId) {
                (variant.props as Record<string, Record<string, unknown>>)[prop] = wrapGvFont(gvId);
                substitutions++;
              }
            }
          }
        }
      }
    }

    const children = (node.elements as Record<string, unknown>[]) || [];
    for (const child of children) walkNode(child);
  }

  const roots = Array.isArray(tree) ? tree : [tree];
  for (const root of roots) walkNode(root as unknown as Record<string, unknown>);

  return { tree, substitutions };
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

let xmlContent: string;
if (args['xml-string']) {
  xmlContent = args['xml-string'] as string;
} else {
  if (!fs.existsSync(args.xml as string)) {
    process.stderr.write(`Error: XML nicht gefunden: ${args.xml}\n`); process.exit(2);
  }
  xmlContent = fs.readFileSync(args.xml as string, 'utf8');
}

let tokenMapping: TokenMapping | null = null;
if (args.tokens) {
  if (!fs.existsSync(args.tokens as string)) {
    warn(`token-mapping.json nicht gefunden: ${args.tokens}. Tokens werden nicht aufgelöst.`);
  } else {
    tokenMapping = JSON.parse(fs.readFileSync(args.tokens as string, 'utf8')) as TokenMapping;
    log(`Token mapping loaded: ${Object.keys(tokenMapping.colors || {}).length} colors, ${Object.keys(tokenMapping.fonts || {}).length} fonts`);
  }
}

let fontResolution: FontResolution | null = null;
if (args.fonts) {
  if (!fs.existsSync(args.fonts as string)) {
    warn(`font-resolution.json nicht gefunden: ${args.fonts}.`);
  } else {
    fontResolution = JSON.parse(fs.readFileSync(args.fonts as string, 'utf8')) as FontResolution;
    log(`Font resolution loaded: ${(fontResolution.fonts || []).length} fonts`);
  }
}

let imageMap: Record<string, unknown> | null = null;
if (args['image-map']) {
  if (fs.existsSync(args['image-map'] as string)) {
    imageMap = JSON.parse(fs.readFileSync(args['image-map'] as string, 'utf8'));
    log(`Image map loaded: ${Object.keys((imageMap as ImageMap).images || {}).length} images`);
  }
}

let styleMap: StyleMap | null = null;
if (args['style-map']) {
  if (fs.existsSync(args['style-map'] as string)) {
    styleMap = JSON.parse(fs.readFileSync(args['style-map'] as string, 'utf8')) as StyleMap;
    const tsCount = Object.keys(styleMap.textStyles || {}).length;
    const csCount = Object.keys(styleMap.colorStyles || {}).length;
    log(`Style map loaded: ${tsCount} text styles, ${csCount} color styles`);
  } else {
    warn(`style-map nicht gefunden: ${args['style-map']}`);
  }
}

const styleMapIsEmpty = !styleMap ||
  (Object.keys(styleMap.textStyles || {}).length === 0 &&
   Object.keys(styleMap.colorStyles || {}).length === 0);

if (styleMapIsEmpty && (args['framer-url'] || args['framer-html'])) {
  const tmpStyleMap = path.join(os.tmpdir(), `style-map-fallback-${Date.now()}.json`);
  warn(`style-map leer/fehlend → CSS-Fallback via ${args['framer-html'] ? 'HTML' : 'URL'}`);

  const fallbackResult = spawnSync(
    process.execPath,
    [
      path.join(__dirname, 'css-fallback-extractor.js'),
      ...(args['framer-html'] ? ['--html', args['framer-html'] as string] : ['--url', args['framer-url'] as string]),
      '--style-map-output', tmpStyleMap,
      '--output-dir', os.tmpdir(),
      ...(args.verbose ? ['--verbose'] : []),
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );

  if (fallbackResult.status === 0 && fs.existsSync(tmpStyleMap)) {
    styleMap = JSON.parse(fs.readFileSync(tmpStyleMap, 'utf8')) as StyleMap;
    const tsCount = Object.keys(styleMap.textStyles || {}).length;
    const csCount = Object.keys(styleMap.colorStyles || {}).length;
    process.stderr.write(`✓ CSS-Fallback: ${tsCount} TextStyles, ${csCount} Colors geladen.\n`);
    try { fs.unlinkSync(tmpStyleMap); } catch { /* ignore cleanup error */ }
  } else {
    warn('CSS-Fallback fehlgeschlagen — RC-11 statische Fallbacks werden genutzt.');
  }
}

let themeDefaults: ThemeDefaults | null = null;
if (args['theme-defaults']) {
  if (fs.existsSync(args['theme-defaults'] as string)) {
    try {
      themeDefaults = JSON.parse(fs.readFileSync(args['theme-defaults'] as string, 'utf8')) as ThemeDefaults;
      log(`Theme-Defaults geladen: ${Object.keys(themeDefaults).join(', ')}`);
    } catch (e: unknown) {
      warn(`--theme-defaults konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    warn(`--theme-defaults Datei nicht gefunden: ${args['theme-defaults']}`);
  }
}

let xmlRoots: XmlAstNode[];
try {
  const tokens = tokenizeXml(xmlContent);
  xmlRoots = buildTree(tokens);
} catch (e: unknown) {
  process.stderr.write(`Error: XML parse fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
}

if (xmlRoots.length === 0) {
  process.stderr.write('Error: Keine Nodes im XML gefunden.\n'); process.exit(2);
}

log(`XML nodes parsed: ${xmlRoots.length} root node(s)`);

const v4Tree = xmlRoots
  .filter(n => n.tagName && n.tagName !== '_root')
  .map(n => convertNode(n, tokenMapping, fontResolution, imageMap, 0, styleMap, themeDefaults))
  .filter((n): n is V4Element => n !== null);

if (tokenMapping) {
  let totalSubstitutions = 0;
  for (const root of v4Tree) {
    const result = substituteTokensWithGvIds(root, tokenMapping);
    totalSubstitutions += result.substitutions;
  }
  if (totalSubstitutions > 0) {
    log(`C6 GV-Substitution: ${totalSubstitutions} hardcoded values → e-gv-* references`);
  }
}

const result = v4Tree.length === 1 ? v4Tree[0] : v4Tree;
const output = JSON.stringify(result, null, 2);

const outputPath: string | null = (args.output as string) || (args.validate ? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v4tree-')), 'tree.json') : null);

if (outputPath) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, output, 'utf8');
  if (args.output) process.stderr.write(`Saved to ${outputPath as string}\n`);
}

if (preferGcForBackground && pendingGcCandidates.length > 0 && outputPath) {
  const candidatesPath = (outputPath as string).replace(/\.json$/, '') + '.gc-candidates.json';
  const byCategory: Record<string, unknown[]> = {};
  for (const c of pendingGcCandidates) {
    const cat = (c.category as string) || 'background';
    (byCategory[cat] ||= []).push(c);
  }
  fs.writeFileSync(candidatesPath, JSON.stringify(byCategory, null, 2), 'utf8');
  process.stderr.write(`✓ ${pendingGcCandidates.length} GC-Kandidat(en) (${Object.keys(byCategory).join(', ')}) → ${candidatesPath}\n`);
  process.stderr.write(`  Nutze: generate-global-classes.js --tree ${(args.output as string) || outputPath} --gc-candidates ${candidatesPath}\n`);
}

let validationPassed = true;
if (args.validate && outputPath) {
  const validatorScript = path.join(__dirname, 'validate-v4-tree.js');
  process.stderr.write(`Validating ${outputPath} …\n`);
  const val = spawnSync('node', [validatorScript, outputPath as string], { stdio: 'pipe', encoding: 'utf8' });
  if (val.stderr) process.stderr.write(val.stderr);
  if (val.stdout) {
    try {
      const vResult = JSON.parse(val.stdout) as { passed: boolean; score: number; stats: { totalErrors: number; totalWarnings: number } };
      const icon = vResult.passed ? '✅' : '❌';
      process.stderr.write(`${icon} Score: ${vResult.score}% | ${vResult.stats.totalErrors} errors, ${vResult.stats.totalWarnings} warnings\n`);
      if (!vResult.passed) validationPassed = false;
    } catch {
      process.stderr.write(val.stdout.slice(0, 500) + '\n');
      validationPassed = false;
    }
  }
  if (val.status !== 0) validationPassed = false;
}

if (!args.output) {
  process.stdout.write(output + '\n');
}

// ── RC-13: TOKENS REPORT ──
let tokensReport: TokenUsageReport | null = null;
if (args['tokens-report'] && v4Tree.length > 0) {
  tokensReport = analyzeTokenUsage(v4Tree);
  const tokensReportPath = path.join(path.dirname(outputPath ?? '.'), 'tokens-report.json');
  try {
    const reportOutput = {
      generated_at: new Date().toISOString(),
      source: (args.xml as string) || 'inline',
      summary: tokensReport.summary,
      hardcoded_colors: Object.fromEntries(tokensReport.hardcoded_colors),
      hardcoded_fonts: Object.fromEntries(tokensReport.hardcoded_fonts),
      suggestions: tokensReport.suggestions,
    };
    fs.writeFileSync(tokensReportPath, JSON.stringify(reportOutput, null, 2), 'utf8');
    process.stderr.write(`\n📊 Tokens Report → ${path.relative(process.cwd(), tokensReportPath)}\n`);
    process.stderr.write(`   ${tokensReport.summary!.unique_colors} unique hardcoded colors, ${tokensReport.summary!.unique_fonts} fonts, ${tokensReport.summary!.total_hardcoded_values} total\n`);
    if (tokensReport.suggestions.length > 0) {
      process.stderr.write(`   🔔 ${tokensReport.suggestions.length} token suggestions (${tokensReport.summary!.high_severity_suggestions} high-priority)\n`);
      for (const s of tokensReport.suggestions.filter(s => s.severity === 'high').slice(0, 3)) {
        process.stderr.write(`     • ${s.type}: ${s.value.slice(0, 40)} (${s.occurrences}x)\n`);
      }
    }
  } catch (e: unknown) {
    process.stderr.write(`⚠ Tokens report write failed: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

if (args.gc && outputPath) {
  const gcScript = path.join(__dirname, 'generate-global-classes.js');
  const gcOutput = (args['gc-output'] as string) || path.join(path.dirname(outputPath ?? '.'), 'global-class-plan.json');
  const minDups = String(args['gc-min-dups'] || '2');

  if (!fs.existsSync(gcScript)) {
    process.stderr.write('⚠ generate-global-classes.js not found — skipping GC analysis.\n');
  } else {
    process.stderr.write(`\n🔍 Running Global Classes analysis (min-dups=${minDups})…\n`);
    try {
      const gcResult = spawnSync('node', [gcScript, '--tree', outputPath as string, '--min-dups', minDups as string, '--output', gcOutput], {
        stdio: 'pipe', encoding: 'utf8', timeout: 30000,
      });
      if (gcResult.stderr) {
        const gcStderr = gcResult.stderr.toString();
        const summaryMatch = gcStderr.match(/\[gen-gc\] (\d+) GC-Vorschläge/);
        if (summaryMatch) {
          process.stderr.write(`✅ GC Analysis: ${summaryMatch[1]} Global Class suggestions\n`);
          process.stderr.write(`   Plan → ${path.relative(process.cwd(), gcOutput)}\n`);
        } else {
          const noDupMatch = gcStderr.match(/Keine Duplikate gefunden/);
          if (noDupMatch) {
            process.stderr.write('ℹ️  No duplicate styles found — all styles are unique. GCs not needed.\n');
          } else {
            process.stderr.write(gcStderr.slice(0, 500) + '\n');
          }
        }
      }
    } catch (e: unknown) {
      process.stderr.write(`⚠ GC analysis failed: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
}

if (!args.output && outputPath) {
  try { fs.rmSync(path.dirname(outputPath as string), { recursive: true, force: true }); } catch { /* ignore */ }
}

process.stderr.write(`✓ ${usedStyleIds.size} V4 nodes converted, ${warnings.length} warnings\n`);
if (warnings.length > 0 && args.verbose) {
  warnings.forEach(w => process.stderr.write(`  ⚠ ${w}\n`));
}

process.exit(warnings.length > 0 || !validationPassed ? 1 : 0);
