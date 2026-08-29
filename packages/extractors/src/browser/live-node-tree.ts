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
 * Properties that describe TEXT rather than the box around it.
 *
 * Split out because they must be read from a different element than the rest.
 * See `readStyles`: Framer names a wrapper, but the text sits one or more levels
 * below it, and the wrapper's computed typography is the inherited page default,
 * not what the text renders at.
 */
const TYPOGRAPHY_PROPERTIES: readonly string[] = [
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
];

/**
 * Tags that can be the element actually holding a text run.
 *
 * A closed list rather than "any element with text": `textContent` is inherited
 * upward, so every ancestor of a text node would otherwise qualify and the
 * deepest match could be a layout `div` that merely contains the text.
 */
const TEXT_HOLDER_TAGS: readonly string[] = [
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'P', 'SPAN', 'A', 'LI', 'BLOCKQUOTE', 'STRONG', 'EM', 'FIGCAPTION', 'LABEL',
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
    ({ maxDepth, maxNodes, skipStyles, props, typographyProps, holderTags, defaults }) => {
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

      /**
       * The element that actually renders this node's text, if any.
       *
       * Framer puts `data-framer-name` on a WRAPPER and the text one or more
       * levels below it. Measured on a real page: all 151 named text leaves held
       * their text in a deeper element, and 125 of them had a wrapper whose
       * computed `font-size` differed from it — the wrapper reported the
       * inherited page default of 12px while the text rendered at 72px. Reading
       * typography off the wrapper therefore produced a uniformly wrong value,
       * and a responsive diff taken from it found zero font-size changes across
       * breakpoints on a page whose headings scale 72 → 56 → 40px.
       *
       * The DEEPEST holder is chosen because Framer nests `<div><h1><span>` and
       * the innermost element is the one carrying the text style.
       */
      const findTextHolder = (element: Element): Element | null => {
        let holder: Element | null = null;
        for (const candidate of Array.from(element.querySelectorAll('*'))) {
          if (!holderTags.includes(candidate.tagName)) continue;
          if ((candidate.textContent ?? '').trim().length === 0) continue;
          holder = candidate;
        }
        return holder;
      };

      /**
       * The heading tag between `element` and its text holder, if any.
       *
       * Read separately from the holder because the two answers live at
       * different depths: measured on a real page the deepest holder is a `<p>`
       * 147 times and a `<span>` 4 times — never a heading — because Framer emits
       * `<h1><span>text</span></h1>`. Taking the tag from the holder would report
       * `span` for an element that renders as an `<h1>`, so the heading level
       * would be lost for every grafted heading on the page.
       */
      const findHeadingTag = (element: Element, holder: Element | null): string | undefined => {
        if (holder === null) return undefined;
        let current: Element | null = holder;
        while (current !== null && current !== element) {
          if (/^H[1-6]$/.test(current.tagName)) return current.tagName.toLowerCase();
          current = current.parentElement;
        }
        return undefined;
      };

      const readStyles = (element: Element, textHolder: Element | null): Record<string, string> | undefined => {
        if (skipStyles) return undefined;
        const styles: Record<string, string> = {};
        const box = window.getComputedStyle(element);
        // Typography from the text holder, box properties from the named element.
        // Both, not either: the wrapper owns padding and layout, the holder owns
        // font-size and line-height, and taking all of them from one element is
        // wrong in one direction or the other.
        const type = textHolder !== null ? window.getComputedStyle(textHolder) : box;
        for (const prop of props) {
          const source = typographyProps.includes(prop) ? type : box;
          const value = source.getPropertyValue(prop).trim();
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
        textHolderTag?: string;
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
        // Only a leaf's typography is meaningful: a container's `textContent` is
        // its descendants' text concatenated, so looking for a "holder" inside it
        // would attribute one child's font size to the whole subtree.
        const textHolder = text !== undefined ? findTextHolder(element) : null;
        const styles = readStyles(element, textHolder);
        const headingTag = findHeadingTag(element, textHolder);

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
          // The heading tag this node RENDERS as, when its own tag is not one.
          // `classifyDomRole` trusts the tag for its heading decision, and
          // Framer's named wrapper is a `div` even when an `<h1>` sits inside it
          // — so without this every grafted heading is classified as body text.
          ...(headingTag !== undefined ? { textHolderTag: headingTag } : {}),
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
    {
      maxDepth,
      maxNodes,
      skipStyles,
      props: CAPTURED_PROPERTIES,
      typographyProps: TYPOGRAPHY_PROPERTIES,
      holderTags: TEXT_HOLDER_TAGS,
      defaults: DEFAULT_VALUES,
    },
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
