/**
 * Motion-Evidence-Probe — Arbeitspaket B5 (BAUPLAN v7.0 §4.5).
 *
 * Framer does not animate through anything a static reader can see. Measured on
 * the real Humeen page (`output/loud-alt-2026-08-26/animation-evidence.json`):
 *
 *   - `document.getAnimations()`            → 0   (no WAAPI)
 *   - content `@keyframes`                  → 0   (the 2 found belong to the
 *                                                  Framer editor bar)
 *   - CSS `transition` rules                → 0   (same, editor bar only)
 *   - `[data-framer-appear-id]`             → 2, and BOTH are the "Made in
 *                                                  Framer" badge — the
 *                                                  declarative appear payload
 *                                                  covers zero content nodes
 *   - style deltas across scroll positions  → 31 elements
 *
 * So the only source that sees this page's motion is a scroll-position sweep
 * over computed styles. That is what this module does, and it is why it exists
 * as a first-class module instead of a throwaway script.
 *
 * What this module deliberately does NOT do:
 *
 *   - It does not decide Elementor settings. Mapping to `_animation` /
 *     `motion_fx_*` is a separate work package that owns the schema and the
 *     container-vs-widget control split.
 *   - It does not report a duration for scroll-derived motion. The sweep
 *     samples settled end states, so a duration would be invented. Only the
 *     Framer appear payload carries a real duration.
 *
 * @module extractors/browser/motion-evidence-probe
 */

import type { Page } from 'playwright';
import { conventionalViewportHeight, type ViewportConfig } from './types.js';
import { discoverAnimations, type AnimationDiscovery, type CrossOriginStylesheet } from './keyframes-discovery.js';
import { extractAnimationProperties, type AnimationExtractionResult } from './animation-property-extractor.js';
import { capturePseudoStates, type PseudoStateSnapshot } from './pseudo-state-capture.js';

/**
 * Below this, a delta is measurement noise, not motion.
 *
 * Not a guess: the real page reports transforms like
 * `matrix(0.999915, 0, 0, 0.999915, 0, 0)` on nodes that are visually static,
 * and one image (`framer-tw203r`) whose entire scale range across the sweep is
 * 0.0021. Without a threshold that image is a false positive; with it the eight
 * measured image-scale nodes reduce to the seven that actually zoom.
 */
export const MOTION_EPSILON = 0.005;

/** Pixel threshold for translate deltas. Sub-pixel drift is not motion. */
export const TRANSLATE_EPSILON_PX = 1;

/** Degree threshold for rotation deltas. */
export const ROTATE_EPSILON_DEG = 0.5;

/**
 * Width used for a breakpoint band that only declares `max-width`.
 *
 * A `(max-width: 809.98px)` query states an upper bound and nothing else, so
 * any capture width inside the band is a convention rather than a measurement.
 * Probing at this width is recorded as a warning so the report never presents
 * it as sourced data.
 */
export const MAX_WIDTH_BAND_PROBE_WIDTH = 390;

/** One decomposed 2D transform. */
export interface TransformParts {
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
  rotateDeg: number;
}

/** The identity transform, i.e. what `transform: none` resolves to. */
export const IDENTITY_TRANSFORM: TransformParts = {
  scaleX: 1,
  scaleY: 1,
  translateX: 0,
  translateY: 0,
  rotateDeg: 0,
};

/** One sampled visual state of one element at one scroll position. */
export interface MotionSample {
  opacity: number;
  transform: TransformParts | null;
  position: string;
  clipPath: string;
  filter: string;
}

export type MotionEffectKind =
  | 'opacity'
  | 'translateX'
  | 'translateY'
  | 'scale'
  | 'rotate';

/** A single measured property change, with its observed range. */
export interface MotionEffect {
  kind: MotionEffectKind;
  from: number;
  to: number;
  /** Largest observed span across the whole sweep. */
  range: number;
  /** True when every step moved the same direction (no reversal). */
  monotonic: boolean;
}

/**
 * How an element's motion behaves, derived from the sweep — not from a name.
 *
 * `entrance` — the element fades in from (near) transparent and stays visible.
 *   A one-shot reveal. This is the class Elementor covers with entrance
 *   animations.
 * `scroll-linked` — opacity stays constant while a transform tracks the scroll
 *   position. This is the class Elementor covers with scroll motion effects, or
 *   that needs a scroll library.
 * `indeterminate` — something changed but not enough to classify. Reported, not
 *   guessed at.
 */
