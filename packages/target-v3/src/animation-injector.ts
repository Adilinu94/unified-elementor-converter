/**
 * Phase 7 — Animation Injector.
 *
 * Transforms an `AnimationInfo` extraction (keyframes, transitions,
 * GSAP/Lenis detection) into WPCode-snippet specs that are persisted
 * to disk and can be pushed to a WordPress target via the
 * WPCode adapter.
 *
 * Spec: BAUPLAN-SITE-CLONE-TO-V3.md §Phase 7
 *
 * Outputs (per source URL):
 *   1. CSS-Keyframe bundle: one WPCode snippet with all unique
 *      @keyframes rules + a tiny utility-class block that maps
 *      `section-<section_id>` selectors to them.
 *   2. CSS-Transition bundle: one WPCode snippet per detected
 *      `transition` property on a non-default selector.
 *   3. GSAP bundle: one WPCode snippet that loads GSAP + ScrollTrigger
 *      from the official CDN and applies a per-section `gsap.from()`
 *      call (if `animations.has_gsap` is true).
 *   4. Lenis bundle: one WPCode snippet that wires up Lenis
 *      smooth-scroll (if `animations.has_lenis` is true).
 *
 * Linking strategy (per Plan §Phase 7, Task 6):
 *   - V3 section elements get a class `section-<section_id>`
 *   - WPCode snippets target `.section-<section_id>` selectors
 *   - Works without touching V3 element settings.
 *
 * The function `buildAnimationPlan()` is pure (no I/O) so it is
 * fully unit-testable. The function `writeAnimationPlan()` persists
 * the plan to disk for later sync via the WPCode adapter.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SectionInfo } from '@elconv/core';

/**
 * Structural subset of the extractors `AnimationInfo` (kept local so
 * target-v3 does not need a package dependency on @elconv/extractors;
 * callers can pass the extractors type directly thanks to structural typing).
 */
export interface AnimationTransitionInfo {
  selector: string;
  property: string;
  duration: string;
  easing: string;
  delay: string;
}

export interface AnimationInfo {
  has_keyframes: boolean;
  keyframe_names: string[];
  has_gsap: boolean;
  has_scrolltrigger: boolean;
  has_framer_motion: boolean;
  has_lenis: boolean;
  /** CSS transitions used in the DOM. */
  transitions?: AnimationTransitionInfo[];
  same_origin_keyframe_count?: number;
  cross_origin_keyframe_count?: number;
}

export type AnimationSnippetType = 'css' | 'js' | 'html';

export interface AnimationSnippet {
  /** Stable identifier (used in tests + manifest). */
  id: string;
  /** WPCode title (visible in WP-Admin). */
  title: string;
  type: AnimationSnippetType;
  /** WPCode location. CSS/JS-animation goes in the footer by default. */
  location: 'site-wide-footer' | 'site-wide-header' | 'frontend-only';
  /** The actual code string. */
  code: string;
  /** Optional priority (lower = earlier). */
  priority: number;
  /** Source provenance (for diagnostics + reverting). */
  source:
    | { kind: 'keyframes'; names: string[] }
    | { kind: 'transitions'; selectors: string[] }
    | { kind: 'gsap-bundle' }
    | { kind: 'gsap-trigger' }
    | { kind: 'lenis-bundle' };
}

export interface AnimationPlan {
  url: string;
  generatedAt: string;
  snippets: AnimationSnippet[];
  /** Section IDs that the snippets target. */
  sectionTargets: string[];
  /** No-op flags for downstream stages. */
  hasAnimations: boolean;
}

export interface BuildAnimationPlanInput {
  url: string;
  animations: AnimationInfo;
  sections: SectionInfo[];
  /** Optional override: only include snippets that target these section_ids. */
  includeSectionIds?: string[];
}

const GSAP_CDN = 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js';
const SCROLLTRIGGER_CDN =
  'https://cdn.jsdelivr.net/npm/gsap@3.12.5/ScrollTrigger.min.js';
const LENIS_CDN = 'https://cdn.jsdelivr.net/npm/lenis@1.1.13/dist/lenis.min.js';

/** Build a V3-element-linkable class name from a section_id. */
export function sectionClassName(sectionId: string | undefined | null): string {
  const cleaned = (sectionId ?? 'unnamed').replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  return `section-${cleaned}`;
}

