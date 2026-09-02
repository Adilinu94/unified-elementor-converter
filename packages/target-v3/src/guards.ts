/**
 * V3-specific Guards.
 * Ported from site-clone-to-v3/src/validator/json-guard.ts (V3_GUARDS) + new guards.
 */

import type { Guard } from '@elconv/core';
import {
  runGuards,
  findPrefixedBreakpointKeys,
  isBreakpointKey,
  isVisualControlId,
  type GuardReport,
} from '@elconv/core';
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
      const keys = Object.keys(settings);
      const hasTablet = keys.some((k) => isBreakpointKey(k, 'tablet'));
      const hasMobile = keys.some((k) => isBreakpointKey(k, 'mobile'));
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

// G4b: breakpoint-prefix-misuse — `tablet_padding` instead of `padding_tablet` (critical)
//
// Elementor stores prefixed keys in `_elementor_data` but never renders them.
// The tree therefore looks structurally valid while every responsive override
// is dead. This is a silent-data-loss class, hence `critical`.
const G_BREAKPOINT_PREFIX_MISUSE: Guard<V3Tree> = {
  name: 'G4b:breakpoint-prefix-misuse',
  severity: 'critical',
  check(tree) {
    const offenders: string[] = [];
    let keyCount = 0;
    walkAll(tree, (el) => {
      const prefixed = findPrefixedBreakpointKeys(el.settings ?? {});
      if (prefixed.length === 0) return;
      keyCount += prefixed.length;
      offenders.push(`${el.id}: ${prefixed.slice(0, 3).join(', ')}`);
    });
    return keyCount === 0
      ? { passed: true, message: 'No breakpoint prefix misuse' }
      : {
          passed: false,
          message:
            `${keyCount} settings use the tablet_/mobile_ prefix; Elementor requires ` +
            'the _tablet/_mobile suffix. These settings are silently ignored.',
          details: offenders.slice(0, 3).join('; '),
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
          details: `${risks.slice(0, 5).join(', ')} — give a container child content_width:full + width, a widget child _element_width:initial + _element_custom_width, or use the HTML row pattern`,
        };
  },
};

// ============================================================================
// Substance guards (P5.3) — a structurally perfect but EMPTY tree must fail.
//
// The v6.0 build plan documents a real conversion that reached "Guards passed:
// 100/100" with a 496-byte tree containing 1 section and 0 widgets. Every
// existing guard measures structure (unique ids, known types, no V4 markers),
// and an empty tree is structurally flawless. These four guards measure
// substance instead.
//
// See docs/BAUPLAN-v6.0-FRAMER-FIDELITY-2026-08.md §11.3.
// ============================================================================

/** elTypes that act as a page-level section in a V3 tree root. */
const SECTION_LIKE = new Set(['section', 'container']);

/** widgetType -> settings key that must carry visible text. */
const TEXT_CONTENT_KEYS: Record<string, string> = {
  heading: 'title',
  'text-editor': 'editor',
  button: 'text',
};

/** Settings keys that represent an actual visual decision (not layout plumbing). */
/**
 * True when a settings key styles the element.
 *
 * Delegates to `isVisualControlId`, which is derived from the emitter's own
 * CSS→control candidate tables. A hand-written prefix list stood here before and
 * undercounted badly: on a real converted page it reported 39% styled while
 * missing 81 `flex_align_items`, 80 `flex_direction`, 69 `flex_gap`, 63
 * `flex_justify_content`, 27 `boxed_width` and 48 `border_radius` settings — all
 * written by the emitter and all rendering. A guard that cannot see what the
 * emitter writes measures nothing.
 */
function isStyleSettingKey(key: string): boolean {
  return isVisualControlId(key);
}

function stripHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// G_SUBSTANCE_WIDGETS: every top-level section carries at least one widget (critical)
const G_SUBSTANCE_WIDGETS: Guard<V3Tree> = {
  name: 'G_SUBSTANCE_WIDGETS:section-has-widgets',
  severity: 'critical',
  check(tree) {
    const roots = tree.filter((el) => SECTION_LIKE.has(el.elType));
    if (roots.length === 0) {
      return { passed: false, message: 'Tree has no top-level section or container' };
    }
    const empty: string[] = [];
    for (const root of roots) {
      const widgets = countAll([root], (el) => el.elType === 'widget');
      if (widgets === 0) empty.push(root.id);
    }
    return empty.length === 0
      ? { passed: true, message: `All ${roots.length} top-level section(s) contain widgets` }
      : {
          passed: false,
          message: `${empty.length} of ${roots.length} top-level section(s) have no widgets — extraction produced an empty section.`,
          details: empty.slice(0, 5).join(', '),
        };
  },
};

