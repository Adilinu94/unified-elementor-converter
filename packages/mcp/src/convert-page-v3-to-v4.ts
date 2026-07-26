/**
 * TS client for the existing `novamira-adrianv2/convert-page-v3-to-v4`
 * ability (the real PHP converter — see
 * WordPress_mcp_adrian/includes/abilities/elementor/class-convert-page-v3-to-v4.php).
 * UMBAUPLAN-DELTA.md: B1 (the PHP converter itself) already exists; this
 * is only the thin TS-side wrapper the pipeline calls it through, mirroring
 * the convention in upgrade-v4.ts.
 *
 * Response shape (`ConvertPageV3ToV4Response`) is transcribed directly from
 * the ability's `execute()` return array, not guessed — see that file for
 * the source of truth if the PHP side changes.
 */
import type { McpAdapter } from './mcp-adapter.js';

export interface ConvertPageV3ToV4Options {
  postId: number;
  dryRun?: boolean;
  targetPostId?: number;
  unknownWidgetStrategy?: 'keep_v3' | 'skip' | 'error';
  runKitConvert?: boolean;
  variableMap?: Record<string, unknown>;
  classMap?: Record<string, unknown>;
  semanticClasses?: { heading?: string[]; body?: string[]; button?: string[] };
  autoFix?: boolean;
}

export interface ConvertPageV3ToV4Stats {
  elements_read: number;
  converted: number;
  kept_v3: number;
  skipped: number;
  unsupported_widgets: string[];
}

export interface ConvertPageV3ToV4Audit {
  total_issues: number;
  by_severity: { error: number; warning: number; info: number };
  by_type: { layout: number; class: number; responsive: number };
  issues: unknown[];
}

/** Shape of the novamira-adrianv2/convert-page-v3-to-v4 ability response (success case). */
export interface ConvertPageV3ToV4Response {
  success: boolean;
  dry_run: boolean;
  source_post_id: number;
  target_post_id: number | null;
  stats: ConvertPageV3ToV4Stats;
  warnings: string[];
  audit: ConvertPageV3ToV4Audit;
  auto_fix: boolean;
  fixes_applied: number;
  run_kit_convert: boolean;
  /** Only present when dry_run was true. */
  converted_tree?: unknown[];
  kit?: {
    variable_map: Record<string, unknown>;
    semantic_classes: Record<string, string[]>;
    class_map: Record<string, unknown>;
    phase_colors: unknown;
    phase_classes: unknown;
  };
  error?: string;
}

export interface ConvertPageV3ToV4Result {
  success: boolean;
  stats?: ConvertPageV3ToV4Stats;
  warnings?: string[];
  audit?: ConvertPageV3ToV4Audit;
  convertedTree?: unknown[];
  targetPostId?: number | null;
  error?: string;
}

/**
 * Converts a single V3 Elementor page to V4 Atomic via MCP. Dry-run by
 * default, matching the ability's own default (preview only, no DB write).
 */
export async function convertPageV3ToV4(
  adapter: McpAdapter,
  options: ConvertPageV3ToV4Options,
): Promise<ConvertPageV3ToV4Result> {
  const res = await adapter.executeAbility<ConvertPageV3ToV4Response>('novamira-adrianv2/convert-page-v3-to-v4', {
    post_id: options.postId,
    dry_run: options.dryRun ?? true,
    target_post_id: options.targetPostId,
    unknown_widget_strategy: options.unknownWidgetStrategy ?? 'keep_v3',
    run_kit_convert: options.runKitConvert ?? false,
    variable_map: options.variableMap ?? {},
    class_map: options.classMap ?? {},
    semantic_classes: options.semanticClasses ?? {},
    auto_fix: options.autoFix ?? false,
  });

  if (!res.success) {
    return { success: false, error: res.error ?? 'unknown error' };
  }

  console.log(
    `[convert-page-v3-to-v4] post ${res.source_post_id}: ${res.stats.converted} converted, ${res.stats.kept_v3} kept as V3, ${res.stats.skipped} skipped`,
  );

  return {
    success: true,
    stats: res.stats,
    warnings: res.warnings,
    audit: res.audit,
    convertedTree: res.converted_tree,
    targetPostId: res.target_post_id,
  };
}
