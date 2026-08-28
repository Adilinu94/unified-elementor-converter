/**
 * Unframer layer tree → VisualPageIR.
 *
 * This is the missing producer. Before this module the repo declared
 * `SourceAdapter` and `VisualPageIR` and had a working consumer
 * (`visual-ir-to-v3.ts`) but nothing that produced the IR, so every real
 * conversion fell back to a legacy path.
 *
 * Two structural facts drive the design, both measured against the real
 * Humeen home page (158 nodes):
 *
 *   1. **The tag name is a layer name, not a type.** `<Text>` is a horizontal
 *      wrapper with 27 children; `<Image>` is a background-image frame;
 *      `<5>` is a text node containing "5". Role must come from attributes.
 *
 *   2. **Framer splits sentences across sibling nodes.** The About section has
 *      25 sibling text leaves, each one word, all using `/Heading 3`, inside a
 *      `stackWrap="true"` horizontal stack. That is a text WRAP, not 25
 *      headings — and it is the exact cause of the 140 single-word widgets the
 *      regex HTML path produced. Reassembling these runs is the single most
 *      important thing this module does.
 *
 * @module extractors/framer/unframer-ir-builder
 */

import type {
  Evidence,
  VisualNodeIR,
  VisualPageIR,
  VisualSectionIR,
  ViewportProfile,
} from '@elconv/core';
import { walkUnframerNodes, type UnframerNode, type UnframerParseResult } from './unframer-xml-parser.js';
import {
  resolveColorReference,
  resolveStyleTokens,
  type FramerProjectStyles,
} from './unframer-style-resolver.js';
import { conventionalViewportHeight } from '../browser/types.js';

export interface BuildUnframerIrOptions {
  route: string;
  pageId: string;
  url?: string;
  /** Parsed `getProjectXml`, for style and component resolution. */
  project: FramerProjectStyles;
  /**
   * Reassemble runs of same-style sibling text leaves into one node.
   * Default true; disable only to inspect the raw fragmentation.
   */
  mergeTextRuns?: boolean;
}

export interface BuildUnframerIrResult {
  ir: VisualPageIR;
  /** Diagnostics that are useful even when the build succeeded. */
  stats: {
    nodesParsed: number;
    sectionsEmitted: number;
    textRunsMerged: number;
    textLeavesMerged: number;
    componentInstances: number;
    unresolvedColorPaths: string[];
  };
}

/** Attributes that are structural, not component props. */
const STRUCTURAL_ATTRIBUTES = new Set([
  'nodeId', 'width', 'height', 'componentId', 'variant', 'position', 'top', 'right', 'bottom',
  'left', 'centerX', 'centerY', 'opacity', 'locked', 'visible', 'rotation', 'zIndex', 'overflow',
  'overflowX', 'overflowY', 'layout', 'gap', 'padding', 'stackDirection', 'stackDistribution',
  'stackAlignment', 'stackWrap', 'gridColumns', 'gridRows', 'gridAlignment',
  'gridColumnWidthType', 'gridColumnWidth', 'gridColumnMinWidth', 'gridRowHeightType',
  'gridRowHeight', 'gridFillWidth', 'gridFillHeight', 'gridAlignX', 'gridAlignY',
  'gridColumnSpan', 'gridRowSpan', 'maxWidth', 'minWidth', 'maxHeight', 'minHeight',
  'aspectRatio', 'backgroundColor', 'backgroundImage', 'borderWidth', 'borderStyle',
  'borderColor', 'borderRadius', 'inlineTextStyle', 'font', 'link', 'linkOpenInNewTab', 'svg',
  'imageRendering', 'textTruncation',
]);

/**
 * Build a VisualPageIR from a parsed Unframer page plus project styles.
 *
 * Throws nothing on partial data: missing pieces become warnings so the caller
 * can decide, per the charter's "no silent loss" rule.
 */