// G_SUBSTANCE_TEXT: text-bearing widgets have non-empty content (critical)
const G_SUBSTANCE_TEXT: Guard<V3Tree> = {
  name: 'G_SUBSTANCE_TEXT:text-content-present',
  severity: 'critical',
  check(tree) {
    const empty: string[] = [];
    let total = 0;
    walkAll(tree, (el) => {
      if (el.elType !== 'widget' || !el.widgetType) return;
      const contentKey = TEXT_CONTENT_KEYS[el.widgetType];
      if (!contentKey) return;
      total++;
      if (!stripHtml((el.settings ?? {})[contentKey])) {
        empty.push(`${el.id} (${el.widgetType}.${contentKey})`);
      }
    });
    if (total === 0) {
      return { passed: true, message: 'No text-bearing widgets in tree' };
    }
    return empty.length === 0
      ? { passed: true, message: `All ${total} text-bearing widget(s) carry content` }
      : {
          passed: false,
          message: `${empty.length} of ${total} text-bearing widgets have empty content.`,
          details: empty.slice(0, 5).join('; '),
        };
  },
};

/** Minimum widgets per section before under-extraction is assumed. */
const MIN_WIDGETS_PER_SECTION = 3;

// G_SUBSTANCE_RATIO: widgets/sections >= 3 (warning)
const G_SUBSTANCE_RATIO: Guard<V3Tree> = {
  name: 'G_SUBSTANCE_RATIO:widget-density',
  severity: 'warning',
  check(tree) {
    const sectionCount = countAll(tree, (el) => SECTION_LIKE.has(el.elType) && !el.isInner);
    const widgetCount = countAll(tree, (el) => el.elType === 'widget');
    if (sectionCount === 0) {
      return { passed: true, message: 'No sections to measure density against' };
    }
    const ratio = widgetCount / sectionCount;
    return ratio >= MIN_WIDGETS_PER_SECTION
      ? {
          passed: true,
          message: `Widget density ${ratio.toFixed(1)} per section >= ${MIN_WIDGETS_PER_SECTION}`,
        }
      : {
          passed: false,
          message: `Only ${widgetCount} widgets across ${sectionCount} sections (${ratio.toFixed(1)} per section) — likely under-extraction.`,
        };
  },
};

/** Minimum share of elements that must carry at least one visual setting. */
const MIN_STYLED_RATIO = 0.5;

// G_SUBSTANCE_STYLED: >= 50% of elements carry a visual setting (warning)
const G_SUBSTANCE_STYLED: Guard<V3Tree> = {
  name: 'G_SUBSTANCE_STYLED:visual-settings-present',
  severity: 'warning',
  check(tree) {
    let total = 0;
    let styled = 0;
    walkAll(tree, (el) => {
      total++;
      if (Object.keys(el.settings ?? {}).some(isStyleSettingKey)) styled++;
    });
    if (total === 0) {
      return { passed: false, message: 'Tree is empty — no elements to check' };
    }
    const ratio = styled / total;
    const pct = (ratio * 100).toFixed(0);
    return ratio >= MIN_STYLED_RATIO
      ? { passed: true, message: `${pct}% of elements carry visual settings` }
      : {
          passed: false,
          message: `Only ${pct}% of elements carry visual settings — styles may be lost.`,
          details: `${styled}/${total} elements have background_*, typography_*, padding, margin or *_color`,
        };
  },
};

// ============================================================================
// Fragmentation guards (v7.0 D) — a tree full of real widgets can still be
// garbage.
//
// Measured motivation: the `--html` run against loud-alternative-352151
// .framer.app scored 95/100 and PASSED while containing 140 heading widgets
// whose text was a single word each ("We're", "Wegency", "digital", "studio")
// and 59.8% duplicated text from the desktop/tablet/phone variants of the same
// export. Every substance guard was satisfied: widgets existed, text was
// non-empty, density was high. Nothing measured *fragmentation*.
//
// See docs/BAUPLAN-v7.0-FRAMER-GENERIC-2026-08-26.md §6.1.
// ============================================================================

