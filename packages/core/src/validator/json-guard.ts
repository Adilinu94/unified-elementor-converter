/**
 * JSON Guard System — pre-push validation for V3 and V4 Elementor trees.
 *
 * Runs a scored suite of guards before any WP push to catch structural
 * inconsistencies the builder might silently produce.
 *
 * Usage:
 *   import { runV3Guards, runV4Guards } from './json-guard.js';
 *   const report = runV3Guards(v3Elements);
 *   if (!report.passed) { throw new Error(`Guard score too low: ${report.score}`); }
 *
 * Scoring: critical failure = −20pts, warning failure = −5pts.
 * Default pass threshold: 85 / 100.
 */

import type { V3Element } from '../builder/v3-builder.js';
import type { V4AtomicElement } from '../builder/v4-builder.js';
import {
  findFlexRowStackRisks,
  findNestedContainersMissingIsInner,
} from '../builder/v3-container-normalize.js';

// ============================================================================
// Core types
// ============================================================================

export type GuardSeverity = 'critical' | 'warning';

export interface GuardResult {
  readonly passed: boolean;
  readonly message: string;
  readonly details?: string;
}

export interface Guard<T> {
  readonly name: string;
  readonly severity: GuardSeverity;
  check(tree: T): GuardResult;
}

export interface GuardReportEntry {
  readonly name: string;
  readonly severity: GuardSeverity;
  readonly result: GuardResult;
}

export interface GuardReport {
  /** 0–100 score after applying penalties. */
  readonly score: number;
  /** true when score >= threshold. */
  readonly passed: boolean;
  /** Score threshold used (default 85). */
  readonly threshold: number;
  readonly results: readonly GuardReportEntry[];
}

const SCORE_PENALTY: Record<GuardSeverity, number> = {
  critical: 20,
  warning: 5,
};

// ============================================================================
// Guard runner
// ============================================================================

export function runGuards<T>(
  tree: T,
  guards: ReadonlyArray<Guard<T>>,
  threshold = 85,
): GuardReport {
  let score = 100;
  const results: GuardReportEntry[] = [];

  for (const guard of guards) {
    const result = guard.check(tree);
    results.push({ name: guard.name, severity: guard.severity, result });
    if (!result.passed) {
      score = Math.max(0, score - SCORE_PENALTY[guard.severity]);
    }
  }

  return { score, passed: score >= threshold, threshold, results };
}

// ============================================================================
// Helpers
// ============================================================================

function collectAllV3Elements(elements: V3Element[]): V3Element[] {
  const out: V3Element[] = [];
  function walk(els: V3Element[]): void {
    for (const el of els) {
      out.push(el);
      if (el.elements && el.elements.length > 0) {
        walk(el.elements);
      }
    }
  }
  walk(elements);
  return out;
}

function collectAllV4Elements(elements: V4AtomicElement[]): V4AtomicElement[] {
  const out: V4AtomicElement[] = [];
  function walk(els: V4AtomicElement[]): void {
    for (const el of els) {
      out.push(el);
      if (el.elements && el.elements.length > 0) {
        walk(el.elements);
      }
    }
  }
  walk(elements);
  return out;
}

function v4Depth(el: V4AtomicElement, current = 0): number {
  if (!el.elements || el.elements.length === 0) return current;
  return Math.max(...el.elements.map((child: V4AtomicElement) => v4Depth(child, current + 1)));
}

// ============================================================================
// V3 Guards
// ============================================================================

/**
 * G1 — All element IDs across the V3 tree must be unique.
 * Duplicate IDs cause Elementor to silently drop elements.
 */
const g1UniqueIds: Guard<V3Element[]> = {
  name: 'G1:unique-ids',
  severity: 'critical',
  check(tree) {
    const all = collectAllV3Elements(tree);
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const el of all) {
      if (seen.has(el.id)) {
        dupes.push(el.id);
      } else {
        seen.add(el.id);
      }
    }
    if (dupes.length > 0) {
      return {
        passed: false,
        message: `${dupes.length} duplicate element ID(s) found`,
        details: dupes.slice(0, 5).join(', '),
      };
    }
    return { passed: true, message: `All ${seen.size} element IDs are unique` };
  },
};

/**
 * G2 — Every column element must be a direct child of a section element.
 * Orphaned columns (columns at root or inside widgets) crash Elementor.
 */
