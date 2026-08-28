/**
 * Hybrid merge — Arbeitspaket A4 (BAUPLAN v7.0 §3.4).
 *
 * The Unframer adapter knows the author's INTENT (layer tree, named text
 * styles, color style references, component identity) and has no geometry. The
 * live DOM knows the RESULT (per-viewport boxes, real motion) and has lost the
 * intent. `VisualPageIR` requires both: `bboxByViewport` is mandatory on a
 * section, and `Evidence.methods` is a list precisely so a node can declare
 * that it was seen twice.
 *
 * ## Why the merge is order-first, not name-first
 *
 * The plan assumed matching runs over `data-framer-name`. Measured against the
 * real Humeen page, a name-first merge silently drops exactly the nodes that
 * matter most:
 *
 *   XML section layers  : Hero About Projects Partners Services Awards
 *                         Testimonial Rating Cta Faq Blogs            (11)
 *   DOM section names   : Hero About Projects Partners Services Awards
 *                         Desktop Rating CTA Desktop Blogs            (11)
 *
 * `Testimonial` and `Faq` are the two XML sections that carry a `componentId`,
 * and a rendered Framer component instance is named after its active VARIANT
 * (`Desktop` / `Tablet` / `Phone`), not after the layer. So the two nodes whose
 * structure is least recoverable from the DOM are the two a name match cannot
 * find. `Cta` vs `CTA` adds a case difference on top.
 *
 * Document order, by contrast, aligned perfectly across all three measured
 * viewports. So order is the primary key, the name is a VERIFICATION signal,
 * and a mismatch on a component instance is an expected variant rename rather
 * than a conflict. Where a mismatch is not explained that way, it is recorded
 * as a conflict and the geometry is NOT applied (charter §5.1: never overwrite
 * on an ambiguous match).
 *
 * ## What the DOM candidate list must exclude
 *
 * Also measured, also non-obvious:
 *   - Two `div.framer-*-container` wrappers sit at the exact bbox of the
 *     component section they wrap. Kept, they double the section count and
 *     break the order alignment.
 *   - `section.framer-slideshow` is NESTED inside the testimonial section
 *     (y 9588 within 9438..10361, width 645 of 1200). A flat
 *     `querySelectorAll('section')` reports it as a sibling.
 *
 * @module extractors/framer/hybrid-ir-merge
 */

import type {
  AnimationIR,
  Evidence,
  EvidenceMethod,
  VisualNodeIR,
  VisualPageIR,
  VisualSectionIR,
  ViewportProfile,
} from '@elconv/core';
import type { MotionEvidence } from '../browser/motion-evidence-probe.js';

/** One measured box for one element at one viewport. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A section-level candidate as measured in the live DOM. */
export interface LiveSectionGeometry {
  tag: string;
  framerName?: string;
  /** First class token. Hashed by Framer, so diagnostics only — never an identity. */
  firstClass?: string;
  childCount?: number;
  bbox: BoundingBox;
  display?: string;
  backgroundColor?: string;
}

/** Everything the live-DOM side contributes to the merge. */
export interface LiveDomEvidence {
  viewports: ViewportProfile[];
  /** Section candidates per viewport label, in document order. */
  byViewport: Record<string, LiveSectionGeometry[]>;
  documentHeights?: Record<string, number>;
  /** Output of `probeMotionEvidence`, when a motion sweep ran. */
  motion?: MotionEvidence;
}

export type SectionMatchMethod =
  | 'name+order'
  | 'order-only'
  | 'order-variant-rename'
  | 'unmatched';

export interface SectionMatch {
  /** `sourceId` of the IR section. */
  sourceId: string;
  /** Layer name / role the structural side reported. */
  structuralName: string;
  /** `data-framer-name` the DOM reported, when present. */
  domName?: string;
  method: SectionMatchMethod;
  confidence: number;
  /** Viewport labels that contributed a box to this section. */
  viewportsApplied: string[];
  reason: string;
}