/**
 * Function words that are never a standalone heading or paragraph.
 * A text widget containing only one of these is proof the source sentence was
 * tokenized across sibling nodes rather than parsed.
 */
const FUNCTION_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'did', 'do', 'does',
  'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'how', 'if', 'in', 'into', 'is', 'it',
  'its', 'just', 'may', 'might', 'not', 'of', 'on', 'or', 'our', 'out', 'over', 'she', 'should',
  'so', 'that', 'the', 'their', 'them', 'then', 'these', 'they', 'this', 'those', 'to', 'too',
  'under', 'up', 'us', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who',
  'why', 'will', 'with', 'would', 'you', 'your',
]);

/** Collect the visible text of a widget, or null if it is not text-bearing. */
function widgetText(el: V3Element): string | null {
  if (el.elType !== 'widget' || !el.widgetType) return null;
  const key = TEXT_CONTENT_KEYS[el.widgetType];
  if (!key) return null;
  return stripHtml((el.settings ?? {})[key]);
}

function isSingleWord(text: string): boolean {
  return text.split(/\s+/).filter(Boolean).length === 1;
}

/**
 * True when a lone token can only be the middle of a sentence:
 * it starts lowercase, is a function word, or carries trailing punctuation.
 *
 * Deliberately conservative — a capitalised single word like "Contact" or
 * "Services" is a legitimate heading and must NOT count.
 */
