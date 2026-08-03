/**
 * Build Options — canonical option contract for the V3/V4 build adapters
 * (O-04 parity preparation).
 *
 * The wizard collects a full option set (strictness, animations, fonts,
 * sections, viewports, …). Until now only `viewports` was actually forwarded
 * to an adapter. This module defines the options bag the build adapters
 * (`buildV3Tree` / `buildV4Tree`) and the URL pipeline accept, plus the pure
 * helpers that turn wizard choices into adapter behavior:
 *
 *  - `guardThresholdForStrictness()` — the validate phase runs tree guards
 *    against a strictness-dependent threshold (draft 70 / balanced 85 /
 *    pixel-perfect 95).
 *  - `matchesSectionSelector()` / `selectSpecSections()` — the `sections`
 *    option filters which sections a build emits, matching by section id,
 *    semantic role or CSS class (case-insensitive).
 *
 * `animations` and `fonts` are carried through the same bag: the URL pipeline
 * consumes them (animation plan stage, font download), while the html/xml
 * builder path records them for productive parity. Nothing here activates a
 * remote capability — this is pure, offline, deterministic data + logic.
 */

import type { SectionSpec, SourceSpec } from './types.js';

export type BuildStrictness = 'draft' | 'balanced' | 'pixel-perfect';
export type BuildAnimationStrategy = 'none' | 'css' | 'gsap' | 'auto';
export type BuildFontStrategy = 'auto' | 'system' | 'all';

export interface BuildOptions {
  strictness?: BuildStrictness;
  animations?: BuildAnimationStrategy;
  fonts?: BuildFontStrategy;
  /** Section selectors (id, semanticRole or cssClass); when given, only matching sections are built. */
  sections?: string[];
}

/**
 * Guard-score threshold for the validate phase per strictness. Values mirror
 * the QA strictness profiles' minMatchPercent (draft 70 / balanced 85 /
 * pixel-perfect 95) so a 'balanced' run behaves exactly like the historical
 * default threshold of 85.
 */
export function guardThresholdForStrictness(strictness?: BuildStrictness): number {
  switch (strictness) {
    case 'draft':
      return 70;
    case 'pixel-perfect':
      return 95;
    default:
      return 85;
  }
}

/** Minimal field set the section selector can match against. */
export interface SectionSelectorFields {
  id?: string;
  section_id?: string;
  semanticRole?: string;
  cssClass?: string;
  css_class?: string;
}

/**
 * True when a section matches any of the given selectors (case-insensitive
 * exact match on id, section_id, semanticRole, cssClass/css_class). With no
 * selectors — or only blank ones — every section matches.
 */
export function matchesSectionSelector(section: SectionSelectorFields, selectors?: string[]): boolean {
  const normalized = (selectors ?? [])
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (normalized.length === 0) return true;

  const fields = [
    section.id,
    section.section_id,
    section.semanticRole,
    section.cssClass,
    section.css_class,
  ].map((f) => (f ?? '').toLowerCase());

  return normalized.some((selector) => fields.includes(selector));
}

/**
 * Filter a SourceSpec's sections by the wizard's `sections` option. Returns
 * all sections when no selectors are given. Used by `buildV3Tree` and
 * `buildV4Tree` so a section-scoped wizard run builds exactly the chosen
 * sections.
 */
export function selectSpecSections(spec: SourceSpec, sections?: string[]): SectionSpec[] {
  return spec.sections.filter((section) => matchesSectionSelector(section, sections));
}
