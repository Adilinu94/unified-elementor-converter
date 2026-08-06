/**
 * Tree-Chunk Deploy — chunked transport for large _elementor_data (Plugin fc26eb6).
 * Pure planner + registry guard + retry-aware executor. MCP-only safe (~2 KB/chunk).
 */

import type { McpAdapter } from './adapter.js';
import { resolveAbilityName } from './ability-registry.js';
import { measureTreeBytes } from '@elconv/core';
import { unwrapMcpPayload } from './readback.js';
import { isMcpSuccess, warningText, READ_BACK_ABILITY as SHARED_READ_BACK, CLEAR_CACHE_ABILITY as SHARED_CACHE_CLEAR } from './deploy-chunked-shared.js';

export const TREE_CHUNK_BYTES = 2048;
export const TREE_CHUNK_MAX_BYTES = 5242880;
export const TREE_CHUNK_TTL_SECONDS = 900;

export const TREE_CHUNK_START = 'novamira-adrianv2/elementor-tree-chunk-start';
export const TREE_CHUNK_APPEND = 'novamira-adrianv2/elementor-tree-chunk-append';
export const TREE_CHUNK_COMMIT = 'novamira-adrianv2/elementor-tree-chunk-commit';
const READ_BACK_ABILITY = SHARED_READ_BACK;
const CLEAR_CACHE_ABILITY = SHARED_CACHE_CLEAR;

export type TreeChunkKind = 'start' | 'append' | 'commit' | 'read-back' | 'cache-clear';

export interface TreeChunkCall {
  step: number;
  kind: TreeChunkKind;
  ability: string;
  params: Record<string, unknown>;
  chunkIndex: number;
}

export interface TreeChunkPlan {
  strategy: 'tree-chunk';
  target: 'v3' | 'v4';
  postId: number;
  treeBytes: number;
  jsonLength: number;
  chunkBytes: number;
  chunkCount: number;
  requiresSchemaVerification: true;
  calls: TreeChunkCall[];
}

export interface TreeChunkPlanOptions {
  target: 'v3' | 'v4';
  postId: number;
  mode?: 'overwrite' | 'merge_by_id';
  pageTemplate?: 'elementor_canvas' | 'elementor_header_footer' | 'default';
  version?: string;
  chunkBytes?: number;
  sessionIdPlaceholder?: string;
}

function splitByBytes(value: string, chunkBytes: number): string[] {
  const buf = Buffer.from(value, 'utf8');
  const out: string[] = [];
  for (let i = 0; i < buf.length; i += chunkBytes) out.push(buf.subarray(i, i + chunkBytes).toString('utf8'));
  return out;
}

export function planTreeChunkDeploy(tree: unknown[], options: TreeChunkPlanOptions): TreeChunkPlan {
  const { target, postId, mode = 'overwrite', pageTemplate = 'elementor_canvas', version = '3.0.0' } = options;
  const chunkBytes = Math.max(1, options.chunkBytes ?? TREE_CHUNK_BYTES);
  const json = JSON.stringify(tree);
  const jsonLength = Buffer.byteLength(json, 'utf-8');
  if (jsonLength > TREE_CHUNK_MAX_BYTES) {
    throw new Error(`tree-chunk payload ${jsonLength} bytes exceeds 5 MB cap (${TREE_CHUNK_MAX_BYTES}) — reduce tree or use split`);
  }
  const stringChunks = json.length === 0 ? [] : splitByBytes(json, chunkBytes);
  const chunkCount = stringChunks.length;
  const placeholder = options.sessionIdPlaceholder ?? '__SESSION__';
  const calls: TreeChunkCall[] = [];
  let step = 0;

  calls.push({
    step: ++step,
    kind: 'start',
    ability: TREE_CHUNK_START,
    params: { post_id: postId, mode, wp_page_template: pageTemplate, elementor_version: version },
    chunkIndex: 0,
  });

  stringChunks.forEach((chunkData, chunkIndex) => {
    calls.push({
      step: ++step,
      kind: 'append',
      ability: TREE_CHUNK_APPEND,
      params: { session_id: placeholder, chunk_index: chunkIndex, chunk_data: chunkData },
      chunkIndex,
    });
  });

  calls.push({
    step: ++step,
    kind: 'commit',
    ability: TREE_CHUNK_COMMIT,
    params: { session_id: placeholder, post_id: postId },
    chunkIndex: Math.max(0, chunkCount - 1),
  });

  calls.push({
    step: ++step,
    kind: 'read-back',
    ability: READ_BACK_ABILITY,
    params: { post_id: postId, full_dump: true },
    chunkIndex: Math.max(0, chunkCount - 1),
  });

  calls.push({
    step: ++step,
    kind: 'cache-clear',
    ability: CLEAR_CACHE_ABILITY,
    params: { post_ids: [postId] },
    chunkIndex: Math.max(0, chunkCount - 1),
  });

  return {
    strategy: 'tree-chunk',
    target,
    postId,
    treeBytes: measureTreeBytes(tree),
    jsonLength,
    chunkBytes,
    chunkCount,
    requiresSchemaVerification: true,
    calls,
  };
}