function isSentenceContinuation(text: string): boolean {
  if (/^[a-z]/.test(text)) return true;
  if (/[.,;:!?]$/.test(text)) return true;
  return FUNCTION_WORDS.has(text.toLowerCase().replace(/[^a-z']/g, ''));
}

/** Minimum consecutive single-word siblings before tokenization is assumed. */
const MIN_TOKENIZED_RUN = 3;

/** Collect runs of consecutive single-word text siblings that read as one sentence. */
function findTokenizedRuns(tree: V3Tree): string[][] {
  const runs: string[][] = [];
  const visit = (elements: V3Element[]): void => {
    let run: string[] = [];
    const flush = (): void => {
      if (run.length >= MIN_TOKENIZED_RUN && run.some(isSentenceContinuation)) {
        runs.push(run);
      }
      run = [];
    };
    for (const el of elements) {
      const text = widgetText(el);
      if (text !== null && text.length > 0 && isSingleWord(text)) {
        run.push(text);
        continue;
      }
      flush();
    }
    flush();
    for (const el of elements) {
      if (el.elements) visit(el.elements);
    }
  };
  visit(tree);
  return runs;
}

// G_SUBSTANCE_FRAGMENTS: source was tokenized, not parsed (critical)
const G_SUBSTANCE_FRAGMENTS: Guard<V3Tree> = {
  name: 'G_SUBSTANCE_FRAGMENTS:text-not-tokenized',
  severity: 'critical',
  check(tree) {
    const runs = findTokenizedRuns(tree);
    if (runs.length === 0) {
      return { passed: true, message: 'No tokenized text runs detected' };
    }
    const affected = runs.reduce((sum, r) => sum + r.length, 0);
    return {
      passed: false,
      message:
        `${runs.length} run(s) of ${MIN_TOKENIZED_RUN}+ consecutive single-word text widgets ` +
        `(${affected} widgets) — the source was tokenized, not parsed.`,
      details: runs
        .slice(0, 3)
        .map((r) => `[${r.length}] ${r.join(' ').slice(0, 80)}`)
        .join(' | '),
    };
  },
};

/**
 * Minimum text length considered for duplicate detection.
 *
 * Short labels legitimately repeat ("Contact" in nav, footer and a CTA).
 * A body sentence does not. Measured on the fragmented tree: 63.6% of texts
 * at or above this length were duplicates, all from responsive variants.
 */
const DUPE_MIN_TEXT_LENGTH = 25;

/** Share of long texts allowed to be duplicates before the tree is rejected. */
const MAX_DUPE_RATIO = 0.25;

/** Absolute floor so a 3-element tree cannot trip the ratio. */
const MIN_DUPES_TO_FAIL = 4;

// G_SUBSTANCE_DUPES: responsive variants were not deduplicated (critical)
const G_SUBSTANCE_DUPES: Guard<V3Tree> = {
  name: 'G_SUBSTANCE_DUPES:no-variant-duplication',
  severity: 'critical',
  check(tree) {
    const seen = new Map<string, number>();
    let considered = 0;
    walkAll(tree, (el) => {
      const text = widgetText(el);
      if (text === null || text.length < DUPE_MIN_TEXT_LENGTH) return;
      considered++;
      const key = `${el.widgetType}|${text}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    });
    if (considered === 0) {
      return { passed: true, message: `No text of ${DUPE_MIN_TEXT_LENGTH}+ chars to compare` };
    }
    const repeats = [...seen.entries()].filter(([, count]) => count > 1);
    const duplicateInstances = repeats.reduce((sum, [, count]) => sum + (count - 1), 0);
    const ratio = duplicateInstances / considered;
    if (duplicateInstances < MIN_DUPES_TO_FAIL || ratio <= MAX_DUPE_RATIO) {
      return {
        passed: true,
        message: `${duplicateInstances}/${considered} long texts duplicated (${(ratio * 100).toFixed(0)}%)`,
      };
    }
    return {
      passed: false,
      message:
        `${duplicateInstances} of ${considered} texts >= ${DUPE_MIN_TEXT_LENGTH} chars are duplicates ` +
        `(${(ratio * 100).toFixed(0)}%) — responsive variants were not deduplicated.`,
      details: repeats
        .slice(0, 3)
        .map(([key, count]) => `x${count} ${key.slice(0, 60)}`)
        .join(' | '),
    };
  },
};

// ============================================================================
// Animation control guards (v7.0 D/B) — a setting Elementor silently ignores
// is worse than no setting, because the deploy reports success.
//
// Verified against schemas/elementor-v3-controls.snapshot.json (pulled live
// from testseite.nick-webdesign.de, `missing: []`):
//
//   __container__   animation   animation_delay   css_classes
//   every widget    _animation  _animation_delay  _css_classes
//   both            animation_duration  sticky*  motion_fx_*
//
// The entrance-animation control name differs by ONE underscore depending on
// element kind, and every companion is gated by an `if` condition. Set the
// wrong one, or omit the companion, and the animation simply does not happen.
// ============================================================================

/** Entrance-animation control ids, by element kind. */
const CONTAINER_ANIMATION_KEYS = ['animation', 'animation_delay', 'css_classes'] as const;
const WIDGET_ANIMATION_KEYS = ['_animation', '_animation_delay', '_css_classes'] as const;

// G_ANIMATION_CONTROL_SPLIT: right control id for the element kind (critical)
const G_ANIMATION_CONTROL_SPLIT: Guard<V3Tree> = {
  name: 'G_ANIMATION_CONTROL_SPLIT:underscore-variant-matches-eltype',
  severity: 'critical',
  check(tree) {
    const wrong: string[] = [];
    walkAll(tree, (el) => {
      const settings = el.settings ?? {};
      if (el.elType === 'container') {
        for (const key of WIDGET_ANIMATION_KEYS) {
          if (key in settings) {
            wrong.push(`${el.id} (container) uses "${key}" — containers use "${key.slice(1)}"`);
          }
        }
      } else if (el.elType === 'widget') {
        for (const key of CONTAINER_ANIMATION_KEYS) {
          if (key in settings) {
            wrong.push(`${el.id} (${el.widgetType}) uses "${key}" — widgets use "_${key}"`);
          }
        }
      }
      // section / column are intentionally not judged: the live snapshot only
      // covers __container__ and widgets, so any verdict would be a guess.
    });
    return wrong.length === 0
      ? { passed: true, message: 'Animation/class control ids match their element kind' }
      : {
          passed: false,
          message: `${wrong.length} element(s) use the wrong underscore variant — Elementor ignores these silently.`,
          details: wrong.slice(0, 5).join('; '),
        };
  },
};

/**
 * Companion requirements taken verbatim from the snapshot `if` clauses.
 * `dependent` is only honoured while `requires` holds.
 */
interface CompanionRule {
  dependent: string;
  requires: string;
  /** Satisfied when the companion is a non-empty value. */
  mode: 'non-empty' | 'yes';
}

const COMPANION_RULES: readonly CompanionRule[] = [
  // Container: `if: { animation!: "" }`
  { dependent: 'animation_delay', requires: 'animation', mode: 'non-empty' },
  // Widget: `if: { _animation!: "" }`
  { dependent: '_animation_delay', requires: '_animation', mode: 'non-empty' },
  // Both: `sticky_*` is gated on `if: { sticky!: "" }`
  { dependent: 'sticky_offset', requires: 'sticky', mode: 'non-empty' },
  { dependent: 'sticky_effects_offset', requires: 'sticky', mode: 'non-empty' },
  { dependent: 'sticky_on', requires: 'sticky', mode: 'non-empty' },
  { dependent: 'sticky_parent', requires: 'sticky', mode: 'non-empty' },
];

/** Scroll motion effects are all gated on the master scrolling switcher. */
const MOTION_FX_SCROLL_MASTER = 'motion_fx_motion_fx_scrolling';
const MOTION_FX_MOUSE_MASTER = 'motion_fx_motion_fx_mouse';
const MOUSE_FX_EFFECTS = new Set(['motion_fx_mouseTrack_effect', 'motion_fx_tilt_effect']);

function isPresent(settings: Record<string, unknown>, key: string): boolean {
  const value = settings[key];
  return value !== undefined && value !== null && value !== '';
}

// G_ANIMATION_COMPANION: every gated control has its companion (critical)
const G_ANIMATION_COMPANION: Guard<V3Tree> = {
  name: 'G_ANIMATION_COMPANION:gated-controls-have-companion',
  severity: 'critical',
  check(tree) {
    const missing: string[] = [];
    walkAll(tree, (el) => {
      const settings = el.settings ?? {};
      const label = el.widgetType ? `${el.id} (${el.widgetType})` : `${el.id} (${el.elType})`;

      for (const rule of COMPANION_RULES) {
        if (!(rule.dependent in settings)) continue;
        if (!isPresent(settings, rule.requires)) {
          missing.push(`${label}: "${rule.dependent}" needs a non-empty "${rule.requires}"`);
        }
      }

      // `animation_duration` has no underscore on either kind, but its `if`
      // clause points at the kind-specific entrance control.
      if ('animation_duration' in settings) {
        const entrance = el.elType === 'widget' ? '_animation' : 'animation';
        if (!isPresent(settings, entrance)) {
          missing.push(`${label}: "animation_duration" needs a non-empty "${entrance}"`);
        }
      }

      // motion_fx_*_effect / *_speed / *_direction require the master switcher.
      for (const key of Object.keys(settings)) {
        if (!key.startsWith('motion_fx_')) continue;
        if (key === MOTION_FX_SCROLL_MASTER || key === MOTION_FX_MOUSE_MASTER) continue;
        if (key.startsWith('motion_fx_transform_')) continue; // ungated
        const master = MOUSE_FX_EFFECTS.has(key) || /mouseTrack|tilt/.test(key)
          ? MOTION_FX_MOUSE_MASTER
          : MOTION_FX_SCROLL_MASTER;
        if (settings[master] !== 'yes') {
          missing.push(`${label}: "${key}" needs "${master}": "yes"`);
        }
      }
    });
    return missing.length === 0
      ? { passed: true, message: 'All gated animation controls carry their companion' }
      : {
          passed: false,
          message:
            `${missing.length} gated animation control(s) missing a companion — ` +
            'Elementor drops these without error, so the deploy looks successful.',
          details: missing.slice(0, 5).join('; '),
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
  G_BREAKPOINT_PREFIX_MISUSE,
  G_IMAGE_URL,
  G_HTML_BUDGET,
  G_HTML_EMPTY,
  G_TREE_SIZE,
  G_NESTED_IS_INNER,
  G_FLEX_ROW_CHILD_WIDTH,
  G_SUBSTANCE_WIDGETS,
  G_SUBSTANCE_TEXT,
  G_SUBSTANCE_RATIO,
  G_SUBSTANCE_STYLED,
  G_SUBSTANCE_FRAGMENTS,
  G_SUBSTANCE_DUPES,
  G_ANIMATION_CONTROL_SPLIT,
  G_ANIMATION_COMPANION,
];

/** Runs all V3 guards (score-based: critical −20, warning −5; pass ≥ threshold). */
export function runV3Guards(tree: V3Element[], threshold = 85): GuardReport {
  return runGuards(tree as V3Tree, V3_GUARDS, threshold);
}
