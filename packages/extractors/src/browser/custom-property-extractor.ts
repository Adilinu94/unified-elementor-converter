/**
 * Phase 4 (UMBAUPLAN §7.3.3): Custom-Property-Extractor.
 *
 * Auto-discovers every `--*` custom property declared on `:root` (and
 * optionally `:host` / `*`) and resolves their computed values at the
 * document root. Also walks the subtree to collect any `:root`-inherited
 * custom property values for snapshot purposes.
 *
 * Custom properties are essential for V3-style decisions: modern sites
 * (Tailwind, CSS-Vars-driven design systems) keep brand color / typography
 * tokens as `--*` and reference them via `var(--token)`. Phase 4 must
 * preserve them so Phase 6 (Token-Resolution) can map them to V3-Settings.
 */

import type { Page } from 'playwright';

/** A single custom-property declaration discovered on :root or :host. */
export interface CustomProperty {
  /** Property name, e.g. `--color-brand-primary`. */
  name: string;
  /** Resolved computed value at the declaration scope. */
  value: string;
  /** Where the property was declared. */
  scope: ':root' | ':host' | 'element';
  /** Selector of the element that *uses* this property (only when scope='element'). */
  selector?: string;
}

/** Options for extractCustomProperties(). */
export interface ExtractCustomPropertiesOptions {
  /** Also walk the subtree and capture inherited values (default: false).
   *  When true, an element's computed `getPropertyValue(name)` is captured
   *  even if the property was declared on `:root`. */
  walkSubtree?: boolean;
  /** Max nodes for subtree walk (default: 200). */
  maxNodes?: number;
  /** Depth limit for subtree walk (default: 4). */
  maxDepth?: number;
  /** Restrict to property names matching this prefix (e.g. `--color-`). */
  namePrefix?: string;
}

interface RawCustomProperty {
  name: string;
  value: string;
  scope: ':root' | ':host' | 'element';
  selector?: string;
}

function buildRootExtractionScript(namePrefix: string | undefined): string {
  const prefixJson = namePrefix ? JSON.stringify(namePrefix) : 'null';
  return `(function(){
    const prefix = ${prefixJson};
    const out = [];
    const matches = (n) => !prefix || (typeof n === 'string' && n.indexOf(prefix) === 0);

    const readScope = (el, scope) => {
      const cs = window.getComputedStyle(el);
      // Safari/older Chromium: style is on element.style; modern Chromium: getPropertyValue works on cs.
      // Walk the declaration list via element.style which is the most portable source of truth.
      const decls = (el && el.style && el.style) ? el.style : null;
      if (decls) {
        for (let i = 0; i < decls.length; i++) {
          const prop = decls[i];
          if (!prop || prop.indexOf('--') !== 0) continue;
          if (!matches(prop)) continue;
          const v = cs.getPropertyValue(prop).trim();
          if (v) out.push({ name: prop, value: v, scope: scope });
        }
      }
    };

    // :root is the document element (HTML); :host applies inside shadow roots.
    const docEl = document.documentElement;
    if (docEl) readScope(docEl, ':root');

    // Walk all elements for shadow-root :host declarations (rare, but cheap to scan)
    try {
      const allEls = document.querySelectorAll('*');
      for (let i = 0; i < allEls.length; i++) {
        const el = allEls[i];
        if (el && el.shadowRoot) {
          readScope(el, ':host');
        }
      }
    } catch (err) { /* swallow */ }

    // De-duplicate by name (later declarations win — keep last value)
    const seen = new Map();
    for (const r of out) seen.set(r.name, r);
    return Array.from(seen.values());
  })()`;
}