export interface HybridMergeReport {
  /** One entry per IR section, in IR order. */
  sections: SectionMatch[];
  sectionsWithGeometry: number;
  /** IR sections that got no box at all. */
  sectionsWithoutGeometry: string[];
  /** DOM candidates that could not be assigned to an IR section. */
  unmatchedDomSections: Array<{ viewport: string; index: number; domName?: string; bbox: BoundingBox }>;
  animationsMapped: number;
  /** Motion observations that could not be attributed to any IR node. */
  animationsUnmapped: Array<{ selector: string; kind: string; reason: string }>;
  /** Everything a reader must see before trusting the merged IR. */
  conflicts: string[];
  warnings: string[];
}

export interface MergeLiveDomOptions {
  /**
   * Viewport whose boxes decide `documentHeight`-relative checks and which is
   * treated as the reference for the order alignment. Defaults to the widest.
   */
  primaryViewportLabel?: string;
  /**
   * Drop a DOM candidate whose box is inside another candidate's box. Default
   * true — see the module docstring for why this is not optional in practice.
   */
  dropNestedCandidates?: boolean;
  /**
   * Drop a candidate whose box is (near) identical to its following sibling's.
   * These are Framer's `*-container` wrappers. Default true.
   */
  dropDuplicateBoxes?: boolean;
  /** Tolerance in px for "near identical" box comparison. Default 2. */
  boxEqualityTolerancePx?: number;
  /**
   * A pre-computed, verified section→DOM-candidate alignment: one entry per IR
   * section holding the candidate index it owns, or `-1` for unmatched.
   *
   * Without this the merge aligns by index and refuses everything when the counts
   * differ — which is what happens on a real page. Measured
   * (precious-board-067119, 2026-08-28): 12 structural sections against 15 named
   * DOM roots, because the site header, the footer and a stray anchor are roots
   * the structural section detector never treats as page sections. Index
   * alignment then matches NONE of the 12.
   *
   * `alignSectionRoots` resolves that case by anchoring on unique layer names and
   * only using order between anchors. Passing its result here keeps geometry
   * application in ONE place instead of duplicating it in the caller.
   *
   * When supplied, the candidate lists are used as given: cleaning and order
   * alignment are skipped, because the caller has already decided which candidate
   * belongs to which section.
   */
  rootAlignment?: readonly number[];
}

export interface MergeLiveDomResult {
  ir: VisualPageIR;
  report: HybridMergeReport;
}

const DEFAULT_BOX_TOLERANCE_PX = 2;

/**
 * Merge live-DOM geometry and motion into a structural IR.
 *
 * Pure function: the input IR is not mutated. Nothing is ever overwritten on an
 * ambiguous match — an unresolved case produces a conflict entry and leaves the
 * structural value alone.
 */
