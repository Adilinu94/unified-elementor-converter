/**
 * `SourceAdapter` implementation backed by the Unframer MCP.
 *
 * This closes the gap the v7.0 plan identified: `SourceAdapter` and
 * `VisualPageIR` were declared in core, `visual-ir-to-v3.ts` consumed the IR,
 * but nothing produced it. Every real conversion therefore fell back to a
 * legacy path that could not preserve Framer's structure.
 *
 * The transport (`UnframerBridge`) is reused unchanged — JSON-RPC, retry,
 * circuit breaker and idempotency already live there.
 *
 * @module extractors/framer/unframer-source-adapter
 */

import type {
  CapabilityResult,
  PageRef,
  RawComponentEvidence,
  RawPageEvidence,
  SourceAdapter,
  SourceInput,
  SourceManifest,
  VisualPageIR,
} from '@elconv/core';
import { UnframerBridge } from './unframer-bridge.js';
import { parseUnframerXml, type UnframerParseResult } from './unframer-xml-parser.js';
import { parseUnframerProject, type FramerProjectStyles } from './unframer-style-resolver.js';
import { buildUnframerIr, type BuildUnframerIrResult } from './unframer-ir-builder.js';

/**
 * Minimal transport surface this adapter needs.
 *
 * Declared as an interface so tests can supply a fixture-backed fake without
 * a live MCP endpoint or credentials.
 */
