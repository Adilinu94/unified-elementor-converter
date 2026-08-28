/**
 * Resolve Unframer project-level styles into IR tokens.
 *
 * `getProjectXml` returns the project's colour and text styles as a flat list.
 * These are the pieces the live DOM cannot give back: a computed style says
 * `font-size: 68px`, but only the project XML says *this text uses
 * `/Heading 3`*, which is what makes a rebuild editable rather than a pile of
 * inline overrides.
 *
 * Measured against the Humeen project: 14 colour styles, 13 text styles.
 * Note `/White` appears TWICE with the same value — the project genuinely has
 * a duplicate, so the resolver must not assume path uniqueness.
 *
 * @module extractors/framer/unframer-style-resolver
 */

import type { TextStyleIR } from '@elconv/core';
import { parseUnframerXml, walkUnframerNodes, type UnframerNode } from './unframer-xml-parser.js';

export interface FramerColorStyle {
  path: string;
  light: string;
  dark?: string;
}

export interface FramerTextStyle {
  path: string;
  font?: string;
  fontSize?: string;
  lineHeight?: string;
  letterSpacing?: string;
  /** HTML tag the style maps to — the ONLY reliable heading-level signal. */
  tag?: string;
  alignment?: string;
  transform?: string;
}

export interface FramerProjectPage {
  nodeId: string;
  path: string;
}

export interface FramerProjectComponent {
  nodeId: string;
  name: string;
}

export interface FramerCodeComponent {
  codeFileId: string;
  path: string;
}

export interface FramerProjectStyles {
  pages: FramerProjectPage[];
  components: FramerProjectComponent[];
  codeComponents: FramerCodeComponent[];
  colorStyles: FramerColorStyle[];
  textStyles: FramerTextStyle[];
  warnings: string[];
}

/** Parse a `getProjectXml` response into pages, components and styles. */
export function parseUnframerProject(xml: string): FramerProjectStyles {
  const parsed = parseUnframerXml(xml);
  const warnings = [...parsed.warnings];

  const pages: FramerProjectPage[] = [];
  const components: FramerProjectComponent[] = [];
  const codeComponents: FramerCodeComponent[] = [];
  const colorStyles: FramerColorStyle[] = [];
  const textStyles: FramerTextStyle[] = [];

  for (const root of parsed.roots) {
    walkUnframerNodes(root, (node) => {
      const a = node.attributes;
      switch (node.tag) {
        case 'Page':
          if (a.nodeId && a.path) pages.push({ nodeId: a.nodeId, path: a.path });
          break;
        case 'Component':
          if (a.nodeId && a.name) components.push({ nodeId: a.nodeId, name: a.name });
          break;
        case 'CodeComponent':
          if (a.codeFileId && a.path) codeComponents.push({ codeFileId: a.codeFileId, path: a.path });
          break;
        case 'ColorStyle':
          if (a.path) {
            colorStyles.push({
              path: a.path,
              light: a.light ?? '',
              ...(a.dark ? { dark: a.dark } : {}),
            });
          }
          break;
        case 'TextStyle':
          if (a.path) textStyles.push(toFramerTextStyle(node));
          break;
        default:
          break;
      }
    });
  }

  // The project genuinely contains a duplicate `/White`. Report it rather than
  // silently letting last-write-wins decide.
  const duplicatePaths = findDuplicates(colorStyles.map((s) => s.path));
  for (const path of duplicatePaths) {
    warnings.push(`color style "${path}" is declared more than once in the project`);
  }

  return { pages, components, codeComponents, colorStyles, textStyles, warnings };
}

function toFramerTextStyle(node: UnframerNode): FramerTextStyle {
  const a = node.attributes;
  return {
    path: a.path!,
    ...(a.font ? { font: a.font } : {}),
    ...(a.fontSize ? { fontSize: a.fontSize } : {}),
    ...(a.lineHeight ? { lineHeight: a.lineHeight } : {}),
    ...(a.letterSpacing ? { letterSpacing: a.letterSpacing } : {}),
    ...(a.tag ? { tag: a.tag } : {}),
    ...(a.alignment ? { alignment: a.alignment } : {}),
    ...(a.transform ? { transform: a.transform } : {}),
  };
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    else seen.add(value);
  }
  return [...dupes];
}

