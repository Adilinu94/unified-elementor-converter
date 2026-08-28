/**
 * Live-DOM capture orchestrator — the seam that joins the hybrid halves.
 *
 * ## Why this module exists
 *
 * Four pieces were built and none was reachable: `captureLiveNodeTree`,
 * `alignSectionRoots`, `expandComponentInstances` and `mergeLiveDomIntoIr`. A
 * module with no caller is indistinguishable from a module that does not work.
 *
 * It lives in `extractors` because it owns a browser. Everything it calls is
 * pure; this is the only layer that navigates, waits and scrolls, which keeps the
 * pure parts testable without Playwright.
 *
 * ## The order is the contract
 *
 *   1. capture   — one layout state, all viewports
 *   2. align     — anchor sections to DOM roots (names first, order between)
 *   3. expand    — fill component subtrees from the aligned DOM root
 *   4. merge     — geometry + motion, using that alignment
 *
 * Step 2 must precede both: `mergeLiveDomIntoIr` aligns by index on its own and
 * then refuses everything, because a real page has DOM roots the structural
 * section detector never saw (header, footer).
 *
 * Step 3 must precede step 4, and this cost a measurable amount to get wrong.
 * The merge is what attributes motion to nodes, and it matches on `sourceName`.
 * Run before expansion it had 161 nodes to choose from, and all 31 measured
 * effects fell back to their enclosing section — 3 distinct targets for 31
 * animations, so 28 of them resolved onto elements another animation already
 * owned and `G_ANIMATION_PARITY` correctly reported them as unhandled. After
 * expansion there are 291 nodes, each carrying the `data-framer-name` the probe
 * reports, which is exactly the key attribution needs.
 *
 * ## What it does not do
 *
 * It does not deploy, does not write files and does not decide whether the result
 * is good enough. It reports what it measured and what it could not match.
 *
 * @module extractors/framer/live-capture
 */

import type { VisualPageIR, VisualSectionIR } from '@elconv/core';
import type { Page } from 'playwright';
import { captureLiveNodeTree, type LiveNodeTreeCapture } from '../browser/live-node-tree.js';
import { probeMotionEvidence, type MotionEvidence } from '../browser/motion-evidence-probe.js';
import { conventionalViewportHeight, type ViewportConfig } from '../browser/types.js';
import {
  expandComponentInstances,
  type ExpansionReport,
  type LiveDomNode,
} from './component-expansion.js';
import {
  alignSectionRoots,
  formatRootAlignment,
  type RootAlignmentResult,
} from './section-root-alignment.js';
import {
  mergeLiveDomIntoIr,
  type HybridMergeReport,
  type LiveDomEvidence,
  type LiveSectionGeometry,
} from './hybrid-ir-merge.js';

export interface LiveCaptureOptions {
  /** Rendered page URL. Must be the same route the structural IR describes. */
  url: string;
  /**
   * Viewports to capture. Defaults to the widths the source itself declares,
   * read from `__framer__breakpoints` during the motion probe.
   *
   * Passing them explicitly is for reproducing a fixture; deriving them is the
   * charter's rule — QA viewports must come from the source, not from a guess.
   */
  viewports?: readonly ViewportConfig[];
  /** Skip the motion sweep. Much faster; the IR then carries no animations. */
  skipMotion?: boolean;
  /** Skip component expansion. Geometry and motion only. */
  skipExpansion?: boolean;
  /** Extra settle time after load, in ms. Default 2500. */
  settleMs?: number;
  /** Navigation timeout in ms. Default 60000. */
  timeoutMs?: number;
  /** Max named nodes per viewport capture. Default 3000. */
  maxNodes?: number;
}

export interface LiveCaptureReport {
  url: string;
  /** Viewport labels actually captured. */
  viewports: string[];
  /** Where the viewport list came from. */
  viewportSource: 'source-breakpoints' | 'caller' | 'fallback';
  /** Named nodes present per viewport, before the capture limits. */
  namedNodeCount: Record<string, number>;
  alignment: RootAlignmentResult;
  merge: HybridMergeReport;
  /** One expansion report per matched section, keyed by `sourceId`. */
  expansion: Record<string, ExpansionReport>;
  expansionTotals: { expanded: number; blocked: number; nodesGrafted: number };
  /** Nodes in the IR before and after, so the effect is measurable. */
  nodeCountBefore: number;
  nodeCountAfter: number;
  warnings: string[];
}

export interface LiveCaptureResult {
  ir: VisualPageIR;
  report: LiveCaptureReport;
}

/** Browser surface this module needs. Narrow, so a fake is cheap to write. */
export interface BrowserPort {
  newPage(options: { viewport: { width: number; height: number } }): Promise<Page>;
}