export type MotionKind = 'entrance' | 'scroll-linked' | 'indeterminate';

export interface MotionClassification {
  kind: MotionKind;
  effects: MotionEffect[];
  /** Why this classification — carried verbatim into the report. */
  reason: string;
}

/** One element that measurably changed across the sweep. */
export interface MotionObservation extends MotionClassification {
  /** Sweep-local key: `<index>:<framerName|tag>:<firstClass>`. */
  key: string;
  framerName?: string;
  tag: string;
  /** Best-effort selector. Prefers the stable Framer name over a hashed class. */
  selector: string;
  /**
   * `data-framer-name` of the nearest enclosing `<section>`, when there is one.
   *
   * This is the field that makes a merge with a structural layer tree possible
   * at all. Measured on the real page: only 19 of 31 moving elements carry a
   * Framer name, and the names that exist repeat hard — `Image` 27 times, `Top`
   * 25, `Default` 53. A name alone therefore identifies nothing. Scoped to its
   * section it becomes a usable key, and where it still is not unique the
   * ordinal below says so instead of pretending.
   */
  sectionName?: string;
  /**
   * How many earlier elements in the same section share this element's
   * `framerName`. Zero for the first. Together with `sectionName` and
   * `framerName` this is the strongest identity the DOM offers for a node that
   * has no id.
   */
  ordinalInSection: number;
  /** Depth below the enclosing section. 0 when the element IS the section. */
  depthInSection: number;
}

/**
 * A `position: sticky` element. A native Elementor `sticky` candidate.
 *
 * Carries the same section scoping as a `MotionObservation` because it faces the
 * identical problem: `data-framer-name` repeats hard across a page (measured:
 * `Container` appears many times), so a name alone cannot address a node in a
 * structural tree. Without the section and ordinal a merge can only report that
 * something was sticky, not which element — and Elementor's `sticky` control has
 * to be written onto one specific element.
 */
export interface StickyObservation {
  framerName?: string;
  selector: string;
  /** Computed `top`. `auto` when the element sticks by its bottom edge. */
  top: string;
  /** Computed `bottom`, needed to tell a bottom-sticky element from a top one. */
  bottom: string;
  heightPx: number;
  /** `data-framer-name` of the nearest enclosing `<section>`, when there is one. */
  sectionName?: string;
  /** How many earlier sticky-or-not elements in that section share this name. */
  ordinalInSection: number;
}

/** The Framer declarative appear payload, when present. */
export interface AppearPayloadEvidence {
  /** Raw `__framer__appearAnimationsContent` text, unparsed. */
  raw?: string;
  /** Elements carrying `data-framer-appear-id`. */
  targets: Array<{ appearId: string; tag: string; framerName?: string; classes: string }>;
}

export interface MotionEvidence {
  url: string;
  probedAt: string;
  documentHeightPx: number;
  /** Scroll fractions actually sampled. */
  stops: number[];
  /** Viewports derived from the source's own breakpoints. */
  viewports: ViewportConfig[];
  observations: MotionObservation[];
  sticky: StickyObservation[];
  appear: AppearPayloadEvidence;
  /** Output of the previously unwired `keyframes-discovery` module. */
  cssAnimations: AnimationDiscovery;
  /** Output of the previously unwired `animation-property-extractor` module. */
  animationProperties: AnimationExtractionResult;
  /** Output of the previously unwired `pseudo-state-capture` module. */
  pseudoStates: PseudoStateSnapshot[];
  /** Nodes that changed but could not be classified, plus source caveats. */
  warnings: string[];
}

export interface ProbeMotionEvidenceOptions {
  /** Scroll fractions of document height to sample. Default 7 evenly spread. */
  stops?: readonly number[];
  /** Settle time after each scroll, in ms. Default 1200. */
  settleMs?: number;
  /** Max elements to sample per stop. Default 1200. */
  maxNodes?: number;
  /** CSS bodies intercepted before navigation, for cross-origin @keyframes. */
  crossOriginCss?: CrossOriginStylesheet[];
  /** Skip the three per-node style walks (they are the expensive part). */
  skipStaticStyleWalks?: boolean;
}