/**
 * Build the CSS-Keyframe bundle snippet.
 *
 * Strategy: emit a single WPCode CSS snippet that contains all unique
 * keyframe rules and a default utility block applying them with a
 * fade-in-up pattern. The user can later customize this in the
 * WP-Admin (or by overriding `sectionClassName`-specific rules in
 * `custom_css`).
 */
function buildKeyframeSnippet(
  animations: AnimationInfo,
  sections: SectionInfo[],
): AnimationSnippet | null {
  const names = Array.from(new Set(animations.keyframe_names ?? []));
  if (names.length === 0) return null;

  const rules: string[] = [];
  rules.push('/* Phase 7 — Keyframe bundle (auto-generated) */');

  // Re-emit each @keyframes definition as a stub. The real CSS body
  // is in the source page; the user can paste the original here or
  // rely on the existing keyframes if the source CSS is also linked.
  for (const name of names) {
    rules.push(`@keyframes ${name} { from { opacity: 0; } to { opacity: 1; } }`);
  }

  // Per-section utility: bind the first keyframe to each section.
  for (const sec of sections) {
    const cls = sectionClassName(sec.section_id);
    if (names.length === 0) break;
    const first = names[0];
    rules.push(`.${cls} { animation: ${first} 0.6s ease-out both; }`);
  }

  return {
    id: 'keyframes-bundle',
    title: 'Clone-V3: Keyframe bundle',
    type: 'css',
    location: 'site-wide-header',
    priority: 5,
    code: rules.join('\n'),
    source: { kind: 'keyframes', names },
  };
}

/**
 * Build per-section transition snippets.
 *
 * Each transition the source uses (non-default) becomes a small CSS
 * rule that re-applies the transition to the cloned V3 section.
 */
function buildTransitionSnippet(
  animations: AnimationInfo,
  sections: SectionInfo[],
): AnimationSnippet | null {
  const transitions = animations.transitions ?? [];
  if (transitions.length === 0) return null;

  const sectionSelectors = new Set(sections.map((s) => sectionClassName(s.section_id)));
  const lines: string[] = ['/* Phase 7 — Transition bundle (auto-generated) */'];

  for (const t of transitions.slice(0, 50)) {
    // Map source selector → V3 section class where possible.
    const matchedSection = sections.find(
      (s) => t.selector === s.selector || t.selector.startsWith(`${s.selector} >`),
    );
    if (matchedSection) {
      const cls = sectionClassName(matchedSection.section_id);
      lines.push(`.${cls} { transition: ${t.property} ${t.duration} ${t.easing} ${t.delay}; }`);
    } else {
      // Generic: scope to first known section to avoid bleed.
      const firstCls = sectionSelectors.values().next().value;
      if (firstCls) {
        lines.push(`.${firstCls} ${t.selector} { transition: ${t.property} ${t.duration} ${t.easing} ${t.delay}; }`);
      }
    }
  }

  if (lines.length === 1) return null;

  return {
    id: 'transitions-bundle',
    title: 'Clone-V3: Transition bundle',
    type: 'css',
    location: 'site-wide-header',
    priority: 6,
    code: lines.join('\n'),
    source: { kind: 'transitions', selectors: transitions.map((t) => t.selector) },
  };
}

/**
 * Build the GSAP loader snippet (loads GSAP + ScrollTrigger from CDN).
 */
function buildGsapLoaderSnippet(): AnimationSnippet {
  const code = [
    '(function () {',
    '  if (typeof window.gsap !== "undefined") return;',
    `  var gsapScript = document.createElement("script");`,
    `  gsapScript.src = ${JSON.stringify(GSAP_CDN)};`,
    '  gsapScript.async = true;',
    '  gsapScript.onload = function () {',
    `    var stScript = document.createElement("script");`,
    `    stScript.src = ${JSON.stringify(SCROLLTRIGGER_CDN)};`,
    '    stScript.async = true;',
    '    document.head.appendChild(stScript);',
    '  };',
    '  document.head.appendChild(gsapScript);',
    '})();',
  ].join('\n');

  return {
    id: 'gsap-loader',
    title: 'Clone-V3: GSAP bundle loader',
    type: 'js',
    location: 'site-wide-footer',
    priority: 7,
    code,
    source: { kind: 'gsap-bundle' },
  };
}

/**
 * Build a per-section GSAP trigger snippet (gentle fade-in-up).
 */