const DEFAULT_SETTLE_MS = 2500;
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Fallback viewports, used only when the source declares no breakpoints.
 *
 * Deliberately narrow: capturing at widths the design never targeted produces
 * boxes that describe a layout the author never saw.
 */
const FALLBACK_VIEWPORTS: readonly ViewportConfig[] = [
  { label: 'desktop', width: 1440, height: 900 },
];

/**
 * Enrich a structural IR with everything only the rendered page knows.
 *
 * The browser is injected so a caller owns its lifecycle — this function opens
 * pages and closes them, never the browser.
 */
export async function captureLiveEvidence(
  ir: VisualPageIR,
  browser: BrowserPort,
  options: LiveCaptureOptions,
): Promise<LiveCaptureResult> {
  const warnings: string[] = [];
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // The primary viewport is opened first because two things come from it: the
  // motion sweep, and the breakpoint payload that decides every other viewport.
  const seed = options.viewports?.[0] ?? FALLBACK_VIEWPORTS[0];
  const primaryPage = await browser.newPage({ viewport: { width: seed.width, height: seed.height } });

  let motion: MotionEvidence | undefined;
  let viewports: ViewportConfig[];
  let viewportSource: LiveCaptureReport['viewportSource'];

  try {
    await gotoSettled(primaryPage, options.url, timeoutMs, settleMs);

    if (options.skipMotion === true) {
      viewports = [...(options.viewports ?? FALLBACK_VIEWPORTS)];
      viewportSource = options.viewports ? 'caller' : 'fallback';
      warnings.push('motion sweep skipped: the IR will carry no animations from this run');
    } else {
      motion = await probeMotionEvidence(primaryPage);
      warnings.push(...motion.warnings);
      if (options.viewports !== undefined) {
        viewports = [...options.viewports];
        viewportSource = 'caller';
      } else if (motion.viewports.length > 0) {
        // The source's own breakpoints. This is the charter's rule and it is why
        // the motion probe runs before the geometry capture.
        viewports = [...motion.viewports];
        viewportSource = 'source-breakpoints';
      } else {
        viewports = [...FALLBACK_VIEWPORTS];
        viewportSource = 'fallback';
        warnings.push(
          'the source declared no breakpoints, so only the fallback desktop viewport was captured',
        );
      }
    }

    // Capture the primary viewport on the page that is already loaded.
    const primaryLabel = viewports[0].label;
    const captures: Record<string, LiveNodeTreeCapture> = {};
    captures[primaryLabel] = await captureViewport(primaryPage, viewports[0], options);
    warnings.push(...prefixed(primaryLabel, captures[primaryLabel].warnings));

    // Every other viewport needs its own page: resizing an existing one leaves
    // Framer's runtime holding the previous breakpoint's variant, and the boxes
    // then describe a layout that is no longer rendered.
    for (const viewport of viewports.slice(1)) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
      });
      try {
        await gotoSettled(page, options.url, timeoutMs, settleMs);
        captures[viewport.label] = await captureViewport(page, viewport, options);
        warnings.push(...prefixed(viewport.label, captures[viewport.label].warnings));
      } finally {
        await page.close();
      }
    }

    return assemble(ir, { captures, viewports, viewportSource, motion, options, warnings });
  } finally {
    await primaryPage.close();
  }
}

/**
 * Turn the captures into a merged, expanded IR.
 *
 * Separated from the browser work so the whole decision path is testable with
 * fixture captures and no Playwright.
 */
export function assembleLiveCapture(input: {
  ir: VisualPageIR;
  captures: Record<string, LiveNodeTreeCapture>;
  viewports: readonly ViewportConfig[];
  viewportSource: LiveCaptureReport['viewportSource'];
  motion?: MotionEvidence;
  options: Pick<LiveCaptureOptions, 'url' | 'skipExpansion'>;
  warnings?: string[];
}): LiveCaptureResult {
  return assemble(input.ir, {
    captures: input.captures,
    viewports: input.viewports,
    viewportSource: input.viewportSource,
    ...(input.motion !== undefined ? { motion: input.motion } : {}),
    options: input.options,
    warnings: [...(input.warnings ?? [])],
  });
}