const g2NoOrphanColumns: Guard<V3Element[]> = {
  name: 'G2:no-orphan-columns',
  severity: 'critical',
  check(tree) {
    const orphans: string[] = [];

    function walk(els: V3Element[], parentType?: string): void {
      for (const el of els) {
        if (el.elType === 'column' && parentType !== 'section') {
          orphans.push(el.id);
        }
        if (el.elements) {
          walk(el.elements, el.elType);
        }
      }
    }
    walk(tree);

    if (orphans.length > 0) {
      return {
        passed: false,
        message: `${orphans.length} orphan column(s) found (not inside a section)`,
        details: orphans.slice(0, 3).join(', '),
      };
    }
    return { passed: true, message: 'No orphan columns' };
  },
};

/**
 * G3 — Heading/text widgets must have a `title` or `editor` setting.
 * Image widgets must have a `url` in their `image` setting.
 */
const g3WidgetRequiredSettings: Guard<V3Element[]> = {
  name: 'G3:widget-required-settings',
  severity: 'warning',
  check(tree) {
    const all = collectAllV3Elements(tree);
    const widgets = all.filter((el) => el.elType === 'widget');
    const missing: string[] = [];

    for (const w of widgets) {
      const s = w.settings ?? {};
      if (w.widgetType === 'heading' && !s['title']) {
        missing.push(`${w.id} (heading missing title)`);
      }
      if (w.widgetType === 'text-editor' && !s['editor']) {
        missing.push(`${w.id} (text-editor missing editor)`);
      }
      if (w.widgetType === 'image') {
        const img = s['image'] as Record<string, unknown> | undefined;
        if (!img?.['url']) {
          missing.push(`${w.id} (image missing url)`);
        }
      }
    }

    if (missing.length > 0) {
      return {
        passed: false,
        message: `${missing.length} widget(s) missing required settings`,
        details: missing.slice(0, 3).join('; '),
      };
    }
    return { passed: true, message: `All ${widgets.length} widget(s) have required settings` };
  },
};

/**
 * G4 — Breakpoint coverage: if a section has tablet responsive overrides,
 * it must also have mobile overrides. Incomplete breakpoints cause layout
 * shifts on mobile that are invisible in the desktop Elementor editor.
 */
const g4BreakpointCoverage: Guard<V3Element[]> = {
  name: 'G4:breakpoint-coverage',
  severity: 'warning',
  check(tree) {
    const sections = collectAllV3Elements(tree).filter((el) => el.elType === 'section');
    const incomplete: string[] = [];

    for (const s of sections) {
      const settings = s.settings ?? {};
      const hasTablet = Object.keys(settings).some((k) => k.endsWith('_tablet'));
      const hasMobile = Object.keys(settings).some((k) => k.endsWith('_mobile'));
      if (hasTablet && !hasMobile) {
        incomplete.push(s.id);
      }
    }

    if (incomplete.length > 0) {
      return {
        passed: false,
        message: `${incomplete.length} section(s) have tablet but no mobile breakpoint overrides`,
        details: incomplete.slice(0, 3).join(', '),
      };
    }
    return { passed: true, message: 'Breakpoint coverage complete' };
  },
};

/**
 * G5 — Image widgets must have a non-empty url in their image setting.
 * Empty image urls produce broken img tags in the rendered page.
 */
const g5ImageUrlPresent: Guard<V3Element[]> = {
  name: 'G5:image-url-present',
  severity: 'warning',
  check(tree) {
    const all = collectAllV3Elements(tree);
    const images = all.filter((el) => el.elType === 'widget' && el.widgetType === 'image');
    const noUrl: string[] = [];

    for (const img of images) {
      const s = img.settings ?? {};
      const imageObj = s['image'] as Record<string, unknown> | undefined;
      const url = typeof imageObj?.['url'] === 'string' ? imageObj['url'] : '';
      if (!url) {
        noUrl.push(img.id);
      }
    }

    if (noUrl.length > 0) {
      return {
        passed: false,
        message: `${noUrl.length} image widget(s) have no URL`,
        details: noUrl.slice(0, 3).join(', '),
      };
    }
    return { passed: true, message: `All ${images.length} image widget(s) have a URL` };
  },
};

/**
 * G6c — Nested flex containers must set isInner: true.
 * Missing isInner makes children behave like root e-parent full-width boxes.
 * (ClinicHub 2026-07 — stats/header stacking.)
 */