export interface UnframerTransport {
  callTool(tool: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface UnframerSourceAdapterOptions {
  transport: UnframerTransport;
  /**
   * Minimum byte length before a page payload is considered substantial.
   *
   * Not arbitrary: `getNodeXml` is documented to answer HTTP 200 with a
   * 71–89 byte empty `<WebPageNode>` wrapper for pages it cannot render
   * (FRAMER-V3-CONVERSION-GELAF-2026-08-01 §14, 9 of 10 routes). 500 bytes sits
   * far above that noise floor and far below the 60,340-byte real response.
   */
  minPageBytes?: number;
}

/** Thrown when a 200 response carries no usable page structure. */
export class SourceIncompleteError extends Error {
  constructor(
    public readonly route: string,
    public readonly byteLength: number,
    public readonly reason: string,
  ) {
    super(
      `Unframer returned no usable structure for "${route}" (${byteLength} bytes): ${reason}. ` +
        'A 200 response with an empty wrapper is NOT a successful extraction ' +
        '(see FRAMER-V3-CONVERSION-GELAF-2026-08-01 §14).',
    );
    this.name = 'SourceIncompleteError';
  }
}

const DEFAULT_MIN_PAGE_BYTES = 500;

/**
 * Assert a page payload actually contains layers.
 *
 * Two independent checks, because either alone is foolable: a short payload
 * cannot hold a page, and a payload with no capitalised element tag holds no
 * Framer layers regardless of length.
 */
export function assertPageEvidenceIsSubstantial(
  xml: string,
  route: string,
  minBytes = DEFAULT_MIN_PAGE_BYTES,
): void {
  if (xml.length < minBytes) {
    throw new SourceIncompleteError(route, xml.length, `payload is shorter than ${minBytes} bytes`);
  }
  if (!/<[A-Z]\w*[\s>/]/.test(xml)) {
    throw new SourceIncompleteError(route, xml.length, 'payload contains no element tags');
  }
  const parsed = parseUnframerXml(xml);
  if (!parsed.primaryRoot) {
    throw new SourceIncompleteError(route, xml.length, 'payload has no primary breakpoint root');
  }
  if (parsed.primaryRoot.children.length === 0) {
    throw new SourceIncompleteError(
      route,
      xml.length,
      `primary root <${parsed.primaryRoot.tag}> has no children (empty wrapper)`,
    );
  }
}

export class UnframerSourceAdapter implements SourceAdapter {
  readonly id = 'unframer';

  private readonly transport: UnframerTransport;
  private readonly minPageBytes: number;
  /** Project XML is fetched once and reused for every page and component. */
  private projectCache: { xml: string; parsed: FramerProjectStyles } | null = null;
  /** Component definitions are fetched once per componentId. */
  private readonly componentCache = new Map<string, string>();

  constructor(options: UnframerSourceAdapterOptions) {
    this.transport = options.transport;
    this.minPageBytes = options.minPageBytes ?? DEFAULT_MIN_PAGE_BYTES;
  }

  /** Build an adapter from `UNFRAMER_MCP_*` env vars / `.env.local`. */
  static fromEnv(options: Omit<UnframerSourceAdapterOptions, 'transport'> = {}): UnframerSourceAdapter | null {
    const bridge = UnframerBridge.fromEnv();
    if (!bridge) return null;
    return new UnframerSourceAdapter({ ...options, transport: bridge });
  }

  async canHandle(input: SourceInput): Promise<CapabilityResult> {
    const reasons: string[] = [];
    const warnings: string[] = [];

    if (input.adapterHint && input.adapterHint !== this.id) {
      return {
        supported: false,
        adapterId: this.id,
        confidence: 0,
        reasons: [`adapterHint requests "${input.adapterHint}"`],
        warnings,
      };
    }

    if (input.projectId) reasons.push('projectId supplied');
    const looksLikeFramer = input.url ? /\.framer\.(app|website|media)\b/.test(input.url) : false;
    if (looksLikeFramer) reasons.push('url is a Framer-hosted domain');

    if (!input.projectId && !looksLikeFramer) {
      return {
        supported: false,
        adapterId: this.id,
        confidence: 0,
        reasons: ['no projectId and the url is not a Framer domain'],
        warnings,
      };
    }

    // Honest capability statement: this adapter reads the design source, so it
    // knows structure and styles but has no geometry and no motion evidence.
    warnings.push('provides structure, text styles and components; provides NO geometry and NO animations');
    return {
      supported: true,
      adapterId: this.id,
      // A projectId is a direct instruction; a domain match is an inference.
      confidence: input.projectId ? 0.95 : 0.7,
      reasons,
      warnings,
    };
  }

  async discover(input: SourceInput): Promise<SourceManifest> {
    const project = await this.loadProject();
    const warnings = [...project.parsed.warnings];

    if (project.parsed.pages.length === 0) {
      warnings.push('project reports no pages; getProjectXml may have returned an empty directory');
    }

    return {
      schemaVersion: '1.0',
      adapterId: this.id,
      source: input,
      discoveredAt: new Date().toISOString(),
      pages: project.parsed.pages.map((page) => ({
        route: page.path,
        sourceId: page.nodeId,
        // A `:slug` segment is a CMS template, not a static page. Converting it
        // as static would silently produce one page for a whole collection.
        kind: page.path.includes(':')
          ? 'dynamic-template'
          : page.path === '/404'
            ? '404'
            : 'static',
      })),
      componentIds: [
        ...project.parsed.components.map((component) => component.nodeId),
        ...project.parsed.codeComponents.map((component) => component.codeFileId),
      ],
      assetIds: [],
      warnings,
    };
  }

  async extractPage(manifest: SourceManifest, page: PageRef): Promise<RawPageEvidence> {
    const xml = await this.fetchNodeXml(page.sourceId);
    assertPageEvidenceIsSubstantial(xml, page.route, this.minPageBytes);

    return {
      page,
      evidence: {
        sourceIds: [page.sourceId],
        methods: ['mcp', 'xml'],
        confidence: 0.92,
        warnings: [`extracted via ${manifest.adapterId}; no geometry in this payload`],
      },
      payload: xml,
    };
  }

  async resolveComponent(_manifest: SourceManifest, componentId: string): Promise<RawComponentEvidence> {
    const cached = this.componentCache.get(componentId);
    if (cached !== undefined) {
      return this.componentEvidence(componentId, cached, ['served from cache']);
    }

    let xml: string;
    try {
      xml = await this.fetchNodeXml(componentId);
    } catch (error) {
      // A failed definition fetch is a real capability gap. Report it as low
      // confidence rather than letting a name heuristic fill the void.
      return {
        componentId,
        evidence: {
          sourceIds: [componentId],
          methods: ['mcp'],
          confidence: 0,
          warnings: [`definition could not be fetched: ${(error as Error).message}`],
        },
        payload: null,
      };
    }

    this.componentCache.set(componentId, xml);
    const warnings = xml.length < 200
      ? [`definition payload is only ${xml.length} bytes; it may be an empty wrapper`]
      : [];
    return this.componentEvidence(componentId, xml, warnings);
  }

  async close(): Promise<void> {
    this.projectCache = null;
    this.componentCache.clear();
  }

  // ==========================================================================
  // IR production
  // ==========================================================================

  /**
   * Produce a validated `VisualPageIR` for one page.
   *
   * Not part of `SourceAdapter` (which stops at raw evidence) but the reason
   * the adapter exists — this is the boundary crossing the charter requires.
   */
  async buildPageIr(manifest: SourceManifest, page: PageRef): Promise<BuildUnframerIrResult> {
    const evidence = await this.extractPage(manifest, page);
    const project = await this.loadProject();
    const parsed: UnframerParseResult = parseUnframerXml(evidence.payload as string);
    return buildUnframerIr(parsed, {
      route: page.route,
      pageId: page.sourceId,
      project: project.parsed,
    });
  }

  /** Convenience: discover + build the IR for a single route. */
  async buildIrForRoute(input: SourceInput, route: string): Promise<VisualPageIR> {
    const manifest = await this.discover(input);
    const page = manifest.pages.find((candidate) => candidate.route === route);
    if (!page) {
      throw new Error(
        `route "${route}" is not in the project; available: ${manifest.pages.map((p) => p.route).join(', ')}`,
      );
    }
    if (page.kind === 'dynamic-template') {
      throw new Error(
        `route "${route}" is a CMS template, not a static page. Converting it as static would ` +
          'emit one page for an entire collection.',
      );
    }
    const { ir } = await this.buildPageIr(manifest, { route: page.route, sourceId: page.sourceId });
    return ir;
  }

  // ==========================================================================
  // Transport
  // ==========================================================================

  private componentEvidence(componentId: string, xml: string, warnings: string[]): RawComponentEvidence {
    return {
      componentId,
      evidence: {
        sourceIds: [componentId],
        methods: ['mcp', 'xml'],
        // A real definition is strong evidence; a suspiciously small one is not.
        confidence: warnings.length > 0 ? 0.5 : 0.9,
        warnings,
      },
      payload: xml,
    };
  }

  private async loadProject(): Promise<{ xml: string; parsed: FramerProjectStyles }> {
    if (this.projectCache) return this.projectCache;
    const raw = await this.transport.callTool('getProjectXml', {});
    const xml = toXmlString(raw);
    if (!xml) throw new Error('getProjectXml returned no XML payload');
    this.projectCache = { xml, parsed: parseUnframerProject(xml) };
    return this.projectCache;
  }

  private async fetchNodeXml(nodeId: string): Promise<string> {
    const raw = await this.transport.callTool('getNodeXml', { nodeId });
    const xml = toXmlString(raw);
    if (!xml) throw new Error(`getNodeXml(${nodeId}) returned no XML payload`);
    return xml;
  }
}

/**
 * Coerce an MCP tool result to an XML string.
 *
 * `UnframerBridge.callTool` already unwraps `content[].text` and JSON-parses
 * when it can, so a response may arrive as a bare string, as `{ xml }` /
 * `{ text }`, or as an array of blocks.
 */
export function toXmlString(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const parts = raw.map(toXmlString).filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join('\n') : null;
  }
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    for (const key of ['xml', 'text', 'content', 'result', 'data']) {
      const value = record[key];
      if (value !== undefined) {
        const nested = toXmlString(value);
        if (nested) return nested;
      }
    }
  }
  return null;
}