/**
 * Default sweep. Seven stops is what the original measurement used and what the
 * frozen fixture contains; it resolved every effect on the real page.
 */
export const DEFAULT_MOTION_STOPS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9] as const;

/** The packed sample format used on the wire and in the frozen fixture. */
const PACKED_FIELD_COUNT = 5;

/**
 * Parse the packed `opacity|transform|position|clipPath|filter` sample string.
 *
 * The packed form exists because the sweep serialises one string per element
 * per stop; sending five objects per element per stop across the CDP boundary
 * is a large multiple of the payload for no gain. Exported so the frozen
 * fixture — real measured data — can drive the classification tests.
 */
export function parsePackedSample(packed: string | null | undefined): MotionSample | null {
  if (typeof packed !== 'string' || packed.length === 0) return null;
  const parts = packed.split('|');
  if (parts.length < PACKED_FIELD_COUNT) return null;
  const opacity = Number(parts[0]);
  if (!Number.isFinite(opacity)) return null;
  return {
    opacity,
    transform: decomposeTransform(parts[1]),
    position: parts[2],
    clipPath: parts[3],
    filter: parts[4],
  };
}

/**
 * Decompose a computed `transform` value into scale / translate / rotation.
 *
 * Returns `null` for a value that cannot be decomposed (for example a
 * `matrix3d` with perspective), so the caller can report it instead of
 * silently treating it as identity. `none` is the identity transform, which is
 * a known value — not an unknown one.
 */
export function decomposeTransform(value: string | undefined): TransformParts | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'none') return { ...IDENTITY_TRANSFORM };

  const matrix2d = /^matrix\(([^)]+)\)$/.exec(trimmed);
  if (matrix2d) {
    const n = matrix2d[1].split(',').map((part) => Number(part.trim()));
    if (n.length !== 6 || n.some((value_) => !Number.isFinite(value_))) return null;
    return fromMatrix2d(n[0], n[1], n[2], n[3], n[4], n[5]);
  }

  const matrix3d = /^matrix3d\(([^)]+)\)$/.exec(trimmed);
  if (matrix3d) {
    const n = matrix3d[1].split(',').map((part) => Number(part.trim()));
    if (n.length !== 16 || n.some((value_) => !Number.isFinite(value_))) return null;
    // Only a matrix3d that is a plain 2D transform lifted into 4x4 can be
    // decomposed here. Anything with real depth (perspective, Z translation,
    // X/Y rotation) is reported as undecomposable rather than flattened.
    const hasDepth =
      Math.abs(n[2]) > MOTION_EPSILON || Math.abs(n[6]) > MOTION_EPSILON ||
      Math.abs(n[8]) > MOTION_EPSILON || Math.abs(n[9]) > MOTION_EPSILON ||
      Math.abs(n[10] - 1) > MOTION_EPSILON || Math.abs(n[14]) > TRANSLATE_EPSILON_PX ||
      Math.abs(n[3]) > MOTION_EPSILON || Math.abs(n[7]) > MOTION_EPSILON || Math.abs(n[11]) > MOTION_EPSILON;
    if (hasDepth) return null;
    return fromMatrix2d(n[0], n[1], n[4], n[5], n[12], n[13]);
  }

  return null;
}

function fromMatrix2d(a: number, b: number, c: number, d: number, e: number, f: number): TransformParts {
  return {
    scaleX: Math.hypot(a, b),
    scaleY: Math.hypot(c, d),
    translateX: e,
    translateY: f,
    rotateDeg: (Math.atan2(b, a) * 180) / Math.PI,
  };
}

/**
 * Classify one element's motion from its sampled series.
 *
 * The decisive signal is opacity, and it is measured, not assumed:
 *
 *   - Opacity rising from near-zero to ~1 and staying there is a reveal. Every
 *     such element on the real page also carried a transform that resolved to
 *     identity and stayed there — a one-shot entrance, not a scrub.
 *   - Opacity constant while a transform keeps moving with the scroll position
 *     is scroll-linked. On the real page these were image zooms, ±8° card
 *     rotations, a 2950px horizontal run and two 365px card stacks.
 *
 * Monotonicity alone cannot separate the two: the horizontal run is perfectly
 * monotonic (1900px → −1050px) and is still a scrub, while the image zooms
 * oscillate. Opacity separates them cleanly.
 */
