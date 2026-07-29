/**
 * Novamira MCP Client (Phase 70).
 *
 * Reusable high-level client that encapsulates all MCP interactions with
 * the Novamira WordPress plugin. Handles session management, auth, retry,
 * deploy strategies, and rollback.
 *
 * Deploy is dry-run by default; --execute for live write.
 *
 * @module mcp/novamira-client
 */

// ============================================================================
// Types
// ============================================================================

export interface NovamiraConfig {
  /** MCP server endpoint URL. */
  endpoint: string;
  /** WordPress site URL. */
  siteUrl: string;
  /** Auth token for MCP. */
  authToken?: string;
  /** Max retries per call. */
  maxRetries: number;
  /** Timeout per call (ms). */
  timeoutMs: number;
  /** Dry-run mode (default: true). */
  dryRun: boolean;
}

export interface McpCall {
  ability: string;
  params: Record<string, unknown>;
}

export interface McpCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
  attempt: number;
}

export type DeployStrategy = 'direct' | 'upload-php' | 'split-sections';

export interface DeployPlan {
  strategy: DeployStrategy;
  totalSize: number;
  calls: McpCall[];
  rollbackCalls: McpCall[];
  estimatedDurationMs: number;
}

export interface NovamiraSession {
  config: NovamiraConfig;
  callLog: McpCallResult[];
  elementorVersion?: string;
  connectedAt: string;
}

// ============================================================================
// Default config
// ============================================================================

const DEFAULT_CONFIG: NovamiraConfig = {
  endpoint: 'http://localhost:3000/mcp',
  siteUrl: '',
  maxRetries: 3,
  timeoutMs: 30000,
  dryRun: true,
};

// ============================================================================
// Client
// ============================================================================

/**
 * Create a Novamira MCP client session.
 */
export function createSession(config: Partial<NovamiraConfig> = {}): NovamiraSession {
  return {
    config: { ...DEFAULT_CONFIG, ...config },
    callLog: [],
    connectedAt: new Date().toISOString(),
  };
}

/**
 * Build the MCP call to detect Elementor version on the target site.
 */
export function buildDetectVersionCall(): McpCall {
  return {
    ability: 'novamira-adrianv2/execute-php',
    params: {
      code: `
        $version = defined('ELEMENTOR_VERSION') ? ELEMENTOR_VERSION : 'unknown';
        $is_v4 = version_compare($version, '3.99', '>');
        return ['version' => $version, 'is_v4' => $is_v4, 'engine' => $is_v4 ? 'atomic' : 'classic'];
      `,
      description: 'Detect Elementor version',
    },
  };
}

/**
 * Build MCP call to inject page content.
 */
export function buildInjectPageCall(postId: number, content: string): McpCall {
  return {
    ability: 'novamira-adrianv2/set-page-content',
    params: { post_id: postId, content },
  };
}

/**
 * Build MCP call to create a WPCode snippet.
 */
export function buildCreateWpcodeCall(params: {
  title: string;
  code: string;
  code_type: string;
  location: string;
}): McpCall {
  return {
    ability: 'novamira-adrianv2/create-wpcode-snippet',
    params: { ...params, status: 'active', tags: ['elconv'] },
  };
}

/**
 * Build MCP call to update a WPCode snippet.
 */
export function buildUpdateWpcodeCall(snippetId: number, code: string): McpCall {
  return {
    ability: 'novamira-adrianv2/update-wpcode-snippet',
    params: { snippet_id: snippetId, code },
  };
}

/**
 * Build MCP call to clear WordPress cache.
 */
export function buildClearCacheCall(): McpCall {
  return {
    ability: 'novamira-adrianv2/execute-php',
    params: {
      code: `
        if (function_exists('wp_cache_flush')) wp_cache_flush();
        if (function_exists('wp_cache_clear_cache')) wp_cache_clear_cache();
        return ['cleared' => true];
      `,
      description: 'Clear all WordPress caches',
    },
  };
}

/**
 * Build MCP call for render preview (render element in temp post).
 */
export function buildRenderPreviewCall(elementJson: string): McpCall {
  return {
    ability: 'novamira/elementor-render-preview',
    params: { element_json: elementJson },
  };
}

// ============================================================================
// Deploy strategies
// ============================================================================

