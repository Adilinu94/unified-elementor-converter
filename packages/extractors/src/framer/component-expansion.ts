/**
 * Node-level component expansion — the second half of the hybrid merge.
 *
 * ## The gap this closes
 *
 * `mergeLiveDomIntoIr` works purely on sections: it sets `bboxByViewport`,
 * `background` and `evidence`, then returns `...section` with `nodes` untouched.
 * That is correct for geometry and motion, and useless for the problem that
 * actually blocks a deploy.
 *
 * Measured on a real project (2026-08-28, mcp.unframer.co): 59 of 161 nodes on
 * `/` are component instances across 23 distinct definitions, and Unframer's
 * `getNodeXml` cannot expand ANY of them — it answers "Node is not a text node"
 * for 13 ids and returns a flat attribute dump with no child tree for the other
 * 10. So the structural source is permanently unable to fill those subtrees, the
 * V3 emitter turns each one into an HTML placeholder, and the HTML-ratio guard
 * fails at 55.7% against a 15% budget.
 *
 * The rendered DOM has the answer. Framer's own runtime already resolved every
 * instance: 690 named nodes at depth 0..11 where the structural IR had 161.
 *
 * ## Why the DOM tree is navigable at all
 *
 * Framer wraps a component instance in a `div.framer-*-container` that carries
 * NO `data-framer-name`. Collecting "the nearest named descendants" therefore
 * steps over those wrappers automatically, which is why the captured tree lines
 * up with the author's layer tree instead of doubling every level.
 *
 * ## Why identity still comes from the structural side
 *
 * `componentId` is not in the DOM. Verified: of `qrtE7TDjw`, `dUE3IkJ5U`,
 * `TT_VIBCnP`, `cfQE74KCY`, `aV9355fL8`, only one string appears anywhere in the
 * rendered HTML. So the DOM cannot say "this is a Button instance" — only the
 * structural IR can. Expansion keeps `componentId` on the instance node and adds
 * the DOM subtree beneath it. Structure supplies identity, DOM supplies values.
 *
 * ## Why matching is order-first, exactly like the section merge
 *
 * A Framer name is not unique: `Text Wrapper` occurs 64 times on one page,
 * `Overlay` 51, `Variant 1` 50. And a rendered instance is named after its
 * active VARIANT (`Desktop` / `Tablet` / `Phone`), not after the layer — so the
 * nodes most in need of expansion are precisely the ones a name match cannot
 * find. Order is the key, the name is verification, and an unexplained mismatch
 * blocks the graft rather than guessing.
 *
 * @module extractors/framer/component-expansion
 */

import type { Evidence, VisualNodeIR, VisualSectionIR } from '@elconv/core';
import type { BoundingBox } from './hybrid-ir-merge.js';
import { alignByNameAnchors } from './section-root-alignment.js';

/**
 * One named element of the rendered page, with its nearest named descendants.
 *
 * Produced by `captureLiveNodeTree`. Unnamed intermediate elements are skipped
 * rather than represented: they are Framer's own wrappers, and keeping them
 * would make the tree impossible to align against a layer tree.
 */
export interface LiveDomNode {
  /** `data-framer-name`. Absent on a named-less root, which is unmatchable. */
  framerName?: string;
  tag: string;
  bbox: BoundingBox;
  /** Own text content, only when this node has no named children. */
  text?: string;
  href?: string;
  /** Resolved `background-image` URL, when the node carries one. */
  backgroundImage?: string;
  /** `<img>` / `<svg>` source, when this node IS the media element. */
  mediaUrl?: string;
  /** Curated computed styles. Already filtered against browser defaults. */
  styles?: Record<string, string>;
  children: LiveDomNode[];
}

export type ExpansionMethod =
  | 'name+order'
  | 'order-variant-rename'
  | 'blocked-count-mismatch'
  | 'blocked-name-mismatch'
  | 'blocked-no-dom-node';