export function classifyMotionSeries(series: readonly (MotionSample | null)[]): MotionClassification {
  const samples = series.filter((sample): sample is MotionSample => sample !== null);
  if (samples.length < 2) {
    return { kind: 'indeterminate', effects: [], reason: 'fewer than two usable samples' };
  }

  const undecomposable = samples.filter((sample) => sample.transform === null).length;
  const transforms = samples
    .map((sample) => sample.transform)
    .filter((transform): transform is TransformParts => transform !== null);

  const effects: MotionEffect[] = [];

  const opacities = samples.map((sample) => sample.opacity);
  const opacityEffect = buildEffect('opacity', opacities, MOTION_EPSILON);
  if (opacityEffect) effects.push(opacityEffect);

  if (transforms.length >= 2) {
    const scales = transforms.map((t) => (t.scaleX + t.scaleY) / 2);
    const scaleEffect = buildEffect('scale', scales, MOTION_EPSILON);
    if (scaleEffect) effects.push(scaleEffect);

    const translateXEffect = buildEffect('translateX', transforms.map((t) => t.translateX), TRANSLATE_EPSILON_PX);
    if (translateXEffect) effects.push(translateXEffect);

    const translateYEffect = buildEffect('translateY', transforms.map((t) => t.translateY), TRANSLATE_EPSILON_PX);
    if (translateYEffect) effects.push(translateYEffect);

    const rotateEffect = buildEffect('rotate', transforms.map((t) => t.rotateDeg), ROTATE_EPSILON_DEG);
    if (rotateEffect) effects.push(rotateEffect);
  }

  if (effects.length === 0) {
    const reason = undecomposable > 0
      ? `all deltas below threshold; ${undecomposable} sample(s) had an undecomposable transform`
      : 'all deltas below threshold (measurement noise, not motion)';
    return { kind: 'indeterminate', effects: [], reason };
  }

  const opacity = effects.find((effect) => effect.kind === 'opacity');
  const first = opacities[0];
  const last = opacities[opacities.length - 1];

  if (opacity && first < 0.5 && last > 0.9 && opacity.monotonic) {
    const transformNames = effects.filter((effect) => effect.kind !== 'opacity').map((effect) => effect.kind);
    const detail = transformNames.length > 0 ? ` with ${transformNames.join(' + ')}` : ' with no transform';
    return {
      kind: 'entrance',
      effects,
      reason: `opacity rose ${first.toFixed(3)} → ${last.toFixed(3)} and stayed${detail}`,
    };
  }

  const transformEffects = effects.filter((effect) => effect.kind !== 'opacity');
  if (!opacity && transformEffects.length > 0) {
    const detail = transformEffects
      .map((effect) => `${effect.kind} range ${effect.range.toFixed(3)}`)
      .join(', ');
    return {
      kind: 'scroll-linked',
      effects,
      reason: `opacity constant at ${first.toFixed(3)} while ${detail}`,
    };
  }

  return {
    kind: 'indeterminate',
    effects,
    reason: opacity
      ? `opacity moved ${first.toFixed(3)} → ${last.toFixed(3)} without settling visible; not a clean reveal or scrub`
      : 'changed without a classifiable signature',
  };
}

function buildEffect(kind: MotionEffectKind, values: readonly number[], epsilon: number): MotionEffect | null {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range < epsilon) return null;
  return {
    kind,
    from: values[0],
    to: values[values.length - 1],
    range,
    monotonic: isMonotonic(values, epsilon),
  };
}

function isMonotonic(values: readonly number[], epsilon: number): boolean {
  let direction = 0;
  for (let index = 1; index < values.length; index++) {
    const delta = values[index] - values[index - 1];
    if (Math.abs(delta) < epsilon) continue;
    const step = delta > 0 ? 1 : -1;
    if (direction === 0) direction = step;
    else if (step !== direction) return false;
  }
  return true;
}

/**
 * Derive capture viewports from a source's own breakpoint payload.
 *
 * The repo default (1440 / 768 / 390) is wrong for any project whose bands do
 * not happen to match it. The real Humeen payload declares 1200 / 810 / and a
 * max-width band — probing at 768px lands on the wrong side of the 810px
 * boundary, so the tablet capture tests a layout the site never shows there.
 *
 * A `max-width`-only band has no width in the payload at all; a probe width is
 * chosen by convention and the caller is told so through `warnings`.
 */
