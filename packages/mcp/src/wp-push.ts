/**
 * WordPress Push — High-level page push with pre-push normalization.
 * Phase 47: Push body + deploy resilience.
 *
 * CRITICAL: Never use batch-build-page for V3 nested trees — it silently
 * ignores nested elements and only saves top-level sections. Always use
 * elementor-inject-calibrated-page with the full _elementor_data array.
 *
 * V3: normalizeV3ContainerTree() → inject-calibrated-page
 * V4: No V3 normalize → batch-build-page
 */

import type { McpAdapter } from './adapter.js';
import {
  clearElementorDocumentCache,
  verifyPersistedTree,
  type TreeVerificationResult,
} from './readback.js';

// ============================================================================
// Types
// ============================================================================

export interface WpPushOptions {
  /** Existing post ID to update. If undefined, a new page is created. */
  postId?: number;
  title: string;
  status: 'draft' | 'publish';
  pageTemplate: 'elementor_canvas' | 'elementor_header_footer' | 'default';
  target: 'v3' | 'v4';
  dryRun?: boolean;
  /** Override the inject ability name (V3 only). */
  injectAbility?: string;
  /** Skip pre-push normalization (not recommended for V3). */
  skipNormalize?: boolean;
  /** Verify cache-cleared persisted content with a semantic read-back. */
  verify?: boolean;
}

export interface WpPushResult {
  postId: number;
  permalink: string;
  /** True when a new WP page was created (no postId in options). */
  created: boolean;
  dryRun: boolean;
  target: 'v3' | 'v4';
  normalizeStats?: NormalizeStats;
  verification?: TreeVerificationResult;
}

export interface NormalizeStats {
  nestedIsInnerFixed: number;
  flexRowWidthFixed: number;
  totalNodes: number;
}

interface ExecutePhpResponse {
  success: boolean;
  error?: string;
  data?: { output?: string };
  output?: string;
}

