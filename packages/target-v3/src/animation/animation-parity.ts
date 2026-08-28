/**
 * `G_ANIMATION_PARITY` — did every measured effect actually arrive somewhere?
 * (BAUPLAN v7.0 §6.1)
 *
 * ## Why this cannot be a plain `Guard<V3Tree>`
 *
 * Every other V3 guard reads the tree and nothing else. This one cannot, and the
 * reason is the failure it exists to catch: an animation that resolved to
 * `js-fallback` leaves **no trace in the settings**. Counting animation settings
 * in the tree would report it as identical to an animation that was silently
 * dropped — which is exactly the confusion that let the whole animation path sit
 * unwired while every guard passed.
 *
 * So the guard is produced by a factory that closes over the mapper's verdicts.
 * `emitVisualIrToV3` returns them as `animationResolutions` for this purpose.
 *
 * ## What parity means here
 *
 * Three buckets, and each has a different definition of "handled":
 *
 *   - `native` / `static-approximation` — settings were written. Handled iff the
 *     target element in the tree actually carries an animation control. This is
 *     a real cross-check, not a tautology: the merge could have targeted an
 *     element that a later flattening pass removed.
 *   - `css-fallback` / `js-fallback` — nothing was written on purpose. Handled
 *     iff a residual snippet claims the source id.
 *   - `unsupported` — nothing can handle it. Always a reported gap.
 *
 * A gap is a `warning`, not `critical`: an unmappable effect is a documented
 * fidelity loss, not a broken tree. The charter asks that it be named, not that
 * it stop the build.
 *
 * @module target-v3/animation/animation-parity
 */

import type { Guard, GuardResult } from '@elconv/core';
import type { V3Element } from '../types.js';
import type { AnimationResolution } from './animation-mapper.js';

/** Control ids whose presence proves an element carries animation behaviour. */
const ANIMATION_MARKER_KEYS: readonly string[] = [
  'animation',
  '_animation',
  'animation_tablet',
  '_animation_tablet',
  'animation_mobile',
  '_animation_mobile',
  'sticky',
];

/** Prefix marking any Pro motion-fx control. */
const MOTION_FX_PREFIX = 'motion_fx_';

/**
 * True when this element carries at least one control that makes it move.
 *
 * `motion_fx_motion_fx_scrolling: 'yes'` alone is deliberately NOT enough — the
 * master switch without a single `*_effect` produces no motion, and treating it
 * as coverage would let a half-written effect set pass as handled.
 */
export function hasAnimationSettings(element: V3Element): boolean {
  const settings = element.settings ?? {};
  for (const key of ANIMATION_MARKER_KEYS) {
    const value = settings[key];
    if (value !== undefined && value !== null && value !== '') return true;
  }
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith(MOTION_FX_PREFIX) && key.endsWith('_effect') && value === 'yes') return true;
  }
  return false;
}

export interface AnimationParityGap {
  targetSourceId: string;
  animationId: string;
  decision: AnimationResolution['decision'];
  reason: string;
}

export interface AnimationParityReport {
  /** Effects whose settings are present in the tree. */
  nativeCovered: number;
  /** Effects deliberately left to a snippet, and a snippet claims them. */
  snippetCovered: number;
  /** Effects nothing handles. Each one is named. */
  gaps: AnimationParityGap[];
  /** Elements carrying animation settings that no resolution accounts for. */
  orphanAnimatedElementIds: string[];
  /** Total resolutions examined. */
  total: number;
}

export interface AnimationParityInput {
  resolutions: readonly AnimationResolution[];
  /**
   * `targetSourceId`s a residual WPCode snippet covers.
   *
   * Empty means no snippet was generated, which turns every fallback into a gap
   * — the honest verdict for a run that mapped an effect to "needs a snippet"
   * and then produced none.
   */
  snippetCoveredSourceIds?: readonly string[];
}

/**
 * Compare the mapper's verdicts against what the tree and the snippets deliver.
 *
 * Pure. The element lookup is by `_element_id`-independent means: the emitter
 * writes settings onto the element it registered for a `sourceId`, so this walks
 * the tree once and asks whether ANY element carries animation settings that the
 * resolution's own `nativeSettings` keys appear in. Matching on keys rather than
 * on element identity keeps the check independent of the emitter's id scheme.
 */