const g6NestedContainerIsInner: Guard<V3Element[]> = {
  name: 'G6c:nested-container-is-inner',
  severity: 'warning',
  check(tree) {
    const bad = findNestedContainersMissingIsInner(tree);
    if (bad.length > 0) {
      return {
        passed: false,
        message: `${bad.length} nested container(s) missing isInner:true`,
        details: `${bad.slice(0, 5).join(', ')} — run normalizeV3ContainerTree()`,
      };
    }
    return { passed: true, message: 'Nested containers have isInner:true' };
  },
};

/**
 * G7c — Flex-row parents with ≥2 unconstrained full-width container children
 * will stack vertically instead of sitting side-by-side.
 */
const g7FlexRowChildWidth: Guard<V3Element[]> = {
  name: 'G7c:flex-row-child-width',
  severity: 'warning',
  check(tree) {
    const risks = findFlexRowStackRisks(tree);
    if (risks.length > 0) {
      return {
        passed: false,
        message: `${risks.length} flex-row container(s) risk stacking (unconstrained children)`,
        details: `${risks.slice(0, 5).join(', ')} — set _element_width:initial + custom width, or use HTML row pattern`,
      };
    }
    return { passed: true, message: 'No flex-row stack risks detected' };
  },
};

export const V3_GUARDS: ReadonlyArray<Guard<V3Element[]>> = [
  g1UniqueIds,
  g2NoOrphanColumns,
  g3WidgetRequiredSettings,
  g4BreakpointCoverage,
  g5ImageUrlPresent,
  g6NestedContainerIsInner,
  g7FlexRowChildWidth,
];

// ============================================================================
// V4 Guards
// ============================================================================

const KNOWN_DOLLAR_TYPES = new Set([
  'background-overlay',
  'background-image-overlay',
  'background-color-overlay',
  'image-attachment-id',
  'global-variable',
  'size',
  'color',
  'typography',
  'box-shadow',
  'text-shadow',
  'border',
  'transform',
]);

/**
 * G6 — Any $$type envelope values must be from the known Elementor V4 list.
 * Unknown $$type values are silently ignored by Elementor and produce blank output.
 */
const g6ValidDollarType: Guard<V4AtomicElement[]> = {
  name: 'G6:valid-dollar-type',
  severity: 'critical',
  check(tree) {
    const all = collectAllV4Elements(tree);
    const unknown: string[] = [];

    function scanObject(obj: unknown, path: string): void {
      if (!obj || typeof obj !== 'object') return;
      const record = obj as Record<string, unknown>;
      if ('$$type' in record && typeof record['$$type'] === 'string') {
        if (!KNOWN_DOLLAR_TYPES.has(record['$$type'])) {
          unknown.push(`${path}: $$type="${record['$$type']}"`);
        }
      }
      for (const [k, v] of Object.entries(record)) {
        if (k !== 'elements') scanObject(v, `${path}.${k}`);
      }
    }

    for (const el of all) {
      scanObject(el.settings, `${el.id}[settings]`);
      scanObject(el.styles, `${el.id}[styles]`);
    }

    if (unknown.length > 0) {
      return {
        passed: false,
        message: `${unknown.length} unknown $$type value(s)`,
        details: unknown.slice(0, 3).join('; '),
      };
    }
    return { passed: true, message: 'All $$type values are valid' };
  },
};

/**
 * G7 — V4 class names must not contain hyphens.
 * Elementor V4 validates class names and rejects ones with hyphens
 * (error: class_name_contains_spaces). Use camelCase or underscores.
 */
const g7NoHyphenInClass: Guard<V4AtomicElement[]> = {
  name: 'G7:no-hyphen-in-class',
  severity: 'critical',
  check(tree) {
    const all = collectAllV4Elements(tree);
    const violations: string[] = [];

    for (const el of all) {
      for (const cls of el.classes ?? []) {
        if (cls.includes('-')) {
          violations.push(`${el.id}: class "${cls}"`);
        }
      }
    }

    if (violations.length > 0) {
      return {
        passed: false,
        message: `${violations.length} class name(s) contain hyphens (Elementor V4 will reject them)`,
        details: violations.slice(0, 3).join('; '),
      };
    }
    return { passed: true, message: 'No hyphenated class names' };
  },
};