function buildGsapTriggerSnippet(sections: SectionInfo[]): AnimationSnippet {
  const sectionSelectors = sections.map((s) => sectionClassName(s.section_id));
  const selectorList = sectionSelectors.map((s) => `.${s}`).join(', ');

  const code = [
    '(function () {',
    '  function initGsap() {',
    '    if (typeof window.gsap === "undefined") return false;',
    `    var targets = document.querySelectorAll(${JSON.stringify(selectorList)});`,
    '    if (targets.length === 0) return true;',
    '    window.gsap.from(targets, {',
    '      y: 60,',
    '      opacity: 0,',
    '      duration: 0.6,',
    '      ease: "power2.out",',
    '      stagger: 0.1',
    '    });',
    '    if (typeof window.ScrollTrigger !== "undefined") {',
    '      window.gsap.registerPlugin(window.ScrollTrigger);',
    '    }',
    '    return true;',
    '  }',
    '  if (!initGsap()) {',
    '    var tries = 0;',
    '    var iv = setInterval(function () {',
    '      tries += 1;',
    '      if (initGsap() || tries > 50) clearInterval(iv);',
    '    }, 200);',
    '  }',
    '})();',
  ].join('\n');

  return {
    id: 'gsap-trigger',
    title: 'Clone-V3: GSAP section triggers',
    type: 'js',
    location: 'site-wide-footer',
    priority: 8,
    code,
    source: { kind: 'gsap-trigger' },
  };
}

/**
 * Build the Lenis smooth-scroll snippet.
 */
function buildLenisSnippet(): AnimationSnippet {
  const code = [
    '(function () {',
    '  if (typeof window.Lenis !== "undefined") return;',
    `  var s = document.createElement("script");`,
    `  s.src = ${JSON.stringify(LENIS_CDN)};`,
    '  s.async = true;',
    '  s.onload = function () {',
    '    if (typeof window.Lenis !== "function") return;',
    '    var lenis = new window.Lenis();',
    '    function raf(time) {',
    '      lenis.raf(time);',
    '      requestAnimationFrame(raf);',
    '    }',
    '    requestAnimationFrame(raf);',
    '  };',
    '  document.head.appendChild(s);',
    '})();',
  ].join('\n');

  return {
    id: 'lenis-loader',
    title: 'Clone-V3: Lenis smooth scroll',
    type: 'js',
    location: 'site-wide-footer',
    priority: 9,
    code,
    source: { kind: 'lenis-bundle' },
  };
}

/**
 * Pure: build the animation plan from extraction + section info.
 *
 * Always returns a plan object; the `snippets` array may be empty if
 * no animation features were detected.
 */
export function buildAnimationPlan(input: BuildAnimationPlanInput): AnimationPlan {
  const animations = input.animations;
  const allSections = input.sections ?? [];
  const sections = input.includeSectionIds
    ? allSections.filter((s) => input.includeSectionIds!.includes(s.section_id))
    : allSections;

  const snippets: AnimationSnippet[] = [];

  const keyframe = buildKeyframeSnippet(animations, sections);
  if (keyframe) snippets.push(keyframe);

  const transitions = buildTransitionSnippet(animations, sections);
  if (transitions) snippets.push(transitions);

  if (animations.has_gsap) {
    snippets.push(buildGsapLoaderSnippet());
    if (sections.length > 0) {
      snippets.push(buildGsapTriggerSnippet(sections));
    }
  }

  if (animations.has_lenis) {
    snippets.push(buildLenisSnippet());
  }

  return {
    url: input.url,
    generatedAt: new Date().toISOString(),
    snippets,
    sectionTargets: sections.map((s) => s.section_id),
    hasAnimations: snippets.length > 0,
  };
}

/**
 * Persist the animation plan to disk as `animation-plan.json` and
 * `wpcode-snippets.json` (the latter is the manifest the WPCode
 * adapter consumes).
 */
export async function writeAnimationPlan(
  plan: AnimationPlan,
  outputDir: string,
): Promise<{ planPath: string; manifestPath: string }> {
  await fs.mkdir(outputDir, { recursive: true });
  const planPath = path.join(outputDir, 'animation-plan.json');
  const manifestPath = path.join(outputDir, 'wpcode-snippets.json');

  await fs.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8');
  await fs.writeFile(manifestPath, JSON.stringify(plan.snippets, null, 2), 'utf-8');

  return { planPath, manifestPath };
}
