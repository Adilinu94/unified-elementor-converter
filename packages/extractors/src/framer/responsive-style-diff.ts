/**
 * Responsive style overrides, derived by comparing per-viewport captures.
 *
 * ## Why this has to be measured rather than read from the source
 *
 * Framer's project XML returns the non-primary breakpoints as EMPTY stubs.
 * Verified against the live MCP (2026-08-29), asking `getNodeXml` for the two
 * variant roots of the Ordina home page directly:
 *
 * ```
 * Tablet (lqBlLakCk, 760px) → 620 bytes, 0 children
 * Phone  (m6quUCEMD, 390px) → 619 bytes, 0 children
 * ```
 *
 * with the server's own explanation: *"This is a replica node (variant). Only
 * update a few attributes on variants."* A variant inherits everything and
 * stores only what was overridden — and what it stores is not exposed. So there
 * is no second call that would return the tablet layout: the overrides exist
 * only in the rendered page.
 *
 * ## What is compared
 *
 * `captureLiveNodeTree` already runs once per viewport, and until now every
 * capture but the primary was used for section geometry and then discarded. This
 * module diffs them: same tree, three layout states, and any property whose
 * computed value differs at a narrower viewport is an override the author made.
 *
 * Measured on the Ordina page at its own breakpoints (1200 / 760 / 390):
 *
 * | property         | desktop→tablet | desktop→mobile |
 * |------------------|----------------|----------------|
 * | padding          | 57             | 95             |
 * | gap              | 45             | 100            |
 * | border-radius    | 4              | 92             |
 * | flex-direction   | 10             | 22             |
 * | font-size        | 121            | 124            |
 *
 * ## Why the font-size row is the reason this module exists at all
 *
 * That row was ZERO until `captureLiveNodeTree` started reading typography from
 * the element that renders the text. Framer names a wrapper that inherits
 * `body { font-size: 12px }`, and 12px is 12px at every viewport — so a diff
 * over wrapper styles reported "no responsive typography" on a page whose
 * headings scale 72 → 56 → 40px. A correct differ over wrong inputs is silent.
 *
 * ## Alignment, and why a mismatch is skipped rather than guessed
 *
 * The trees are NOT identical across viewports: measured 690 named nodes at
 * desktop against 746 at tablet and 754 at mobile, because Framer renders extra
 * variant overlays at narrower widths. So pairing is done by
 * `alignByNameAnchors` — the same rule the section and instance layers use —
 * per level. An ambiguous position yields no override and is counted, because a
 * padding value attributed to the wrong node is worse than a missing one.
 *
 * @module extractors/framer/responsive-style-diff
 */

import type { LiveDomNode } from './component-expansion.js';
import type { BoundingBox } from './hybrid-ir-merge.js';
import { alignByNameAnchors } from './section-root-alignment.js';

/** One viewport's captured roots, as `captureLiveNodeTree` returns them. */
export interface ViewportRoots {
  label: string;
  roots: readonly LiveDomNode[];
}

export interface ResponsiveDiffReport {
  /** Breakpoint labels that were compared against the primary. */
  breakpoints: string[];
  /** Nodes that received at least one override, per breakpoint. */
  nodesWithOverrides: Record<string, number>;
  /** Property → how many nodes changed it, per breakpoint. */
  changedProperties: Record<string, Record<string, number>>;
  /**
   * Positions where alignment refused to pair, per breakpoint.
   *
   * Reported rather than logged: an unpaired node silently keeps its desktop
   * styling at every width, which looks like a deliberate design decision.
   */
  unpaired: Record<string, number>;
  warnings: string[];
}

export interface ResponsiveDiffResult {
  /**
   * The primary roots, annotated with `responsiveStyles` and
   * `responsiveBboxes`. Input is not mutated.
   */
  roots: LiveDomNode[];
  report: ResponsiveDiffReport;
}

/**
 * Annotate the primary capture with the style deltas of the other viewports.
 *
 * Every captured property is compared, not a hand-picked subset: the V3 emitter
 * already resolves each one against the live control schema and records a
 * decision when a control declares no responsive capability. Pre-filtering here
 * would move that judgement into a module that cannot see the schema.
 */