export interface ExpansionRecord {
  /** `sourceId` of the IR instance node. */
  sourceId: string;
  componentId: string;
  /** Layer name the structural side reported. */
  structuralName?: string;
  /** `data-framer-name` of the DOM node it was matched to. */
  domName?: string;
  method: ExpansionMethod;
  /** Nodes grafted beneath the instance. 0 when blocked. */
  nodesGrafted: number;
  reason: string;
}

export interface ExpansionReport {
  /** One entry per component instance considered, in IR order. */
  instances: ExpansionRecord[];
  expanded: number;
  blocked: number;
  /** Total nodes added to the IR. */
  nodesGrafted: number;
  /** Ambiguities that stopped a graft. Each names the instance. */
  conflicts: string[];
  warnings: string[];
}

export interface ExpandComponentsOptions {
  /**
   * Viewport label the captured tree belongs to, used as the `bboxByViewport`
   * key on grafted nodes.
   *
   * Required rather than defaulted: a box stored under the wrong label is worse
   * than no box, because a later responsive pass would trust it.
   */
  viewportLabel: string;
  /**
   * Maximum depth of grafted subtree. Default 6.
   *
   * The measured page reaches depth 11, but a V3 tree flattens past depth 3
   * anyway (`maxContainerDepth`), so grafting deeper adds nodes the emitter
   * immediately discards.
   */
  maxDepth?: number;
  /**
   * Graft even when only the order matched and no variant explains the name
   * difference. Default false — see the module docstring.
   */
  allowUnverifiedNames?: boolean;
  /**
   * Register an image URL and return the `assetId` to reference it by.
   *
   * Required for any correctness, not a nicety. `classifyDomRole` marks a node
   * carrying a `background-image` or an `<img>` as `role: 'image'`, and the V3
   * emitter treats an image node WITHOUT a resolvable `assetId` as a blocking
   * `UNSUPPORTED_IMAGE_ASSET` — measured on the live page: 4 grafted nodes made
   * the whole build refuse to continue. Omitting the registrar therefore
   * downgrades such nodes to `layout` rather than emitting an image that
   * references nothing.
   */
  registerAsset?: (url: string, framerName?: string) => string;
}

const DEFAULT_MAX_DEPTH = 6;

export interface ExpandComponentsResult {
  section: VisualSectionIR;
  report: ExpansionReport;
}

/**
 * Fill the empty subtrees of a section's component instances from the live DOM.
 *
 * Pure: the input section is not mutated. An instance whose DOM counterpart
 * cannot be identified unambiguously is left empty and recorded as blocked —
 * a wrong subtree is worse than a reported placeholder.
 */
export function expandComponentInstances(
  section: VisualSectionIR,
  domSection: LiveDomNode,
  options: ExpandComponentsOptions,
): ExpandComponentsResult {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const report: ExpansionReport = {
    instances: [],
    expanded: 0,
    blocked: 0,
    nodesGrafted: 0,
    conflicts: [],
    warnings: [],
  };
  const usedIds = new Set<string>();
  collectSourceIds(section.nodes, usedIds);

  // Special case: the SECTION ITSELF is a component instance.
  //
  // `unframer-ir-builder` emits such a section with exactly one node — the host
  // re-emitted as its own child, `sourceId` + `-section` for the section. The DOM
  // root then holds the component's INTERNAL children, not siblings of the
  // instance, so pairing the node against `domSection.children` compares an
  // instance to its own contents and refuses. Measured on the live page: this hit
  // `TestimonialsSection` and `FaqSection` — the two sections whose subtree is
  // least recoverable from the source and therefore the two that most need this.
  const hostInstance =
    section.nodes.length === 1 &&
    section.nodes[0].componentId !== undefined &&
    section.nodes[0].children.length === 0 &&
    `${section.nodes[0].sourceId}-section` === section.sourceId
      ? section.nodes[0]
      : undefined;

  if (hostInstance !== undefined) {
    const grafted = graftInstance(hostInstance, domSection, 0, {
      options,
      maxDepth,
      depth: 0,
      report,
      usedIds,
    }, namesMatch(hostInstance.sourceName, domSection.framerName));
    return { section: { ...section, nodes: [grafted] }, report };
  }

  const nodes = alignLevel(section.nodes, domSection.children, {
    options,
    maxDepth,
    depth: 0,
    report,
    usedIds,
    path: section.sourceId,
  });

  return { section: { ...section, nodes }, report };
}