function assemble(
  ir: VisualPageIR,
  ctx: {
    captures: Record<string, LiveNodeTreeCapture>;
    viewports: readonly ViewportConfig[];
    viewportSource: LiveCaptureReport['viewportSource'];
    motion?: MotionEvidence;
    options: Pick<LiveCaptureOptions, 'url' | 'skipExpansion'>;
    warnings: string[];
  },
): LiveCaptureResult {
  const warnings = ctx.warnings;
  const primaryLabel = ctx.viewports[0]?.label ?? 'desktop';
  const primaryCapture = ctx.captures[primaryLabel];

  // Step 2 — align sections to DOM roots at the primary viewport.
  const alignment = alignSectionRoots(ir.sections, primaryCapture?.roots ?? []);
  warnings.push(...alignment.warnings);
  warnings.push(...alignment.conflicts);

  // Step 3 — expand component instances BEFORE the merge, so motion attribution
  // has the grafted nodes to aim at. See the module docstring: running the merge
  // first left 28 of 31 effects unattributable.
  const expansion: Record<string, ExpansionReport> = {};
  const totals = { expanded: 0, blocked: 0, nodesGrafted: 0 };

  // Assets discovered while grafting. Registered centrally so one image used in
  // five component instances becomes ONE asset entry — and, more importantly, so
  // a grafted image node has a resolvable `assetId`. Without one the V3 emitter
  // records a blocking `UNSUPPORTED_IMAGE_ASSET`; measured on the live page that
  // was 4 nodes and it refused the entire build.
  const assets = [...ir.assets];
  const assetIdByUrl = new Map(assets.map((asset) => [asset.sourceUrl, asset.id] as const));
  const registerAsset = (url: string, framerName?: string): string => {
    const existing = assetIdByUrl.get(url);
    if (existing !== undefined) return existing;
    const id = `dom-asset-${assetIdByUrl.size + 1}`;
    assetIdByUrl.set(url, id);
    assets.push({
      id,
      kind: url.toLowerCase().includes('.svg') ? 'svg' : 'image',
      sourceUrl: url,
      evidence: {
        sourceIds: framerName !== undefined ? [framerName] : [],
        methods: ['dom', 'computed-style'],
        confidence: 0.85,
        warnings: ['discovered in the rendered DOM during component expansion'],
      },
    });
    return id;
  };

  let expandedSections: VisualSectionIR[] = [...ir.sections];
  if (ctx.options.skipExpansion !== true && primaryCapture !== undefined) {
    expandedSections = ir.sections.map((section, index) => {
      const domIndex = alignment.matches[index]?.domIndex ?? -1;
      const domRoot = domIndex >= 0 ? primaryCapture.roots[domIndex] : undefined;
      if (domRoot === undefined) return section;

      const result = expandComponentInstances(section, domRoot, {
        viewportLabel: primaryLabel,
        registerAsset,
      });
      if (result.report.instances.length === 0) return result.section;

      expansion[section.sourceId] = result.report;
      totals.expanded += result.report.expanded;
      totals.blocked += result.report.blocked;
      totals.nodesGrafted += result.report.nodesGrafted;
      warnings.push(...result.report.conflicts);
      return result.section;
    });
  }

  // Step 4 — geometry and motion, on the expanded tree.
  const live: LiveDomEvidence = {
    viewports: ctx.viewports.map((viewport) => ({
      label: viewport.label,
      width: viewport.width,
      height: viewport.height,
    })),
    byViewport: Object.fromEntries(
      Object.entries(ctx.captures).map(([label, capture]) => [
        label,
        capture.roots.map(toSectionGeometry),
      ]),
    ),
    ...(ctx.motion !== undefined ? { motion: ctx.motion } : {}),
  };

  const merged = mergeLiveDomIntoIr(
    { ...ir, sections: expandedSections, assets },
    live,
    {
      primaryViewportLabel: primaryLabel,
      rootAlignment: alignment.matches.map((match) => match.domIndex),
    },
  );
  warnings.push(...merged.report.warnings);

  const sections = merged.ir.sections;

  // Drop a section that has no nodes AND no measured area.
  //
  // Only doable here: the structural source has no geometry, so it cannot tell a
  // real-but-empty section from a scroll helper. Measured on the live page,
  // `Lenis Smooth Scroll` is exactly that — a 0x0 div hosting a smooth-scroll
  // script. Carried through, it becomes a V3 section with no widgets and fails
  // `G_SUBSTANCE_WIDGETS`, which is a correct verdict about a section that should
  // never have been a section. Anything with nodes or with area is kept: an empty
  // section that occupies space is a real finding, not noise.
  const dropped: string[] = [];
  const keptSections = sections.filter((section) => {
    const boxes = Object.values(section.bboxByViewport);
    const hasArea = boxes.some((box) => box.width > 0 && box.height > 0);
    if (section.nodes.length === 0 && boxes.length > 0 && !hasArea) {
      dropped.push(section.sourceName ?? section.sourceId);
      return false;
    }
    return true;
  });
  for (const name of dropped) {
    warnings.push(
      `section "${name}" was dropped: it has no nodes and a zero-area box at every measured viewport, ` +
        'so it is a script host rather than a page section',
    );
  }

  const nodeCountBefore = countNodes(ir.sections);
  const nodeCountAfter = countNodes(keptSections);

  const finalIr: VisualPageIR = {
    ...merged.ir,
    sections: keptSections,
    assets,
    warnings: [
      ...merged.ir.warnings,
      `live capture: ${alignment.matched}/${ir.sections.length} section(s) aligned, ` +
        `${totals.expanded} component instance(s) expanded (+${totals.nodesGrafted} node(s)), ` +
        `${totals.blocked} blocked`,
      ...(alignment.extraDomRoots.length > 0
        ? [
            `${alignment.extraDomRoots.length} rendered root(s) have no structural section and were NOT ` +
              `converted: ${alignment.extraDomRoots.map((extra) => extra.domName ?? extra.tag).join(', ')}`,
          ]
        : []),
    ],
  };

  return {
    ir: finalIr,
    report: {
      url: ctx.options.url,
      viewports: ctx.viewports.map((viewport) => viewport.label),
      viewportSource: ctx.viewportSource,
      namedNodeCount: Object.fromEntries(
        Object.entries(ctx.captures).map(([label, capture]) => [label, capture.namedNodeCount]),
      ),
      alignment,
      merge: merged.report,
      expansion,
      expansionTotals: totals,
      nodeCountBefore,
      nodeCountAfter,
      warnings,
    },
  };
}