export function mergeLiveDomIntoIr(
  ir: VisualPageIR,
  live: LiveDomEvidence,
  options: MergeLiveDomOptions = {},
): MergeLiveDomResult {
  const tolerance = options.boxEqualityTolerancePx ?? DEFAULT_BOX_TOLERANCE_PX;
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const unmatchedDomSections: HybridMergeReport['unmatchedDomSections'] = [];

  const viewportLabels = Object.keys(live.byViewport);
  if (viewportLabels.length === 0) {
    return {
      ir,
      report: {
        sections: ir.sections.map((section) => ({
          sourceId: section.sourceId,
          structuralName: section.role,
          method: 'unmatched' as const,
          confidence: 0,
          viewportsApplied: [],
          reason: 'live evidence contained no viewport',
        })),
        sectionsWithGeometry: 0,
        sectionsWithoutGeometry: ir.sections.map((section) => section.sourceId),
        unmatchedDomSections: [],
        animationsMapped: 0,
        animationsUnmapped: [],
        conflicts: ['live evidence contained no viewport; geometry was not merged'],
        warnings: [],
      },
    };
  }

  // Clean the candidate list per viewport before any alignment.
  //
  // Skipped entirely when the caller supplied `rootAlignment`: those indices
  // address the UNCLEANED list the caller aligned against, so cleaning here
  // would shift every index and silently point each section at a neighbour.
  const useCallerAlignment = options.rootAlignment !== undefined;
  const cleaned: Record<string, LiveSectionGeometry[]> = {};
  for (const label of viewportLabels) {
    if (useCallerAlignment) {
      cleaned[label] = [...(live.byViewport[label] ?? [])];
      continue;
    }
    const { kept, dropped } = selectTopLevelSections(live.byViewport[label] ?? [], {
      dropNested: options.dropNestedCandidates !== false,
      dropDuplicateBoxes: options.dropDuplicateBoxes !== false,
      tolerance,
    });
    cleaned[label] = kept;
    for (const drop of dropped) {
      warnings.push(`${label}: dropped DOM candidate ${describeCandidate(drop.candidate)} (${drop.reason})`);
    }
  }

  const primaryLabel = options.primaryViewportLabel
    ?? [...viewportLabels].sort((a, b) => widestWidth(cleaned[b]) - widestWidth(cleaned[a]))[0];

  // Align IR sections against the primary viewport's candidates.
  const alignment = useCallerAlignment
    ? adoptCallerAlignment(ir.sections, cleaned[primaryLabel] ?? [], options.rootAlignment!)
    : alignSectionsByOrder(ir.sections, cleaned[primaryLabel] ?? [], primaryLabel);
  conflicts.push(...alignment.conflicts);
  warnings.push(...alignment.warnings);

  // Any viewport whose cleaned count disagrees with the primary is reported
  // rather than force-fitted: a differing count means the page genuinely
  // renders a different structure there, and guessing which box belongs to
  // which section would be fabrication.
  const usableViewports: string[] = [];
  for (const label of viewportLabels) {
    const count = cleaned[label].length;
    if (count === cleaned[primaryLabel].length) {
      usableViewports.push(label);
    } else {
      conflicts.push(
        `${label}: ${count} section candidate(s) vs ${cleaned[primaryLabel].length} at the primary viewport ` +
          `"${primaryLabel}"; boxes for this viewport were NOT applied because the alignment is ambiguous`,
      );
    }
  }

  const sections: VisualSectionIR[] = ir.sections.map((section, index) => {
    const match = alignment.matches[index];
    if (match.method === 'unmatched') return section;

    // With a caller alignment the candidate index is per-section, not the
    // section's own position — that is the entire point of passing it.
    const candidateIndex = useCallerAlignment ? options.rootAlignment![index] : index;

    const bboxByViewport: Record<string, BoundingBox> = { ...section.bboxByViewport };
    const applied: string[] = [];
    for (const label of usableViewports) {
      const candidate = cleaned[label][candidateIndex];
      if (!candidate) continue;
      bboxByViewport[label] = candidate.bbox;
      applied.push(label);
    }
    match.viewportsApplied = applied;

    const domCandidate = cleaned[primaryLabel][candidateIndex];
    const background = mergeBackground(section, domCandidate, match, conflicts);

    return {
      ...section,
      bboxByViewport,
      ...(background ? { background } : {}),
      evidence: extendEvidence(section.evidence, ['dom', 'computed-style'], match),
    };
  });

  const withGeometry = sections.filter((section) => Object.keys(section.bboxByViewport).length > 0);

  // Motion: attribute each observation to an IR node.
  const motionResult = live.motion
    ? attributeMotion(live.motion, sections, alignment.matches)
    : { animations: [], unmapped: [], warnings: [] };
  warnings.push(...motionResult.warnings);

  for (const label of viewportLabels) {
    const extra = cleaned[label].length - ir.sections.length;
    if (extra > 0) {
      for (let index = ir.sections.length; index < cleaned[label].length; index++) {
        const candidate = cleaned[label][index];
        unmatchedDomSections.push({
          viewport: label,
          index,
          domName: candidate.framerName,
          bbox: candidate.bbox,
        });
      }
    }
  }

  const mergedWarnings = ir.warnings.filter(
    (warning) => !warning.startsWith('structure-only extraction:'),
  );
  mergedWarnings.push(
    `hybrid merge: geometry applied to ${withGeometry.length}/${ir.sections.length} section(s) ` +
      `across viewport(s) ${usableViewports.join(', ') || 'none'}; ` +
      `${motionResult.animations.length} animation(s) attributed, ${motionResult.unmapped.length} unattributed`,
  );
  mergedWarnings.push(...conflicts);

  const mergedIr: VisualPageIR = {
    ...ir,
    source: { ...ir.source, extractionMode: 'hybrid' },
    // Live boxes were captured at these widths, so these are the widths the IR
    // must declare. Keeping the structural widths would describe boxes that
    // were never measured.
    viewportProfiles: live.viewports.length > 0 ? live.viewports : ir.viewportProfiles,
    sections,
    animations: [...ir.animations, ...motionResult.animations],
    warnings: mergedWarnings,
  };

  return {
    ir: mergedIr,
    report: {
      sections: alignment.matches,
      sectionsWithGeometry: withGeometry.length,
      sectionsWithoutGeometry: sections
        .filter((section) => Object.keys(section.bboxByViewport).length === 0)
        .map((section) => section.sourceId),
      unmatchedDomSections,
      animationsMapped: motionResult.animations.length,
      animationsUnmapped: motionResult.unmapped,
      conflicts,
      warnings,
    },
  };
}