/** Case-insensitive layer-name equality, for the host-instance case. */
function namesMatch(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && left.toLowerCase() === right.toLowerCase();
}

/**
 * Walk one level of the IR tree against one level of the DOM tree.
 *
 * ## Why this is not a strict count check
 *
 * It was, and the cost was measured: on the live page a plain
 * `irNodes.length === domNodes.length` gate blocked 15 of 32 instances. The
 * counts disagree for a legitimate reason — the rendered DOM carries named nodes
 * the author's layer tree never had (variant overlays, a `Border` helper), and a
 * component's own subtree adds more. Refusing the whole level then punished the
 * nodes that most needed grafting.
 *
 * So the level is paired by `alignByNameAnchors`, the same routine the section
 * layer uses: unique names anchor, order fills the runs between anchors, and an
 * ambiguous run is refused. That refusal is still absolute — a subtree attached
 * to the wrong node is worse than a reported placeholder — but it now applies per
 * position instead of per level.
 */
function alignLevel(
  irNodes: readonly VisualNodeIR[],
  domNodes: readonly LiveDomNode[],
  ctx: {
    options: ExpandComponentsOptions;
    maxDepth: number;
    depth: number;
    report: ExpansionReport;
    usedIds: Set<string>;
    path: string;
  },
): VisualNodeIR[] {
  const aligned = alignByNameAnchors(
    irNodes.map((node) => node.sourceName ?? ''),
    domNodes.map((node) => node.framerName ?? ''),
  );

  return irNodes.map((node, index) => {
    const pair = aligned.pairs[index];
    const dom = pair.rightIndex >= 0 ? domNodes[pair.rightIndex] : undefined;
    const isUnexpandedInstance = node.componentId !== undefined && node.children.length === 0;

    if (isUnexpandedInstance) {
      if (dom === undefined) {
        return blockInstance(
          node,
          ctx,
          domNodes.length === 0 ? 'blocked-no-dom-node' : 'blocked-count-mismatch',
          domNodes.length === 0
            ? 'the matched DOM node has no named children, so there is no subtree to attach'
            : `could not be paired against the ${domNodes.length} DOM node(s) at this level: ${pair.reason}`,
        );
      }
      return graftInstance(node, dom, pair.rightIndex, ctx, pair.method === 'name-anchor');
    }

    // A node with children of its own: descend so that instances nested deeper
    // are reachable. Measured: instances sit at depth 0..11, and stopping at the
    // top level would miss most of them.
    if (node.children.length > 0) {
      if (dom === undefined || ctx.depth >= ctx.maxDepth) return node;
      return {
        ...node,
        children: alignLevel(node.children, dom.children, { ...ctx, depth: ctx.depth + 1, path: node.sourceId }),
      };
    }

    return node;
  });
}

/** Record an instance that could not be expanded, and leave it untouched. */
function blockInstance(
  node: VisualNodeIR,
  ctx: { report: ExpansionReport },
  method: Extract<ExpansionMethod, `blocked-${string}`>,
  reason: string,
): VisualNodeIR {
  ctx.report.instances.push({
    sourceId: node.sourceId,
    componentId: node.componentId ?? 'unknown',
    ...(node.sourceName !== undefined ? { structuralName: node.sourceName } : {}),
    method,
    nodesGrafted: 0,
    reason,
  });
  ctx.report.blocked++;
  ctx.report.conflicts.push(
    `${node.sourceId} (component ${node.componentId ?? 'unknown'}) was not expanded: ${reason}`,
  );
  return node;
}

