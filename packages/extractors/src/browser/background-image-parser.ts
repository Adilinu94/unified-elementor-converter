/**
 * Phase 4 (UMBAUPLAN §7.3.5): Background-Image-Parser.
 *
 * `getComputedStyle().backgroundImage` returns the raw value:
 *   "none" | "url(\"https://...\")" | "linear-gradient(...)" | "radial-gradient(...)"
 *   | "url(\"a.png\"), linear-gradient(red, blue)"  // multiple layers
 *
 * V3's elementor background-image setting only accepts a single URL, and
 * gradients are best expressed as a `custom_css` injection. This parser
 * splits the value into discrete layers + classifies each as url | linear
 * | radial | conic | other, so downstream stages (asset downloader,
 * token-resolver) can act on the right shape.
 */

import type { Page } from 'playwright';

/** Discriminated union for a single background-image layer. */
export type BackgroundLayer =
  | { kind: 'none' }
  | { kind: 'url'; url: string; quoted: boolean }
  | { kind: 'linear-gradient'; value: string }
  | { kind: 'radial-gradient'; value: string }
  | { kind: 'conic-gradient'; value: string }
  | { kind: 'other'; raw: string };

/** Parsed background-image for a single element. */
export interface BackgroundImageParseResult {
  selector: string;
  tag: string;
  raw: string;
  layers: BackgroundLayer[];
  /** First URL layer, if any. Convenience for V3's single-image setting. */
  primaryUrl?: string;
}

interface RawParseRow {
  selector: string;
  tag: string;
  raw: string;
}

/**
 * Parse a single `background-image` computed value into discrete layers.
 * Tolerates leading/trailing whitespace, multiple comma-separated layers,
 * and quoted/unquoted url() arguments.
 *
 * NOTE: This is a heuristic parser. It does not understand `image-set()`
 * or cross-origin syntax; those are returned as `{ kind: 'other' }`.
 */
export function parseBackgroundImage(value: string): BackgroundLayer[] {
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'none') return [{ kind: 'none' }];

  // Split at top-level commas (commas inside parens are kept).
  const parts = splitTopLevelCommas(trimmed);
  const layers: BackgroundLayer[] = [];

  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;
    if (p === 'none') { layers.push({ kind: 'none' }); continue; }

    const urlMatch = /^url\(\s*(['"]?)(.+?)\1\s*\)$/.exec(p);
    if (urlMatch) {
      layers.push({ kind: 'url', url: urlMatch[2], quoted: urlMatch[1] !== '' });
      continue;
    }
    if (/^linear-gradient\(/.test(p)) {
      layers.push({ kind: 'linear-gradient', value: p });
      continue;
    }
    if (/^radial-gradient\(/.test(p)) {
      layers.push({ kind: 'radial-gradient', value: p });
      continue;
    }
    if (/^conic-gradient\(/.test(p)) {
      layers.push({ kind: 'conic-gradient', value: p });
      continue;
    }
    layers.push({ kind: 'other', raw: p });
  }
  return layers;
}

/** Split a comma-separated CSS value while respecting parens. */
export function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buffer = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '(' && !inSingle && !inDouble) depth++;
    else if (ch === ')' && !inSingle && !inDouble) depth--;
    else if (ch === ',' && depth === 0 && !inSingle && !inDouble) {
      parts.push(buffer);
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  if (buffer.length > 0) parts.push(buffer);
  return parts;
}

/** Extract the first URL layer (if any). Returns undefined for non-url layers. */
export function firstUrl(layers: BackgroundLayer[]): string | undefined {
  for (const l of layers) {
    if (l.kind === 'url') return l.url;
  }
  return undefined;
}

function buildExtractionScript(maxNodes: number, maxDepth: number): string {
  return `(function(){
    const maxN = ${maxNodes};
    const maxD = ${maxDepth};
    const out = [];
    const root = document.body;
    if (!root) return [];

    const buildSelector = (el, ancestors) => {
      const parts = [];
      const chain = ancestors.slice(-2).concat([el]);
      for (const node of chain) {
        const tag = node.tagName.toLowerCase();
        if (node.id) { parts.push('#' + node.id); continue; }
        const cls = (node.className && typeof node.className === 'string')
          ? node.className.split(/\\s+/).filter(Boolean)[0]
          : '';
        parts.push(cls ? tag + '.' + cls : tag);
      }
      return parts.join(' > ');
    };

    const walk = (el, depth, ancestors) => {
      if (out.length >= maxN) return;
      if (depth > maxD) return;
      const cs = window.getComputedStyle(el);
      const bg = cs.getPropertyValue('background-image');
      // Skip the 'none' baseline — it's the default everywhere
      if (bg && bg.trim() && bg.trim() !== 'none') {
        out.push({
          selector: buildSelector(el, ancestors),
          tag: el.tagName.toLowerCase(),
          raw: bg,
        });
      }
      for (const child of Array.from(el.children)) walk(child, depth + 1, ancestors.concat([el]));
    };
    walk(root, 0, []);
    return out;
  })()`;
}

/**
 * Walk the DOM and parse background-image values for every element that
 * has a non-`none` background. Layers are split and classified so the
 * asset-downloader + token-resolver can act on the right shape.
 */
export async function parseBackgroundImages(
  page: Page,
  options: { maxNodes?: number; maxDepth?: number } = {},
): Promise<BackgroundImageParseResult[]> {
  const maxNodes = options.maxNodes ?? 500;
  const maxDepth = options.maxDepth ?? 4;

  const raw = ((await page
    .evaluate(buildExtractionScript(maxNodes, maxDepth))
    .catch(() => [])) ?? []) as RawParseRow[];

  return raw.map((row) => {
    const layers = parseBackgroundImage(row.raw);
    return {
      selector: row.selector,
      tag: row.tag,
      raw: row.raw,
      layers,
      primaryUrl: firstUrl(layers),
    };
  });
}