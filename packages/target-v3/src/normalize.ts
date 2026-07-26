/**
 * V3 Container Normalize.
 * Fixes isInner flags and flex-row child widths before deploy.
 * Ported from site-clone-to-v3/src/builder/v3-container-normalize.ts
 * (merged: simple `_inline_size` normalizer + ClinicHub-lessons report API
 * with the companion switcher pair `_element_width`/`_element_custom_width`;
 * `_element_custom_width` only emits CSS when `_element_width === "initial"`).
 */

import type { V3Element } from './types.js';

/**
 * Normalize a V3 container tree:
 * 1. Set isInner: true on all nested containers (depth > 0)
 * 2. Ensure flex-row children have _inline_size
 * 3. Remove isInner from top-level containers
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
        if (child.elType === 'container' || child.elType === 'column') {
          const settings = { ...(child.settings as Record<string, unknown>) };
          if (!settings._inline_size) {
            settings._inline_size = { unit: '%', size: equalWidth };
          }
          return { ...child, settings };
        }
        return child;
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
 * Find flex-row containers where children lack any width constraint
 * (`_inline_size`, companion switcher pair, or width slider).
 */
export function findFlexRowStackRisks(tree: V3Element[]): string[] {
  const issues: string[] = [];
  walkTree(tree, (el) => {
    if (el.elType !== 'container' || !el.elements) return;
    const direction = (el.settings as Record<string, unknown>)?.flex_direction;
    if (direction !== 'row') return;

    for (const child of el.elements) {
      if (child.elType === 'container' || child.elType === 'column') {
        const settings = child.settings as Record<string, unknown> | undefined;
        if (!settings?._inline_size && !hasCustomWidthConstraint(settings)) {
          issues.push(child.id);
        }
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
   * custom width get equal % widths via the companion switcher pair.
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
}

function isContainer(el: V3Element): boolean {
  return el.elType === 'container';
}

function isFlexRow(settings: Record<string, unknown> | undefined): boolean {
  return settings?.['flex_direction'] === 'row';
}

function hasCustomWidthConstraint(settings: Record<string, unknown> | undefined): boolean {
  if (!settings) return false;
  if (settings['_element_width'] === 'initial' && settings['_element_custom_width'] != null) {
    return true;
  }
  // Explicit non-full content_width / width slider sometimes used instead
  const w = settings['width'];
  if (w && typeof w === 'object' && w !== null && 'size' in w) {
    const size = (w as { size?: unknown }).size;
    if (typeof size === 'number' && size > 0 && size < 100) return true;
  }
  return false;
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
 * section>column trees. Uses the companion switcher pair for widths.
 */
export function normalizeV3ContainerTreeWithReport(
  elements: V3Element[],
  options: NormalizeContainerOptions = {},
): NormalizeContainerReport {
  const constrainFlexRowChildren = options.constrainFlexRowChildren ?? true;
  const forceNestedIsInner = options.forceNestedIsInner ?? true;

  let nestedIsInnerFixed = 0;
  let flexRowWidthFixed = 0;

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
        const unconstrained = containerKids.filter(
          (c) => !hasCustomWidthConstraint(c.settings),
        );
        if (unconstrained.length >= 2) {
          const pct = Math.max(1, Math.floor(100 / containerKids.length));
          children = children.map((child) => {
            if (!isContainer(child) || hasCustomWidthConstraint(child.settings)) {
              return child;
            }
            const settings = cloneSettings(child.settings);
            settings['_element_width'] = 'initial';
            settings['_element_custom_width'] = slider(pct, '%');
            // Prefer full content_width inside the constrained box
            if (settings['content_width'] === undefined) {
              settings['content_width'] = 'full';
            }
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
  return { tree, nestedIsInnerFixed, flexRowWidthFixed };
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
          const unconstrained = kids.filter((c) => !hasCustomWidthConstraint(c.settings));
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
