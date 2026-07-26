/**
 * V4 Upgrade stage.
 *
 * Converts an already-pushed V3 page to Elementor V4 Atomic Widgets via the
 * novamira-adrianv2/upgrade-page-to-v4 MCP ability. Designed to run as the
 * final pipeline stage, after WP-push and QA/auto-fix have completed — the
 * ability's own docblock confirms this is its intended call site.
 *
 * dry_run is a native parameter of the ability itself (server-side preview,
 * no DB writes), so it is passed straight through rather than short-circuited
 * client-side like wp-push.ts does for its own dry-run concept.
 */
import type { McpAdapter } from './mcp-adapter.js';

export interface UpgradeV4Options {
  postId: number;
  dryRun?: boolean;
}

export type UpgradeV4Status = 'upgraded' | 'skipped' | 'failed' | 'already_v4';

export interface UpgradeV4Result {
  success: boolean;
  status: UpgradeV4Status;
  converted?: number;
  keptV3?: number;
  warnings?: string[];
  error?: string;
}

/** Shape of the novamira-adrianv2/upgrade-page-to-v4 ability response. */
interface UpgradePageToV4Response {
  success: boolean;
  error?: string;
  results?: Record<
    string,
    {
      status: UpgradeV4Status;
      converted?: number;
      kept_v3?: number;
      warnings?: string[];
      error?: string;
    }
  >;
}

/**
 * Upgrade a single pushed V3 page to Elementor V4 Atomic Widgets via MCP.
 *
 * @param adapter - Configured MCP adapter pointing at the target WordPress
 * @param options - Upgrade options (single post_id — the pipeline only ever
 *                  upgrades the one page it just pushed)
 */
export async function upgradePageToV4(
  adapter: McpAdapter,
  options: UpgradeV4Options,
): Promise<UpgradeV4Result> {
  const res = await adapter.executeAbility<UpgradePageToV4Response>(
    'novamira-adrianv2/upgrade-page-to-v4',
    { post_ids: [options.postId], dry_run: options.dryRun ?? false },
  );

  if (!res.success) {
    return { success: false, status: 'failed', error: res.error ?? 'unknown error' };
  }

  const perPage = res.results?.[String(options.postId)];
  if (!perPage) {
    return { success: false, status: 'failed', error: 'no result for post_id in response' };
  }

  console.log(`[upgrade-v4] post ${options.postId} → ${perPage.status}`);
  return {
    success: perPage.status === 'upgraded' || perPage.status === 'already_v4',
    status: perPage.status,
    converted: perPage.converted,
    keptV3: perPage.kept_v3,
    warnings: perPage.warnings,
    error: perPage.error,
  };
}