// ============================================================================
// Style → IR token conversion
// ============================================================================

/**
 * Framer font selectors look like `CUSTOMV2;Creato Display Regular` or
 * `GF;Inter-600`. Split off the source prefix and derive a weight when the
 * name carries one.
 */
export function parseFramerFontSelector(selector: string): { family: string; weight: number } {
  const withoutSource = selector.includes(';') ? selector.slice(selector.indexOf(';') + 1) : selector;

  // Google-Fonts form: `Inter-600`
  const numeric = /^(.*)-(\d{3})$/.exec(withoutSource);
  if (numeric) return { family: numeric[1]!.trim(), weight: Number(numeric[2]) };

  const NAMED_WEIGHTS: Array<[RegExp, number]> = [
    [/\bthin\b/i, 100],
    [/\bextra-?light\b/i, 200],
    [/\blight\b/i, 300],
    [/\bregular\b|\bnormal\b|\bbook\b/i, 400],
    [/\bmedium\b/i, 500],
    [/\bsemi-?bold\b/i, 600],
    [/\bextra-?bold\b/i, 800],
    [/\bblack\b|\bheavy\b/i, 900],
    [/\bbold\b/i, 700],
  ];
  for (const [pattern, weight] of NAMED_WEIGHTS) {
    if (pattern.test(withoutSource)) {
      return { family: withoutSource.replace(pattern, '').replace(/\s+/g, ' ').trim(), weight };
    }
  }
  return { family: withoutSource.trim(), weight: 400 };
}

/**
 * Convert a Framer text style to the IR shape.
 *
 * `lineHeight` stays verbatim (`1.1em`) — converting an em line-height to px
 * would need the final font size and would be a guess.
 */
export function toTextStyleIR(style: FramerTextStyle): TextStyleIR {
  const font = style.font ? parseFramerFontSelector(style.font) : undefined;
  return {
    ...(font ? { family: font.family, weight: font.weight } : {}),
    ...(style.fontSize ? { size: style.fontSize } : {}),
    ...(style.lineHeight ? { lineHeight: style.lineHeight } : {}),
    ...(style.letterSpacing ? { letterSpacing: style.letterSpacing } : {}),
  };
}

export interface ResolvedStyleTokens {
  colors: Record<string, string>;
  fonts: Array<{ family: string; weight: number; style: string; sourceUrl?: string }>;
  textStyles: Record<string, TextStyleIR>;
  /** Text style path → HTML tag, for heading-level decisions. */
  tagByTextStyle: Record<string, string>;
}

/** Build the IR `tokens` block from parsed project styles. */
export function resolveStyleTokens(project: FramerProjectStyles): ResolvedStyleTokens {
  const colors: Record<string, string> = {};
  for (const style of project.colorStyles) {
    // First declaration wins; the duplicate is reported as a warning by
    // parseUnframerProject rather than silently overwritten here.
    if (!(style.path in colors)) colors[style.path] = style.light;
  }

  const textStyles: Record<string, TextStyleIR> = {};
  const tagByTextStyle: Record<string, string> = {};
  const fontKeys = new Set<string>();
  const fonts: Array<{ family: string; weight: number; style: string }> = [];

  for (const style of project.textStyles) {
    textStyles[style.path] = toTextStyleIR(style);
    if (style.tag) tagByTextStyle[style.path] = style.tag;
    if (style.font) {
      const { family, weight } = parseFramerFontSelector(style.font);
      const key = `${family}|${weight}`;
      if (!fontKeys.has(key)) {
        fontKeys.add(key);
        fonts.push({ family, weight, style: 'normal' });
      }
    }
  }

  return { colors, fonts, textStyles, tagByTextStyle };
}

/**
 * Resolve a colour reference from a node attribute.
 *
 * Framer writes either a literal (`rgb(13, 13, 13)`) or a style path
 * (`/Dark`). A path must be looked up; passing it through would emit the
 * literal string "/Dark" as a CSS colour.
 */
export function resolveColorReference(
  value: string | undefined,
  colors: Record<string, string>,
): { color?: string; unresolvedPath?: string } {
  if (!value) return {};
  if (!value.startsWith('/')) return { color: value };
  const resolved = colors[value];
  return resolved ? { color: resolved } : { unresolvedPath: value };
}