export function deriveViewportsFromBreakpoints(
  raw: string | null | undefined,
): { viewports: ViewportConfig[]; warnings: string[] } {
  const warnings: string[] = [];
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { viewports: [], warnings: ['no breakpoint payload found; viewports not derived from the source'] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { viewports: [], warnings: ['breakpoint payload is not valid JSON; viewports not derived from the source'] };
  }
  if (!Array.isArray(parsed)) {
    return { viewports: [], warnings: ['breakpoint payload is not an array; viewports not derived from the source'] };
  }

  const widths = new Set<number>();
  let usedConvention = false;
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const mediaQuery = (entry as { mediaQuery?: unknown }).mediaQuery;
    if (typeof mediaQuery !== 'string') continue;

    const minWidth = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(mediaQuery);
    if (minWidth) {
      widths.add(Math.round(Number(minWidth[1])));
      continue;
    }
    const maxWidth = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(mediaQuery);
    if (maxWidth) {
      widths.add(MAX_WIDTH_BAND_PROBE_WIDTH);
      usedConvention = true;
    }
  }

  if (widths.size === 0) {
    return { viewports: [], warnings: ['no widths could be read from the breakpoint payload'] };
  }
  if (usedConvention) {
    warnings.push(
      `a max-width-only breakpoint band declares no width; probing it at ${MAX_WIDTH_BAND_PROBE_WIDTH}px by convention`,
    );
  }

  const sorted = [...widths].sort((a, b) => b - a);
  const CONVENTIONAL_LABELS = ['desktop', 'tablet', 'mobile'];
  const viewports = sorted.map((width, index) => ({
    label: index < CONVENTIONAL_LABELS.length ? CONVENTIONAL_LABELS[index] : `bp-${width}`,
    width,
    height: conventionalViewportHeight(width),
  }));
  return { viewports, warnings };
}

/**
 * Sweep the live page and return everything measurable about its motion.
 *
 * This is also the module that finally calls `discoverAnimations`,
 * `extractAnimationProperties` and `capturePseudoStates`. All three shipped
 * complete, were exported, and had zero callers anywhere in the repo — their
 * output was never reaching a report.
 */