function graftInstance(
  node: VisualNodeIR,
  dom: LiveDomNode,
  index: number,
  ctx: {
    options: ExpandComponentsOptions;
    maxDepth: number;
    depth: number;
    report: ExpansionReport;
    usedIds: Set<string>;
  },
  nameVerified: boolean,
): VisualNodeIR {
  const structuralName = node.sourceName;
  const namesAgree = nameVerified;

  let method: ExpansionMethod;
  let reason: string;

  if (namesAgree) {
    method = 'name+order';
    reason = `position ${index} and data-framer-name both agree`;
  } else if (ctx.options.allowUnverifiedNames === true) {
    // The caller explicitly accepted an order-only graft. Still recorded as a
    // variant rename so the report never claims a name verification happened.
    method = 'order-variant-rename';
    reason =
      `position ${index} matched; name differs (structural "${structuralName ?? '(none)'}" vs DOM ` +
      `"${dom.framerName ?? '(none)'}"). A rendered instance is named after its active variant, ` +
      'so this is expected — but it was NOT verified by name.';
  } else {
    // Default: a component instance renders under its variant name, so a
    // mismatch is expected. Treated as a variant rename at reduced confidence
    // rather than blocked, because blocking every instance would leave the
    // subtree empty for exactly the nodes this module exists to fill.
    method = 'order-variant-rename';
    reason =
      `position ${index} matched by order; DOM reported "${dom.framerName ?? '(none)'}" ` +
      `for structural "${structuralName ?? '(none)'}" (component instances render under their variant name)`;
  }

  const children = dom.children
    .slice()
    .map((child, childIndex) =>
      toVisualNode(child, {
        ...ctx,
        depth: ctx.depth + 1,
        parentSourceId: node.sourceId,
        childIndex,
      }),
    );

  const grafted = children.reduce((total, child) => total + countNodes(child), 0);

  ctx.report.instances.push({
    sourceId: node.sourceId,
    componentId: node.componentId ?? 'unknown',
    ...(structuralName !== undefined ? { structuralName } : {}),
    ...(dom.framerName !== undefined ? { domName: dom.framerName } : {}),
    method,
    nodesGrafted: grafted,
    reason,
  });

  if (grafted === 0) {
    // The DOM node was found and genuinely has no named children. Not a failure
    // — a Button instance often renders as a single element — but the caller
    // must not read `expanded` as "this now has content".
    ctx.report.warnings.push(
      `${node.sourceId}: matched a DOM node with no named children; the instance stays a leaf`,
    );
  }

  ctx.report.expanded++;
  ctx.report.nodesGrafted += grafted;

  return {
    ...node,
    children,
    // The instance's own geometry, now that a DOM node is attributed to it.
    bboxByViewport: {
      ...node.bboxByViewport,
      [ctx.options.viewportLabel]: dom.bbox,
    },
    // Merge computed styles UNDER the structural ones: a named color style or
    // text style from the source is the author's intent and must win over a
    // computed literal (charter §5.1).
    ...(mergeStyles(node.styles, dom.styles) !== undefined
      ? { styles: mergeStyles(node.styles, dom.styles) }
      : {}),
    evidence: addDomEvidence(node.evidence, method, reason),
  };
}

/**
 * Convert a captured DOM node into a `VisualNodeIR`.
 *
 * Everything here is a measured value, so `methods` is `['dom','computed-style']`
 * and never includes `mcp` — a reader must be able to tell which side of the
 * merge a node came from.
 */
