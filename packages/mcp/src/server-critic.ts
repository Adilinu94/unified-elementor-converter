/**
 * Server-side design critique + pipeline-state clients (Phase 108).
 *
 * Wires three live abilities that no repo used before into typed helpers:
 *   - novamira-adrianv2/suggest-design-fixes   → actionable fix recommendations
 *   - novamira-adrianv2/score-distinctiveness  → 0–100 layout-uniqueness score
 *   - novamira-adrianv2/pipeline-state         → server-side session/resume store
 *
 * This closes Phase 73 (Design-Critic ↔ server integration): the local L1
 * critic (packages/qa design-critic) judges computed styles without a server,
 * while these run server-side against a deployed post_id and complement it.
 *
 * Shapes are transcribed from the abilities' live get-ability-info output
 * (verified 2026-07-30), not guessed.
 */
import type { McpAdapter } from './adapter.js';

// ── suggest-design-fixes ────────────────────────────────────────────────────

export interface SuggestDesignFixesResult {
  success: boolean;
  problems: Array<Record<string, unknown>>;
  fixes: Array<Record<string, unknown>>;
  priorityOrder: string[];
  error?: string;
}

interface SuggestDesignFixesRaw {
  success: boolean;
  problems?: Array<Record<string, unknown>>;
  fixes?: Array<Record<string, unknown>>;
  priority_order?: string[];
  error?: string;
}

/** Server-side: translate a page's design-audit issues into fix recommendations. */
export async function suggestDesignFixes(
  adapter: McpAdapter,
  postId: number,
): Promise<SuggestDesignFixesResult> {
  const res = await adapter.executeAbility<SuggestDesignFixesRaw>(
    'novamira-adrianv2/suggest-design-fixes',
    { post_id: postId },
  );
  return {
    success: res.success,
    problems: res.problems ?? [],
    fixes: res.fixes ?? [],
    priorityOrder: res.priority_order ?? [],
    error: res.error,
  };
}

// ── score-distinctiveness ───────────────────────────────────────────────────

export interface DistinctivenessResult {
  success: boolean;
  postId: number;
  /** 0–100; higher = more unique, varied layout. */
  score: number;
  penalties: Array<Record<string, unknown>>;
  recommendations: string[];
  error?: string;
}

interface DistinctivenessRaw {
  success: boolean;
  post_id?: number;
  score?: number;
  penalties?: Array<Record<string, unknown>>;
  recommendations?: string[];
  error?: string;
}

/** Server-side: score how distinctive (non-repetitive) a page's layout is. */
export async function scoreDistinctiveness(
  adapter: McpAdapter,
  postId: number,
): Promise<DistinctivenessResult> {
  const res = await adapter.executeAbility<DistinctivenessRaw>(
    'novamira-adrianv2/score-distinctiveness',
    { post_id: postId },
  );
  return {
    success: res.success,
    postId: res.post_id ?? postId,
    score: res.score ?? 0,
    penalties: res.penalties ?? [],
    recommendations: res.recommendations ?? [],
    error: res.error,
  };
}

// ── pipeline-state (server-side session/resume backend) ─────────────────────

export type PipelineStateAction = 'save' | 'load' | 'cleanup' | 'list';

export interface PipelineStateResult<S = Record<string, unknown>> {
  success: boolean;
  pipelineId?: string;
  state?: S;
  cleaned?: number;
  pipelines?: unknown[];
  count?: number;
  timestamp?: string;
  error?: string;
}

interface PipelineStateRaw<S> {
  success: boolean;
  pipeline_id?: string;
  state?: S;
  cleaned?: number;
  pipelines?: unknown[];
  count?: number;
  timestamp?: string;
  error?: string;
}

/**
 * Server-side pipeline-state store. `save`/`load` need a pipelineId; `save`
 * also needs the state object; `cleanup` accepts maxAgeDays (default 7).
 * A remote alternative to the local `.elconv-wizard-state.json` file so a
 * wizard run can be resumed from any machine.
 */
export async function pipelineState<S = Record<string, unknown>>(
  adapter: McpAdapter,
  action: PipelineStateAction,
  options: { pipelineId?: string; state?: S; maxAgeDays?: number } = {},
): Promise<PipelineStateResult<S>> {
  if ((action === 'save' || action === 'load') && !options.pipelineId) {
    throw new Error(`pipeline-state "${action}" requires a pipelineId`);
  }
  if (action === 'save' && options.state === undefined) {
    throw new Error('pipeline-state "save" requires a state object');
  }
  const params: Record<string, unknown> = { action };
  if (options.pipelineId) params.pipeline_id = options.pipelineId;
  if (options.state !== undefined) params.state = options.state;
  if (options.maxAgeDays !== undefined) params.max_age_days = options.maxAgeDays;

  const res = await adapter.executeAbility<PipelineStateRaw<S>>(
    'novamira-adrianv2/pipeline-state',
    params,
  );
  return {
    success: res.success,
    pipelineId: res.pipeline_id,
    state: res.state,
    cleaned: res.cleaned,
    pipelines: res.pipelines,
    count: res.count,
    timestamp: res.timestamp,
    error: res.error,
  };
}
