/**
 * V3 Container tree normalizer (ClinicHub lessons, 2026-07).
 *
 * Modern Elementor V3 pages use flex `container` nodes (not only section/column).
 * Manual and AI-generated trees often:
 *  1. Leave nested containers as `isInner: false` (root-like e-parent behavior)
 *  2. Put `content_width: "full"` children inside a `flex_direction: "row"` parent
 *     so every child is 100% wide and stacks instead of sitting side-by-side
 *
 * This module rewrites those trees in-place (immutable return) before WP push / guards.
 *
 * Companion switcher rule (silent failure):
 *   `_element_custom_width` only emits CSS when `_element_width === "initial"`.
 */

import type { V3Element } from './v3-builder.js';

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
 * Normalize a V3 element tree (section/column/widget AND container trees).
 * Safe no-op for classic section>column trees.
 */
export function normalizeV3ContainerTree(
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
 * Convenience: return only the normalized tree.
 */
export function normalizeV3Tree(elements: V3Element[], options?: NormalizeContainerOptions): V3Element[] {
  return normalizeV3ContainerTree(elements, options).tree;
}

/**
 * Static analysis helpers used by json-guard.
 */
export function findNestedContainersMissingIsInner(elements: V3Element[]): string[] {
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

export function findFlexRowStackRisks(elements: V3Element[]): string[] {
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