export function buildUnframerIr(
  parsed: UnframerParseResult,
  options: BuildUnframerIrOptions,
): BuildUnframerIrResult {
  const warnings = [...parsed.warnings];
  const tokens = resolveStyleTokens(options.project);
  warnings.push(...options.project.warnings);

  const primaryRoot = parsed.primaryRoot;
  if (!primaryRoot) {
    throw new Error('Unframer page has no primary breakpoint root');
  }

  const viewportProfiles = deriveViewportProfiles(parsed, warnings);
  const assets: VisualPageIR['assets'] = [];
  const assetIdByUrl = new Map<string, string>();
  const unresolvedColorPaths = new Set<string>();
  let textRunsMerged = 0;
  let textLeavesMerged = 0;
  let componentInstances = 0;
  let nodesParsed = 0;

  const usedSourceIds = new Set<string>();
  /** IR requires globally unique sourceIds; Framer nodeIds already are, but
   *  merged runs and fallbacks need a collision-free allocator. */
  function sourceIdFor(node: UnframerNode, suffix = ''): string {
    const base = `${node.nodeId ?? `anon-${node.tag}`}${suffix}`;
    let id = base;
    let index = 2;
    while (usedSourceIds.has(id)) id = `${base}~${index++}`;
    usedSourceIds.add(id);
    return id;
  }

  function evidenceFor(node: UnframerNode, confidence: number, nodeWarnings: string[] = []): Evidence {
    return {
      sourceIds: node.nodeId ? [node.nodeId] : [],
      methods: ['mcp', 'xml'],
      confidence,
      warnings: nodeWarnings,
    };
  }

  function registerAsset(url: string, node: UnframerNode): string {
    const existing = assetIdByUrl.get(url);
    if (existing) return existing;
    const id = `asset-${assetIdByUrl.size + 1}`;
    assetIdByUrl.set(url, id);
    assets.push({
      id,
      kind: url.toLowerCase().endsWith('.svg') ? 'svg' : 'image',
      sourceUrl: url,
      evidence: evidenceFor(node, 0.95),
    });
    return id;
  }

  function styleSettingsFor(node: UnframerNode): Record<string, string> {
    const a = node.attributes;
    const styles: Record<string, string> = {};

    const background = resolveColorReference(a.backgroundColor, tokens.colors);
    if (background.color) styles['background-color'] = background.color;
    if (background.unresolvedPath) unresolvedColorPaths.add(background.unresolvedPath);

    if (a.padding) styles.padding = a.padding;
    if (a.gap) styles.gap = a.gap;
    if (a.borderRadius) styles['border-radius'] = a.borderRadius;
    if (a.maxWidth) styles['max-width'] = a.maxWidth;
    if (a.minHeight) styles['min-height'] = a.minHeight;
    if (a.opacity) styles.opacity = a.opacity;

    // Layout intent, expressed as CSS so the target maps it, not us.
    if (a.layout === 'stack') {
      styles.display = 'flex';
      styles['flex-direction'] = a.stackDirection === 'horizontal' ? 'row' : 'column';
      if (a.stackDistribution) styles['justify-content'] = toJustifyContent(a.stackDistribution);
      if (a.stackAlignment) styles['align-items'] = toAlignItems(a.stackAlignment);
      if (a.stackWrap === 'true') styles['flex-wrap'] = 'wrap';
    } else if (a.layout === 'grid') {
      styles.display = 'grid';
    }

    // A text style contributes typography; the size/lineHeight live in tokens
    // so the target can choose a reference over a literal.
    const textStyle = a.inlineTextStyle ? tokens.textStyles[a.inlineTextStyle] : undefined;
    if (textStyle) {
      if (textStyle.family) styles['font-family'] = textStyle.family;
      if (textStyle.weight !== undefined) styles['font-weight'] = String(textStyle.weight);
      if (textStyle.size) styles['font-size'] = textStyle.size;
      if (textStyle.lineHeight) styles['line-height'] = textStyle.lineHeight;
      if (textStyle.letterSpacing) styles['letter-spacing'] = textStyle.letterSpacing;
    } else if (a.inlineTextStyle) {
      warnings.push(`${node.nodeId ?? node.tag}: text style "${a.inlineTextStyle}" is not in the project`);
    }

    return styles;
  }

  function classifyRole(node: UnframerNode): VisualNodeIR['role'] {
    const a = node.attributes;
    // Order matters: a component instance is a component regardless of what
    // its layer was named or which props it carries.
    if (a.componentId) return 'component';
    if (a.backgroundImage) return 'image';
    if (a.svg) return 'icon';
    const hasOwnText = node.text.length > 0 && node.children.length === 0;
    if (hasOwnText) {
      if (a.link) return 'button';
      const tag = a.inlineTextStyle ? tokens.tagByTextStyle[a.inlineTextStyle] : undefined;
      // The text style's tag is the ONLY reliable heading signal. Framer layer
      // names are free text and font size alone does not imply a heading.
      return tag && /^h[1-6]$/.test(tag) ? 'heading' : 'text';
    }
    if (a.layout || node.children.length > 0) return 'layout';
    return 'unknown';
  }

  /**
   * Reassemble runs of consecutive pure-text siblings that share one text
   * style into a single node.
   *
   * Verified necessary: the About section is a `stackWrap="true"` horizontal
   * stack of 25 one-word `/Heading 3` leaves that render as one paragraph.
   * A run is broken by any non-text sibling — the `<Title>` component instance
   * in the middle of that stack correctly splits it into two runs (10 + 15)
   * instead of swallowing the component.
   */
  function mergeChildren(parent: UnframerNode): UnframerNode[] {
    if (options.mergeTextRuns === false) return parent.children;
    const a = parent.attributes;
    // Only inside a wrapping horizontal stack: that is what makes the siblings
    // a single visual line of text rather than a deliberate column of labels.
    const isTextWrap = a.layout === 'stack' && a.stackDirection === 'horizontal' && a.stackWrap === 'true';
    if (!isTextWrap) return parent.children;

    const out: UnframerNode[] = [];
    let run: UnframerNode[] = [];

    const flush = (): void => {
      if (run.length === 0) return;
      if (run.length === 1) {
        out.push(run[0]!);
      } else {
        out.push(mergeTextRun(run));
        textRunsMerged++;
        textLeavesMerged += run.length;
      }
      run = [];
    };

    for (const child of parent.children) {
      const isPureText = child.text.length > 0 && child.children.length === 0 && !child.attributes.componentId;
      const sameStyle = run.length === 0
        || run[0]!.attributes.inlineTextStyle === child.attributes.inlineTextStyle;
      if (isPureText && sameStyle) {
        run.push(child);
        continue;
      }
      flush();
      if (isPureText) run.push(child);
      else out.push(child);
    }
    flush();
    return out;
  }

  function emitNode(node: UnframerNode): VisualNodeIR {
    nodesParsed++;
    const a = node.attributes;
    const role = classifyRole(node);
    if (role === 'component') componentInstances++;

    const children = role === 'component' ? [] : mergeChildren(node).map(emitNode);
    const styles = styleSettingsFor(node);
    const nodeWarnings: string[] = [];

    // A component instance is a definition reference plus overrides. Keeping
    // them apart is required by the charter (definition vs instance) and is
    // what lets resolveComponent() fill in the real structure later.
    if (role === 'component') {
      const props = Object.entries(a).filter(([key]) => !STRUCTURAL_ATTRIBUTES.has(key));
      if (props.length > 0) {
        for (const [key, value] of props) styles[`--framer-prop-${key}`] = value;
      }
      nodeWarnings.push(
        `component instance of ${a.componentId}; definition not expanded in this pass`,
      );
    }

    const assetId = a.backgroundImage ? registerAsset(a.backgroundImage, node) : undefined;
    const tag = a.inlineTextStyle ? tokens.tagByTextStyle[a.inlineTextStyle] : undefined;

    return {
      sourceId: sourceIdFor(node),
      role,
      // The verbatim layer name. `role` normalises it away, and the rendered DOM
      // exposes exactly this string as `data-framer-name` — it is the only field
      // a live-DOM merge can verify a match against.
      sourceName: node.tag,
      ...(node.text && node.children.length === 0 ? { text: node.text } : {}),
      ...(assetId ? { assetId } : {}),
      ...(a.link ? { href: a.link } : {}),
      ...(tag ? { tag } : {}),
      ...(a.inlineTextStyle ? { textStylePath: a.inlineTextStyle } : {}),
      ...(a.componentId ? { componentId: a.componentId } : {}),
      ...(Object.keys(styles).length > 0 ? { styles } : {}),
      children,
      // Structure from the MCP is high-confidence; a component instance whose
      // definition has not been expanded is explicitly less so.
      evidence: evidenceFor(node, role === 'component' ? 0.7 : 0.92, nodeWarnings),
    };
  }

  const sectionHosts = findSectionHosts(primaryRoot, warnings);
  const sections: VisualSectionIR[] = sectionHosts.map((host) => {
    nodesParsed++;
    const styles = styleSettingsFor(host);
    const background = resolveColorReference(host.attributes.backgroundColor, tokens.colors);
    const nodes = host.attributes.componentId
      ? [emitNode(host)]
      : mergeChildren(host).map(emitNode);

    return {
      sourceId: sourceIdFor(host, '-section'),
      role: sectionRole(host.tag),
      sourceName: host.tag,
      layoutArchetype: layoutArchetype(host),
      // Framer node ids are stable across republishes; hashed classes are not.
      selector: host.nodeId ? `[data-framer-node-id="${host.nodeId}"]` : undefined,
      // Structure-only extraction has no geometry. The hybrid merge fills this;
      // an empty record is honest, a fabricated bbox would not be.
      bboxByViewport: {},
      ...(Object.keys(styles).length > 0 ? { styles } : {}),
      ...(background.color ? { background: { color: background.color } } : {}),
      nodes,
      evidence: {
        sourceIds: host.nodeId ? [host.nodeId] : [],
        methods: ['mcp', 'xml'],
        confidence: 0.9,
        warnings: [],
      },
    };
  });

  if (unresolvedColorPaths.size > 0) {
    warnings.push(
      `${unresolvedColorPaths.size} color style path(s) could not be resolved: ${[...unresolvedColorPaths].join(', ')}`,
    );
  }
  warnings.push(
    'structure-only extraction: bboxByViewport is empty and no animations were detected. ' +
      'Merge live-DOM evidence for geometry and motion.',
  );

  const ir: VisualPageIR = {
    schemaVersion: '1.0',
    source: {
      ...(options.url ? { url: options.url } : {}),
      route: options.route,
      extractionMode: 'unframer',
      capturedAt: new Date().toISOString(),
      pageId: options.pageId,
    },
    viewportProfiles,
    tokens: {
      colors: tokens.colors,
      fonts: tokens.fonts,
      textStyles: tokens.textStyles,
      spacing: {},
    },
    sections,
    assets,
    animations: [],
    warnings,
  };

  return {
    ir,
    stats: {
      nodesParsed,
      sectionsEmitted: sections.length,
      textRunsMerged,
      textLeavesMerged,
      componentInstances,
      unresolvedColorPaths: [...unresolvedColorPaths],
    },
  };
}

