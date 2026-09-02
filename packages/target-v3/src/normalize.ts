/**
 * V3 Container Normalize.
 * Fixes isInner flags and flex-row child widths before deploy.
 * Ported from site-clone-to-v3/src/builder/v3-container-normalize.ts
 *
 * ## The width control depends on the element kind
 *
 * Verified against `schemas/elementor-v3-controls.snapshot.json` (Elementor 4.2.1):
 *
 *   - `__container__` declares `width` (slider, gated on `content_width: 'full'`)
 *     and `boxed_width` (slider, gated on `content_width: 'boxed'`). It declares
 *     NEITHER `_element_width`/`_element_custom_width` NOR `_inline_size`.
 *   - Every widget declares `_element_width` + `_element_custom_width`, no `width`.
 *   - `_inline_size` is a classic COLUMN control and appears nowhere in the
 *     container schema.
 *
 * Both normalizers in this file wrote a container key that does not exist, which
 * the schema gate reports as `unknown-key` — and `elementor-set-content` rejects
 * the whole write on one of those.
 */

import type { V3Element } from './types.js';

/**
 * Normalize a V3 container tree:
 * 1. Set isInner: true on all nested containers (depth > 0)
 * 2. Ensure flex-row container children carry the container `width` control
 * 3. Remove isInner from top-level containers
 *
 * The simple variant. `normalizeV3ContainerTreeWithReport` is the one the deploy
 * path uses and additionally returns fix counters.
 */
export function normalizeV3ContainerTree(tree: V3Element[]): V3Element[] {
  return tree.map((el, _idx) => normalizeElement(el, 0));
}

function normalizeElement(el: V3Element, depth: number): V3Element {
  const result = { ...el };

  if (result.elType === 'container') {
    // Top-level containers: isInner = false
    // Nested containers: isInner = true
    result.isInner = depth > 0;

    // If flex-row, ensure children have width
    const direction = (result.settings as Record<string, unknown>)?.flex_direction;
    if (direction === 'row' && result.elements) {
      const childCount = result.elements.length;
      const equalWidth = Math.floor(100 / childCount);
      result.elements = result.elements.map((child) => {
        if (child.elType !== 'container' && child.elType !== 'column') return child;
        if (hasFlexRowWidthConstraint(child)) return child;
        const settings = { ...(child.settings as Record<string, unknown>) };
        if (child.elType === 'column') {
          // The column's own sizing control, which is where `_inline_size` belongs.
          settings._inline_size = { unit: '%', size: equalWidth };
        } else {
          // `width` renders only while `content_width` is 'full'.
          settings.content_width = 'full';
          settings.width = { unit: '%', size: equalWidth, sizes: [] };
        }
        return { ...child, settings };
      });
    }
  }

  // Recurse into children
  if (result.elements) {
    result.elements = result.elements.map((child) => normalizeElement(child, depth + 1));
  }

  return result;
}

/**
 * Find nested containers missing isInner: true
 */
export function findNestedContainersMissingIsInner(tree: V3Element[]): string[] {
  const issues: string[] = [];
  walkTree(tree, (el, depth) => {
    if (el.elType === 'container' && depth > 0 && !el.isInner) {
      issues.push(el.id);
    }
  });
  return issues;
}

/**
 * True when this element is already sized along the main axis.
 *
 * Kind-aware, because the width control is NOT the same on every element — the
 * committed control snapshot (`schemas/elementor-v3-controls.snapshot.json`,
 * Elementor 4.2.1) is the authority:
 *
 *   - `__container__` declares `width` (slider, gated on `content_width: 'full'`)
 *     and `boxed_width` (slider, gated on `content_width: 'boxed'`). It declares
 *     NEITHER `_element_width`/`_element_custom_width` NOR `_inline_size`.
 *   - Every widget declares the Advanced-tab pair
 *     `_element_width` + `_element_custom_width`, and no `width`.
 *   - A classic `column` sizes itself through `_inline_size` / `_column_size`.
 *
 * `boxed_width` counts as a constraint: it comes from a measured `max-width`, so
 * the source already stated how wide this box may be. Overwriting it would also
 * flip `content_width` to `full` and make `boxed_width` unsatisfiable — Elementor
 * would then store it and never render it.
 *
 * `_flex_size` counts on any element: a child set to `grow`/`shrink` is
 * deliberately elastic and a fixed share would contradict that.
 */
