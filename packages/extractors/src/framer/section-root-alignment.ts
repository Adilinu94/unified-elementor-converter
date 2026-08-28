/**
 * Anchor-based alignment of IR sections against live DOM roots.
 *
 * ## Why the existing section merge is not enough
 *
 * `mergeLiveDomIntoIr` aligns strictly by index and refuses everything when the
 * counts differ. That is the right call for geometry, and it is why the merge
 * blocks itself on a real page. Measured (2026-08-28, precious-board-067119):
 *
 *   structural sections : 12
 *   DOM named roots     : 15
 *
 * The three extras are not noise to be filtered by shape:
 *   - `Desktop <header>` at y=0 — the site header, which the structural section
 *     detector does not treat as a page section at all.
 *   - `CTA & Footer` at y=14115 — likewise outside the structural section list.
 *   - `Light <a>` 140x38 at y=842 — a stray named anchor with no structural peer.
 *
 * ## Why box geometry cannot do the filtering
 *
 * The obvious fix — drop a candidate whose box sits inside another's — is wrong
 * here, and measurably so: `Desktop <header>` is 1440x84 at y=0 and
 * `Hero Section` is 1440x1194 at y=0, so the header's box is fully INSIDE the
 * hero's. A containment filter drops the header as "nested" although the two are
 * DOM siblings. Framer positions the header over the hero, and geometric
 * containment is simply not DOM ancestry.
 *
 * `captureLiveNodeTree` already computes real ancestry (a root is a named node
 * with no named ancestor), so its roots need no shape-based cleaning.
 *
 * ## The algorithm
 *
 * Anchors first, order only between anchors:
 *
 *   1. Normalise both sides' names (`FeaturesSection1` ↔ `Features Section #1`)
 *      and pair every name that occurs exactly once on each side. On the real
 *      page this anchors 10 of 12 sections.
 *   2. Between two consecutive anchors, match the remaining runs by order — but
 *      ONLY when both runs have the same length. This is where the two
 *      component-instance sections land: they render under their variant name
 *      (`Desktop`), so no name can find them, yet each sits alone between two
 *      anchors and is therefore unambiguous.
 *   3. Anything left over is reported, never guessed. A DOM root with no
 *      structural peer becomes an `extraDomRoot`; a structural section with no
 *      DOM peer stays unmatched.
 *
 * The result on the measured page is 12 of 12 sections matched with zero
 * conflicts, where pure index alignment matched none.
 *
 * @module extractors/framer/section-root-alignment
 */

import type { VisualSectionIR } from '@elconv/core';
import type { LiveDomNode } from './component-expansion.js';

export type RootMatchMethod = 'name-anchor' | 'order-between-anchors' | 'unmatched';

export interface RootMatch {
  /** `sourceId` of the IR section. */
  sourceId: string;
  /** Index into `irSections`. */
  irIndex: number;
  /** Index into the DOM root list, or -1 when unmatched. */
  domIndex: number;
  structuralName: string;
  domName?: string;
  method: RootMatchMethod;
  confidence: number;
  reason: string;
}

export interface ExtraDomRoot {
  domIndex: number;
  domName?: string;
  tag: string;
  bbox: LiveDomNode['bbox'];
  reason: string;
}

export interface RootAlignmentResult {
  /** One entry per IR section, in IR order. */
  matches: RootMatch[];
  /** DOM roots that no structural section claims. */
  extraDomRoots: ExtraDomRoot[];
  matched: number;
  unmatched: number;
  /** Ambiguities that prevented a pairing. Each names the sections involved. */
  conflicts: string[];
  warnings: string[];
}

/**
 * Normalise a layer name for cross-source comparison.
 *
 * Framer's XML tag is the layer name with separators stripped
 * (`FeaturesSection1`) while the DOM reports it verbatim
 * (`Features Section #1`). Comparing raw strings finds neither.
 */
export function normaliseLayerName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** How one pair in a name-anchored alignment was decided. */
export type AnchorPairMethod = 'name-anchor' | 'order-between-anchors' | 'unmatched';

export interface AnchorPair {
  leftIndex: number;
  /** Index on the right, or -1 when nothing could be paired. */
  rightIndex: number;
  method: AnchorPairMethod;
  reason: string;
}

export interface AnchorAlignment {
  pairs: AnchorPair[];
  /** Right-hand indices no left item claims. */
  unclaimedRight: number[];
  conflicts: string[];
}