/**
 * Merge a run of text leaves into one synthetic node.
 *
 * The merged node inherits the FIRST leaf's identity so the mapping back to a
 * Framer node stays meaningful, and records every merged id as evidence.
 */
function mergeTextRun(run: UnframerNode[]): UnframerNode {
  const first = run[0]!;
  return {
    tag: first.tag,
    ...(first.nodeId ? { nodeId: first.nodeId } : {}),
    attributes: { ...first.attributes },
    text: run.map((node) => node.text).join(' '),
    children: [],
  };
}

/**
 * Find the nodes that act as page sections.
 *
 * Framer's page root is a breakpoint frame (`Desktop`) containing a single
 * `Main`; the sections are `Main`'s children. Measured: 11 of them, matching
 * the 11 `<section data-framer-name>` elements in the rendered DOM.
 */
function findSectionHosts(primaryRoot: UnframerNode, warnings: string[]): UnframerNode[] {
  // A single wrapper child that itself has several children is the page body.
  let host = primaryRoot;
  while (host.children.length === 1 && host.children[0]!.children.length > 1) {
    host = host.children[0]!;
  }
  if (host.children.length === 0) {
    warnings.push('page root has no section-level children; emitting the root as a single section');
    return [primaryRoot];
  }
  return host.children;
}

