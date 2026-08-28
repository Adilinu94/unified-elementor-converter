/**
 * Residual WPCode snippets — carry the effects Elementor cannot express.
 * (BAUPLAN v7.0 §6.2)
 *
 * ## What "residual" means, and what it deliberately excludes
 *
 * `mapAnimations` ends with one of five verdicts per effect. Exactly two of them
 * are this module's business:
 *
 *   - `css-fallback` — an entrance whose target declares no entrance control.
 *   - `js-fallback`  — a scroll-linked effect on a site without Pro motion-fx.
 *
 * `native` and `static-approximation` already wrote settings; re-emitting them as
 * CSS would double the motion. `unsupported` is excluded on purpose: it means the
 * source itself was never classified (`motionClass` absent or `indeterminate`),
 * so there is no measured amplitude and no direction to reproduce. Generating a
 * snippet for it would be inventing an animation, and `G_ANIMATION_PARITY`
 * correctly keeps reporting it as a gap.
 *
 * ## Why the JS path can beat the native one
 *
 * Elementor Pro renders a scroll effect as `-(passedPercents - 50) * speed` px,
 * where `speed` is a slider with a 0.1 step. A measured 137px translate has no
 * exact speed, so the native mapping snaps and reports the residue as
 * `precisionLoss`. The JS residual interpolates the measured amplitude directly
 * — no enum, no slider step. For a scrub, the fallback is the more faithful of
 * the two, which is worth saying plainly rather than filing every fallback under
 * "degraded".
 *
 * ## Why a CSS-only entrance does NOT fire on load
 *
 * A viewport-triggered reveal has no CSS-only equivalent outside
 * `animation-timeline: view()`. The tempting shortcut — run the keyframes at page
 * load — is wrong for anything below the fold: the animation completes before the
 * element is ever seen, so the visitor meets a static element that has already
 * used up its entrance. Worse, the pre-animation state is usually
 * `opacity: 0`, so a browser without support would leave content permanently
 * invisible. So the `@supports` block carries the animation and the base rule
 * leaves the element fully visible. Degrading to "no animation" is a loss;
 * degrading to "invisible content" is a broken page.
 *
 * @module target-v3/animation/wpcode-residual
 */

import type { AnimationEffectIR, AnimationIR, WpcodeSnippetSpec } from '@elconv/core';
import { applyPageGuard } from '@elconv/core';
import type { AnimationResolution } from './animation-mapper.js';

/** Decisions this module can carry. Everything else is left to the report. */
const RESIDUAL_DECISIONS: readonly AnimationResolution['decision'][] = ['css-fallback', 'js-fallback'];

/**
 * Marker class the JS snippet uses to hand control to CSS.
 *
 * A class rather than an inline style so the reveal stays overridable from the
 * theme and shows up in devtools as a state, not as a mutation.
 */
const REVEAL_CLASS = 'elconv-revealed';

/** Prefix for every generated keyframes name, so a collision is traceable. */
const KEYFRAMES_PREFIX = 'elconv-residual';

export interface ResidualSkip {
  targetSourceId: string;
  animationId: string;
  reason: string;
}

export interface ResidualSnippetResult {
  /** Ready-to-write snippets. Empty when nothing needed carrying. */
  snippets: WpcodeSnippetSpec[];
  /**
   * `targetSourceId`s a snippet actually covers.
   *
   * This is the input `G_ANIMATION_PARITY` consumes. It lists only ids for which
   * a selector AND a rule were emitted — never an id that was merely considered.
   */
  coveredSourceIds: string[];
  /** Effects this module declined to carry, each with a reason. */
  skipped: ResidualSkip[];
  /** Fidelity notes for the run report. */
  notes: string[];
}

export interface ResidualSnippetOptions {
  resolutions: readonly AnimationResolution[];
  /** The source animations, needed for amplitudes: resolutions carry no effects. */
  animations: readonly AnimationIR[];
  /**
   * `sourceId` → the `_element_id` on the emitted element.
   *
   * From `emitVisualIrToV3().elementIdBySourceId`. A missing entry is a skip, not
   * a guessed selector: `allocateId` de-duplicates, so a reconstructed id would
   * be wrong on exactly the pages where two nodes share a source name.
   */
  elementIdBySourceId: Readonly<Record<string, string>>;
  /** Page id for the `body.page-id-N` guard. Omitting it makes snippets global. */
  pageId?: number;
  /** Title prefix, so two runs on one site remain distinguishable. */
  titlePrefix?: string;
}