/**
 * Pair two ordered name lists: unique names first, order only between anchors.
 *
 * The single algorithm behind both alignment layers. Extracted rather than
 * duplicated because the two levels fail the same way and must therefore refuse
 * the same way — a section-level rule that is stricter than the node-level one
 * would make a build's trustworthiness depend on which level a mismatch hit.
 *
 * Why order alone is not enough: the DOM carries named nodes the structural
 * source never had (a site header, a variant overlay), so position `i` on one
 * side is not position `i` on the other.
 *
 * Why names alone are not enough: a Framer name is not unique — measured on one
 * page, `Text Wrapper` occurs 64 times, `Overlay` 51, `Desktop` 3 — and a
 * rendered component instance is named after its active VARIANT, so the nodes
 * most in need of pairing are exactly the ones no name can find.
 *
 * An empty name never anchors, and a non-monotonic anchor is dropped with a
 * conflict rather than producing crossed pairs.
 */
export function alignByNameAnchors(
  leftNames: readonly string[],
  rightNames: readonly string[],
): AnchorAlignment {
  const conflicts: string[] = [];
  const left = leftNames.map(normaliseLayerName);
  const right = rightNames.map(normaliseLayerName);

  const leftCounts = countBy(left);
  const rightCounts = countBy(right);

  // Step 1 — anchors on names that are unique on BOTH sides.
  const anchors: Array<[number, number]> = [];
  left.forEach((name, leftIndex) => {
    if (name === '' || leftCounts.get(name) !== 1 || rightCounts.get(name) !== 1) return;
    const rightIndex = right.indexOf(name);
    if (rightIndex !== -1) anchors.push([leftIndex, rightIndex]);
  });
  anchors.sort((a, b) => a[0] - b[0]);

  const monotonic: Array<[number, number]> = [];
  let lastRight = -1;
  for (const [leftIndex, rightIndex] of anchors) {
    if (rightIndex <= lastRight) {
      conflicts.push(
        `"${leftNames[leftIndex]}" name-matches position ${rightIndex}, which is before an already ` +
          `anchored position (${lastRight}); the two sources disagree on order, so this anchor was dropped`,
      );
      continue;
    }
    monotonic.push([leftIndex, rightIndex]);
    lastRight = rightIndex;
  }

  const pairs: AnchorPair[] = leftNames.map((_, leftIndex) => ({
    leftIndex,
    rightIndex: -1,
    method: 'unmatched' as AnchorPairMethod,
    reason: 'not resolved',
  }));
  const claimed = new Set<number>();

  for (const [leftIndex, rightIndex] of monotonic) {
    pairs[leftIndex] = {
      leftIndex,
      rightIndex,
      method: 'name-anchor',
      reason: 'layer name is unique on both sides and the order is consistent',
    };
    claimed.add(rightIndex);
  }

  // Step 2 — the runs between consecutive anchors.
  const spans: Array<{ lStart: number; lEnd: number; rStart: number; rEnd: number }> = [];
  let prevLeft = -1;
  let prevRight = -1;
  for (const [leftIndex, rightIndex] of monotonic) {
    spans.push({ lStart: prevLeft + 1, lEnd: leftIndex, rStart: prevRight + 1, rEnd: rightIndex });
    prevLeft = leftIndex;
    prevRight = rightIndex;
  }
  spans.push({
    lStart: prevLeft + 1,
    lEnd: leftNames.length,
    rStart: prevRight + 1,
    rEnd: rightNames.length,
  });

  for (const span of spans) {
    const leftRun: number[] = [];
    for (let i = span.lStart; i < span.lEnd; i++) leftRun.push(i);
    const rightRun: number[] = [];
    for (let i = span.rStart; i < span.rEnd; i++) {
      if (!claimed.has(i)) rightRun.push(i);
    }

    if (leftRun.length === 0) continue;

    if (leftRun.length !== rightRun.length) {
      // Do NOT force-fit. A run of 1 against 2 has two equally plausible answers,
      // and picking one attaches content to the wrong element while reporting
      // success.
      for (const leftIndex of leftRun) {
        pairs[leftIndex] = {
          leftIndex,
          rightIndex: -1,
          method: 'unmatched',
          reason:
            `${leftRun.length} item(s) sit between two anchors where the other side has ` +
            `${rightRun.length} unclaimed item(s); the pairing is ambiguous`,
        };
      }
      conflicts.push(
        `${leftRun.length} item(s) between anchors could not be paired against ` +
          `${rightRun.length} unclaimed item(s): ${leftRun.map((i) => `"${leftNames[i]}"`).join(', ')}`,
      );
      continue;
    }

    leftRun.forEach((leftIndex, offset) => {
      const rightIndex = rightRun[offset];
      claimed.add(rightIndex);
      pairs[leftIndex] = {
        leftIndex,
        rightIndex,
        method: 'order-between-anchors',
        reason:
          `alone in its run between two name-anchored items; the other side reported ` +
          `"${rightNames[rightIndex] || '(unnamed)'}" ` +
          '(a rendered component instance is named after its active variant)',
      };
    });
  }

  const unclaimedRight: number[] = [];
  rightNames.forEach((_, rightIndex) => {
    if (!claimed.has(rightIndex)) unclaimedRight.push(rightIndex);
  });

  return { pairs, unclaimedRight, conflicts };
}