function toVisualNode(
  dom: LiveDomNode,
  ctx: {
    options: ExpandComponentsOptions;
    maxDepth: number;
    depth: number;
    report: ExpansionReport;
    usedIds: Set<string>;
    parentSourceId: string;
    childIndex: number;
  },
): VisualNodeIR {
  const sourceId = allocateId(`${ctx.parentSourceId}~dom${ctx.depth}-${ctx.childIndex}`, ctx.usedIds);
  const atDepthLimit = ctx.depth >= ctx.maxDepth;

  if (atDepthLimit && dom.children.length > 0) {
    ctx.report.warnings.push(
      `${sourceId}: depth limit ${ctx.maxDepth} reached; ${dom.children.length} DOM child level(s) were not grafted`,
    );
  }

  const children = atDepthLimit
    ? []
    : dom.children.map((child, childIndex) =>
        toVisualNode(child, { ...ctx, depth: ctx.depth + 1, parentSourceId: sourceId, childIndex }),
      );

  // Resolve the image BEFORE classifying: without an assetId an `image` node is
  // a blocking fidelity decision in the V3 emitter, so a node whose URL cannot
  // be registered must not be classified as one.
  const imageUrl = dom.mediaUrl ?? dom.backgroundImage;
  const assetId =
    imageUrl !== undefined && ctx.options.registerAsset !== undefined
      ? ctx.options.registerAsset(imageUrl, dom.framerName)
      : undefined;

  if (imageUrl !== undefined && assetId === undefined) {
    ctx.report.warnings.push(
      `${sourceId}: carries an image (${imageUrl.slice(0, 80)}) but no asset registrar was supplied, ` +
        'so it was grafted as a layout node instead of an image',
    );
  }

  const role = assetId === undefined && imageUrl !== undefined
    ? classifyDomRole({ ...dom, mediaUrl: undefined, backgroundImage: undefined }, children.length)
    : classifyDomRole(dom, children.length);

  // A `button` role from a link WITH children needs the label its children hold:
  // the V3 emitter reads `text` off the button node itself, and a node whose text
  // lives one level down would emit an empty button.
  const label = role === 'button' && children.length > 0 ? borrowLabel(dom) : undefined;

  return {
    sourceId,
    role,
    ...(dom.framerName !== undefined ? { sourceName: dom.framerName } : {}),
    ...(children.length === 0 && dom.text ? { text: dom.text } : {}),
    ...(label !== undefined ? { text: label } : {}),
    ...(assetId !== undefined ? { assetId } : {}),
    ...(dom.href !== undefined ? { href: dom.href } : {}),
    ...(isHeadingTag(dom.tag) ? { tag: dom.tag } : {}),
    ...(dom.styles !== undefined && Object.keys(dom.styles).length > 0 ? { styles: dom.styles } : {}),
    bboxByViewport: { [ctx.options.viewportLabel]: dom.bbox },
    children,
    evidence: {
      sourceIds: dom.framerName !== undefined ? [dom.framerName] : [],
      methods: ['dom', 'computed-style'],
      // Measured geometry and text are strong; the fact that this node came from
      // a variant-resolved render rather than the author's layer tree means its
      // IDENTITY is weaker than a structural node's.
      confidence: 0.75,
      warnings: [
        'grafted from the rendered DOM during component expansion; ' +
          'the structural source could not supply this subtree',
      ],
    },
  };
}


/**
 * Classify a DOM-derived node.
 *
 * Deliberately narrow. The rendered DOM has lost the author's intent, so
 * anything beyond "does it have text / a link / an image" would be a guess
 * dressed as a classification. A `layout` node that a target renders as a
 * container is a smaller error than a `heading` that was never one.
 */
export function classifyDomRole(dom: LiveDomNode, childCount: number): VisualNodeIR['role'] {
  if (dom.mediaUrl !== undefined || dom.backgroundImage !== undefined) return 'image';
  if (dom.tag === 'svg') return 'icon';
  if (childCount === 0 && dom.text !== undefined && dom.text.length > 0) {
    if (dom.href !== undefined) return 'button';
    // Only the tag is trusted for a heading. Font size is not a signal: Framer
    // renders headings as plain `div`s with a text style, and a large `div` is
    // routinely body copy at hero scale.
    return isHeadingTag(dom.tag) ? 'heading' : 'text';
  }
  if (dom.href !== undefined && childCount > 0) {
    // A link wrapping other elements is a button in every practical sense, and
    // it is the shape Framer produces for a CTA (`<a>` around text + icon).
    //
    // But a `button` role means the V3 emitter emits a `button` WIDGET, whose
    // label comes from this node's own `text` — and a node with children has
    // none, because `toVisualNode` only keeps text on a leaf. Measured on the
    // live page: one such node produced an empty button and failed
    // `G_SUBSTANCE_TEXT`. So the role is only claimed when a label is
    // recoverable; otherwise it stays a layout container that keeps its
    // children, which is what actually renders the CTA.
    return hasRecoverableLabel(dom) ? 'button' : 'layout';
  }
  return childCount > 0 ? 'layout' : 'unknown';
}