/**
 * Build the residual snippets for one emitter run.
 *
 * Pure and total: an effect that cannot be carried becomes a `skipped` entry, so
 * the caller always learns the full picture rather than receiving a short list
 * with no explanation for what is missing.
 */
export function buildResidualSnippets(options: ResidualSnippetOptions): ResidualSnippetResult {
  const byId = new Map(options.animations.map((animation) => [animation.id, animation]));
  const prefix = options.titlePrefix ?? 'Elconv Residual';

  const skipped: ResidualSkip[] = [];
  const notes: string[] = [];
  const covered = new Set<string>();
  const cssBlocks: string[] = [];
  const revealTargets: RevealTarget[] = [];
  const scrubTargets: ScrubTarget[] = [];

  for (const resolution of options.resolutions) {
    if (!RESIDUAL_DECISIONS.includes(resolution.decision)) continue;

    const animation = byId.get(resolution.animationId);
    if (animation === undefined) {
      skipped.push({
        targetSourceId: resolution.targetSourceId,
        animationId: resolution.animationId,
        reason: 'no AnimationIR with this id was passed, so its measured amplitudes are unknown',
      });
      continue;
    }

    const elementId = options.elementIdBySourceId[resolution.targetSourceId];
    if (elementId === undefined || elementId.length === 0) {
      skipped.push({
        targetSourceId: resolution.targetSourceId,
        animationId: resolution.animationId,
        reason:
          'the emitter recorded no _element_id for this source id, so no selector can address it ' +
          '(the element was probably flattened away)',
      });
      continue;
    }
    if (!isSafeCssIdent(elementId)) {
      skipped.push({
        targetSourceId: resolution.targetSourceId,
        animationId: resolution.animationId,
        reason: `element id "${elementId}" is not a bare CSS identifier and was not escaped into a selector`,
      });
      continue;
    }

    const effects = animation.effects ?? [];
    if (effects.length === 0) {
      skipped.push({
        targetSourceId: resolution.targetSourceId,
        animationId: resolution.animationId,
        reason: 'the animation carries no measured effects, so there is no amplitude to reproduce',
      });
      continue;
    }

    if (resolution.decision === 'css-fallback') {
      const built = buildRevealCss(elementId, animation, effects);
      if (built === undefined) {
        skipped.push({
          targetSourceId: resolution.targetSourceId,
          animationId: resolution.animationId,
          reason: 'none of the measured effects map onto a CSS property that can be animated safely',
        });
        continue;
      }
      cssBlocks.push(built.css);
      revealTargets.push({ elementId, thresholdRatio: built.thresholdRatio });
      covered.add(resolution.targetSourceId);
      notes.push(
        `${resolution.targetSourceId}: entrance carried by a residual CSS reveal on #${elementId}. ` +
          'Without JS or animation-timeline support the element renders in its final state, un-animated.',
      );
      continue;
    }

    const scrub = buildScrubTarget(elementId, effects);
    if (scrub === undefined) {
      skipped.push({
        targetSourceId: resolution.targetSourceId,
        animationId: resolution.animationId,
        reason: 'no measured effect maps onto a transform or opacity a scroll scrub can drive',
      });
      continue;
    }
    scrubTargets.push(scrub);
    covered.add(resolution.targetSourceId);
    notes.push(
      `${resolution.targetSourceId}: scroll-linked motion carried by a residual JS scrub on #${elementId}, ` +
        'interpolating the measured amplitude directly (no motion-fx speed-slider snapping).',
    );
  }

  const snippets: WpcodeSnippetSpec[] = [];

  if (cssBlocks.length > 0) {
    snippets.push({
      title: `${prefix} — Entrance CSS`,
      type: 'css',
      // Header: CSS that sets a pre-animation state must land before first
      // paint, or the element is briefly visible in its final position and then
      // jumps back to animate — a flash of un-animated content.
      location: 'header',
      code: cssBlocks.join('\n\n'),
      ...(options.pageId !== undefined ? { pageId: options.pageId } : {}),
      tags: ['elconv', 'residual', 'animation'],
      active: true,
      autoInsert: true,
    });
  }

  if (revealTargets.length > 0) {
    const js = buildRevealJs(revealTargets);
    snippets.push({
      title: `${prefix} — Entrance Observer`,
      // `html` with an inline <script>, not `js`: WPCODE_SAFE_COMBINATIONS marks
      // html+footer as the combo that reliably preserves inline scripts.
      type: 'html',
      location: 'footer',
      code: `<script>\n${applyPageGuardedIife(js, options.pageId)}\n</script>`,
      ...(options.pageId !== undefined ? { pageId: options.pageId } : {}),
      tags: ['elconv', 'residual', 'animation'],
      active: true,
      autoInsert: true,
    });
  }

  if (scrubTargets.length > 0) {
    const js = buildScrubJs(scrubTargets);
    snippets.push({
      title: `${prefix} — Scroll Scrub`,
      type: 'html',
      location: 'footer',
      code: `<script>\n${applyPageGuardedIife(js, options.pageId)}\n</script>`,
      ...(options.pageId !== undefined ? { pageId: options.pageId } : {}),
      tags: ['elconv', 'residual', 'animation'],
      active: true,
      autoInsert: true,
    });
  }

  return { snippets, coveredSourceIds: [...covered], skipped, notes };
}