// ============================================================================
// DOM candidate cleaning
// ============================================================================

interface DroppedCandidate {
  candidate: LiveSectionGeometry;
  reason: string;
}

/**
 * Reduce a flat DOM query result to the real top-level sections.
 *
 * Exported because both the merge and the report need the same definition of
 * "a section", and because the two exclusion rules are measured facts that
 * deserve their own tests.
 */
export function selectTopLevelSections(
  candidates: readonly LiveSectionGeometry[],
  options: { dropNested?: boolean; dropDuplicateBoxes?: boolean; tolerance?: number } = {},
): { kept: LiveSectionGeometry[]; dropped: DroppedCandidate[] } {
  const tolerance = options.tolerance ?? DEFAULT_BOX_TOLERANCE_PX;
  const ordered = [...candidates].sort((a, b) => a.bbox.y - b.bbox.y || b.bbox.height - a.bbox.height);
  const dropped: DroppedCandidate[] = [];
  let kept = ordered;

  if (options.dropNested !== false) {
    kept = kept.filter((candidate) => {
      const container = kept.find((other) => other !== candidate && boxContains(other.bbox, candidate.bbox, tolerance));
      if (container) {
        dropped.push({
          candidate,
          reason: `nested inside ${describeCandidate(container)}`,
        });
        return false;
      }
      return true;
    });
  }

  if (options.dropDuplicateBoxes !== false) {
    const survivors: LiveSectionGeometry[] = [];
    for (const candidate of kept) {
      const twin = survivors.find((other) => boxesEqual(other.bbox, candidate.bbox, tolerance));
      if (!twin) {
        survivors.push(candidate);
        continue;
      }
      // Framer wraps a component section in a `div.framer-*-container` with the
      // identical box. Prefer the `<section>`: it is the semantic element and it
      // is the one that carries a usable `data-framer-name`.
      const preferCandidate = candidate.tag === 'section' && twin.tag !== 'section';
      if (preferCandidate) {
        survivors[survivors.indexOf(twin)] = candidate;
        dropped.push({ candidate: twin, reason: `same box as ${describeCandidate(candidate)}, and not a <section>` });
      } else {
        dropped.push({ candidate, reason: `same box as ${describeCandidate(twin)}` });
      }
    }
    kept = survivors;
  }

  return { kept: kept.sort((a, b) => a.bbox.y - b.bbox.y), dropped };
}

