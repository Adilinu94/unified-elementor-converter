/**
 * V4-specific Guards.
 * Ported from site-clone-to-v3/src/validator/json-guard.ts (V4_GUARDS) + V4-Pipeline guards.
 */

import type { Guard } from '@elconv/core';
import { runGuards, type GuardReport } from '@elconv/core';
import type { V4TreeNode } from './types.js';
import { V4_ATOMIC_TYPES } from './types.js';
import { isValidStyleId } from './style-id.js';

type V4Tree = V4TreeNode[];

function walkAll(elements: V4TreeNode[], fn: (el: V4TreeNode, path: string) => void, path = ''): void {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const elPath = `${path}[${i}]`;
    fn(el, elPath);
    if (el.elements) walkAll(el.elements, fn, elPath);
  }
}

function getDepth(elements: V4TreeNode[], current = 0): number {
  let max = current;
  for (const el of elements) {
    if (el.elements && el.elements.length > 0) {
      max = Math.max(max, getDepth(el.elements, current + 1));
    }
  }
  return max;
}

// G6: valid-dollar-type (critical)
const G_VALID_DOLLAR_TYPE: Guard<V4Tree> = {
  name: 'G6:valid-dollar-type',
  severity: 'critical',
  check(tree) {
    const validTypes = ['size', 'color', 'classes', 'dimensions', 'border-radius', 'image-src', 'global-color-variable', 'global-font-variable', 'html-content'];
    const issues: string[] = [];
    const json = JSON.stringify(tree);
    // Find all $$type values
    const matches = json.matchAll(/"\$\$type"\s*:\s*"([^"]+)"/g);
    for (const m of matches) {
      if (!validTypes.includes(m[1])) {
        issues.push(`Invalid $$type: "${m[1]}"`);
      }
    }
    return issues.length === 0
      ? { passed: true, message: 'All $$type values valid' }
      : { passed: false, message: `${issues.length} invalid $$type values`, details: issues.slice(0, 5).join('; ') };
  },
};

// G7: no-hyphen-in-class (critical)
const G_NO_HYPHEN_CLASS: Guard<V4Tree> = {
  name: 'G7:no-hyphen-in-class',
  severity: 'critical',
  check(tree) {
    const issues: string[] = [];
    walkAll(tree, (el) => {
      for (const styleId of Object.keys(el.styles)) {
        if (styleId.includes('-')) {
          issues.push(`${el.id}: style "${styleId}" contains hyphen`);
        }
      }
    });
    return issues.length === 0
      ? { passed: true, message: 'No hyphens in style IDs' }
      : { passed: false, message: `${issues.length} style IDs with hyphens`, details: issues.slice(0, 5).join('; ') };
  },
};

// G8: max-dom-depth ≤ 4 (warning)
const G_MAX_DEPTH: Guard<V4Tree> = {
  name: 'G8:max-dom-depth',
  severity: 'warning',
  check(tree) {
    const depth = getDepth(tree);
    return depth <= 4
      ? { passed: true, message: `DOM depth ${depth} ≤ 4` }
      : { passed: false, message: `DOM depth ${depth} > 4` };
  },
};

// G9: no-empty-class (warning)
const G_NO_EMPTY_CLASS: Guard<V4Tree> = {
  name: 'G9:no-empty-class',
  severity: 'warning',
  check(tree) {
    const issues: string[] = [];
    walkAll(tree, (el) => {
      for (const [id, cls] of Object.entries(el.styles)) {
        if (!cls.variants || cls.variants.length === 0) {
          issues.push(`${el.id}: style "${id}" has no variants`);
        } else if (cls.variants.every((v) => Object.keys(v.props).length === 0)) {
          issues.push(`${el.id}: style "${id}" has empty props`);
        }
      }
    });
    return issues.length === 0
      ? { passed: true, message: 'No empty style classes' }
      : { passed: false, message: `${issues.length} empty style classes` };
  },
};

