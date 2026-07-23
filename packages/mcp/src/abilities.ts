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