/**
 * G8 — V4 element nesting must not exceed 4 levels deep.
 * Deep nesting creates performance issues and is a signal of V4 structure bugs.
 * V4 target: e-flexbox > e-flexbox > widget (3 levels max; 4 for complex layouts).
 */
const g8MaxDomDepth: Guard<V4AtomicElement[]> = {
  name: 'G8:max-dom-depth',
  severity: 'warning',
  check(tree) {
    const MAX = 4;
    const deep: string[] = [];

    for (const root of tree) {
      const d = v4Depth(root);
      if (d > MAX) {
        deep.push(`${root.id} (depth ${d})`);
      }
    }

    if (deep.length > 0) {
      return {
        passed: false,
        message: `${deep.length} root element(s) exceed max nesting depth of ${MAX}`,
        details: deep.slice(0, 3).join('; '),
      };
    }
    return { passed: true, message: `DOM depth within limit (≤${MAX})` };
  },
};

/**
 * G9 — Classes arrays must not contain empty strings.
 * Empty class bindings in V4 produce `class=""` attributes and cause GC lookup
 * failures that silently prevent styles from applying.
 */
const g9NoEmptyClass: Guard<V4AtomicElement[]> = {
  name: 'G9:no-empty-class',
  severity: 'warning',
  check(tree) {
    const all = collectAllV4Elements(tree);
    const violations: string[] = [];

    for (const el of all) {
      const empty = (el.classes ?? []).filter((c: string) => c.trim() === '');
      if (empty.length > 0) {
        violations.push(`${el.id} (${empty.length} empty class entry)`);
      }
    }

    if (violations.length > 0) {
      return {
        passed: false,
        message: `${violations.length} element(s) have empty class entries`,
        details: violations.slice(0, 3).join('; '),
      };
    }
    return { passed: true, message: 'No empty class entries' };
  },
};

const KNOWN_V4_TYPES = new Set([
  'e-flexbox',
  'e-heading',
  'e-text',
  'e-button',
  'e-image',
  'e-video',
  'e-icon',
  'e-divider',
  'e-spacer',
  'e-form',
  'e-html',
  'e-grid',
  'e-loop',
]);

/**
 * G10 — Atomic widget types must be known Elementor V4 types.
 * Unknown types produce placeholder widgets in Elementor and signal
 * a V3/V4 contamination issue in the builder.
 */
const g10KnownAtomicType: Guard<V4AtomicElement[]> = {
  name: 'G10:known-atomic-type',
  severity: 'warning',
  check(tree) {
    const all = collectAllV4Elements(tree);
    const unknown: string[] = [];

    for (const el of all) {
      if (!KNOWN_V4_TYPES.has(el.type)) {
        unknown.push(`${el.id} (type="${el.type}")`);
      }
    }

    if (unknown.length > 0) {
      return {
        passed: false,
        message: `${unknown.length} element(s) have unknown V4 widget types`,
        details: unknown.slice(0, 3).join('; '),
      };
    }
    return { passed: true, message: `All ${all.length} element(s) have known V4 types` };
  },
};

/**
 * G11 — Every class referenced in the `classes` array must have a
 * corresponding entry in the element's `styles` map. Orphan class
 * references produce blank `<div class="...">` attributes and silently
 * fail in Elementor V4 (styles won't apply).
 *
 * This is the inverse of the V4-Pipeline's STYLE_CLASSES_BINDING guard.
 */
const g11StyleClassesBinding: Guard<V4AtomicElement[]> = {
  name: 'G11:style-classes-binding',
  severity: 'warning',
  check(tree) {
    const all = collectAllV4Elements(tree);
    const orphaned: string[] = [];

    for (const el of all) {
      const classes = el.classes ?? [];
      const styleIds = Object.keys(el.styles ?? {});

      for (const cls of classes) {
        // Skip global class references (gc-* prefix)
        if (cls.startsWith('gc-')) continue;
        if (!styleIds.includes(cls)) {
          orphaned.push(`${el.id}: class "${cls}" not found in styles{}`);
        }
      }
    }

    if (orphaned.length > 0) {
      return {
        passed: false,
        message: `${orphaned.length} orphan class reference(s) (class in classes[] but not in styles{})`,
        details: orphaned.slice(0, 5).join('; '),
      };
    }
    return { passed: true, message: 'All classes are bound to style definitions' };
  },
};

