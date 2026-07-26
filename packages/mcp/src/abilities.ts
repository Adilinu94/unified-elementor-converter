/**
 * Typed ability wrappers for Novamira MCP Plugin.
 * Each function wraps a specific Novamira ability with proper typing.
 */

import type { McpAdapter } from './adapter.js';

// --- V3 Abilities ---

export interface InjectCalibratedPageParams {
  post_id: number;
  _elementor_data: unknown[];
  elementor_version?: string;
  wp_page_template?: string;
}

export interface InjectCalibratedPageResult {
  post_id: number;
  permalink: string;
}

export async function injectCalibratedPage(
  adapter: McpAdapter,
  params: InjectCalibratedPageParams,
): Promise<InjectCalibratedPageResult> {
  return adapter.executeAbility<InjectCalibratedPageResult>(
    'novamira-adrianv2/inject-calibrated-page',
    {
      post_id: params.post_id,
      _elementor_data: JSON.stringify(params._elementor_data),
      elementor_version: params.elementor_version ?? '3.25.0',
      wp_page_template: params.wp_page_template ?? 'elementor_canvas',
    },
  );
}

// --- V4 Abilities ---

export interface BatchBuildPageParams {
  content: unknown[];
  post_id?: number;
  title?: string;
  page_css?: string;
  page_js?: string;
}

export interface BatchBuildPageResult {
  post_id: number;
  permalink: string;
  edit_url: string;
  summary: { total_elements: number; atomic_elements: number; v3_elements: number };
}

export async function batchBuildPage(
  adapter: McpAdapter,
  params: BatchBuildPageParams,
): Promise<BatchBuildPageResult> {
  const result = await adapter.executeAbility<{ success: boolean; data: BatchBuildPageResult }>(
    'novamira-adrianv2/batch-build-page',
    params as unknown as Record<string, unknown>,
  );
  return result.data;
}

// --- Shared Abilities ---

export async function executePhp(adapter: McpAdapter, code: string): Promise<string> {
  const result = await adapter.executeAbility<{ success: boolean; data: { output: string } }>(
    'novamira-adrianv2/execute-php',
    { code },
  );
  return result.data.output;
}

export interface V4FoundationData {
  success: boolean;
  base_classes: Record<string, { status: 'created' | 'exists'; id: string }>;
  variables: { colors: Record<string, string>; fonts: Record<string, string>; sizes: Record<string, string> };
  classes: Record<string, string>;
}

export async function setupV4Foundation(adapter: McpAdapter): Promise<V4FoundationData> {
  const result = await adapter.executeAbility<{ success: boolean; data: V4FoundationData }>(
    'novamira-adrianv2/setup-v4-foundation',
    { create_missing: true },
  );
  return result.data;
}

export interface VariableEntry {
  id: string;
  label: string;
  type: 'color' | 'font' | 'size';
  value: string;
}

export async function listVariables(adapter: McpAdapter): Promise<VariableEntry[]> {
  const result = await adapter.executeAbility<{ success: boolean; data: { variables: VariableEntry[] } }>(
    'novamira/elementor-list-variables',
    {},
  );
  return result.data.variables ?? [];
}

export interface GlobalClassEntry {
  id: string;
  label: string;
  type: string;
  variants: Array<{ meta: { breakpoint: string; state: string | null }; props: Record<string, unknown> }>;
}

export async function listGlobalClasses(adapter: McpAdapter): Promise<GlobalClassEntry[]> {
  const result = await adapter.executeAbility<{ success: boolean; data: { classes: GlobalClassEntry[] } }>(
    'novamira/elementor-list-global-classes',
    {},
  );
  return result.data.classes ?? [];
}

export async function clearDocumentCache(adapter: McpAdapter, postIds: number[]): Promise<void> {
  await adapter.executeAbility('novamira-adrianv2/elementor-clear-document-cache', {
    post_ids: postIds,
  });
}

export interface ListMediaItem {
  id: number;
  title: string;
  mime: string;
  url?: string;
  width?: number;
  height?: number;
  alt?: string;
}

export async function listMedia(
  adapter: McpAdapter,
  params: { per_page?: number; search?: string; mime_type?: string } = {},
): Promise<ListMediaItem[]> {
  const result = await adapter.executeAbility<{ success: boolean; data: { media?: ListMediaItem[] } }>(
    'novamira-adrianv2/list-media',
    params,
  );
  return result.data.media ?? [];
}

export interface ApplyGlobalClassParams {
  element_id: string;
  class_id: string;
  post_id: number;
}

export async function applyGlobalClass(
  adapter: McpAdapter,
  params: ApplyGlobalClassParams,
): Promise<{ element_id: string; class_id: string }> {
  const result = await adapter.executeAbility<{ success: boolean; data: { element_id: string; class_id: string } }>(
    'novamira/elementor-apply-global-class',
    params as unknown as Record<string, unknown>,
  );
  return result.data;
}