function assertAbilitySuccess(result: { success?: boolean; error?: string } | null | undefined, operation: string): void {
  if (!result || result.success !== true) {
    throw new Error(`${operation} failed: ${result?.error ?? 'MCP did not confirm success'}`);
  }
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_V3_INJECT_ABILITY = 'novamira-adrianv2/elementor-inject-calibrated-page';
const DEFAULT_V4_BUILD_ABILITY = 'novamira-adrianv2/batch-build-page';

/**
 * CRITICAL WARNING (from wp-push.ts source, adopted verbatim):
 * Never use batch-build-page for V3 nested trees — it silently ignores
 * nested elements and only saves top-level sections.
 */
export const V3_PUSH_WARNING =
  'Never use batch-build-page for V3 nested trees — it silently ignores nested elements and only saves top-level sections.';

// ============================================================================
// PHP Helpers
// ============================================================================

function getPhpOutput(res: ExecutePhpResponse): string {
  return (res.data?.output ?? res.output ?? '').trim();
}

async function createPage(
  adapter: McpAdapter,
  title: string,
  status: 'draft' | 'publish',
): Promise<{ postId: number; permalink: string }> {
  const php = `
$id = wp_insert_post(['post_title' => ${JSON.stringify(title)}, 'post_status' => ${JSON.stringify(status)}, 'post_type' => 'page']);
if (is_wp_error($id)) { throw new Exception($id->get_error_message()); }
echo json_encode(['post_id' => (int) $id, 'permalink' => (string) get_permalink($id)]);
`;
  const res = await adapter.executeAbility<ExecutePhpResponse>('novamira/execute-php', { code: php });
  assertAbilitySuccess(res, 'createPage');
  const raw = getPhpOutput(res);
  if (!raw) throw new Error('[wp-push] execute-php returned empty output for createPage');
  const parsed = JSON.parse(raw) as { post_id: number; permalink: string };
  return { postId: parsed.post_id, permalink: parsed.permalink };
}

async function getPermalink(adapter: McpAdapter, postId: number): Promise<string> {
  const php = `echo get_permalink(${postId.toString()});`;
  const res = await adapter.executeAbility<ExecutePhpResponse>('novamira/execute-php', { code: php });
  assertAbilitySuccess(res, 'getPermalink');
  return getPhpOutput(res);
}

// ============================================================================
// Pre-Push Normalization (V3 only)
// ============================================================================

interface V3Node {
  id?: string;
  elType?: string;
  isInner?: boolean;
  settings?: Record<string, unknown>;
  elements?: V3Node[];
  [key: string]: unknown;
}

/**
 * Normalize V3 container tree before push.
 * Fixes nested isInner flags and flex-row child widths.
 * Ported from site-clone-to-v3/src/builder/v3-container-normalize.ts
 */
export function normalizeV3Tree(tree: unknown[]): { tree: unknown[]; stats: NormalizeStats } {
  let nestedIsInnerFixed = 0;
  let flexRowWidthFixed = 0;
  let totalNodes = 0;

  function walk(nodes: unknown[], depth: number): unknown[] {
    return nodes.map((raw) => {
      const node = raw as V3Node;
      totalNodes++;

      // Fix nested isInner: sections inside sections must have isInner=true
      if (node.elType === 'section' && depth > 0 && !node.isInner) {
        node.isInner = true;
        nestedIsInnerFixed++;
      }

      // Fix flex-row child widths: containers with flex_direction=row
      // need explicit width on children for proper rendering
      const settings = node.settings ?? {};
      if (settings.flex_direction === 'row' && node.elements && node.elements.length > 0) {
        const childWidth = `${(100 / node.elements.length).toFixed(2)}%`;
        for (const child of node.elements) {
          const childNode = child as V3Node;
          const childSettings = childNode.settings ?? {};
          if (!childSettings.width && !childSettings._flex_size) {
            childSettings.width = childWidth;
            childNode.settings = childSettings;
            flexRowWidthFixed++;
          }
        }
      }

      // Recurse into children
      if (node.elements && Array.isArray(node.elements)) {
        node.elements = walk(node.elements, depth + 1) as V3Node[];
      }

      return node;
    });
  }

  const normalized = walk(tree, 0);
  return {
    tree: normalized,
    stats: { nestedIsInnerFixed, flexRowWidthFixed, totalNodes },
  };
}

// ============================================================================
// Main Push Function
// ============================================================================

/**
 * Push an element tree to a WordPress/Elementor page via MCP.
 *
 * V3: Uses elementor-inject-calibrated-page (NOT batch-build-page) so that the
 * full nested V3 tree (section > column > widget) is preserved.
 * Pre-push normalization fixes isInner flags and flex-row widths.
 *
 * V4: Uses batch-build-page with atomic content array.
 * No V3 normalization applied.
 */
export async function pushToWordPress(
  adapter: McpAdapter,
  content: unknown[],
  options: WpPushOptions,
): Promise<WpPushResult> {
  const { target, dryRun = false } = options;

  if (dryRun) {
    return {
      postId: options.postId ?? 0,
      permalink: '',
      created: options.postId === undefined,
      dryRun: true,
      target,
    };
  }

  // Resolve post ID
  let postId: number;
  let permalink: string;
  let created: boolean;

  if (options.postId !== undefined) {
    postId = options.postId;
    created = false;
    permalink = await getPermalink(adapter, postId);
  } else {
    const page = await createPage(adapter, options.title, options.status);
    postId = page.postId;
    permalink = page.permalink;
    created = true;
  }

  // Target-specific push
  let normalizeStats: NormalizeStats | undefined;
  let persistedContent = content;

  if (target === 'v3') {
    // V3: Pre-push normalization (critical for nested trees)
    if (!options.skipNormalize) {
      const normalized = normalizeV3Tree(content);
      persistedContent = normalized.tree;
      normalizeStats = normalized.stats;
    }

    const result = await adapter.executeAbility<{ success?: boolean; error?: string }>(options.injectAbility ?? DEFAULT_V3_INJECT_ABILITY, {
      post_id: postId,
      _elementor_data: persistedContent,
      elementor_version: '3.0.0',
      wp_page_template: options.pageTemplate,
    });
    assertAbilitySuccess(result, 'V3 push');
  } else {
    // V4: batch-build-page (atomic elements, no V3 normalize)
    const result = await adapter.executeAbility<{ success?: boolean; error?: string }>(DEFAULT_V4_BUILD_ABILITY, {
      post_id: postId,
      elements: content,
    });
    assertAbilitySuccess(result, 'V4 push');
  }

  const verification = options.verify
    ? await verifyPersistedTree(adapter, postId, persistedContent)
    : undefined;
  if (!options.verify) {
    // Cache invalidation is part of every real push, even when an explicit
    // verification opt-out is used. The opt-out skips only read-back.
    await clearElementorDocumentCache(adapter, postId);
  }
  if (verification && !verification.verified) {
    const error = new Error(`Persisted Elementor tree verification failed: ${verification.issues.join('; ')}`);
    const typed = error as Error & {
      failureKind: 'verification-failed';
      verification: TreeVerificationResult;
    };
    typed.failureKind = 'verification-failed';
    typed.verification = verification;
    throw typed;
  }

  return { postId, permalink, created, dryRun: false, target, normalizeStats, ...(verification ? { verification } : {}) };
}

// ============================================================================
// Deploy Resilience
// ============================================================================

export interface PushRetryOptions {
  maxRetries?: number;
  backoffMs?: number;
  onRetry?: (attempt: number, error: string) => void;
}

/**
 * Push with retry logic for transient MCP failures.
 */
export async function pushWithRetry(
  adapter: McpAdapter,
  content: unknown[],
  options: WpPushOptions,
  retryOptions: PushRetryOptions = {},
): Promise<WpPushResult> {
  const maxRetries = retryOptions.maxRetries ?? 3;
  const backoffMs = retryOptions.backoffMs ?? 2000;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await pushToWordPress(adapter, content, options);
    } catch (err) {
      lastError = err as Error;
      if (attempt <= maxRetries) {
        retryOptions.onRetry?.(attempt, lastError.message);
        await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
      }
    }
  }

  throw new Error(`[wp-push] Failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
}

/**
 * Validate push preconditions before attempting deploy.
 */
export function validatePushPreconditions(
  content: unknown[],
  options: WpPushOptions,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!content || content.length === 0) {
    issues.push('Content tree is empty');
  }

  if (!options.title && options.postId === undefined) {
    issues.push('Title required when creating a new page');
  }

  if (options.target === 'v3' && content.length > 500) {
    issues.push(`V3 tree has ${content.length} top-level elements — consider splitting`);
  }

  return { valid: issues.length === 0, issues };
}