const SIZE_DIRECT = 400 * 1024;       // < 400KB → direct
const SIZE_UPLOAD = 1200 * 1024;      // < 1.2MB → upload + PHP

/**
 * Determine deploy strategy based on content size.
 */
export function determineDeployStrategy(contentSizeBytes: number): DeployStrategy {
  if (contentSizeBytes < SIZE_DIRECT) return 'direct';
  if (contentSizeBytes < SIZE_UPLOAD) return 'upload-php';
  return 'split-sections';
}

/**
 * Build a full deploy plan with rollback capability.
 */
export function buildDeployPlan(
  postId: number,
  content: string,
  existingContent?: string,
): DeployPlan {
  const size = new TextEncoder().encode(content).length;
  const strategy = determineDeployStrategy(size);
  const calls: McpCall[] = [];
  const rollbackCalls: McpCall[] = [];

  // Backup for rollback
  if (existingContent) {
    rollbackCalls.push(buildInjectPageCall(postId, existingContent));
    rollbackCalls.push(buildClearCacheCall());
  }

  switch (strategy) {
    case 'direct':
      calls.push(buildInjectPageCall(postId, content));
      calls.push(buildClearCacheCall());
      break;

    case 'upload-php': {
      // Previously generated PHP that read from a temp file
      // (/tmp/elconv-deploy-{postId}.json) that no step in this plan ever
      // wrote — the deploy would fail at runtime (file not found / empty
      // content read). No verified MCP ability exists in this codebase yet
      // for the "upload content, then execute-php reads it" pattern the
      // AI-Executor-Playbook describes, so rather than invent an unverified
      // ability call, this tier now uses the same set-page-content chunking
      // as 'split-sections' (in 2 chunks instead of 3) — self-contained,
      // uses only the same already-proven mechanism as the tier below it.
      const sections = JSON.parse(content) as unknown[];
      const chunkSize = Math.max(1, Math.ceil(sections.length / 2));
      for (let i = 0; i < sections.length; i += chunkSize) {
        const chunk = sections.slice(i, i + chunkSize);
        calls.push({
          ability: 'novamira-adrianv2/set-page-content',
          params: {
            post_id: postId,
            content: JSON.stringify(chunk),
            mode: i === 0 ? 'replace' : 'append',
          },
        });
      }
      calls.push(buildClearCacheCall());
      break;
    }

    case 'split-sections': {
      // Parse content and split into top-level sections
      const sections = JSON.parse(content) as unknown[];
      const chunkSize = Math.ceil(sections.length / 3);
      for (let i = 0; i < sections.length; i += chunkSize) {
        const chunk = sections.slice(i, i + chunkSize);
        calls.push({
          ability: 'novamira-adrianv2/set-page-content',
          params: {
            post_id: postId,
            content: JSON.stringify(chunk),
            mode: i === 0 ? 'replace' : 'append',
          },
        });
      }
      calls.push(buildClearCacheCall());
      break;
    }
  }

  return {
    strategy,
    totalSize: size,
    calls,
    rollbackCalls,
    estimatedDurationMs: calls.length * 2000,
  };
}

// ============================================================================
// Execution simulation (dry-run)
// ============================================================================

/**
 * Simulate execution of a deploy plan (dry-run mode).
 * Returns what WOULD happen without actually calling MCP.
 */
export function simulateDeploy(plan: DeployPlan): {
  dryRun: true;
  strategy: DeployStrategy;
  stepsCount: number;
  estimatedDurationMs: number;
  steps: Array<{ step: number; ability: string; summary: string }>;
} {
  return {
    dryRun: true,
    strategy: plan.strategy,
    stepsCount: plan.calls.length,
    estimatedDurationMs: plan.estimatedDurationMs,
    steps: plan.calls.map((call, i) => ({
      step: i + 1,
      ability: call.ability,
      summary: summarizeCall(call),
    })),
  };
}

function summarizeCall(call: McpCall): string {
  const params = call.params;
  if ('post_id' in params) return `post_id=${params['post_id']}`;
  if ('snippet_id' in params) return `snippet_id=${params['snippet_id']}`;
  if ('description' in params) return String(params['description']);
  return JSON.stringify(Object.keys(params));
}