// ============================================================================
// Phase 56: Asset Upload (uses chunked-deploy infrastructure)
// ============================================================================

export interface AssetUploadEntry {
  key: string;
  filename: string;
  originalFilename: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64?: string;
  status: 'pending' | 'uploading' | 'done' | 'failed';
  wpMediaId?: number;
  wpUrl?: string;
  error?: string;
}

export interface AssetUploadQueue {
  meta: {
    assetsDir: string;
    totalFiles: number;
    queued: number;
    batchSize: number;
    generatedAt: string;
  };
  entries: AssetUploadEntry[];
}

export interface AssetUploadResult {
  key: string;
  filename: string;
  wp_media_id: number;
  wp_url: string;
}

export interface AssetManifest {
  assets: Record<string, { wp_media_id?: number; wp_url?: string | null; wp_upload_error?: string }>;
  meta?: { lastUpdated?: string };
}

/**
 * Upload a single asset to WordPress Media Library.
 */
export async function uploadMediaAsset(
  adapter: McpAdapter,
  params: { filename: string; mime_type: string; content_base64: string },
): Promise<{ wp_media_id: number; url: string }> {
  const result = await adapter.executeAbility<{ success: boolean; data: { id: number; url: string } }>(
    'novamira-adrianv2/adrians-media-upload',
    params,
  );
  return { wp_media_id: result.data.id, url: result.data.url };
}

/**
 * Upload assets in batches using chunked-deploy infrastructure.
 * Processes the queue in CHUNK_SIZE batches with checkpoint verification.
 */