// ============================================================================
// Entrance reveal
// ============================================================================

interface RevealTarget {
  elementId: string;
  thresholdRatio: number;
}

/**
 * Threshold at which a reveal fires.
 *
 * 0.1 is Elementor's own `elementor-invisible` observer threshold, so a residual
 * reveal fires at the same scroll position as a native one on the same page —
 * mixing the two must not produce two different reveal lines.
 */
const REVEAL_THRESHOLD = 0.1;

/** Elementor's default entrance duration, used when the source reported none. */
const DEFAULT_REVEAL_MS = 1250;

function buildRevealCss(
  elementId: string,
  animation: AnimationIR,
  effects: readonly AnimationEffectIR[],
): { css: string; thresholdRatio: number } | undefined {
  const from = startStateFor(effects);
  if (from.length === 0) return undefined;

  const durationMs = Math.round(animation.durationMs ?? DEFAULT_REVEAL_MS);
  const name = `${KEYFRAMES_PREFIX}-${elementId}`;
  const selector = `#${elementId}`;

  // The base rule intentionally sets NOTHING. Support for the reveal is opt-in
  // via the two blocks below, so a browser that reaches neither shows the
  // element normally instead of holding it at opacity: 0 forever.
  const css = [
    `/* residual entrance for ${animation.id} (${animation.intent}) */`,
    `@keyframes ${name} {`,
    `  from { ${from.join(' ')} }`,
    `  to { ${restStateFor(effects).join(' ')} }`,
    `}`,
    ``,
    `/* JS path: the observer adds .${REVEAL_CLASS} when the element enters view. */`,
    `body.js ${selector}.${REVEAL_CLASS},`,
    `${selector}.${REVEAL_CLASS} {`,
    `  animation: ${name} ${durationMs}ms cubic-bezier(0.25, 0.46, 0.45, 0.94) both;`,
    `}`,
    ``,
    `/* No-JS path, where the browser can drive the reveal from scroll itself. */`,
    `@supports (animation-timeline: view()) {`,
    `  ${selector}:not(.${REVEAL_CLASS}) {`,
    `    animation: ${name} 1ms linear both;`,
    `    animation-timeline: view();`,
    `    animation-range: entry 10% entry 90%;`,
    `  }`,
    `}`,
    ``,
    `@media (prefers-reduced-motion: reduce) {`,
    `  ${selector}, ${selector}.${REVEAL_CLASS} { animation: none; }`,
    `}`,
  ].join('\n');

  return { css, thresholdRatio: REVEAL_THRESHOLD };
}

/**
 * The pre-animation state, from the measured `from` values.
 *
 * Only opacity and transform are emitted: they are the two properties that
 * animate on the compositor. Animating anything else here would trade a missing
 * animation for a janky one.
 */