export async function probeMotionEvidence(
  page: Page,
  options: ProbeMotionEvidenceOptions = {},
): Promise<MotionEvidence> {
  const stops = [...(options.stops ?? DEFAULT_MOTION_STOPS)];
  const settleMs = options.settleMs ?? 1200;
  const maxNodes = options.maxNodes ?? 1200;
  const warnings: string[] = [];

  const documentHeightPx = await page.evaluate(() => document.body.scrollHeight);

  const appearRaw = await page.evaluate(() => {
    const readScript = (id: string): string | null => document.getElementById(id)?.textContent ?? null;
    return {
      appearAnimations: readScript('__framer__appearAnimationsContent'),
      breakpoints: readScript('__framer__breakpoints'),
      targets: Array.from(document.querySelectorAll('[data-framer-appear-id]')).map((element) => ({
        appearId: element.getAttribute('data-framer-appear-id') ?? '',
        tag: element.tagName.toLowerCase(),
        framerName: element.getAttribute('data-framer-name') ?? undefined,
        classes: typeof element.className === 'string' ? element.className : '',
      })),
    };
  });

  const derived = deriveViewportsFromBreakpoints(appearRaw.breakpoints);
  warnings.push(...derived.warnings);

  // The sweep: one packed sample per candidate element per stop.
  const snapshots: Array<Record<string, string>> = [];
  for (const stop of stops) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round(documentHeightPx * stop));
    await page.waitForTimeout(settleMs);
    snapshots.push(await samplePackedStyles(page, maxNodes));
  }

  const meta = await collectNodeMeta(page, maxNodes);
  const stickyPositions = await collectStickyPositions(page, maxNodes);

  const keys = new Set(snapshots.flatMap((snapshot) => Object.keys(snapshot)));
  const observations: MotionObservation[] = [];
  for (const key of keys) {
    const packedSeries = snapshots.map((snapshot) => snapshot[key] ?? null);
    const distinct = new Set(packedSeries.filter((value): value is string => value !== null));
    // Identical strings at every stop means nothing changed. Skipping these
    // before classification is what keeps the observation list to the elements
    // that actually moved (31 of ~800 on the real page).
    if (distinct.size < 2) continue;

    const classification = classifyMotionSeries(packedSeries.map(parsePackedSample));
    const nodeMeta = meta[key];
    observations.push({
      ...classification,
      key,
      framerName: nodeMeta?.framerName,
      tag: nodeMeta?.tag ?? 'unknown',
      selector: nodeMeta?.selector ?? key,
      sectionName: nodeMeta?.sectionName,
      ordinalInSection: nodeMeta?.ordinalInSection ?? 0,
      depthInSection: nodeMeta?.depthInSection ?? 0,
    });
    if (classification.kind === 'indeterminate') {
      warnings.push(`unclassified motion on ${nodeMeta?.selector ?? key}: ${classification.reason}`);
    }
  }

  // Sticky is collected through the same meta walk as the motion candidates so
  // both sides share one identity scheme (section + name + ordinal). Querying it
  // separately with `querySelectorAll('*')` produced a name and nothing to
  // resolve it against.
  const sticky: StickyObservation[] = [];
  for (const [key, nodeMeta] of Object.entries(meta)) {
    const position = stickyPositions[key];
    if (position === undefined) continue;
    sticky.push({
      framerName: nodeMeta.framerName,
      selector: nodeMeta.selector,
      top: position.top,
      bottom: position.bottom,
      heightPx: position.heightPx,
      sectionName: nodeMeta.sectionName,
      ordinalInSection: nodeMeta.ordinalInSection,
    });
  }

  const runStaticWalks = options.skipStaticStyleWalks !== true;
  const cssAnimations = runStaticWalks
    ? await discoverAnimations(page, options.crossOriginCss ?? [])
    : emptyAnimationDiscovery();
  const animationProperties = runStaticWalks
    ? await extractAnimationProperties(page)
    : { elements: [], referencedKeyframes: [], distinctTransitionProperties: [] };
  const pseudoStates = runStaticWalks ? await capturePseudoStates(page) : [];

  if (appearRaw.targets.length === 0) {
    warnings.push('no [data-framer-appear-id] elements found; the declarative appear payload covers no node on this page');
  }
  if (observations.length === 0) {
    warnings.push('the scroll sweep found no style deltas; either the page has no scroll motion or it did not settle');
  }

  return {
    url: page.url(),
    probedAt: new Date().toISOString(),
    documentHeightPx,
    stops,
    viewports: derived.viewports,
    observations,
    sticky,
    appear: {
      raw: appearRaw.appearAnimations ?? undefined,
      targets: appearRaw.targets.filter((target) => target.appearId !== ''),
    },
    cssAnimations,
    animationProperties,
    pseudoStates,
    warnings,
  };
}

function emptyAnimationDiscovery(): AnimationDiscovery {
  return {
    keyframes: [],
    same_origin_count: 0,
    cross_origin_count: 0,
    transitions: [],
    gsap: { hasGSAP: false, hasScrollTrigger: false },
  };
}

/** Candidate selector for the sweep. Framer names or hashes every own node. */
const MOTION_CANDIDATE_SELECTOR = '[data-framer-name], [class*="framer-"]';

async function samplePackedStyles(page: Page, maxNodes: number): Promise<Record<string, string>> {
  return page.evaluate(
    ({ selector, limit }) => {
      const out: Record<string, string> = {};
      const elements = Array.from(document.querySelectorAll(selector)).slice(0, limit);
      elements.forEach((element, index) => {
        const style = window.getComputedStyle(element);
        const firstClass = typeof element.className === 'string' ? element.className.split(' ')[0] : '';
        const name = element.getAttribute('data-framer-name') ?? element.tagName.toLowerCase();
        out[`${index}:${name}:${firstClass}`] =
          [style.opacity, style.transform, style.position, style.clipPath, style.filter].join('|');
      });
      return out;
    },
    { selector: MOTION_CANDIDATE_SELECTOR, limit: maxNodes },
  );
}

interface StickyPosition {
  top: string;
  bottom: string;
  heightPx: number;
}

/**
 * Sticky offsets, keyed identically to `collectNodeMeta`.
 *
 * Uses the same selector and the same index-based key so a position can be
 * joined onto its node metadata. Both walks run over `MOTION_CANDIDATE_SELECTOR`
 * in document order, which is what makes the index a valid join key.
 */