function buildSubtreeExtractionScript(
  namePrefix: string | undefined,
  maxNodes: number,
  maxDepth: number,
): string {
  const prefixJson = namePrefix ? JSON.stringify(namePrefix) : 'null';
  return `(function(){
    const prefix = ${prefixJson};
    const maxN = ${maxNodes};
    const maxD = ${maxDepth};
    const root = document.body;
    if (!root) return [];
    const out = [];
    const matches = (n) => !prefix || (typeof n === 'string' && n.indexOf(prefix) === 0);

    const walk = (el, depth) => {
      if (out.length >= maxN) return;
      if (depth > maxD) return;
      const cs = window.getComputedStyle(el);
      // Probe a small but representative slice of known variable names by
      // reading element.style (the same source-of-truth used for :root).
      const decls = el.style;
      for (let i = 0; i < decls.length; i++) {
        const prop = decls[i];
        if (!prop || prop.indexOf('--') !== 0) continue;
        if (!matches(prop)) continue;
        const v = cs.getPropertyValue(prop).trim();
        if (v) {
          const tag = el.tagName.toLowerCase();
          const id = el.id ? '#' + el.id : '';
          const cls = (el.className && typeof el.className === 'string')
            ? '.' + el.className.split(/\\s+/).filter(Boolean)[0]
            : '';
          out.push({
            name: prop,
            value: v,
            scope: 'element',
            selector: tag + id + cls,
          });
        }
      }
      for (const child of Array.from(el.children)) walk(child, depth + 1);
    };
    walk(root, 0);
    return out;
  })()`;
}

/**
 * Extract all custom-property declarations visible from `:root` (and any
 * `:host` shadow roots). Returns a deduplicated list, ordered by first
 * appearance.
 */
export async function extractCustomProperties(
  page: Page,
  options: ExtractCustomPropertiesOptions = {},
): Promise<CustomProperty[]> {
  const namePrefix = options.namePrefix;

  const rootRaw = ((await page
    .evaluate(buildRootExtractionScript(namePrefix))
    .catch(() => [])) ?? []) as RawCustomProperty[];

  const result: CustomProperty[] = rootRaw.map((r) => ({
    name: r.name,
    value: r.value,
    scope: r.scope,
  }));

  if (options.walkSubtree) {
    const subtreeRaw = ((await page
      .evaluate(buildSubtreeExtractionScript(namePrefix, options.maxNodes ?? 200, options.maxDepth ?? 4))
      .catch(() => [])) ?? []) as RawCustomProperty[];

    for (const r of subtreeRaw) {
      const entry: CustomProperty = {
        name: r.name,
        value: r.value,
        scope: 'element',
        selector: r.selector,
      };
      // Don't overwrite an existing :root/-host value (declarations win)
      if (!result.some((e) => e.name === entry.name)) {
        result.push(entry);
      }
    }
  }

  return result;
}

/** Group custom properties by their conventional token category (best-effort). */
export function groupByTokenCategory(
  properties: CustomProperty[],
): Record<string, CustomProperty[]> {
  const groups: Record<string, CustomProperty[]> = {
    color: [],
    typography: [],
    spacing: [],
    radius: [],
    shadow: [],
    motion: [],
    layout: [],
    other: [],
  };
  for (const p of properties) {
    const lower = p.name.toLowerCase();
    let bucket = 'other';
    if (lower.includes('color') || lower.includes('-c-') || /--c$/.test(lower)) bucket = 'color';
    else if (lower.includes('font') || lower.includes('text') || lower.includes('-fs-') || lower.includes('-lh-')) bucket = 'typography';
    else if (lower.includes('space') || lower.includes('spacing') || lower.includes('gap') || lower.includes('pad') || lower.includes('margin') || lower.includes('-p-') || lower.includes('-m-')) bucket = 'spacing';
    else if (lower.includes('radius') || lower.includes('-r-')) bucket = 'radius';
    else if (lower.includes('shadow') || lower.includes('-shadow')) bucket = 'shadow';
    else if (lower.includes('motion') || lower.includes('duration') || lower.includes('ease') || lower.includes('delay')) bucket = 'motion';
    else if (lower.includes('width') || lower.includes('height') || lower.includes('size') || lower.includes('breakpoint')) bucket = 'layout';
    groups[bucket].push(p);
  }
  return groups;
}