function startStateFor(effects: readonly AnimationEffectIR[]): string[] {
  const parts: string[] = [];
  const transforms: string[] = [];

  for (const effect of effects) {
    switch (effect.kind) {
      case 'opacity':
        parts.push(`opacity: ${clamp01(effect.from)};`);
        break;
      case 'translateX':
        transforms.push(`translateX(${round(effect.from)}px)`);
        break;
      case 'translateY':
        transforms.push(`translateY(${round(effect.from)}px)`);
        break;
      case 'scale':
        transforms.push(`scale(${round(effect.from, 3)})`);
        break;
      case 'rotate':
        transforms.push(`rotate(${round(effect.from, 2)}deg)`);
        break;
    }
  }

  if (transforms.length > 0) parts.push(`transform: ${transforms.join(' ')};`);
  return parts;
}

/** The resting state. Mirrors `startStateFor` so the pair cannot drift apart. */
function restStateFor(effects: readonly AnimationEffectIR[]): string[] {
  const parts: string[] = [];
  const transforms: string[] = [];

  for (const effect of effects) {
    switch (effect.kind) {
      case 'opacity':
        parts.push(`opacity: ${clamp01(effect.to)};`);
        break;
      case 'translateX':
        transforms.push(`translateX(${round(effect.to)}px)`);
        break;
      case 'translateY':
        transforms.push(`translateY(${round(effect.to)}px)`);
        break;
      case 'scale':
        transforms.push(`scale(${round(effect.to, 3)})`);
        break;
      case 'rotate':
        transforms.push(`rotate(${round(effect.to, 2)}deg)`);
        break;
    }
  }

  if (transforms.length > 0) parts.push(`transform: ${transforms.join(' ')};`);
  return parts;
}

function buildRevealJs(targets: readonly RevealTarget[]): string {
  const entries = targets
    .map((target) => `    ['${target.elementId}', ${target.thresholdRatio}]`)
    .join(',\n');

  return [
    `var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;`,
    `if (reduce) return;`,
    `var targets = [`,
    entries,
    `];`,
    // No IntersectionObserver means no viewport detection. Adding the class
    // immediately would fire every reveal at once, including below the fold, so
    // the elements are simply left in their final state.
    `if (!('IntersectionObserver' in window)) return;`,
    `targets.forEach(function (entry) {`,
    `  var el = document.getElementById(entry[0]);`,
    `  if (!el) return;`,
    `  var observer = new IntersectionObserver(function (records) {`,
    `    records.forEach(function (record) {`,
    `      if (!record.isIntersecting) return;`,
    `      record.target.classList.add('${REVEAL_CLASS}');`,
    // One-shot: an entrance that replays on every scroll-by is a different
    // effect from the one that was measured.
    `      observer.unobserve(record.target);`,
    `    });`,
    `  }, { threshold: entry[1] });`,
    `  observer.observe(el);`,
    `});`,
  ].join('\n');
}

// ============================================================================
// Scroll scrub
// ============================================================================

interface ScrubTarget {
  elementId: string;
  /** Per-property amplitude, in the property's own unit. */
  channels: ScrubChannel[];
}

interface ScrubChannel {
  property: 'translateX' | 'translateY' | 'scale' | 'rotate' | 'opacity';
  from: number;
  to: number;
}

function buildScrubTarget(
  elementId: string,
  effects: readonly AnimationEffectIR[],
): ScrubTarget | undefined {
  const channels: ScrubChannel[] = [];
  for (const effect of effects) {
    // Every AnimationEffectIR kind maps 1:1 onto a scrubbable channel, but the
    // switch stays exhaustive rather than casting: a new IR kind must fail
    // loudly at the type level instead of being scrubbed with wrong units.
    switch (effect.kind) {
      case 'translateX':
      case 'translateY':
      case 'scale':
      case 'rotate':
      case 'opacity':
        channels.push({ property: effect.kind, from: effect.from, to: effect.to });
        break;
    }
  }
  if (channels.length === 0) return undefined;
  return { elementId, channels };
}

/**
 * The scroll scrub.
 *
 * Progress is the element's own passage through the viewport, matching Pro's
 * `passedPercents`, so a page mixing native motion-fx with a residual scrub keeps
 * one consistent notion of "how far along" an element is.
 */