/**
 * Project a captured node onto the section-geometry shape the merge consumes.
 *
 * `childCount` is the NAMED child count, not the DOM child count: the merge uses
 * it for diagnostics, and reporting Framer's wrapper divs there would describe a
 * tree nobody authored.
 */
function toSectionGeometry(node: LiveDomNode): LiveSectionGeometry {
  return {
    tag: node.tag,
    ...(node.framerName !== undefined ? { framerName: node.framerName } : {}),
    childCount: node.children.length,
    bbox: node.bbox,
    ...(node.styles?.display !== undefined ? { display: node.styles.display } : {}),
    ...(node.styles?.['background-color'] !== undefined
      ? { backgroundColor: node.styles['background-color'] }
      : {}),
  };
}

async function captureViewport(
  page: Page,
  viewport: ViewportConfig,
  options: LiveCaptureOptions,
): Promise<LiveNodeTreeCapture> {
  return captureLiveNodeTree(page, {
    ...(options.maxNodes !== undefined ? { maxNodes: options.maxNodes } : {}),
  });
}

/**
 * Navigate and wait for the page to stop moving.
 *
 * `networkidle` alone is not enough for a Framer page: hydration replaces the
 * SSR markup, and a capture taken between the two reads boxes from DOM that is
 * about to be discarded.
 */
async function gotoSettled(page: Page, url: string, timeoutMs: number, settleMs: number): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
  await page.waitForTimeout(settleMs);
}

function prefixed(label: string, messages: readonly string[]): string[] {
  return messages.map((message) => `${label}: ${message}`);
}

function countNodes(sections: readonly VisualSectionIR[]): number {
  const walk = (nodes: readonly { children: readonly unknown[] }[]): number =>
    nodes.reduce(
      (total, node) =>
        total + 1 + walk(node.children as readonly { children: readonly unknown[] }[]),
      0,
    );
  return sections.reduce((total, section) => total + walk(section.nodes), 0);
}

/** Derive capture viewports from a source breakpoint payload. */
export function viewportsFromWidths(widths: readonly number[]): ViewportConfig[] {
  return [...new Set(widths)]
    .sort((a, b) => b - a)
    .map((width) => ({
      label: width >= 1200 ? 'desktop' : width >= 760 ? 'tablet' : 'mobile',
      width,
      height: conventionalViewportHeight(width),
    }));
}

/** Human-readable summary for a run report or the CLI. */
export function formatLiveCaptureReport(report: LiveCaptureReport): string {
  const lines = [
    `Live capture: ${report.url}`,
    `  viewports: ${report.viewports.join(', ')} (from ${report.viewportSource})`,
    `  named nodes: ${Object.entries(report.namedNodeCount).map(([label, count]) => `${label}=${count}`).join(', ')}`,
    `  IR nodes: ${report.nodeCountBefore} → ${report.nodeCountAfter}`,
    `  component instances: ${report.expansionTotals.expanded} expanded, ` +
      `${report.expansionTotals.blocked} blocked, +${report.expansionTotals.nodesGrafted} node(s)`,
    `  geometry: ${report.merge.sectionsWithGeometry} section(s) with boxes`,
    `  motion: ${report.merge.animationsMapped} animation(s) attributed, ` +
      `${report.merge.animationsUnmapped.length} unattributed`,
    '',
    formatRootAlignment(report.alignment),
  ];
  return lines.join('\n');
}