/** Align IR sections to captured DOM roots. Pure. */
export function alignSectionRoots(
  irSections: readonly VisualSectionIR[],
  domRoots: readonly LiveDomNode[],
): RootAlignmentResult {
  const warnings: string[] = [];

  const aligned = alignByNameAnchors(
    irSections.map((section) => section.sourceName ?? section.role),
    domRoots.map((root) => root.framerName ?? ''),
  );

  const matches: RootMatch[] = irSections.map((section, irIndex) => {
    const pair = aligned.pairs[irIndex];
    const structuralName = section.sourceName ?? section.role;
    const domRoot = pair.rightIndex >= 0 ? domRoots[pair.rightIndex] : undefined;

    if (pair.method === 'order-between-anchors' && aligned.pairs.filter(
      (other) => other.method === 'order-between-anchors',
    ).length > 1) {
      warnings.push(
        `section "${structuralName}" was matched by order between anchors; only the run boundaries ` +
          'are name-verified',
      );
    }

    return {
      sourceId: section.sourceId,
      irIndex,
      domIndex: pair.rightIndex,
      structuralName,
      ...(domRoot?.framerName !== undefined ? { domName: domRoot.framerName } : {}),
      method: pair.method,
      confidence: pair.method === 'name-anchor' ? 0.97 : pair.method === 'order-between-anchors' ? 0.85 : 0,
      reason: pair.reason,
    };
  });

  const extraDomRoots: ExtraDomRoot[] = aligned.unclaimedRight.map((domIndex) => {
    const root = domRoots[domIndex];
    return {
      domIndex,
      ...(root.framerName !== undefined ? { domName: root.framerName } : {}),
      tag: root.tag,
      bbox: root.bbox,
      reason: isZeroArea(root.bbox)
        ? 'zero-area element (a script host or a scroll helper), so it carries no visual content'
        : 'no structural section claims this root; the structural section detector did not treat it as a page section',
    };
  });

  const matched = matches.filter((match) => match.domIndex !== -1).length;
  return {
    matches,
    extraDomRoots,
    matched,
    unmatched: matches.length - matched,
    conflicts: aligned.conflicts.map((conflict) => `section alignment: ${conflict}`),
    warnings,
  };
}

function countBy(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function isZeroArea(bbox: LiveDomNode['bbox']): boolean {
  return bbox.width === 0 || bbox.height === 0;
}

/** One line per section, plus the leftovers. For a run report or the CLI. */
export function formatRootAlignment(result: RootAlignmentResult): string {
  const lines = [
    `Section alignment: ${result.matched} matched, ${result.unmatched} unmatched, ` +
      `${result.extraDomRoots.length} DOM root(s) with no structural peer`,
    '',
  ];
  for (const match of result.matches) {
    const target = match.domIndex === -1 ? '(none)' : `DOM ${match.domIndex} "${match.domName ?? '(unnamed)'}"`;
    lines.push(`  [${match.method}] ${match.structuralName} → ${target} — ${match.reason}`);
  }
  if (result.extraDomRoots.length > 0) {
    lines.push('', `Unclaimed DOM roots (${result.extraDomRoots.length}):`);
    for (const extra of result.extraDomRoots) {
      lines.push(
        `  ? ${extra.domIndex} "${extra.domName ?? '(unnamed)'}" <${extra.tag}> ` +
          `${extra.bbox.width}x${extra.bbox.height} — ${extra.reason}`,
      );
    }
  }
  if (result.conflicts.length > 0) {
    lines.push('', `Conflicts (${result.conflicts.length}):`);
    for (const conflict of result.conflicts) lines.push(`  ! ${conflict}`);
  }
  return lines.join('\n');
}