export function assertTreeChunkPlanUsesKnownAbilities(plan: TreeChunkPlan): TreeChunkPlan {
  for (const call of plan.calls) resolveAbilityName(call.ability);
  return plan;
}

export interface TreeChunkDeployReport {
  success: boolean;
  strategy: 'tree-chunk';
  sessionId: string;
  chunkCount: number;
  executedSteps: number;
  errors: string[];
}

function isSuccessResponse(raw: unknown): boolean {
  return isMcpSuccess(raw);
}

export async function runTreeChunkDeploy(
  adapter: McpAdapter,
  plan: TreeChunkPlan,
  txId?: string,
): Promise<TreeChunkDeployReport> {
  assertTreeChunkPlanUsesKnownAbilities(plan);
  const errors: string[] = [];
  let executedSteps = 0;
  let sessionId = '';

  const startCall = plan.calls.find((c) => c.kind === 'start');
  if (!startCall) return { success: false, strategy: 'tree-chunk', sessionId: '', chunkCount: plan.chunkCount, executedSteps, errors: ['missing start call'] };

  if (txId) (startCall.params as Record<string, unknown>).transaction_id = txId;
  let startRaw: unknown;
  let hasFatalStartError = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      startRaw = await adapter.executeAbility(startCall.ability, startCall.params);
      executedSteps++;
      if (!isSuccessResponse(startRaw)) {
        if (attempt === 2) hasFatalStartError = true;
        continue;
      }
      const payload = unwrapMcpPayload<{ session_id?: string }>(startRaw, 'session_id');
      sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
      if (!sessionId) {
        if (attempt === 2) hasFatalStartError = true;
        continue;
      }
      hasFatalStartError = false;
      break;
    } catch (err) {
      if (attempt === 2) {
        hasFatalStartError = true;
        errors.push(`start attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  if (hasFatalStartError && !sessionId) {
    errors.push('start failed after retry');
  }

  if (!sessionId) return { success: false, strategy: 'tree-chunk', sessionId: '', chunkCount: plan.chunkCount, executedSteps, errors };

  const appendCalls = plan.calls.filter((c) => c.kind === 'append').sort((a, b) => (a.params.chunk_index as number) - (b.params.chunk_index as number));
  for (const appendCall of appendCalls) {
    let ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      try {
        const raw = await adapter.executeAbility(appendCall.ability, { ...appendCall.params, session_id: sessionId });
        executedSteps++;
        if (isSuccessResponse(raw)) ok = true;
        else errors.push(`append ${appendCall.params.chunk_index} attempt ${attempt}: ${warningText(raw) || 'not success'}`);
      } catch (err) {
        executedSteps++;
        errors.push(`append ${appendCall.params.chunk_index} attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!ok) return { success: false, strategy: 'tree-chunk', sessionId, chunkCount: plan.chunkCount, executedSteps, errors };
  }

  const commitCall = plan.calls.find((c) => c.kind === 'commit');
  if (commitCall) {
    let ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      try {
        const raw = await adapter.executeAbility(commitCall.ability, { session_id: sessionId, post_id: commitCall.params.post_id });
        executedSteps++;
        if (isSuccessResponse(raw)) ok = true;
        else errors.push(`commit attempt ${attempt}: ${warningText(raw) || 'not success'}`);
      } catch (err) {
        executedSteps++;
        errors.push(`commit attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!ok) return { success: false, strategy: 'tree-chunk', sessionId, chunkCount: plan.chunkCount, executedSteps, errors };
  }

  for (const kind of ['read-back', 'cache-clear'] as const) {
    const call = plan.calls.find((c) => c.kind === kind);
    if (!call) continue;
    try {
      const raw = await adapter.executeAbility(call.ability, call.params);
      executedSteps++;
      const ok = kind === 'read-back' ? Array.isArray(unwrapMcpPayload<{ content?: unknown }>(raw, 'content').content) : isSuccessResponse(raw);
      if (!ok) errors.push(`${kind} not verified`);
    } catch (err) {
      executedSteps++;
      errors.push(`${kind}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { success: errors.length === 0 && !!sessionId, strategy: 'tree-chunk', sessionId, chunkCount: plan.chunkCount, executedSteps, errors };
}
