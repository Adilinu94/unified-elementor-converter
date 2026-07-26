/**
 * Phase 4 (UMBAUPLAN §7.3.4): Animation-Property-Extractor.
 *
 * Captures the granular `animation-*` and `transition-*` properties that
 * drive V3's animation-injection pipeline. The existing `keyframes-discovery.ts`
 * already enumerates keyframe rules + transition-* usage; this module
 * complements it by reading the resolved animation/transition props off
 * each element so the spec knows exactly what to inject (and how long it
 * takes).
 */

import type { Page } from 'playwright';

/** Per-element animation props extracted from getComputedStyle. */
export interface AnimationProperties {
  selector: string;
  tag: string;
  animation: {
    name: string;
    duration: string;
    delay: string;
    iterationCount: string;
    direction: string;
    fillMode: string;
    timingFunction: string;
    playState: string;
  };
  transition: {
    property: string;
    duration: string;
    delay: string;
    timingFunction: string;
  };
}

/** Snapshot wrapper for the extractor output. */
export interface AnimationExtractionResult {
  /** All elements with at least one non-default animation or transition. */
  elements: AnimationProperties[];
  /** Distinct @keyframes names actually referenced (subset of computed values). */
  referencedKeyframes: string[];
  /** Distinct transition-property values across the DOM. */
  distinctTransitionProperties: string[];
}

function buildAnimationExtractScript(maxNodes: number, maxDepth: number): string {
  return `(function(){
    const maxN = ${maxNodes};
    const maxD = ${maxDepth};
    const out = [];
    const keyframes = new Set();
    const transProps = new Set();
    const root = document.body;
    if (!root) return { elements: [], referencedKeyframes: [], distinctTransitionProperties: [] };

    const buildSelector = (el, ancestors) => {
      const parts = [];
      const chain = ancestors.slice(-2).concat([el]);
      for (const node of chain) {
        const tag = node.tagName.toLowerCase();
        if (node.id) { parts.push('#' + node.id); continue; }
        const cls = (node.className && typeof node.className === 'string')
          ? node.className.split(/\\s+/).filter(Boolean)[0]
          : '';
        parts.push(cls ? tag + '.' + cls : tag);
      }
      return parts.join(' > ');
    };

    const readAnim = (cs) => ({
      name: cs.getPropertyValue('animation-name').trim(),
      duration: cs.getPropertyValue('animation-duration').trim(),
      delay: cs.getPropertyValue('animation-delay').trim(),
      iterationCount: cs.getPropertyValue('animation-iteration-count').trim(),
      direction: cs.getPropertyValue('animation-direction').trim(),
      fillMode: cs.getPropertyValue('animation-fill-mode').trim(),
      timingFunction: cs.getPropertyValue('animation-timing-function').trim(),
      playState: cs.getPropertyValue('animation-play-state').trim(),
    });
    const readTrans = (cs) => ({
      property: cs.getPropertyValue('transition-property').trim(),
      duration: cs.getPropertyValue('transition-duration').trim(),
      delay: cs.getPropertyValue('transition-delay').trim(),
      timingFunction: cs.getPropertyValue('transition-timing-function').trim(),
    });

    const isNonDefaultAnim = (a) => a.name && a.name !== 'none';
    const isNonDefaultTrans = (t) => t.property && t.property !== 'none' && t.property !== 'all';

    const walk = (el, depth, ancestors) => {
      if (out.length >= maxN) return;
      if (depth > maxD) return;
      const cs = window.getComputedStyle(el);
      const a = readAnim(cs);
      const t = readTrans(cs);
      if (isNonDefaultAnim(a) || isNonDefaultTrans(t)) {
        if (isNonDefaultAnim(a) && a.name !== 'none') {
          // animation-name can be a comma-separated list (multiple animations)
          for (const n of a.name.split(',').map((s) => s.trim()).filter(Boolean)) {
            keyframes.add(n);
          }
        }
        if (isNonDefaultTrans(t)) {
          for (const p of t.property.split(',').map((s) => s.trim()).filter(Boolean)) {
            transProps.add(p);
          }
        }
        out.push({
          selector: buildSelector(el, ancestors),
          tag: el.tagName.toLowerCase(),
          animation: a,
          transition: t,
        });
      }
      for (const child of Array.from(el.children)) walk(child, depth + 1, ancestors.concat([el]));
    };
    walk(root, 0, []);
    return {
      elements: out,
      referencedKeyframes: Array.from(keyframes).sort(),
      distinctTransitionProperties: Array.from(transProps).sort(),
    };
  })()`;
}

/**
 * Walk the DOM and capture per-element animation + transition properties
 * via getComputedStyle. Only elements with at least one non-default
 * animation or transition are included (the rest have `none`/`all 0s`
 * and are not useful for the spec).
 */
export async function extractAnimationProperties(
  page: Page,
  options: { maxNodes?: number; maxDepth?: number } = {},
): Promise<AnimationExtractionResult> {
  const maxNodes = options.maxNodes ?? 500;
  const maxDepth = options.maxDepth ?? 4;

  const raw = ((await page
    .evaluate(buildAnimationExtractScript(maxNodes, maxDepth))
    .catch(() => null)) ?? null) as AnimationExtractionResult | null;

  if (!raw) {
    return { elements: [], referencedKeyframes: [], distinctTransitionProperties: [] };
  }
  return {
    elements: raw.elements ?? [],
    referencedKeyframes: raw.referencedKeyframes ?? [],
    distinctTransitionProperties: raw.distinctTransitionProperties ?? [],
  };
}