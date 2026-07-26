/**
 * Framer Link Wirer (#7)
 *
 * Reads Framer `link` attributes from ComponentInstance instance props (and
 * Button/Link elements) and wires them into Elementor button widget `link`
 * settings. Eliminates manual link hardcoding.
 *
 * Framer stores links as instance props on ComponentInstance nodes (e.g.
 * `link="/book-appointment"`) and as attributes on Button/Link elements.
 * The framer-tree-to-v3 converter preserves these in `_source` JSON for
 * component instances, and directly in button settings for Button/Link.
 *
 * This module walks the V3 tree and:
 *  1. Resolves button widgets with a link setting already set (from converter).
 *  2. For component instances with a `link` in _source, finds child button
 *     widgets and wires the link (the builder resolves the component shape).
 *  3. Normalizes internal vs external links.
 *
 * @example
 * import { wireLinks } from './framer-link-wirer.js';
 * const { tree, wired, unresolved } = wireLinks(tree);
 */

import type { V3Tree, V3Element } from './v3-tree-types.js';

export interface LinkWirerOptions {
  /** Base URL of the target site (for resolving relative links). Optional. */
  baseUrl?: string;
  /** Link patterns to skip (e.g. /^#/ for anchor-only links). Default: none. */
  skipPatterns?: RegExp[];
}

export interface LinkWirerResult {
  tree: V3Tree;
  wired: number;
  unresolved: Array<{ elementId: string; reason: string }>;
}

/**
 * Walk the tree and wire button links from component instance props + button attrs.
 */
export function wireLinks(tree: V3Tree, opts: LinkWirerOptions = {}): LinkWirerResult {
  let wired = 0;
  const unresolved: Array<{ elementId: string; reason: string }> = [];

  for (const el of walk(tree)) {
    // 1. Button widgets with a link already in settings (from converter)
    if (el.elType === 'widget' && el.widgetType === 'button') {
      const link = el.settings?.link as { url?: string; is_external?: boolean } | undefined;
      if (link?.url) {
        const normalized = normalizeLink(link.url, opts);
        if (normalized) {
          el.settings!.link = { url: normalized, is_external: isExternal(normalized, opts.baseUrl) };
          wired++;
        } else {
          unresolved.push({ elementId: el.id ?? '?', reason: `skip pattern: ${link.url}` });
        }
      }
    }

    // 2. Component instances with a link in _source — propagate to child buttons
    if (el.elType === 'container' && el._source) {
      try {
        const src = JSON.parse(el._source) as { instanceProps?: Record<string, string> };
        const link = src.instanceProps?.link ?? src.instanceProps?.href;
        if (link && el.elements) {
          const buttons = findButtons(el.elements);
          for (const btn of buttons) {
            if (!btn.settings?.link || !(btn.settings.link as { url?: string }).url) {
              const normalized = normalizeLink(link, opts);
              if (normalized) {
                btn.settings!.link = { url: normalized, is_external: isExternal(normalized, opts.baseUrl) };
                wired++;
              }
            }
          }
        }
      } catch {
        // _source not valid JSON — skip
      }
    }
  }

  return { tree, wired, unresolved };
}

function* walk(tree: V3Tree): Generator<V3Element> {
  for (const el of tree) yield* walkEl(el);
}

function* walkEl(el: V3Element): Generator<V3Element> {
  yield el;
  if (el.elements) for (const c of el.elements) yield* walkEl(c);
}

function findButtons(els: V3Element[]): V3Element[] {
  const out: V3Element[] = [];
  for (const el of walk(els)) {
    if (el.elType === 'widget' && el.widgetType === 'button') out.push(el);
  }
  return out;
}

function normalizeLink(url: string, opts: LinkWirerOptions): string | null {
  if (!url) return null;
  for (const pat of opts.skipPatterns ?? []) {
    if (pat.test(url)) return null;
  }
  // Resolve relative links against base URL
  if (opts.baseUrl && url.startsWith('/') && !url.startsWith('//')) {
    return opts.baseUrl.replace(/\/$/, '') + url;
  }
  return url;
}

function isExternal(url: string, baseUrl?: string): boolean {
  if (!baseUrl) return /^https?:\/\//.test(url);
  return !url.startsWith(baseUrl);
}
