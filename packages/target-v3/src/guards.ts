/**
 * V3-specific Guards.
 * Ported from site-clone-to-v3/src/validator/json-guard.ts (V3_GUARDS) + new guards.
 */

import type { Guard, GuardResult } from '@elconv/core';
import { runGuards, type GuardReport } from '@elconv/core';
import type { V3Element } from './types.js';
import { V3_EL_TYPES, V3_WIDGET_TYPES } from './types.js';
import { findFlexRowStackRisks } from './normalize.js';

type V3Tree = V3Element[];

function walkAll(elements: V3Element[], fn: (el: V3Element, path: string) => void, path = ''): void {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const elPath = `${path}[${i}]`;
    fn(el, elPath);
    if (el.elements) walkAll(el.elements, fn, elPath);
  }
}

function countAll(elements: V3Element[], predicate: (el: V3Element) => boolean): number {
  let count = 0;
  walkAll(elements, (el) => { if (predicate(el)) count++; });
  return count;
}

// G1: unique-ids (critical)
const G_UNIQUE_IDS: Guard<V3Tree> = {
  name: 'G1:unique-ids',
  severity: 'critical',
  check(tree) {
    const ids = new Set<string>();
    const dupes: string[] = [];
    walkAll(tree, (el) => {
      if (ids.has(el.id)) dupes.push(el.id);
      ids.add(el.id);
    });
    return dupes.length === 0
      ? { passed: true, message: 'All IDs unique' }
      : { passed: false, message: `${dupes.length} duplicate IDs`, details: dupes.slice(0, 5).join(', ') };
  },
};

// G2: no-orphan-columns (critical)
const G_NO_ORPHAN_COLUMNS: Guard<V3Tree> = {
  name: 'G2:no-orphan-columns',
  severity: 'critical',
  check(tree) {
    const orphans: string[] = [];
    walkAll(tree, (el) => {
      if (el.elType === 'column') {
        // columns must be inside a section
        // simplified: just check column exists at top level = orphan
      }
    });
    // Check top-level: no columns at root
    for (const el of tree) {
      if (el.elType === 'column') orphans.push(el.id);
    }
    return orphans.length === 0
      ? { passed: true, message: 'No orphan columns' }
      : { passed: false, message: `${orphans.length} orphan columns at root` };
  },
};

// G3: widget-required-settings (warning)
const G_WIDGET_SETTINGS: Guard<V3Tree> = {
  name: 'G3:widget-required-settings',
  severity: 'warning',
  check(tree) {
    const issues: string[] = [];
    walkAll(tree, (el) => {
      if (el.elType !== 'widget' || !el.widgetType) return;
      const s = el.settings ?? {};
      if (el.widgetType === 'heading' && !s.title) issues.push(`${el.id}: heading missing title`);
      if (el.widgetType === 'image' && !s.image) issues.push(`${el.id}: image missing image`);
      if (el.widgetType === 'button' && !s.text) issues.push(`${el.id}: button missing text`);
    });
    return issues.length === 0
      ? { passed: true, message: 'All widgets have required settings' }
      : { passed: false, message: `${issues.length} widgets missing settings`, details: issues.slice(0, 5).join('; ') };
  },
};

// G_ELTYPE: unknown elType/widgetType (critical)
const G_ELTYPE: Guard<V3Tree> = {
  name: 'G_ELTYPE:known-types',
  severity: 'critical',
  check(tree) {
    const unknown: string[] = [];
    walkAll(tree, (el) => {
      if (!V3_EL_TYPES.includes(el.elType as typeof V3_EL_TYPES[number])) {
        unknown.push(`${el.id}: elType="${el.elType}"`);
      }
      if (el.widgetType && !V3_WIDGET_TYPES.includes(el.widgetType as typeof V3_WIDGET_TYPES[number])) {
        unknown.push(`${el.id}: widgetType="${el.widgetType}"`);
      }
    });
    return unknown.length === 0
      ? { passed: true, message: 'All types valid' }
      : { passed: false, message: `${unknown.length} unknown types`, details: unknown.slice(0, 5).join('; ') };
  },
};