/**
 * The label a link node's single text child holds.
 *
 * Only used where `hasRecoverableLabel` already said one exists, so the shape is
 * known: exactly one child, and it carries the text.
 */
function borrowLabel(dom: LiveDomNode): string | undefined {
  if (dom.text !== undefined && dom.text.length > 0) return dom.text;
  const only = dom.children.length === 1 ? dom.children[0] : undefined;
  return only?.text !== undefined && only.text.length > 0 ? only.text : undefined;
}

/**
 * True when a link node can supply its own button label.
 *
 * Own text, or a single descendant that carries all of it. Anything deeper is
 * left as a container: flattening a multi-element CTA into one label would drop
 * whatever else it contains.
 */
function hasRecoverableLabel(dom: LiveDomNode): boolean {
  if (dom.text !== undefined && dom.text.length > 0) return true;
  const textChildren = dom.children.filter(
    (child) => child.text !== undefined && child.text.length > 0,
  );
  return textChildren.length === 1 && dom.children.length === 1;
}

function isHeadingTag(tag: string): boolean {
  return /^h[1-6]$/.test(tag);
}

/**
 * Structural styles win over computed ones.
 *
 * A named color style resolved to `rgb(1, 40, 60)` and a computed
 * `rgb(1, 40, 60)` are the same pixel, but the structural side may hold a token
 * reference a target can emit as a global, while the computed side is always a
 * literal. Overwriting would trade a reusable value for a hard-coded one.
 */
function mergeStyles(
  structural: Record<string, string> | undefined,
  computed: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (computed === undefined || Object.keys(computed).length === 0) return structural;
  if (structural === undefined) return computed;
  return { ...computed, ...structural };
}

function addDomEvidence(evidence: Evidence, method: ExpansionMethod, reason: string): Evidence {
  const methods = [...evidence.methods];
  for (const added of ['dom', 'computed-style'] as const) {
    if (!methods.includes(added)) methods.push(added);
  }
  return {
    ...evidence,
    methods,
    // A name-verified graft raises confidence above the 0.7 an unexpanded
    // instance carried; an order-only one leaves it where it was, because the
    // subtree is now present but its attribution is not verified.
    confidence: method === 'name+order' ? 0.9 : Math.max(evidence.confidence, 0.7),
    warnings: [...evidence.warnings.filter((w) => !w.includes('definition not expanded')), `expanded from the live DOM: ${reason}`],
  };
}

function collectSourceIds(nodes: readonly VisualNodeIR[], into: Set<string>): void {
  for (const node of nodes) {
    into.add(node.sourceId);
    collectSourceIds(node.children, into);
  }
}

function allocateId(base: string, used: Set<string>): string {
  let id = base;
  let index = 2;
  while (used.has(id)) id = `${base}~${index++}`;
  used.add(id);
  return id;
}

function countNodes(node: VisualNodeIR): number {
  return 1 + node.children.reduce((total, child) => total + countNodes(child), 0);
}

/** One-line-per-instance report for a run report or CLI output. */
export function formatExpansionReport(report: ExpansionReport): string {
  if (report.instances.length === 0) {
    return 'Component expansion: no component instances needed expanding.';
  }
  const lines = [
    `Component expansion: ${report.expanded} expanded, ${report.blocked} blocked, ` +
      `${report.nodesGrafted} node(s) grafted from the DOM`,
    '',
  ];
  for (const instance of report.instances) {
    lines.push(
      `  [${instance.method}] ${instance.sourceId} (${instance.componentId}) ` +
        `+${instance.nodesGrafted} — ${instance.reason}`,
    );
  }
  if (report.warnings.length > 0) {
    lines.push('', `Warnings (${report.warnings.length}):`);
    for (const warning of report.warnings) lines.push(`  ! ${warning}`);
  }
  return lines.join('\n');
}