async function collectStickyPositions(
  page: Page,
  maxNodes: number,
): Promise<Record<string, StickyPosition>> {
  return page.evaluate(
    ({ selector, limit }) => {
      const out: Record<string, StickyPosition> = {};
      const elements = Array.from(document.querySelectorAll(selector)).slice(0, limit);
      elements.forEach((element, index) => {
        const style = window.getComputedStyle(element);
        if (style.position !== 'sticky') return;
        const framerName = element.getAttribute('data-framer-name') ?? undefined;
        const firstClass = typeof element.className === 'string' ? element.className.split(' ')[0] : '';
        const key = `${index}:${framerName ?? element.tagName.toLowerCase()}:${firstClass}`;
        out[key] = {
          top: style.top,
          bottom: style.bottom,
          heightPx: Math.round(element.getBoundingClientRect().height),
        };
      });
      return out;
    },
    { selector: MOTION_CANDIDATE_SELECTOR, limit: maxNodes },
  );
}

interface NodeMeta {
  tag: string;
  framerName?: string;
  selector: string;
  sectionName?: string;
  ordinalInSection: number;
  depthInSection: number;
}

async function collectNodeMeta(page: Page, maxNodes: number): Promise<Record<string, NodeMeta>> {
  return page.evaluate(
    ({ selector, limit }) => {
      const out: Record<string, NodeMeta> = {};
      const elements = Array.from(document.querySelectorAll(selector)).slice(0, limit);

      // Per-section tally of how often each Framer name has already been seen.
      // Framer reuses names heavily (measured: `Default` 53x, `Image` 27x on one
      // page), so a name is only an identity together with its section and its
      // position within that section.
      const ordinalBySection = new Map<string, Map<string, number>>();

      elements.forEach((element, index) => {
        const tag = element.tagName.toLowerCase();
        const framerName = element.getAttribute('data-framer-name') ?? undefined;
        const firstClass = typeof element.className === 'string' ? element.className.split(' ')[0] : '';
        const key = `${index}:${framerName ?? tag}:${firstClass}`;

        let sectionName: string | undefined;
        let depthInSection = 0;
        let cursor: Element | null = element;
        while (cursor !== null) {
          if (cursor.tagName.toLowerCase() === 'section') {
            sectionName = cursor.getAttribute('data-framer-name') ?? undefined;
            break;
          }
          cursor = cursor.parentElement;
          depthInSection++;
        }
        if (cursor === null) depthInSection = -1;

        const sectionKey = sectionName ?? '(no-section)';
        let names = ordinalBySection.get(sectionKey);
        if (!names) {
          names = new Map<string, number>();
          ordinalBySection.set(sectionKey, names);
        }
        const nameKey = framerName ?? `<${tag}>`;
        const ordinalInSection = names.get(nameKey) ?? 0;
        names.set(nameKey, ordinalInSection + 1);

        out[key] = {
          tag,
          framerName,
          // The hashed class changes on every republish; the Framer name does not.
          selector: framerName
            ? `${tag}[data-framer-name="${framerName}"]`
            : firstClass
              ? `${tag}.${firstClass}`
              : tag,
          sectionName,
          ordinalInSection,
          depthInSection: depthInSection < 0 ? 0 : depthInSection,
        };
      });
      return out;
    },
    { selector: MOTION_CANDIDATE_SELECTOR, limit: maxNodes },
  );
}

/** Counts per classification, for the report and for guard comparison. */
export function summariseMotionEvidence(evidence: MotionEvidence): {
  entrance: number;
  scrollLinked: number;
  indeterminate: number;
  sticky: number;
  byEffect: Record<MotionEffectKind, number>;
} {
  const byEffect: Record<MotionEffectKind, number> = {
    opacity: 0,
    translateX: 0,
    translateY: 0,
    scale: 0,
    rotate: 0,
  };
  let entrance = 0;
  let scrollLinked = 0;
  let indeterminate = 0;
  for (const observation of evidence.observations) {
    if (observation.kind === 'entrance') entrance++;
    else if (observation.kind === 'scroll-linked') scrollLinked++;
    else indeterminate++;
    for (const effect of observation.effects) byEffect[effect.kind]++;
  }
  return { entrance, scrollLinked, indeterminate, sticky: evidence.sticky.length, byEffect };
}