export function hasFlexRowWidthConstraint(el: V3Element): boolean {
  const settings = el.settings as Record<string, unknown> | undefined;
  if (!settings) return false;
  if (settings['_flex_size'] !== undefined) return true;

  if (el.elType === 'container') {
    return settings['width'] !== undefined || settings['boxed_width'] !== undefined;
  }
  if (el.elType === 'column') {
    return settings['_inline_size'] !== undefined;
  }
  return settings['_element_width'] === 'initial' && settings['_element_custom_width'] != null;
}

/**
 * Find flex-row containers whose children carry no width constraint the target
 * can actually apply. See `hasFlexRowWidthConstraint` for why "a constraint" is
 * not one single settings key.
 */
export function findFlexRowStackRisks(tree: V3Element[]): string[] {
  const issues: string[] = [];
  walkTree(tree, (el) => {
    if (el.elType !== 'container' || !el.elements) return;
    const direction = (el.settings as Record<string, unknown>)?.flex_direction;
    if (direction !== 'row') return;

    for (const child of el.elements) {
      if (child.elType === 'container' || child.elType === 'column') {
        if (!hasFlexRowWidthConstraint(child)) issues.push(child.id);
      }
    }
  });
  return issues;
}

function walkTree(
  elements: V3Element[],
  fn: (el: V3Element, depth: number) => void,
  depth = 0,
): void {
  for (const el of elements) {
    fn(el, depth);
    if (el.elements) {
      walkTree(el.elements, fn, depth + 1);
    }
  }
}

/* ------------------------------------------------------------------ */
/* ClinicHub-lessons report API (source: v3-container-normalize.ts)   */
/* ------------------------------------------------------------------ */

export interface NormalizeContainerOptions {
  /**
   * When true (default), container children of a flex-row parent without an explicit
   * custom width get equal % widths via the container's own `width` slider.
   */
  constrainFlexRowChildren?: boolean;
  /**
   * When true (default), any container that has a container ancestor gets `isInner: true`.
   */
  forceNestedIsInner?: boolean;
}

export interface NormalizeContainerReport {
  /** Deep-cloned, normalized tree. */
  tree: V3Element[];
  nestedIsInnerFixed: number;
  flexRowWidthFixed: number;
  /**
   * Children left alone because the SOURCE already constrains them.
   *
   * Reported rather than folded into `flexRowWidthFixed`: a child carrying
   * `boxed_width` from a measured `max-width` is already sized, and an equal
   * share would replace the source's own instruction.
   */
  flexRowWidthSkipped: number;
}

function isContainer(el: V3Element): boolean {
  return el.elType === 'container';
}

function isFlexRow(settings: Record<string, unknown> | undefined): boolean {
  return settings?.['flex_direction'] === 'row';
}

function slider(size: number, unit: string = '%'): { unit: string; size: number; sizes: unknown[] } {
  return { unit, size, sizes: [] };
}

function cloneSettings(settings: Record<string, unknown> | undefined): Record<string, unknown> {
  return settings ? { ...settings } : {};
}

/**
 * Normalize a V3 element tree (section/column/widget AND container trees)
 * and return a report with fix counters. Safe no-op for classic
 * section>column trees.
 *
 * ## Why a container's width is not the widget switcher pair
 *
 * This wrote `_element_width: 'initial'` + `_element_custom_width` onto container
 * children — the shape `G7c`'s own hint text recommended. The committed control
 * snapshot (Elementor 4.2.1) declares that pair on every WIDGET and on no
 * container. Measured on a real converted page: 95 schema-gate errors, 46 of each
 * key plus 3 `boxed_width` conditions broken by the `content_width: 'full'` this
 * function also wrote.
 *
 * A container's own main-axis size is `width` (slider), gated on
 * `content_width: 'full'` — so a companion is still needed, just for a different
 * control.
 *
 * Latent until the emitter stopped forcing every layout node to
 * `flex_direction: 'column'`: with no row in the tree there was nothing to fix.
 */