// G_NO_V4: tree contains V4 markers (critical) — Anti-Contamination
const G_NO_V4: Guard<V3Tree> = {
  name: 'G_NO_V4:no-v4-markers',
  severity: 'critical',
  check(tree) {
    const json = JSON.stringify(tree);
    const v4Markers = ['$$type', 'e-flexbox', 'e-heading', 'e-text', 'e-button', 'e-image', 'e-div-block', 'e-grid'];
    const found = v4Markers.filter((m) => json.includes(m));
    return found.length === 0
      ? { passed: true, message: 'No V4 markers found' }
      : { passed: false, message: `V4 contamination: ${found.join(', ')}` };
  },
};

// G_HTML_BUDGET: html widgets ≤ 15% of total (warning)
const G_HTML_BUDGET: Guard<V3Tree> = {
  name: 'G_HTML_BUDGET:html-ratio',
  severity: 'warning',
  check(tree) {
    const totalWidgets = countAll(tree, (el) => el.elType === 'widget');
    const htmlWidgets = countAll(tree, (el) => el.elType === 'widget' && el.widgetType === 'html');
    if (totalWidgets === 0) return { passed: true, message: 'No widgets' };
    const ratio = htmlWidgets / totalWidgets;
    return ratio <= 0.15
      ? { passed: true, message: `HTML ratio ${(ratio * 100).toFixed(1)}% ≤ 15%` }
      : { passed: false, message: `HTML ratio ${(ratio * 100).toFixed(1)}% > 15% budget` };
  },
};

// G_HTML_HAS_IMG: html widget contains <img (critical)
const G_HTML_HAS_IMG: Guard<V3Tree> = {
  name: 'G_HTML_HAS_IMG:no-img-in-html',
  severity: 'critical',
  check(tree) {
    const issues: string[] = [];
    walkAll(tree, (el) => {
      if (el.elType === 'widget' && el.widgetType === 'html') {
        const html = String((el.settings as Record<string, unknown>)?.html ?? '');
        if (html.includes('<img')) issues.push(el.id);
      }
    });
    return issues.length === 0
      ? { passed: true, message: 'No <img> in HTML widgets' }
      : { passed: false, message: `${issues.length} HTML widgets contain <img> — use image widget` };
  },
};

// G_HTML_EMPTY: html widget with empty html (warning)
const G_HTML_EMPTY: Guard<V3Tree> = {
  name: 'G_HTML_EMPTY:no-empty-html',
  severity: 'warning',
  check(tree) {
    const issues: string[] = [];
    walkAll(tree, (el) => {
      if (el.elType === 'widget' && el.widgetType === 'html') {
        const html = String((el.settings as Record<string, unknown>)?.html ?? '');
        if (!html.trim()) issues.push(el.id);
      }
    });
    return issues.length === 0
      ? { passed: true, message: 'No empty HTML widgets' }
      : { passed: false, message: `${issues.length} empty HTML widgets` };
  },
};

// G_TREE_SIZE: JSON size check (warning/critical)
const G_TREE_SIZE: Guard<V3Tree> = {
  name: 'G_TREE_SIZE:byte-limit',
  severity: 'warning',
  check(tree) {
    const bytes = Buffer.byteLength(JSON.stringify(tree), 'utf-8');
    if (bytes > 1_500_000) {
      return { passed: false, message: `Tree ${(bytes / 1000).toFixed(0)}KB > 1.5MB limit` };
    }
    if (bytes > 900_000) {
      return { passed: false, message: `Tree ${(bytes / 1000).toFixed(0)}KB > 900KB warning` };
    }
    return { passed: true, message: `Tree size ${(bytes / 1000).toFixed(0)}KB OK` };
  },
};