/** Map a Framer layer name onto a coarse semantic role. */
function sectionRole(tag: string): string {
  const lower = tag.toLowerCase();
  const KNOWN: Array<[RegExp, string]> = [
    [/hero/, 'hero'],
    [/nav|header/, 'header'],
    [/footer/, 'footer'],
    [/about/, 'about'],
    [/project|portfolio|work/, 'projects'],
    [/partner|logo/, 'partners'],
    [/service/, 'services'],
    [/award/, 'awards'],
    [/testimonial|review/, 'testimonials'],
    [/rating|stat/, 'stats'],
    [/cta|contact/, 'cta'],
    [/faq/, 'faq'],
    [/blog|news/, 'blog'],
    [/pricing|plan/, 'pricing'],
  ];
  for (const [pattern, role] of KNOWN) {
    if (pattern.test(lower)) return role;
  }
  // A layer name is a weak signal (charter §6); fall back to the name itself
  // rather than inventing a role.
  return tag;
}

function layoutArchetype(node: UnframerNode): string {
  const a = node.attributes;
  if (a.componentId) return 'component-instance';
  if (a.layout === 'grid') return 'grid';
  if (a.layout === 'stack') {
    return a.stackDirection === 'horizontal'
      ? (a.stackWrap === 'true' ? 'row-wrap' : 'row')
      : 'column';
  }
  return 'absolute';
}

