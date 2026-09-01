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
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
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
 *
 * "Default" means default IN THE TARGET, not in CSS. `flex-direction: row` is
 * deliberately absent: it is the CSS default but NOT Elementor's, whose container
 * stylesheet sets `.e-con.e-flex { --flex-direction: column }` (verified in
 * elementor/assets/css/frontend.min.css). Filtering it made a rendered row
 * indistinguishable from an unset value, and `flexDirectionSetting` in the V3
 * emitter then wrote `column` for every layout node — measured on
 * precious-board-067119 as 188 rendered rows arriving as 72 forced columns.
 */
const DEFAULT_VALUES: Readonly<Record<string, readonly string[]>> = {
  'background-color': ['rgba(0, 0, 0, 0)', 'transparent'],
  opacity: ['1'],
  display: ['block', 'inline'],
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
       * A runtime clone the page produced for a marquee loop, not authored layout.
       *
       * Measured on precious-board-067119 (Integrations ticker): the authored list
       * holds 11 `<li>`. Sampled before the section scrolls into view it still
       * holds 11; afterwards it holds 22, and exactly the added 11 carry
       * `aria-hidden="true"`. The duplication is also perfectly periodic — card
       * names AND image sources repeat at period 11 — so the extra nodes are a
       * copy of the authored run, produced for the animation.
       *
       * Filtering them is a correctness requirement, not a size optimisation: kept,
       * they double a level the structural side has once, and every component
       * instance in that level loses its DOM counterpart and emits as an HTML
       * placeholder. Page-wide this removes 69 of 742 named nodes and changes no
       * other level-bearing site (verified: 14 of 15 sites report identical counts
       * with and without the filter).
       *
       * `aria-hidden` is the page's OWN statement that the subtree is decorative.
       * Reading it is not a heuristic about class names or geometry.
       */
      const isRuntimeClone = (node: Element): boolean =>
        node.getAttribute('aria-hidden') === 'true';

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
          if (isRuntimeClone(child)) continue;
          if (isNamed(child)) found.push(child);
          else found.push(...nearestNamedChildren(child));
        }
        return found;
      };

      /**
       * Unnamed direct children that each stand for a whole authored level.
       *
       * The flattening above is right for Framer's pass-through instance wrapper,
       * which contributes exactly ONE named node. It is wrong when several unnamed
       * siblings each contribute MANY: the authored level those siblings represent
       * then disappears and its children all surface as one flat run.
       *
       * Measured on precious-board-067119 (after clone filtering): of 15 sites with
       * two or more such branches, 14 have every branch contributing exactly 1
       * (Framer wrappers — unchanged), and 1 is the Integrations `Container`, whose
       * two `ssr-variant` branches contribute 11 authored cards each. The
       * structural side has two `Ticker` layers there, so flattening turned 2×11
       * into one run of 22 and all 22 ToolCard instances lost their DOM
       * counterpart — 22 of the 37 `html` placeholders in the measured build.
       *
       * The condition is deliberately narrow — EVERY branch must contribute more
       * than one, and no named sibling may be present — because that is the only
       * shape measured to lose a level. The three mixed sites (`Content Wrapper`,
       * branches contributing 2 and 1) stay flattened rather than being reshaped on
       * a guess; their flattened result was verified to match the structural
       * children exactly.
       */
      const levelBearingBranches = (element: Element): Element[] => {
        const children = Array.from(element.children).filter((child) => !isRuntimeClone(child));
        if (children.some((child) => isNamed(child))) return [];
        const branches = children.filter(
          (child) => nearestNamedChildren(child).length > 0,
        );
        if (branches.length < 2) return [];
        return branches.every((branch) => nearestNamedChildren(branch).length > 1) ? branches : [];
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

      /**
       * Positioning carried by an unnamed wrapper around a named root.
       *
       * Framer's header on the measured page is a relative `<header>` inside an
       * unnamed `framer-*-container` that is `position:absolute; top:0; z-index:10`.
       * The named-node walk deliberately skips that wrapper, but dropping its
       * positioning turns an overlay header into a normal-flow section at the
       * bottom of the Elementor page. Only root nodes are eligible: inheriting an
       * arbitrary component wrapper's positioning would fabricate layout on every
       * nested instance.
       */
      const readRootWrapperPosition = (element: Element): Record<string, string> | undefined => {
        let cursor = element.parentElement;
        while (cursor !== null && cursor !== document.body) {
          if (isNamed(cursor)) return undefined;
          const style = window.getComputedStyle(cursor);
          if (style.position === 'absolute' || style.position === 'fixed' || style.position === 'sticky') {
            const result: Record<string, string> = { position: style.position };
            for (const property of ['top', 'right', 'bottom', 'left', 'z-index']) {
              const value = style.getPropertyValue(property).trim();
              if (value !== '' && value !== 'auto') result[property] = value;
            }
            return result;
          }
          cursor = cursor.parentElement;
        }
        return undefined;
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
        // A level-bearing site is represented by its branches, each becoming one
        // synthetic node, instead of by the flattened union of their children.
        const branches = levelBearingBranches(element);
        const namedChildren = branches.length > 0 ? [] : nearestNamedChildren(element);
        const atLimit = depth >= maxDepth;

        if (atLimit && (namedChildren.length > 0 || branches.length > 0)) {
          warnings.push(
            `depth ${maxDepth} reached at "${element.getAttribute('data-framer-name')}"; ` +
              `${namedChildren.length + branches.length} named child level(s) not captured`,
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
          for (const branch of branches) {
            if (budget <= 0) {
              warnings.push(`node budget ${maxNodes} exhausted; the tree is truncated`);
              break;
            }
            children.push(buildBranch(branch, depth + 1));
          }
        }

        const name = element.getAttribute('data-framer-name');
        const href = element.getAttribute('href');
        const background = readBackgroundImage(element);
        const media = readMediaUrl(element);
        const text = readOwnText(element, namedChildren.length > 0 || branches.length > 0);
        // Only a leaf's typography is meaningful: a container's `textContent` is
        // its descendants' text concatenated, so looking for a "holder" inside it
        // would attribute one child's font size to the whole subtree.
        const textHolder = text !== undefined ? findTextHolder(element) : null;
        const ownStyles = readStyles(element, textHolder);
        const wrapperPosition = readRootWrapperPosition(element);
        const styles = ownStyles === undefined && wrapperPosition === undefined
          ? undefined
          : { ...ownStyles, ...wrapperPosition };
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

      /**
       * Represent one level-bearing branch as a node of its own.
       *
       * The branch element is unnamed by definition, so it gets no `framerName`.
       * That is honest: the author's layer tree has a layer here (`Ticker`), but the
       * rendered DOM does not say which, and inventing the name would make a guess
       * unfalsifiable downstream. The alignment matches it positionally, which is
       * exactly what `alignByNameAnchors` does for an unnamed candidate.
       *
       * Geometry and styles still come from the branch's own box, so a target can
       * emit the level even without a name.
       */
      const buildBranch = (element: Element, depth: number): Captured => {
        budget--;
        const rect = element.getBoundingClientRect();
        const namedChildren = nearestNamedChildren(element);
        const children: Captured[] = [];
        if (depth < maxDepth) {
          for (const child of namedChildren) {
            if (budget <= 0) {
              warnings.push(`node budget ${maxNodes} exhausted; the tree is truncated`);
              break;
            }
            children.push(build(child, depth + 1));
          }
        }
        const styles = readStyles(element, null);
        return {
          tag: element.tagName.toLowerCase(),
          bbox: {
            x: Math.round(rect.x + window.scrollX),
            y: Math.round(rect.y + window.scrollY),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          ...(styles !== undefined ? { styles } : {}),
          children,
        };
      };

      const allNamed = Array.from(document.querySelectorAll('[data-framer-name]'));
      // A clone can also be a ROOT (nothing named above it), so the same filter
      // has to apply here — otherwise a filtered-out subtree reappears as a
      // top-level root and the section alignment sees a phantom section.
      const roots = allNamed.filter((element) => {
        if (element.closest('[aria-hidden="true"]') !== null) return false;
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

      const clonedNamed = allNamed.filter(
        (element) => element.closest('[aria-hidden="true"]') !== null,
      ).length;
      if (clonedNamed > 0) {
        warnings.push(
          `${clonedNamed} named node(s) sit inside an aria-hidden subtree and were skipped as ` +
            'runtime clones (marquee/ticker duplicates the page marks decorative itself)',
        );
      }

      return {
        roots: built,
        nodeCount: built.reduce((total, node) => total + count(node), 0),
        // The AUTHORED named count: clones are not structure, and reporting them
        // here would make the capture look richer than the layer tree it must
        // align against.
        namedNodeCount: allNamed.length - clonedNamed,
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