function buildScrubJs(targets: readonly ScrubTarget[]): string {
  const spec = targets
    .map(
      (target) =>
        `    { id: '${target.elementId}', ch: [` +
        target.channels
          .map((channel) => `{ p: '${channel.property}', a: ${round(channel.from, 4)}, b: ${round(channel.to, 4)} }`)
          .join(', ') +
        `] }`,
    )
    .join(',\n');

  return [
    `var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;`,
    `if (reduce) return;`,
    `var specs = [`,
    spec,
    `];`,
    `var live = specs.map(function (s) {`,
    `  var el = document.getElementById(s.id);`,
    `  return el ? { el: el, ch: s.ch } : null;`,
    `}).filter(Boolean);`,
    `if (!live.length) return;`,
    ``,
    `function progress(el) {`,
    `  var rect = el.getBoundingClientRect();`,
    `  var vh = window.innerHeight || document.documentElement.clientHeight;`,
    // Guard a zero viewport (headless capture before layout settles): dividing
    // by it yields NaN, which becomes transform: translateY(NaNpx) and silently
    // drops the whole transform.
    `  if (!vh) return 0;`,
    `  var span = rect.height + vh;`,
    `  if (span <= 0) return 0;`,
    `  var passed = (vh - rect.top) / span;`,
    `  return passed < 0 ? 0 : passed > 1 ? 1 : passed;`,
    `}`,
    ``,
    `function apply() {`,
    `  live.forEach(function (item) {`,
    `    var t = progress(item.el);`,
    `    var transforms = [];`,
    `    var opacity = null;`,
    `    item.ch.forEach(function (c) {`,
    `      var v = c.a + (c.b - c.a) * t;`,
    `      if (c.p === 'translateX') transforms.push('translateX(' + v.toFixed(2) + 'px)');`,
    `      else if (c.p === 'translateY') transforms.push('translateY(' + v.toFixed(2) + 'px)');`,
    `      else if (c.p === 'scale') transforms.push('scale(' + v.toFixed(4) + ')');`,
    `      else if (c.p === 'rotate') transforms.push('rotate(' + v.toFixed(2) + 'deg)');`,
    `      else opacity = v;`,
    `    });`,
    `    if (transforms.length) item.el.style.transform = transforms.join(' ');`,
    `    if (opacity !== null) item.el.style.opacity = String(opacity);`,
    `  });`,
    `}`,
    ``,
    // rAF-coalesced: a raw scroll handler that writes style on every event
    // forces a layout per event and is the usual cause of a "smooth on desktop,
    // unusable on mobile" scrub.
    `var queued = false;`,
    `function onScroll() {`,
    `  if (queued) return;`,
    `  queued = true;`,
    `  window.requestAnimationFrame(function () { queued = false; apply(); });`,
    `}`,
    `window.addEventListener('scroll', onScroll, { passive: true });`,
    `window.addEventListener('resize', onScroll, { passive: true });`,
    `apply();`,
  ].join('\n');
}

// ============================================================================
// Shared helpers
// ============================================================================

/**
 * Wrap JS in an IIFE, applying the page guard INSIDE it.
 *
 * The guard is an early `return`, which is only legal inside a function — so the
 * wrapping has to happen here and not at the call site. `applyPageGuard` is
 * reused rather than reimplemented so the `body.page-id-N` class name has one
 * definition across the repo.
 */
function applyPageGuardedIife(body: string, pageId: number | undefined): string {
  const guarded = applyPageGuard(body, pageId, 'js');
  return `(function () {\n${indent(guarded)}\n})();`;
}

function indent(code: string): string {
  return code
    .split('\n')
    .map((line) => (line.length > 0 ? `  ${line}` : line))
    .join('\n');
}

/**
 * True for an identifier usable directly after `#` in a selector.
 *
 * The emitter runs ids through `safeCssId`, so this should always hold; it is
 * checked anyway because the failure mode is silent. An id needing escaping
 * produces a selector that parses but matches nothing, and the snippet would
 * then be reported as coverage while doing nothing at all.
 */
export function isSafeCssIdent(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, round(value, 3)));
}

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