/**
 * Derive viewport profiles from the breakpoint roots.
 *
 * Framer returns every breakpoint as a root with its real width — 1200 / 810 /
 * 390 for this project. That is the source of truth; the repo's
 * DEFAULT_VIEWPORTS (1440 / 768 / 390) would test 768px, which is on the wrong
 * side of this project's 810px boundary.
 */
function deriveViewportProfiles(parsed: UnframerParseResult, warnings: string[]): ViewportProfile[] {
  const profiles: ViewportProfile[] = [];
  for (const root of parsed.roots) {
    const width = parsePx(root.attributes.width);
    if (width === undefined) continue;
    profiles.push({ label: root.tag.toLowerCase(), width, height: conventionalViewportHeight(width) });
  }
  if (profiles.length === 0) {
    warnings.push('no breakpoint widths found on the page roots; falling back to a single desktop profile');
    return [{ label: 'desktop', width: 1440, height: 900 }];
  }
  return profiles.sort((a, b) => b.width - a.width);
}

function parsePx(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
  return match ? Number(match[1]) : undefined;
}

function toJustifyContent(distribution: string): string {
  const MAP: Record<string, string> = {
    start: 'flex-start',
    center: 'center',
    end: 'flex-end',
    'space-between': 'space-between',
    'space-around': 'space-around',
    'space-evenly': 'space-evenly',
  };
  return MAP[distribution] ?? distribution;
}

function toAlignItems(alignment: string): string {
  const MAP: Record<string, string> = {
    start: 'flex-start',
    center: 'center',
    end: 'flex-end',
  };
  return MAP[alignment] ?? alignment;
}

/** Count IR nodes in a section, for diagnostics and tests. */
export function countIrNodes(section: VisualSectionIR): number {
  let count = 0;
  const visit = (nodes: VisualNodeIR[]): void => {
    for (const node of nodes) {
      count++;
      visit(node.children);
    }
  };
  visit(section.nodes);
  return count;
}

/** Depth-first walk over every node of an IR page. */
export function walkIrNodes(ir: VisualPageIR, visit: (node: VisualNodeIR) => void): void {
  const recurse = (nodes: VisualNodeIR[]): void => {
    for (const node of nodes) {
      visit(node);
      recurse(node.children);
    }
  };
  for (const section of ir.sections) recurse(section.nodes);
}

export { walkUnframerNodes };