/**
 * G12 — Image and e-image widget settings must have a valid image source.
 *
 * For V4 atomic format: `image-src` $$type with exactly one of {id, url}.
 * For V3 legacy format: `image` object with a non-empty `url` or `id`.
 * Catches scraper failures where image data was not extracted.
 */
const g12ImageSrcFormat: Guard<V4AtomicElement[]> = {
  name: 'G12:image-src-format',
  severity: 'warning',
  check(tree) {
    const all = collectAllV4Elements(tree);
    const imageWidgets = all.filter((el) => el.type === 'e-image' || el.type === 'image');
    const invalid: string[] = [];

    for (const el of imageWidgets) {
      const s = (el.settings ?? {}) as Record<string, unknown>;
      const image = s['image'] as Record<string, unknown> | undefined;
      const imageSrc = s['image-src'] ?? s['image_src'];

      // Check V3-style image object
      if (image && typeof image === 'object') {
        const hasId = image['id'] !== undefined && image['id'] !== null && image['id'] !== 0;
        const hasUrl = typeof image['url'] === 'string' && image['url'].length > 0;
        if (!hasId && !hasUrl) {
          invalid.push(`${el.id}: image object has neither valid id nor url`);
        }
        // Check for url: null (V4 anti-pattern)
        if ('url' in image && image['url'] === null) {
          invalid.push(`${el.id}: image object has url: null (omit the key entirely in V4)`);
        }
        continue;
      }

      // Check V4-style image-src
      if (imageSrc && typeof imageSrc === 'object') {
        const srcObj = imageSrc as Record<string, unknown>;
        const value = (srcObj['value'] ?? srcObj) as Record<string, unknown> | undefined;
        if (value && typeof value === 'object') {
          const hasId = value['id'] !== undefined && value['id'] !== null;
          const hasUrl = typeof value['url'] === 'string' && value['url'].length > 0;
          if (!hasId && !hasUrl) {
            invalid.push(`${el.id}: image-src has neither id nor url`);
          }
        }
        continue;
      }

      // No image data at all
      if (!image && !imageSrc) {
        invalid.push(`${el.id}: no image or image-src setting found`);
      }
    }

    if (invalid.length > 0) {
      return {
        passed: false,
        message: `${invalid.length} image widget(s) have malformed or missing image source`,
        details: invalid.slice(0, 5).join('; '),
      };
    }
    return {
      passed: true,
      message: `All ${imageWidgets.length} image widget(s) have valid image sources`,
    };
  },
};

export const V4_GUARDS: ReadonlyArray<Guard<V4AtomicElement[]>> = [
  g6ValidDollarType,
  g7NoHyphenInClass,
  g8MaxDomDepth,
  g9NoEmptyClass,
  g10KnownAtomicType,
  g11StyleClassesBinding,
  g12ImageSrcFormat,
];

// ============================================================================
// Public API
// ============================================================================

/**
 * Run all V3 guards against a V3 element tree.
 * Pass the `content` array from V3PageData.
 *
 * @param tree       - V3Element[] (top-level sections from _elementor_data)
 * @param threshold  - Minimum score to pass (default 85)
 */
export function runV3Guards(tree: V3Element[], threshold = 85): GuardReport {
  return runGuards(tree, V3_GUARDS, threshold);
}

/**
 * Run all V4 guards against a V4 atomic element tree.
 *
 * @param tree       - V4AtomicElement[] from V4BuildPlan.elements
 * @param threshold  - Minimum score to pass (default 85)
 */
export function runV4Guards(tree: V4AtomicElement[], threshold = 85): GuardReport {
  return runGuards(tree, V4_GUARDS, threshold);
}

/**
 * Format a GuardReport as a human-readable summary for CLI output.
 */
export function formatGuardReport(report: GuardReport): string {
  const status = report.passed ? '✅ PASSED' : '❌ FAILED';
  const lines: string[] = [
    `Guard Score: ${report.score}/100 — ${status} (threshold: ${report.threshold})`,
  ];

  for (const entry of report.results) {
    const icon = entry.result.passed ? '✓' : entry.severity === 'critical' ? '✗' : '⚠';
    const line = `  ${icon} [${entry.name}] ${entry.result.message}`;
    lines.push(entry.result.details ? `${line}\n    ↳ ${entry.result.details}` : line);
  }

  return lines.join('\n');
}