// G10: known-atomic-type (warning)
const G_KNOWN_TYPE: Guard<V4Tree> = {
  name: 'G10:known-atomic-type',
  severity: 'warning',
  check(tree) {
    const issues: string[] = [];
    walkAll(tree, (el) => {
      if (!V4_ATOMIC_TYPES.includes(el.type as typeof V4_ATOMIC_TYPES[number])) {
        issues.push(`${el.id}: unknown type "${el.type}"`);
      }
    });
    return issues.length === 0
      ? { passed: true, message: 'All types are known atomic types' }
      : { passed: false, message: `${issues.length} unknown types`, details: issues.slice(0, 5).join('; ') };
  },
};

// G_NO_V3: tree contains V3 markers (critical) — Anti-Contamination
const G_NO_V3: Guard<V4Tree> = {
  name: 'G_NO_V3:no-v3-markers',
  severity: 'critical',
  check(tree) {
    const json = JSON.stringify(tree);
    const v3Markers = ['"elType":"container"', '"elType":"section"', '"elType":"column"', '"isInner":true', '"_element_width"', '"content_width"'];
    const found = v3Markers.filter((m) => json.includes(m));
    return found.length === 0
      ? { passed: true, message: 'No V3 markers found' }
      : { passed: false, message: `V3 contamination: ${found.join(', ')}` };
  },
};

// G_STYLE_ID_VALID: all style IDs match /^[a-z][a-z0-9_]*$/ (critical)
const G_STYLE_ID_VALID: Guard<V4Tree> = {
  name: 'G_STYLE_ID_VALID:format',
  severity: 'critical',
  check(tree) {
    const issues: string[] = [];
    walkAll(tree, (el) => {
      for (const styleId of Object.keys(el.styles)) {
        if (!isValidStyleId(styleId)) {
          issues.push(`${el.id}: "${styleId}"`);
        }
      }
    });
    return issues.length === 0
      ? { passed: true, message: 'All style IDs valid' }
      : { passed: false, message: `${issues.length} invalid style IDs`, details: issues.slice(0, 5).join('; ') };
  },
};

// G12: image-src-format (warning)
const G_IMAGE_SRC: Guard<V4Tree> = {
  name: 'G12:image-src-format',
  severity: 'warning',
  check(tree) {
    const issues: string[] = [];
    walkAll(tree, (el) => {
      if (el.type === 'e-image') {
        const img = el.settings.image as { '$$type'?: string; value?: { url?: string } } | undefined;
        if (!img || img['$$type'] !== 'image-src') {
          issues.push(`${el.id}: image missing $$type image-src`);
        } else if (!img.value?.url) {
          issues.push(`${el.id}: image has empty url`);
        }
      }
    });
    return issues.length === 0
      ? { passed: true, message: 'All images have valid src' }
      : { passed: false, message: `${issues.length} image format issues` };
  },
};

// G11: style-classes-binding — every class referenced in settings.classes must
// exist in styles{} (orphan refs render blank class attrs and silently fail in
// V4). Global class references (gc-* prefix) are managed externally → skipped.
const G_STYLE_CLASSES_BINDING: Guard<V4Tree> = {
  name: 'G11:style-classes-binding',
  severity: 'warning',
  check(tree) {
    const orphaned: string[] = [];
    walkAll(tree, (el) => {
      const classesSetting = el.settings['classes'] as { '$$type'?: string; value?: unknown } | undefined;
      const classes = Array.isArray(classesSetting?.value) ? (classesSetting.value as string[]) : [];
      const styleIds = Object.keys(el.styles);
      for (const cls of classes) {
        if (typeof cls !== 'string' || cls.startsWith('gc-')) continue;
        if (!styleIds.includes(cls)) {
          orphaned.push(`${el.id}: class "${cls}" not found in styles{}`);
        }
      }
    });
    return orphaned.length === 0
      ? { passed: true, message: 'All classes are bound to style definitions' }
      : {
          passed: false,
          message: `${orphaned.length} orphan class reference(s) (class in classes[] but not in styles{})`,
          details: orphaned.slice(0, 5).join('; '),
        };
  },
};