export function normalizeV3ContainerTreeWithReport(
  elements: V3Element[],
  options: NormalizeContainerOptions = {},
): NormalizeContainerReport {
  const constrainFlexRowChildren = options.constrainFlexRowChildren ?? true;
  const forceNestedIsInner = options.forceNestedIsInner ?? true;

  let nestedIsInnerFixed = 0;
  let flexRowWidthFixed = 0;
  let flexRowWidthSkipped = 0;

  function walk(el: V3Element, depth: number, ancestorsAreContainers: boolean): V3Element {
    const next: V3Element = {
      ...el,
      settings: el.settings ? { ...el.settings } : el.settings,
      elements: el.elements ? [...el.elements] : el.elements,
    };

    if (isContainer(next)) {
      if (forceNestedIsInner && ancestorsAreContainers && next.isInner !== true) {
        next.isInner = true;
        nestedIsInnerFixed += 1;
      } else if (!ancestorsAreContainers && next.isInner === undefined) {
        // Root-level containers stay outer (isInner false / omit)
        next.isInner = false;
      }
    }

    const childAncestorContainers = ancestorsAreContainers || isContainer(next);
    let children = (next.elements ?? []).map((child) =>
      walk(child, depth + 1, childAncestorContainers),
    );

    if (
      constrainFlexRowChildren &&
      isContainer(next) &&
      isFlexRow(next.settings) &&
      children.length > 0
    ) {
      const containerKids = children.filter(isContainer);
      if (containerKids.length >= 2) {
        const unconstrained = containerKids.filter((c) => !hasFlexRowWidthConstraint(c));
        if (unconstrained.length >= 2) {
          const pct = Math.max(1, Math.floor(100 / containerKids.length));
          children = children.map((child) => {
            if (!isContainer(child)) return child;
            if (hasFlexRowWidthConstraint(child)) {
              flexRowWidthSkipped += 1;
              return child;
            }
            const settings = cloneSettings(child.settings);
            // `width` is the container's own main-axis control and only applies
            // while `content_width` is 'full'. Written unconditionally, because a
            // 'boxed' value left here would leave the slider stored and never
            // rendered — and a child carrying `boxed_width` never reaches this
            // branch, so nothing measured is overwritten.
            settings['content_width'] = 'full';
            settings['width'] = slider(pct, '%');
            flexRowWidthFixed += 1;
            return {
              ...child,
              isInner: true,
              settings,
            };
          });
        }
      }
    }

    next.elements = children;
    return next;
  }

  const tree = elements.map((el) => walk(el, 0, false));
  return { tree, nestedIsInnerFixed, flexRowWidthFixed, flexRowWidthSkipped };
}

/**
 * Convenience: return only the normalized tree (report API).
 */
export function normalizeV3Tree(elements: V3Element[], options?: NormalizeContainerOptions): V3Element[] {
  return normalizeV3ContainerTreeWithReport(elements, options).tree;
}

/**
 * Source-compatible risk finder: returns the PARENT ids of flex-row
 * containers with >= 2 unconstrained container children.
 * (`findFlexRowStackRisks` returns the child ids instead.)
 */
export function findFlexRowStackRiskParents(elements: V3Element[]): string[] {
  const risks: string[] = [];
  function walk(els: V3Element[]): void {
    for (const el of els) {
      if (isContainer(el) && isFlexRow(el.settings)) {
        const kids = (el.elements ?? []).filter(isContainer);
        if (kids.length >= 2) {
          const unconstrained = kids.filter((c) => !hasFlexRowWidthConstraint(c));
          if (unconstrained.length >= 2) {
            risks.push(el.id);
          }
        }
      }
      if (el.elements?.length) walk(el.elements);
    }
  }
  walk(elements);
  return risks;
}

/**
 * Ancestor-aware version of findNestedContainersMissingIsInner: flags a
 * container only when it has an actual container ancestor (not merely
 * structural depth). Safe no-op for containers nested under classic
 * section>column trees, matching normalizeV3ContainerTreeWithReport's own
 * isInner rule. (Plain `findNestedContainersMissingIsInner` flags by raw
 * depth instead, which also fires for containers under section>column.)
 */
export function findNestedContainersMissingIsInnerAncestorAware(elements: V3Element[]): string[] {
  const bad: string[] = [];
  function walk(els: V3Element[], parentIsContainer: boolean): void {
    for (const el of els) {
      if (isContainer(el) && parentIsContainer && el.isInner !== true) {
        bad.push(el.id);
      }
      if (el.elements?.length) {
        walk(el.elements, parentIsContainer || isContainer(el));
      }
    }
  }
  walk(elements, false);
  return bad;
}