function boxContains(outer: BoundingBox, inner: BoundingBox, tolerance: number): boolean {
  const strictlySmaller =
    inner.width < outer.width - tolerance || inner.height < outer.height - tolerance;
  return (
    strictlySmaller &&
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

function boxesEqual(a: BoundingBox, b: BoundingBox, tolerance: number): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

function describeCandidate(candidate: LiveSectionGeometry): string {
  const name = candidate.framerName ? `[data-framer-name="${candidate.framerName}"]` : '';
  const cls = candidate.firstClass ? `.${candidate.firstClass}` : '';
  return `<${candidate.tag}${name || cls}> at y=${candidate.bbox.y}`;
}

function widestWidth(candidates: readonly LiveSectionGeometry[] | undefined): number {
  if (!candidates || candidates.length === 0) return 0;
  return Math.max(...candidates.map((candidate) => candidate.bbox.width));
}

// ============================================================================
// Section alignment
// ============================================================================

interface AlignmentResult {
  matches: SectionMatch[];
  conflicts: string[];
  warnings: string[];
}

/**
 * Turn a caller-supplied section→candidate mapping into `SectionMatch` entries.
 *
 * No verification happens here on purpose: the caller (`alignSectionRoots`) did
 * the anchoring and already reported its own conflicts. Re-deciding would either
 * duplicate that logic or contradict it. What this DOES check is that each index
 * is in range and used once — a caller bug must not silently apply one box to two
 * sections.
 */
function adoptCallerAlignment(
  irSections: readonly VisualSectionIR[],
  domSections: readonly LiveSectionGeometry[],
  mapping: readonly number[],
): AlignmentResult {
  const matches: SectionMatch[] = [];
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const used = new Set<number>();

  if (mapping.length !== irSections.length) {
    conflicts.push(
      `rootAlignment has ${mapping.length} entr(ies) for ${irSections.length} section(s); ` +
        'the mapping was ignored and no geometry was applied',
    );
  }

  irSections.forEach((section, index) => {
    const structuralName = structuralNameOf(section);
    const candidateIndex = mapping.length === irSections.length ? mapping[index] : -1;

    if (candidateIndex < 0 || candidateIndex >= domSections.length) {
      matches.push({
        sourceId: section.sourceId,
        structuralName,
        method: 'unmatched',
        confidence: 0,
        viewportsApplied: [],
        reason: candidateIndex < 0
          ? 'the caller reported no DOM root for this section'
          : `the caller pointed at candidate ${candidateIndex}, which is outside the ${domSections.length} available`,
      });
      return;
    }

    if (used.has(candidateIndex)) {
      matches.push({
        sourceId: section.sourceId,
        structuralName,
        method: 'unmatched',
        confidence: 0,
        viewportsApplied: [],
        reason: `candidate ${candidateIndex} is already claimed by an earlier section`,
      });
      conflicts.push(
        `section "${structuralName}" was mapped to DOM candidate ${candidateIndex}, which another section already owns`,
      );
      return;
    }

    used.add(candidateIndex);
    const dom = domSections[candidateIndex];
    const namesAgree =
      dom.framerName !== undefined && dom.framerName.toLowerCase() === structuralName.toLowerCase();

    matches.push({
      sourceId: section.sourceId,
      structuralName,
      ...(dom.framerName !== undefined ? { domName: dom.framerName } : {}),
      method: namesAgree ? 'name+order' : 'order-variant-rename',
      confidence: namesAgree ? 0.97 : 0.85,
      viewportsApplied: [],
      reason: namesAgree
        ? `caller-supplied alignment to candidate ${candidateIndex}; the name also agrees`
        : `caller-supplied alignment to candidate ${candidateIndex}; DOM reported "${dom.framerName ?? '(none)'}"`,
    });
  });

  return { matches, conflicts, warnings };
}

function alignSectionsByOrder(
  irSections: readonly VisualSectionIR[],
  domSections: readonly LiveSectionGeometry[],
  primaryLabel: string,
): AlignmentResult {
  const matches: SectionMatch[] = [];
  const conflicts: string[] = [];
  const warnings: string[] = [];

  if (irSections.length !== domSections.length) {
    conflicts.push(
      `section count differs: structural source has ${irSections.length}, live DOM has ${domSections.length} ` +
        `at viewport "${primaryLabel}". Order alignment is not trustworthy; only name-verified pairs get geometry.`,
    );
  }

  for (let index = 0; index < irSections.length; index++) {
    const section = irSections[index];
    const dom = domSections[index];
    const structuralName = structuralNameOf(section);

    if (!dom) {
      matches.push({
        sourceId: section.sourceId,
        structuralName,
        method: 'unmatched',
        confidence: 0,
        viewportsApplied: [],
        reason: `no live-DOM candidate at position ${index}`,
      });
      continue;
    }

    const namesAgree =
      dom.framerName !== undefined &&
      dom.framerName.toLowerCase() === structuralName.toLowerCase();

    if (namesAgree) {
      matches.push({
        sourceId: section.sourceId,
        structuralName,
        domName: dom.framerName,
        method: 'name+order',
        confidence: 0.97,
        viewportsApplied: [],
        reason: `position ${index} and data-framer-name both agree`,
      });
      continue;
    }

    const isComponentInstance = section.layoutArchetype === 'component-instance';
    if (isComponentInstance) {
      // A rendered component instance is named after its active variant, so a
      // name mismatch here is expected and is NOT evidence of a bad match.
      matches.push({
        sourceId: section.sourceId,
        structuralName,
        domName: dom.framerName,
        method: 'order-variant-rename',
        confidence: 0.85,
        viewportsApplied: [],
        reason:
          `position ${index} matched; name differs (structural "${structuralName}" vs DOM ` +
          `"${dom.framerName ?? '(none)'}") because a component instance renders under its variant name`,
      });
      continue;
    }

    if (irSections.length !== domSections.length) {
      // Count already disagrees AND the name does not verify this pair. Two
      // independent reasons to distrust it: do not apply geometry.
      matches.push({
        sourceId: section.sourceId,
        structuralName,
        domName: dom.framerName,
        method: 'unmatched',
        confidence: 0,
        viewportsApplied: [],
        reason:
          `position ${index} is unverified: section counts differ and the name does not match ` +
          `(structural "${structuralName}" vs DOM "${dom.framerName ?? '(none)'}")`,
      });
      conflicts.push(
        `section "${structuralName}" could not be matched: name mismatch on an already ambiguous alignment`,
      );
      continue;
    }

    matches.push({
      sourceId: section.sourceId,
      structuralName,
      domName: dom.framerName,
      method: 'order-only',
      confidence: 0.7,
      viewportsApplied: [],
      reason:
        `position ${index} matched by order; name differs (structural "${structuralName}" vs DOM ` +
        `"${dom.framerName ?? '(none)'}") with no variant explanation`,
    });
    warnings.push(
      `section "${structuralName}" matched by order only; DOM reported "${dom.framerName ?? '(none)'}"`,
    );
  }

  return { matches, conflicts, warnings };
}

/**
 * The name the structural side offers for a section.
 *
 * `sourceName` is the verbatim layer name and is what the DOM exposes as
 * `data-framer-name`. `role` is a normalised classification and cannot be
 * compared: measured on the real page, `Rating` classifies as role `stats` and
 * `Blogs` as `blog`, so a role-based comparison would report a name mismatch on
 * two sections that match perfectly.
 */
function structuralNameOf(section: VisualSectionIR): string {
  return section.sourceName ?? section.role;
}

function mergeBackground(
  section: VisualSectionIR,
  dom: LiveSectionGeometry | undefined,
  match: SectionMatch,
  conflicts: string[],
): VisualSectionIR['background'] | undefined {
  const structural = section.background;
  const domColor = dom?.backgroundColor;
  if (!domColor || isTransparent(domColor)) return structural;
  if (!structural?.color) {
    return { ...structural, color: domColor };
  }
  if (!colorsRoughlyEqual(structural.color, domColor)) {
    // The structural value came from a named color style, which is the author's
    // intent and the more useful value for a target. Record the disagreement,
    // keep the intent.
    conflicts.push(
      `section "${match.structuralName}": background differs — structural "${structural.color}" ` +
        `vs computed "${domColor}". Kept the structural value (a named style beats a computed literal).`,
    );
  }
  return structural;
}

function isTransparent(color: string): boolean {
  const normalised = color.replace(/\s+/g, '').toLowerCase();
  return normalised === 'transparent' || normalised === 'rgba(0,0,0,0)';
}

function colorsRoughlyEqual(a: string, b: string): boolean {
  const parse = (value: string): [number, number, number] | null => {
    const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
    if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
    if (hex) {
      const n = Number.parseInt(hex[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return null;
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return a.trim().toLowerCase() === b.trim().toLowerCase();
  return left.every((channel, index) => Math.abs(channel - right[index]) <= 2);
}

// ============================================================================
// Motion attribution
// ============================================================================

interface MotionAttribution {
  animations: AnimationIR[];
  unmapped: HybridMergeReport['animationsUnmapped'];
  warnings: string[];
}

/**
 * Attribute each motion observation to an IR node.
 *
 * The DOM offers three keys, in decreasing strength:
 *   1. section name + Framer name + ordinal within the section
 *   2. section name + Framer name (first unclaimed)
 *   3. section name alone — but only ONCE per section, see below
 *
 * A Framer name is NOT globally unique — measured on one page: `Default` 53
 * times, `Image` 27, `Top` 25 — so key 1 exists for a reason. When even the
 * section is unknown, the observation is reported as unattributed rather than
 * pinned to a guess: an animation on the wrong element is worse than a named
 * gap in the report.
 *
 * ## Why the section fallback is capped at one
 *
 * It was not, and the cost was measured: on a live page 31 observations produced
 * only 3 distinct targets, because every unresolvable one fell back to its
 * enclosing section. A target then writes ONE entrance onto that one element, so
 * 28 of the 31 were reported by `G_ANIMATION_PARITY` as effects that would not
 * appear — correctly, but uselessly late.
 *
 * A second fallback to the same section carries no information: it says "some
 * element in here moves", which the first one already said. So it is reported as
 * unattributed, which is the same fact stated at the point where it is still
 * actionable.
 */
function attributeMotion(
  motion: MotionEvidence,
  sections: readonly VisualSectionIR[],
  matches: readonly SectionMatch[],
): MotionAttribution {
  const animations: AnimationIR[] = [];
  const unmapped: HybridMergeReport['animationsUnmapped'] = [];
  const warnings: string[] = [];

  // Section lookup by every name the structural and DOM sides used.
  const sectionByName = new Map<string, VisualSectionIR>();
  sections.forEach((section, index) => {
    const match = matches[index];
    for (const name of [match?.structuralName, match?.domName, section.sourceName, section.role]) {
      if (name) sectionByName.set(name.toLowerCase(), section);
    }
  });

  const claimed = new Set<string>();
  /** Sections that already carry a fallback-attributed animation. */
  const sectionFallbackUsed = new Set<string>();

  for (const observation of motion.observations) {
    if (observation.kind === 'indeterminate') {
      unmapped.push({
        selector: observation.selector,
        kind: observation.kind,
        reason: `not classified: ${observation.reason}`,
      });
      continue;
    }

    const section = observation.sectionName
      ? sectionByName.get(observation.sectionName.toLowerCase())
      : undefined;

    if (!section) {
      unmapped.push({
        selector: observation.selector,
        kind: observation.kind,
        reason: observation.sectionName
          ? `enclosing section "${observation.sectionName}" is not in the structural IR`
          : 'element is not inside any known section',
      });
      continue;
    }

    const target = observation.framerName
      ? findNodeByName(section, observation.framerName, observation.ordinalInSection, claimed)
      : undefined;

    const attributedToSection = target === undefined;

    if (attributedToSection && sectionFallbackUsed.has(section.sourceId)) {
      unmapped.push({
        selector: observation.selector,
        kind: observation.kind,
        reason:
          `no node in section "${section.sourceName ?? section.role}" could be identified ` +
          `(${observation.framerName ? `no unclaimed layer named "${observation.framerName}"` : 'element carries no Framer name'}), ` +
          'and that section already carries a fallback-attributed animation — a second one would ' +
          'target the same element and only one could be visible',
      });
      continue;
    }

    const targetSourceId = target?.sourceId ?? section.sourceId;
    if (attributedToSection) {
      sectionFallbackUsed.add(section.sourceId);
      warnings.push(
        `motion on ${observation.selector} attributed to section "${section.role}" rather than to a ` +
          `specific node (${observation.framerName ? `no layer named "${observation.framerName}" in that section` : 'element carries no Framer name'})`,
      );
    }

    const effectNames = observation.effects.map((effect) => effect.kind).join('+');
    animations.push({
      id: `motion-${animations.length + 1}-${slug(observation.selector)}`,
      // Both classes are triggered by scroll position: an entrance fires when
      // the element comes into view, a scroll-linked effect tracks the offset.
      kind: 'scroll',
      targetSourceId,
      intent: `${observation.kind}:${effectNames || 'unspecified'}`,
      // The behavioural class travels as its own field, not only inside the
      // `intent` string. A target has to branch on it — entrance and
      // scroll-linked need different Elementor controls — and parsing it back
      // out of prose would be a contract nobody can typecheck.
      motionClass: observation.kind,
      // Amplitudes are the reason this field exists: every Elementor motion
      // effect setting IS an amplitude (`motion_fx_translateY_speed` resolves to
      // `-(passedPercents - 50) * speed` px), so a mapper without measured
      // ranges can only invent speeds.
      effects: observation.effects.map((effect) => ({
        kind: effect.kind,
        from: effect.from,
        to: effect.to,
        range: effect.range,
        monotonic: effect.monotonic,
      })),
      // durationMs is deliberately absent. The sweep samples settled states at
      // discrete scroll positions, so any duration would be invented.
      evidence: {
        sourceIds: [observation.selector],
        methods: ['dom', 'computed-style'],
        // Attributing to a specific node is stronger evidence than falling back
        // to the whole section.
        confidence: attributedToSection ? 0.55 : 0.8,
        warnings: attributedToSection
          ? [`attributed to the enclosing section, not to an exact node`, observation.reason]
          : [observation.reason],
      },
    });
  }

  return { animations, unmapped, warnings };
}

/**
 * Find the nth descendant of a section whose layer name matches.
 *
 * Matching is on `sourceName` — the verbatim layer name — because that is the
 * string the DOM reports as `data-framer-name`. A node whose `sourceName` is
 * absent (an older IR, or a synthetic node) is unmatchable, and the caller
 * reports that as a section-level fallback instead of pinning the animation to
 * an arbitrary node.
 */
function findNodeByName(
  section: VisualSectionIR,
  framerName: string,
  ordinal: number,
  claimed: Set<string>,
): VisualNodeIR | undefined {
  const wanted = framerName.toLowerCase();
  const hits: VisualNodeIR[] = [];

  const walk = (nodes: readonly VisualNodeIR[]): void => {
    for (const node of nodes) {
      if (node.sourceName !== undefined && node.sourceName.toLowerCase() === wanted) hits.push(node);
      walk(node.children);
    }
  };
  walk(section.nodes);

  const exact = hits[ordinal];
  if (exact && !claimed.has(exact.sourceId)) {
    claimed.add(exact.sourceId);
    return exact;
  }
  const firstFree = hits.find((node) => !claimed.has(node.sourceId));
  if (firstFree) {
    claimed.add(firstFree.sourceId);
    return firstFree;
  }
  return undefined;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function extendEvidence(
  evidence: Evidence,
  addMethods: readonly EvidenceMethod[],
  match: SectionMatch,
): Evidence {
  const methods = [...evidence.methods];
  for (const method of addMethods) {
    if (!methods.includes(method)) methods.push(method);
  }
  return {
    ...evidence,
    methods,
    // Two independent sources agreeing is stronger than one; a weaker match
    // method must not inflate the structural confidence.
    confidence: Math.min(0.99, Math.max(evidence.confidence, match.confidence)),
    warnings: [...evidence.warnings, `hybrid merge: ${match.reason}`],
  };
}

/** Format the merge report for a human-readable run report. */
export function formatHybridMergeReport(report: HybridMergeReport): string {
  const lines = [
    `Hybrid merge: ${report.sectionsWithGeometry}/${report.sections.length} section(s) got geometry, ` +
      `${report.animationsMapped} animation(s) attributed`,
    '',
  ];
  for (const match of report.sections) {
    lines.push(
      `  [${match.method}] ${match.structuralName}` +
        (match.domName && match.domName !== match.structuralName ? ` <- DOM "${match.domName}"` : '') +
        ` conf=${match.confidence.toFixed(2)} viewports=${match.viewportsApplied.join('/') || 'none'}`,
    );
  }
  if (report.sectionsWithoutGeometry.length > 0) {
    lines.push('', `Sections without geometry (${report.sectionsWithoutGeometry.length}):`);
    for (const sourceId of report.sectionsWithoutGeometry) lines.push(`  ${sourceId}`);
  }
  if (report.animationsUnmapped.length > 0) {
    lines.push('', `Unattributed motion (${report.animationsUnmapped.length}):`);
    for (const entry of report.animationsUnmapped) {
      lines.push(`  ${entry.selector} — ${entry.reason}`);
    }
  }
  if (report.conflicts.length > 0) {
    lines.push('', `Conflicts (${report.conflicts.length}):`);
    for (const conflict of report.conflicts) lines.push(`  ! ${conflict}`);
  }
  return lines.join('\n');
}