// G13: responsive-coverage — large font/padding values should have mobile variants
const G_RESPONSIVE_COVERAGE: Guard<V4Tree> = {
  name: 'G13:responsive-coverage',
  severity: 'warning',
  check(tree) {
    const issues: string[] = [];
    const THRESHOLD_PX = 28;
    walkAll(tree, (el) => {
      for (const [styleId, styleDef] of Object.entries(el.styles)) {
        const desktopVariant = styleDef.variants?.find((v) => !v.meta?.breakpoint);
        if (!desktopVariant?.props) continue;
        const fontSize = desktopVariant.props['font-size'];
        const num = typeof fontSize === 'object' && fontSize !== null
          ? ((fontSize as Record<string, unknown>).value as Record<string, unknown>)?.size
          : parseFloat(String(fontSize));
        if (typeof num === 'number' && num > THRESHOLD_PX) {
          const hasMobile = styleDef.variants?.some((v) => v.meta?.breakpoint === 'mobile');
          if (!hasMobile) {
            issues.push(`${el.id}/${styleId}: font-size ${num}px without mobile variant`);
          }
        }
      }
    });
    return issues.length === 0
      ? { passed: true, message: 'All large text has responsive variants' }
      : { passed: false, message: `${issues.length} elements missing mobile variants`, details: issues.slice(0, 5).join('; ') };
  },
};

// G14: widget-settings-congruence — required settings keys for widget types
const G_WIDGET_CONGRUENCE: Guard<V4Tree> = {
  name: 'G14:widget-settings-congruence',
  severity: 'warning',
  check(tree) {
    const issues: string[] = [];
    const REQUIRED_KEYS: Record<string, string[]> = {
      'e-heading': ['title'],
      'e-paragraph': ['text'],
      'e-button': ['text'],
      'e-image': ['image'],
    };
    walkAll(tree, (el) => {
      const required = REQUIRED_KEYS[el.type];
      if (!required) return;
      for (const key of required) {
        if (!(key in el.settings)) {
          issues.push(`${el.id}: ${el.type} missing required setting "${key}"`);
        }
      }
    });
    return issues.length === 0
      ? { passed: true, message: 'All widgets have required settings' }
      : { passed: false, message: `${issues.length} widgets missing required settings`, details: issues.slice(0, 5).join('; ') };
  },
};

// G15: verbose-style-format — style entries should have id/type/label
const G_VERBOSE_STYLE_FORMAT: Guard<V4Tree> = {
  name: 'G15:verbose-style-format',
  severity: 'warning',
  check(tree) {
    const issues: string[] = [];
    walkAll(tree, (el) => {
      for (const [styleId, styleDef] of Object.entries(el.styles)) {
        if (!styleDef.id) issues.push(`${el.id}/${styleId}: missing style.id`);
        if (!styleDef.type) issues.push(`${el.id}/${styleId}: missing style.type`);
      }
    });
    return issues.length === 0
      ? { passed: true, message: 'All styles have verbose format' }
      : { passed: false, message: `${issues.length} styles missing verbose fields`, details: issues.slice(0, 5).join('; ') };
  },
};

/** All V4 guards in execution order */
export const V4_GUARDS: ReadonlyArray<Guard<V4Tree>> = [
  G_VALID_DOLLAR_TYPE,
  G_NO_HYPHEN_CLASS,
  G_STYLE_ID_VALID,
  G_NO_V3,
  G_MAX_DEPTH,
  G_NO_EMPTY_CLASS,
  G_KNOWN_TYPE,
  G_STYLE_CLASSES_BINDING,
  G_IMAGE_SRC,
  G_RESPONSIVE_COVERAGE,
  G_WIDGET_CONGRUENCE,
  G_VERBOSE_STYLE_FORMAT,
];

/** Runs all V4 guards (score-based: critical −20, warning −5; pass ≥ threshold). */
export function runV4Guards(tree: V4TreeNode[], threshold = 85): GuardReport {
  return runGuards(tree as V4Tree, V4_GUARDS, threshold);
}