export async function uploadAssetQueue(
  adapter: McpAdapter,
  queue: AssetUploadQueue,
  options: { batchSize?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ results: AssetUploadResult[]; failed: AssetUploadEntry[] }> {
  const { planChunkedDeploy } = await import('./chunked-deploy.js');
  const batchSize = options.batchSize ?? 10;
  const pending = queue.entries.filter((e) => e.status === 'pending');
  const plan = planChunkedDeploy(pending, batchSize);

  const results: AssetUploadResult[] = [];
  const failed: AssetUploadEntry[] = [];

  for (let i = 0; i < plan.chunkCount; i++) {
    const batch = plan.chunks[i] as AssetUploadEntry[];

    for (const entry of batch) {
      if (!entry.contentBase64) {
        entry.status = 'failed';
        entry.error = 'No base64 content';
        failed.push(entry);
        continue;
      }

      try {
        entry.status = 'uploading';
        const uploadResult = await uploadMediaAsset(adapter, {
          filename: entry.filename,
          mime_type: entry.mimeType,
          content_base64: entry.contentBase64,
        });
        entry.status = 'done';
        entry.wpMediaId = uploadResult.wp_media_id;
        entry.wpUrl = uploadResult.url;
        results.push({
          key: entry.key,
          filename: entry.filename,
          wp_media_id: uploadResult.wp_media_id,
          wp_url: uploadResult.url,
        });
      } catch (err) {
        entry.status = 'failed';
        entry.error = (err as Error).message;
        failed.push(entry);
      }
    }

    options.onProgress?.(results.length + failed.length, pending.length);
  }

  return { results, failed };
}

/**
 * Build an asset manifest from upload results.
 */
export function buildAssetManifest(results: AssetUploadResult[], existing?: AssetManifest): AssetManifest {
  const manifest: AssetManifest = existing ?? { assets: {} };
  for (const r of results) {
    manifest.assets[r.key] = { wp_media_id: r.wp_media_id, wp_url: r.wp_url };
  }
  manifest.meta = { lastUpdated: new Date().toISOString() };
  return manifest;
}

// ============================================================================
// Phase 56: HTML-to-Widget-Plan Bridge (shared V3/V4)
// ============================================================================

export interface WidgetPlanStats {
  total_elements?: number;
  native_candidates?: number;
  container_candidates?: number;
  html_required?: number;
  css_blocks?: number;
  script_blocks?: number;
  images?: number;
  links?: number;
  forms?: number;
}

export interface WidgetPlan {
  success?: boolean;
  native_widget_ratio?: number;
  target_surface?: string;
  stats?: WidgetPlanStats;
  summary?: Record<string, unknown>;
  recommendations?: string[];
  css_inventory?: { blocks?: Array<{ selector_hint: string; length: number; features: string[] }>; count?: number };
  js_inventory?: { blocks?: Array<{ selector_hint: string; length: number; features: string[] }>; count?: number };
  unconverted?: Array<{ tag: string; selector_hint: string; reason: string }>;
  error?: string;
  tree?: unknown;
}

export interface HtmlToWidgetPlanParams {
  html: string;
  target_surface?: 'v3' | 'v4';
  max_nodes?: number;
}

/**
 * Bridge to novamira/adrians-html-to-elementor-widget-plan.
 * Analyzes HTML and produces a structured Elementor widget conversion plan.
 * Used by BOTH V3 and V4 targets (generic HTML→Widget bridge).
 */
export async function htmlToWidgetPlan(
  adapter: McpAdapter,
  params: HtmlToWidgetPlanParams,
): Promise<WidgetPlan> {
  const result = await adapter.executeAbility<WidgetPlan>(
    'novamira-adrianv2/adrians-html-to-elementor-widget-plan',
    {
      html: params.html,
      target_surface: params.target_surface ?? 'v4',
      max_nodes: params.max_nodes ?? 250,
    },
  );
  return result;
}

/**
 * Build a fallback plan when MCP widget-plan is unavailable.
 */
export function buildWidgetPlanFallback(html: string, target: 'v3' | 'v4'): WidgetPlan {
  return {
    success: false,
    target_surface: target,
    error: 'MCP ability unavailable — fallback plan generated',
    stats: {
      total_elements: (html.match(/<[a-z]/gi) ?? []).length,
      css_blocks: (html.match(/<style/gi) ?? []).length,
      script_blocks: (html.match(/<script/gi) ?? []).length,
      images: (html.match(/<img/gi) ?? []).length,
    },
    recommendations: [
      'Retry MCP connection',
      'Use local HTML parser as fallback',
      'Reduce max_nodes if HTML is too large',
    ],
  };
}

// ============================================================================
// Phase 56: XML Export Plan (Unframer getNodeXml)
// ============================================================================

export interface XmlExportCallEntry {
  nodeId: string;
  label: string;
  type: 'page' | 'component';
  mcpTool: string;
  mcpParams: { nodeId: string };
  outputFile: string;
  status: 'pending' | 'done' | 'failed';
  error?: string;
}

export interface XmlExportPlan {
  meta: {
    totalNodes: number;
    pages: number;
    components: number;
    exportedAt: string;
    outdir: string;
  };
  calls: XmlExportCallEntry[];
  agentInstructions: string[];
}

export interface ProjectStructure {
  pages?: Array<{ id: string; name?: string }>;
  components?: Array<{ id: string; name?: string }>;
}

/**
 * Build an XML export plan from project structure.
 * Generates getNodeXml MCP calls for each page/component.
 */
export function buildXmlExportPlan(
  project: ProjectStructure,
  outdir: string,
  options: { buildOrder?: string[] } = {},
): XmlExportPlan {
  const calls: XmlExportCallEntry[] = [];
  const pages = project.pages ?? [];
  const components = project.components ?? [];

  // If build order provided, sort components accordingly
  const orderedComponents = options.buildOrder
    ? [...components].sort((a, b) => {
        const ia = options.buildOrder!.indexOf(a.id);
        const ib = options.buildOrder!.indexOf(b.id);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      })
    : components;

  for (const page of pages) {
    calls.push({
      nodeId: page.id,
      label: page.name ?? page.id,
      type: 'page',
      mcpTool: 'unframer/getNodeXml',
      mcpParams: { nodeId: page.id },
      outputFile: `${outdir}/${page.name ?? page.id}.xml`,
      status: 'pending',
    });
  }

  for (const comp of orderedComponents) {
    calls.push({
      nodeId: comp.id,
      label: comp.name ?? comp.id,
      type: 'component',
      mcpTool: 'unframer/getNodeXml',
      mcpParams: { nodeId: comp.id },
      outputFile: `${outdir}/${comp.name ?? comp.id}.xml`,
      status: 'pending',
    });
  }

  return {
    meta: {
      totalNodes: calls.length,
      pages: pages.length,
      components: components.length,
      exportedAt: new Date().toISOString(),
      outdir,
    },
    calls,
    agentInstructions: [
      'Iterate through calls[] in order',
      'For each entry: call unframer/getNodeXml with mcpParams.nodeId',
      'Save XML response to outputFile path',
      'Set call.status = "done" on success, "failed" on error',
      'After all calls: run update-from to generate statistics',
    ],
  };
}

/**
 * Execute a single getNodeXml call via adapter.
 */
export async function getNodeXml(
  adapter: McpAdapter,
  nodeId: string,
): Promise<string> {
  const result = await adapter.call('unframer-get-node-xml', { nodeId }) as { xml?: string };
  if (!result.xml) throw new Error(`No XML returned for node ${nodeId}`);
  return result.xml;
}

/**
 * Get the full project XML structure from Unframer.
 */
export async function getProjectXml(
  adapter: McpAdapter,
): Promise<ProjectStructure> {
  const result = await adapter.call('unframer-get-project-xml', {}) as ProjectStructure;
  return result;
}