export function checkAnimationParity(input: AnimationParityInput, tree: readonly V3Element[]): AnimationParityReport {
  const snippetCovered = new Set(input.snippetCoveredSourceIds ?? []);
  const animatedElements: V3Element[] = [];
  walk(tree, (element) => {
    if (hasAnimationSettings(element)) animatedElements.push(element);
  });

  const gaps: AnimationParityGap[] = [];
  let nativeCount = 0;
  let snippetCount = 0;
  const claimedElements = new Set<V3Element>();

  for (const resolution of input.resolutions) {
    if (resolution.decision === 'native' || resolution.decision === 'static-approximation') {
      // Only UNCLAIMED elements count. Two animations that resolve to identical
      // settings must not both point at one element and report 2/2 coverage for
      // a single written entrance — the same over-counting the guard exists to
      // prevent, one level down.
      const match = animatedElements.find(
        (element) => !claimedElements.has(element) && carriesAll(element, resolution.nativeSettings),
      );
      if (match !== undefined) {
        nativeCount++;
        claimedElements.add(match);
        continue;
      }
      // Distinguish the two ways this fails. They have different causes and
      // different fixes, and one message for both would send a reader looking
      // for a flattening bug that is not there.
      const claimedByAnother = animatedElements.some((element) =>
        carriesAll(element, resolution.nativeSettings),
      );
      gaps.push({
        targetSourceId: resolution.targetSourceId,
        animationId: resolution.animationId,
        decision: resolution.decision,
        reason: claimedByAnother
          ? 'the only element carrying these settings is already accounted for by another animation — ' +
            'two animations resolved onto one element, so only one of them can be visible'
          : 'the mapper wrote native settings but no element in the tree carries them — ' +
            'the target was probably removed after mapping (flattened wrapper?)',
      });
      continue;
    }

    if (resolution.decision === 'css-fallback' || resolution.decision === 'js-fallback') {
      if (snippetCovered.has(resolution.targetSourceId)) {
        snippetCount++;
        continue;
      }
      gaps.push({
        targetSourceId: resolution.targetSourceId,
        animationId: resolution.animationId,
        decision: resolution.decision,
        reason: `needs a ${resolution.decision === 'css-fallback' ? 'CSS' : 'JS'} snippet, and none covers it: ${resolution.reason}`,
      });
      continue;
    }

    gaps.push({
      targetSourceId: resolution.targetSourceId,
      animationId: resolution.animationId,
      decision: resolution.decision,
      reason: resolution.reason,
    });
  }

  // An animated element no resolution explains means a setting was written by
  // some other path. That is not automatically wrong, but it is unaccounted for
  // and the report says so rather than staying silent.
  const orphanAnimatedElementIds = animatedElements
    .filter((element) => !claimedElements.has(element))
    .map((element) => element.id);

  return {
    nativeCovered: nativeCount,
    snippetCovered: snippetCount,
    gaps,
    orphanAnimatedElementIds,
    total: input.resolutions.length,
  };
}

/** True when `element.settings` contains every key/value of `expected`. */
function carriesAll(element: V3Element, expected: Record<string, unknown>): boolean {
  const keys = Object.keys(expected);
  if (keys.length === 0) return false;
  const settings = element.settings ?? {};
  return keys.every((key) => sameValue(settings[key], expected[key]));
}

/**
 * Structural equality good enough for control values.
 *
 * Slider values are objects (`{ unit: 'px', size: 0.1, sizes: [] }`), so
 * reference equality fails even though the emitter merged that exact object.
 * JSON comparison is safe here: every control value is JSON by definition — it
 * has to survive `_elementor_data` serialisation.
 */
function sameValue(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (actual === undefined || expected === undefined) return false;
  if (typeof actual === 'object' || typeof expected === 'object') {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }
  return false;
}

function walk(elements: readonly V3Element[], fn: (element: V3Element) => void): void {
  for (const element of elements) {
    fn(element);
    if (element.elements) walk(element.elements, fn);
  }
}

/**
 * Build the parity guard for one emitter run.
 *
 * A factory rather than a constant because the verdicts are per-run data. Append
 * the result to `V3_GUARDS` for that run, or call `checkAnimationParity`
 * directly when no guard score is wanted.
 */
export function createAnimationParityGuard(input: AnimationParityInput): Guard<V3Element[]> {
  return {
    name: 'G_ANIMATION_PARITY:every-measured-effect-accounted-for',
    severity: 'warning',
    check(tree): GuardResult {
      const report = checkAnimationParity(input, tree);
      return formatParityResult(report);
    },
  };
}

/** Turn a parity report into a guard verdict. */
export function formatParityResult(report: AnimationParityReport): GuardResult {
  const handled = report.nativeCovered + report.snippetCovered;
  if (report.total === 0) {
    return { passed: true, message: 'No animations were detected, so there is nothing to account for' };
  }
  if (report.gaps.length === 0) {
    const orphanNote = report.orphanAnimatedElementIds.length > 0
      ? ` (${report.orphanAnimatedElementIds.length} animated element(s) not explained by a resolution)`
      : '';
    return {
      passed: true,
      message:
        `All ${report.total} detected effect(s) accounted for: ` +
        `${report.nativeCovered} native, ${report.snippetCovered} via snippet${orphanNote}`,
      ...(orphanNote ? { details: report.orphanAnimatedElementIds.slice(0, 5).join(', ') } : {}),
    };
  }
  return {
    passed: false,
    message:
      `${report.gaps.length} of ${report.total} detected effect(s) are unhandled ` +
      `(${handled} handled: ${report.nativeCovered} native, ${report.snippetCovered} via snippet). ` +
      'These were measured in the source and will not appear on the page.',
    details: report.gaps
      .slice(0, 5)
      .map((gap) => `${gap.targetSourceId} [${gap.decision}]: ${gap.reason}`)
      .join('; '),
  };
}

/**
 * Share of detected effects that were reproduced natively.
 *
 * The Definition of Done asks for ≥ 80 %. Returns `null` for zero effects rather
 * than 1 — a page with no animations has not met an animation target, it simply
 * had no target to meet, and reporting 100 % would be a flattering fiction.
 */
export function nativeShare(report: AnimationParityReport): number | null {
  if (report.total === 0) return null;
  return report.nativeCovered / report.total;
}
