/**
 * Capture the rendered page as a named-node tree.
 *
 * ## What this exists to provide
 *
 * `expandComponentInstances` needs a tree shaped like the author's layer tree,
 * not like the DOM. This module produces it, and the whole design rests on one
 * measured fact: Framer wraps every component instance in a
 * `div.framer-*-container` that carries NO `data-framer-name`. Verified on a
 * real page — the wrapper's only attribute is `class="framer-1mz98au-container"`.
 *
 * So "collect the nearest NAMED descendants" steps over those wrappers for free,
 * and the captured tree lines up with the layer tree instead of doubling every
 * level. A plain `children` walk would not.
 *
 * ## Why the styles list is curated
 *
 * A full `getComputedStyle` dump is ~340 properties per node. On the measured
 * page (690 named nodes) that is over 200k values, almost all of them browser
 * defaults, and the IR would be dominated by noise that no target reads. The
 * list below is the set a V3/V4 emitter can actually map, and every value is
 * checked against its default before being kept.
 *
 * ## What this deliberately does NOT do
 *
 * No classification, no role guessing, no section detection. It reports what the
 * browser reports. Interpretation belongs to `component-expansion`, where it can
 * be cross-checked against the structural IR — a capture step that also guessed
 * roles would make a wrong guess unfalsifiable.
 *
 * @module extractors/browser/live-node-tree
 */

import type { Page } from 'playwright';
import type { LiveDomNode } from '../framer/component-expansion.js';

/**
 * Computed properties worth carrying into the IR.
 *
 * Kept in sync with what `visual-ir-to-v3.ts` can map: anything a target cannot
 * consume is noise that inflates the IR without changing the output.
 */
const CAPTURED_PROPERTIES: readonly string[] = [
  'background-color',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'padding',
  'margin',
  'border-radius',
  'display',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
  'max-width',
  'min-height',
  'opacity',
];

/**
 * Values that mean "nothing was set".
 *
 * Without this filter, `opacity: 1` and `display: block` land on nearly every
 * node and a target then emits them as explicit settings — turning a default
 * into an override that overrides the theme.
 */
const DEFAULT_VALUES: Readonly<Record<string, readonly string[]>> = {
  'background-color': ['rgba(0, 0, 0, 0)', 'transparent'],
  opacity: ['1'],
  display: ['block', 'inline'],
  'flex-direction': ['row'],
  'justify-content': ['normal', 'flex-start'],
  'align-items': ['normal', 'stretch'],
  gap: ['normal', '0px'],
  padding: ['0px'],
  margin: ['0px'],
  'border-radius': ['0px'],
  'max-width': ['none'],
  'min-height': ['0px', 'auto'],
  'text-align': ['start', 'left'],
  'text-transform': ['none'],
  'letter-spacing': ['normal'],
};

export interface CaptureLiveNodeTreeOptions {
  /**
   * Maximum named-node depth to capture. Default 8.
   *
   * Measured depth on a real page is 11, but a V3 tree flattens past depth 3, so
   * 8 already captures more than any target consumes while bounding the payload.
   */
  maxDepth?: number;
  /** Hard cap on captured nodes, as a runaway guard. Default 3000. */
  maxNodes?: number;
  /** Skip the per-node computed-style read. Much faster, geometry only. */
  skipStyles?: boolean;
}

export interface LiveNodeTreeCapture {
  /** Top-level named nodes, in document order. */
  roots: LiveDomNode[];
  /** Nodes actually captured, after the depth and count limits. */
  nodeCount: number;
  /** Named nodes present in the document, before limits. */
  namedNodeCount: number;
  warnings: string[];
}

/**
 * Read the page's named-node tree with geometry and curated styles.
 *
 * One `page.evaluate` rather than a per-node round trip: 690 nodes × one call
 * each is minutes of IPC, and the geometry must come from a single layout state
 * anyway — boxes read across separate evaluations can straddle a reflow.
 */