export function diffResponsiveStyles(
  primary: ViewportRoots,
  others: readonly ViewportRoots[],
): ResponsiveDiffResult {
  const report: ResponsiveDiffReport = {
    breakpoints: others.map((other) => other.label),
    nodesWithOverrides: {},
    changedProperties: {},
    unpaired: {},
    warnings: [],
  };

  // Accumulated per node identity, so three viewports produce ONE annotated
  // tree rather than three competing ones.
  const overrides = new Map<LiveDomNode, Record<string, Record<string, string>>>();
  // Boxes ride along the SAME pairing rather than in a second pass: a box
  // attributed by one rule and a style delta by another would let the two
  // disagree about which node they describe.
  const boxes = new Map<LiveDomNode, Record<string, BoundingBox>>();

  for (const other of others) {
    report.nodesWithOverrides[other.label] = 0;
    report.changedProperties[other.label] = {};
    report.unpaired[other.label] = 0;
    if (other.roots.length === 0) {
      report.warnings.push(
        `${other.label}: capture has no roots, so no responsive overrides could be derived for it`,
      );
      continue;
    }
    walkPair(primary.roots, other.roots, other.label, overrides, boxes, report);
  }

  return {
    roots: primary.roots.map((root) => annotate(root, overrides, boxes)),
    report,
  };
}

/** Pair one level, record the deltas, and descend into every paired position. */
function walkPair(
  primaryNodes: readonly LiveDomNode[],
  otherNodes: readonly LiveDomNode[],
  label: string,
  overrides: Map<LiveDomNode, Record<string, Record<string, string>>>,
  boxes: Map<LiveDomNode, Record<string, BoundingBox>>,
  report: ResponsiveDiffReport,
): void {
  const aligned = alignByNameAnchors(
    primaryNodes.map((node) => node.framerName ?? ''),
    otherNodes.map((node) => node.framerName ?? ''),
  );

  primaryNodes.forEach((node, index) => {
    const pair = aligned.pairs[index];
    const other = pair !== undefined && pair.rightIndex >= 0 ? otherNodes[pair.rightIndex] : undefined;
    if (other === undefined) {
      report.unpaired[label]! += 1;
      return;
    }

    const delta = styleDelta(node.styles, other.styles);
    if (delta !== undefined) {
      const existing = overrides.get(node) ?? {};
      existing[label] = delta;
      overrides.set(node, existing);
      report.nodesWithOverrides[label]! += 1;
      for (const property of Object.keys(delta)) {
        const counts = report.changedProperties[label]!;
        counts[property] = (counts[property] ?? 0) + 1;
      }
    }

    // The box is recorded for every PAIRED node, not only for one that changed
    // styles: a node can keep every computed property and still be laid out at a
    // different size, because its parent's width changed. Measured on the image
    // nodes of precious-board-067119, which carry no `width`/`height` style at
    // all — for them the box is the only responsive signal that exists.
    const nodeBoxes = boxes.get(node) ?? {};
    nodeBoxes[label] = other.bbox;
    boxes.set(node, nodeBoxes);

    walkPair(node.children, other.children, label, overrides, boxes, report);
  });
}

/**
 * Properties whose value differs between the two states.
 *
 * A property present at desktop and ABSENT at the narrower viewport is not an
 * override that can be expressed: Elementor has no "unset at mobile" control, so
 * emitting the desktop value again would be a no-op and emitting an empty value
 * would clear it at every width. Such a property is skipped.
 */
function styleDelta(
  primaryStyles: Record<string, string> | undefined,
  otherStyles: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (otherStyles === undefined) return undefined;
  const delta: Record<string, string> = {};
  for (const [property, value] of Object.entries(otherStyles)) {
    if (primaryStyles?.[property] === value) continue;
    delta[property] = value;
  }
  return Object.keys(delta).length > 0 ? delta : undefined;
}

/** Rebuild the tree with the per-breakpoint deltas and boxes attached. */
function annotate(
  node: LiveDomNode,
  overrides: Map<LiveDomNode, Record<string, Record<string, string>>>,
  boxes: Map<LiveDomNode, Record<string, BoundingBox>>,
): LiveDomNode {
  const own = overrides.get(node);
  const ownBoxes = boxes.get(node);
  const children = node.children.map((child) => annotate(child, overrides, boxes));
  return {
    ...node,
    ...(own !== undefined ? { responsiveStyles: own } : {}),
    ...(ownBoxes !== undefined ? { responsiveBboxes: ownBoxes } : {}),
    children,
  };
}

/** One line per breakpoint, for a run report or the CLI. */
export function formatResponsiveDiffReport(report: ResponsiveDiffReport): string {
  if (report.breakpoints.length === 0) {
    return 'Responsive overrides: no non-primary viewport was captured, so none could be derived.';
  }
  const lines = ['Responsive overrides (measured from the rendered page):'];
  for (const label of report.breakpoints) {
    const properties = Object.entries(report.changedProperties[label] ?? {})
      .sort((left, right) => right[1] - left[1])
      .map(([property, count]) => `${property}=${count}`)
      .join(', ');
    lines.push(
      `  ${label}: ${report.nodesWithOverrides[label] ?? 0} node(s) overridden, `
        + `${report.unpaired[label] ?? 0} unpaired`
        + (properties.length > 0 ? ` — ${properties}` : ''),
    );
  }
  for (const warning of report.warnings) lines.push(`  ! ${warning}`);
  return lines.join('\n');
}