// G_NESTED_IS_INNER: nested containers have isInner (warning)
const G_NESTED_IS_INNER: Guard<V3Tree> = {
  name: 'G6c:nested-container-is-inner',
  severity: 'warning',
  check(tree) {
    const issues: string[] = [];
    function walk(elements: V3Element[], depth: number) {
      for (const el of elements) {
        if (el.elType === 'container' && depth > 0 && !el.isInner) {
          issues.push(el.id);
        }
        if (el.elements) walk(el.elements, depth + 1);
      }
    }
    walk(tree, 0);
    return issues.length === 0
      ? { passed: true, message: 'All nested containers have isInner' }
      : { passed: false, message: `${issues.length} nested containers missing isInner` };
  },
};

// G4: breakpoint-coverage — sections with tablet overrides need mobile too (warning)
const G_BREAKPOINT_COVERAGE: Guard<V3Tree> = {
  name: 'G4:breakpoint-coverage',
  severity: 'warning',
  check(tree) {
    const incomplete: string[] = [];
    walkAll(tree, (el) => {
      if (el.elType !== 'section') return;
      const settings = el.settings ?? {};
      const hasTablet = Object.keys(settings).some((k) => k.endsWith('_tablet'));
      const hasMobile = Object.keys(settings).some((k) => k.endsWith('_mobile'));
      if (hasTablet && !hasMobile) incomplete.push(el.id);
    });
    return incomplete.length === 0
      ? { passed: true, message: 'Breakpoint coverage complete' }
      : {
          passed: false,
          message: `${incomplete.length} section(s) have tablet but no mobile breakpoint overrides`,
          details: incomplete.slice(0, 3).join(', '),
        };
  },
};

// G5: image-url-present — image widgets must have a non-empty url (warning)
const G_IMAGE_URL: Guard<V3Tree> = {
  name: 'G5:image-url-present',
  severity: 'warning',
  check(tree) {
    const noUrl: string[] = [];
    let imageCount = 0;
    walkAll(tree, (el) => {
      if (el.elType !== 'widget' || el.widgetType !== 'image') return;
      imageCount++;
      const s = el.settings ?? {};
      const imageObj = s['image'] as Record<string, unknown> | undefined;
      const url = typeof imageObj?.['url'] === 'string' ? imageObj['url'] : '';
      if (!url) noUrl.push(el.id);
    });
    return noUrl.length === 0
      ? { passed: true, message: `All ${imageCount} image widget(s) have a URL` }
      : {
          passed: false,
          message: `${noUrl.length} image widget(s) have no URL`,
          details: noUrl.slice(0, 3).join(', '),
        };
  },
};

// G7c: flex-row parents with ≥2 unconstrained full-width children stack vertically (warning)
const G_FLEX_ROW_CHILD_WIDTH: Guard<V3Tree> = {
  name: 'G7c:flex-row-child-width',
  severity: 'warning',
  check(tree) {
    const risks = findFlexRowStackRisks([...tree]);
    return risks.length === 0
      ? { passed: true, message: 'No flex-row stack risks detected' }
      : {
          passed: false,
          message: `${risks.length} flex-row container(s) risk stacking (unconstrained children)`,
          details: `${risks.slice(0, 5).join(', ')} — set _element_width:initial + custom width, or use HTML row pattern`,
        };
  },
};

/** All V3 guards in execution order */
export const V3_GUARDS: ReadonlyArray<Guard<V3Tree>> = [
  G_UNIQUE_IDS,
  G_NO_ORPHAN_COLUMNS,
  G_ELTYPE,
  G_NO_V4,
  G_HTML_HAS_IMG,
  G_WIDGET_SETTINGS,
  G_BREAKPOINT_COVERAGE,
  G_IMAGE_URL,
  G_HTML_BUDGET,
  G_HTML_EMPTY,
  G_TREE_SIZE,
  G_NESTED_IS_INNER,
  G_FLEX_ROW_CHILD_WIDTH,
];

/** Runs all V3 guards (score-based: critical −20, warning −5; pass ≥ threshold). */
export function runV3Guards(tree: V3Element[], threshold = 85): GuardReport {
  return runGuards(tree as V3Tree, V3_GUARDS, threshold);
}