export async function captureLiveNodeTree(
  page: Page,
  options: CaptureLiveNodeTreeOptions = {},
): Promise<LiveNodeTreeCapture> {
  const maxDepth = options.maxDepth ?? 8;
  const maxNodes = options.maxNodes ?? 3000;
  const skipStyles = options.skipStyles === true;

  const captured = await page.evaluate(
    ({ maxDepth, maxNodes, skipStyles, props, defaults }) => {
      const warnings: string[] = [];
      let budget = maxNodes;

      const isNamed = (node: Element): boolean => node.hasAttribute('data-framer-name');

      /**
       * The nearest named descendants of `element`.
       *
       * Descends THROUGH unnamed elements — that is what steps over Framer's
       * `*-container` instance wrappers — and stops at the first named one on
       * each branch.
       */
      const nearestNamedChildren = (element: Element): Element[] => {
        const found: Element[] = [];
        for (const child of Array.from(element.children)) {
          if (isNamed(child)) found.push(child);
          else found.push(...nearestNamedChildren(child));
        }
        return found;
      };

      const readStyles = (element: Element): Record<string, string> | undefined => {
        if (skipStyles) return undefined;
        const computed = window.getComputedStyle(element);
        const styles: Record<string, string> = {};
        for (const prop of props) {
          const value = computed.getPropertyValue(prop).trim();
          if (!value) continue;
          const ignored = (defaults as Record<string, string[]>)[prop];
          if (ignored && ignored.includes(value)) continue;
          styles[prop] = value;
        }
        return Object.keys(styles).length > 0 ? styles : undefined;
      };

      /** `background-image: url(...)` → the bare URL. */
      const readBackgroundImage = (element: Element): string | undefined => {
        const value = window.getComputedStyle(element).backgroundImage;
        if (!value || value === 'none') return undefined;
        const match = /url\(["']?([^"')]+)["']?\)/.exec(value);
        return match ? match[1] : undefined;
      };

      /**
       * Own text, but only when this element has no named descendants.
       *
       * `textContent` on a container returns every descendant's text
       * concatenated, so taking it unconditionally would duplicate the entire
       * page's copy onto every ancestor.
       */
      const readOwnText = (element: Element, hasNamedChildren: boolean): string | undefined => {
        if (hasNamedChildren) return undefined;
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
        return text.length > 0 ? text : undefined;
      };

      const readMediaUrl = (element: Element): string | undefined => {
        if (element.tagName === 'IMG') {
          const src = element.getAttribute('src');
          return src ?? undefined;
        }
        const img = element.querySelector(':scope > img');
        return img?.getAttribute('src') ?? undefined;
      };

      interface Captured {
        framerName?: string;
        tag: string;
        bbox: { x: number; y: number; width: number; height: number };
        text?: string;
        href?: string;
        backgroundImage?: string;
        mediaUrl?: string;
        styles?: Record<string, string>;
        children: Captured[];
      }

      const build = (element: Element, depth: number): Captured => {
        budget--;
        const rect = element.getBoundingClientRect();
        const namedChildren = nearestNamedChildren(element);
        const atLimit = depth >= maxDepth;

        if (atLimit && namedChildren.length > 0) {
          warnings.push(
            `depth ${maxDepth} reached at "${element.getAttribute('data-framer-name')}"; ` +
              `${namedChildren.length} named child level(s) not captured`,
          );
        }

        const children: Captured[] = [];
        if (!atLimit) {
          for (const child of namedChildren) {
            if (budget <= 0) {
              warnings.push(`node budget ${maxNodes} exhausted; the tree is truncated`);
              break;
            }
            children.push(build(child, depth + 1));
          }
        }

        const name = element.getAttribute('data-framer-name');
        const href = element.getAttribute('href');
        const background = readBackgroundImage(element);
        const media = readMediaUrl(element);
        const text = readOwnText(element, namedChildren.length > 0);
        const styles = readStyles(element);

        return {
          ...(name !== null ? { framerName: name } : {}),
          tag: element.tagName.toLowerCase(),
          bbox: {
            // Page coordinates, not viewport coordinates: the section merge
            // compares boxes across scroll positions.
            x: Math.round(rect.x + window.scrollX),
            y: Math.round(rect.y + window.scrollY),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          ...(text !== undefined ? { text } : {}),
          ...(href !== null ? { href } : {}),
          ...(background !== undefined ? { backgroundImage: background } : {}),
          ...(media !== undefined ? { mediaUrl: media } : {}),
          ...(styles !== undefined ? { styles } : {}),
          children,
        };
      };

      const allNamed = Array.from(document.querySelectorAll('[data-framer-name]'));
      const roots = allNamed.filter((element) => {
        let parent = element.parentElement;
        while (parent) {
          if (parent.hasAttribute('data-framer-name')) return false;
          parent = parent.parentElement;
        }
        return true;
      });

      const built = roots.map((root) => build(root, 0));
      const count = (node: Captured): number =>
        1 + node.children.reduce((total, child) => total + count(child), 0);

      return {
        roots: built,
        nodeCount: built.reduce((total, node) => total + count(node), 0),
        namedNodeCount: allNamed.length,
        warnings,
      };
    },
    { maxDepth, maxNodes, skipStyles, props: CAPTURED_PROPERTIES, defaults: DEFAULT_VALUES },
  );

  const warnings = [...captured.warnings];
  if (captured.namedNodeCount === 0) {
    // No `data-framer-name` anywhere means this is not a rendered Framer page,
    // or the capture ran before hydration. Either way, expansion against it
    // would match nothing while reporting success.
    warnings.push(
      'no [data-framer-name] elements found: this is not a hydrated Framer page, ' +
        'so component expansion has nothing to match against',
    );
  }

  return {
    roots: captured.roots as LiveDomNode[],
    nodeCount: captured.nodeCount,
    namedNodeCount: captured.namedNodeCount,
    warnings,
  };
}

/**
 * Find the DOM root that corresponds to a section, by document order.
 *
 * Exported because the caller needs the same pairing rule the section merge
 * uses: order is the key. A convenience wrapper rather than logic — the real
 * alignment lives in `hybrid-ir-merge`, and duplicating it here would let the
 * two drift apart.
 */
export function domRootForSectionIndex(
  capture: LiveNodeTreeCapture,
  index: number,
): LiveDomNode | undefined {
  return capture.roots[index];
}
