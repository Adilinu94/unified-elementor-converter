/**
 * Large-Deploy Planning Contract (O-03 preparation).
 *
 * The `upload-php` and `split` strategies are reachable only through the
 * explicit `largeDeployVerified` opt-in. The live Novamira server still needs
 * the controlled test-target verification described in the release checklist;
 * callers without that opt-in receive `capability-unavailable` and perform no
 * MCP write.
 *
 * What this module provides:
 *  - a pure planner that freezes the INTENDED call sequence (chunking,
 *    replace/append ordering, read-back + cache-clear after every relevant
 *    step) using only registry-known ability names;
 *  - a registry drift guard (`assertPlanUsesKnownAbilities`) so the planned
 *    contract can never silently reference a non-existent ability;
 *  - a mock-executable executor (`runPlannedDeploy`) that proves the contract
 *    is runnable against mock adapters with retry and checkpoint-resume
 *    semantics; the same contract is used by the verified executeDeploy path.
 *
 * `requiresSchemaVerification` is typed as the literal `true` so no code path
 * can accidentally treat a plan as verified.
 */

import type { McpAdapter } from './adapter.js';
import { resolveAbilityName } from './ability-registry.js';
import {
  planChunkedDeploy,
  getResumeIndex,
  canResume as canResumeChunks,
  deployProgress,
  isDeployComplete,
  CHUNK_SIZE,
  type ChunkResult,
} from './chunked-deploy.js';
import { measureTreeBytes } from '@elconv/core';
import { unwrapMcpPayload } from './readback.js';

export type LargeDeployStrategy = 'upload-php' | 'split';

export interface PlannedDeployCall {
  step: number;
  kind: 'deploy' | 'read-back' | 'cache-clear';
  ability: string;
  params: Record<string, unknown>;
  chunkIndex: number;
  mode?: 'replace' | 'append';
}

export interface LargeDeployPlan {
  strategy: LargeDeployStrategy;
  target: 'v3' | 'v4';
  postId: number;
  treeBytes: number;
  chunkSize: number;
  chunkCount: number;
  /** Literal `true` — a plan is never productively verified by construction. */
  requiresSchemaVerification: true;
  calls: PlannedDeployCall[];
}

/**
 * upload-php: medium pages are chunked into at most two calls (replace, append).
 * Trees with two or fewer top-level elements naturally produce a single chunk;
 * the planner derives the real chunk size from the element count.
 */
export const UPLOAD_PHP_CHUNK_COUNT = 2;

/** Planned deploy ability per target — both are already live in the registry. */
const DEPLOY_ABILITY_V3 = 'novamira-adrianv2/elementor-inject-calibrated-page';
const DEPLOY_ABILITY_V4 = 'novamira-adrianv2/batch-build-page';
const READ_BACK_ABILITY = 'novamira/elementor-get-content';
const CLEAR_CACHE_ABILITY = 'novamira/elementor-clear-document-cache';

export interface PlanLargeDeployOptions {
  target: 'v3' | 'v4';
  postId: number;
  strategy: LargeDeployStrategy;
  /** Transaction id — optional in the offline plan; the executor injects one. */
  txId?: string;
  pageTemplate?: 'elementor_canvas' | 'elementor_header_footer' | 'default';
}

function splitChunks(tree: unknown[], strategy: LargeDeployStrategy, chunkSize: number): { chunks: unknown[][]; chunkSize: number } {
  if (strategy === 'upload-php') {
    const size = Math.max(1, Math.ceil(tree.length / UPLOAD_PHP_CHUNK_COUNT));
    return { chunks: planChunkedDeploy(tree, size).chunks, chunkSize: size };
  }
  return { chunks: planChunkedDeploy(tree, chunkSize).chunks, chunkSize };
}

/**
 * Build the frozen, offline parameter contract for a large deploy.
 * Pure data — no MCP call is made here.
 */
export function planLargeDeploy(tree: unknown[], options: PlanLargeDeployOptions): LargeDeployPlan {
  const { target, postId, strategy, txId, pageTemplate = 'elementor_canvas' } = options;
  const { chunks, chunkSize } = splitChunks(tree, strategy, CHUNK_SIZE);
  const calls: PlannedDeployCall[] = [];
  let step = 0;

  chunks.forEach((chunk, chunkIndex) => {
    const mode: 'replace' | 'append' = chunkIndex === 0 ? 'replace' : 'append';

    calls.push({
      step: ++step,
      kind: 'deploy',
      ability: target === 'v3' ? DEPLOY_ABILITY_V3 : DEPLOY_ABILITY_V4,
      params: target === 'v3'
        ? {
            post_id: postId,
            _elementor_data: chunk,
            elementor_version: '3.0.0',
            wp_page_template: pageTemplate,
            transaction_id: txId,
            mode,
          }
        : {
            post_id: postId,
            elements: chunk,
            transaction_id: txId,
            mode,
          },
      chunkIndex,
      mode,
    });

    calls.push({
      step: ++step,
      kind: 'read-back',
      ability: READ_BACK_ABILITY,
      params: { post_id: postId, full_dump: true },
      chunkIndex,
    });

    calls.push({
      step: ++step,
      kind: 'cache-clear',
      ability: CLEAR_CACHE_ABILITY,
      params: { post_ids: [postId] },
      chunkIndex,
    });
  });

  return {
    strategy,
    target,
    postId,
    treeBytes: measureTreeBytes(tree),
    chunkSize,
    chunkCount: chunks.length,
    requiresSchemaVerification: true,
    calls,
  };
}

/**
 * Registry drift guard: every planned ability must resolve to a live ability.
 * Throws `UnknownAbilityError` otherwise. Used by tests and later by the
 * productive path once the server schemas are verified.
 */
export function assertPlanUsesKnownAbilities(plan: LargeDeployPlan): LargeDeployPlan {
  for (const call of plan.calls) {
    resolveAbilityName(call.ability);
  }
  return plan;
}

export interface PlannedChunkResult extends ChunkResult {
  attempts: number;
}

export interface PlannedDeployReport {
  success: boolean;
  strategy: LargeDeployStrategy;
  executedSteps: number;
  chunkResults: PlannedChunkResult[];
  resumeIndex: number;
  canResume: boolean;
  progress: number;
  complete: boolean;
  errors: string[];
}

function callSucceeded(call: PlannedDeployCall, rawResponse: unknown): boolean {
  if (call.kind === 'read-back') {
    const response = unwrapMcpPayload<{ content?: unknown }>(rawResponse, 'content');
    return Array.isArray(response.content);
  }
  const response = unwrapMcpPayload<{ success?: boolean }>(rawResponse, 'success');
  return response?.success === true;
}

/**
 * Execute a planned large deploy against an adapter (mock in tests, real only
 * after the controlled server-side verification). One retry per chunk
 * deploy; on repeated failure the run stops and reports the last verified
 * checkpoint so a later resume can continue from there. Never claims success
 * for unverified chunks. A caller may provide `startChunkIndex` after loading
 * a verified checkpoint; skipped chunks are represented as verified report
 * entries and are not sent again.
 */
export interface RunPlannedDeployOptions {
  /** Start at the first chunk after a verified checkpoint. */
  startChunkIndex?: number;
}

export async function runPlannedDeploy(
  adapter: McpAdapter,
  plan: LargeDeployPlan,
  txId: string,
  options: RunPlannedDeployOptions = {},
): Promise<PlannedDeployReport> {
  assertPlanUsesKnownAbilities(plan);
  const errors: string[] = [];
  const chunkResults: PlannedChunkResult[] = [];
  let executedSteps = 0;
  const startChunkIndex = Math.max(0, Math.min(options.startChunkIndex ?? 0, plan.chunkCount));

  // Preserve prior verified chunks in the report so completion/progress and
  // resumeIndex remain meaningful when a caller continues a saved checkpoint.
  for (let chunkIndex = 0; chunkIndex < startChunkIndex; chunkIndex++) {
    const deployCall = plan.calls.find((call) => call.kind === 'deploy' && call.chunkIndex === chunkIndex);
    const elementCount = deployCall
      ? (Array.isArray(deployCall.params._elementor_data)
          ? deployCall.params._elementor_data.length
          : Array.isArray(deployCall.params.elements)
            ? deployCall.params.elements.length
            : 0)
      : 0;
    chunkResults.push({ chunkIndex, elementCount, success: true, verified: true, attempts: 0 });
  }

  for (let chunkIndex = startChunkIndex; chunkIndex < plan.chunkCount; chunkIndex++) {
    const chunkCalls = plan.calls.filter((c) => c.chunkIndex === chunkIndex);
    const deployCall = chunkCalls.find((c) => c.kind === 'deploy');
    const elementCount = deployCall
      ? (Array.isArray(deployCall.params._elementor_data)
          ? deployCall.params._elementor_data.length
          : Array.isArray(deployCall.params.elements)
            ? deployCall.params.elements.length
            : 0)
      : 0;

    // Deploy with one retry.
    let deployOk = false;
    let attempts = 0;
    if (deployCall) {
      for (let attempt = 1; attempt <= 2 && !deployOk; attempt++) {
        attempts = attempt;
        try {
          const raw = await adapter.executeAbility(deployCall.ability, { ...deployCall.params, transaction_id: txId });
          executedSteps++;
          deployOk = callSucceeded(deployCall, raw);
        } catch (err) {
          executedSteps++;
          errors.push(`chunk ${chunkIndex} deploy attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (!deployOk) {
      chunkResults.push({ chunkIndex, elementCount, success: false, verified: false, attempts, error: 'deploy failed after retry' });
      break;
    }

    // Read-back + cache-clear after the chunk (contract requires both).
    const readBackCall = chunkCalls.find((c) => c.kind === 'read-back');
    const cacheClearCall = chunkCalls.find((c) => c.kind === 'cache-clear');

    let readBackOk = false;
    if (readBackCall) {
      try {
        const raw = await adapter.executeAbility(readBackCall.ability, readBackCall.params);
        executedSteps++;
        readBackOk = callSucceeded(readBackCall, raw);
      } catch (err) {
        executedSteps++;
        errors.push(`chunk ${chunkIndex} read-back: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    let cacheOk = false;
    if (cacheClearCall) {
      try {
        const raw = await adapter.executeAbility(cacheClearCall.ability, cacheClearCall.params);
        executedSteps++;
        cacheOk = callSucceeded(cacheClearCall, raw);
      } catch (err) {
        executedSteps++;
        errors.push(`chunk ${chunkIndex} cache-clear: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const verified = readBackOk && cacheOk;
    chunkResults.push({ chunkIndex, elementCount, success: verified, verified, attempts, error: verified ? undefined : 'read-back or cache-clear failed' });
    if (!verified) break;
  }

  const complete = isDeployComplete(chunkResults, plan.chunkCount);
  return {
    success: complete,
    strategy: plan.strategy,
    executedSteps,
    chunkResults,
    resumeIndex: getResumeIndex(chunkResults),
    canResume: canResumeChunks(chunkResults),
    progress: deployProgress(chunkResults, plan.chunkCount),
    complete,
    errors,
  };
}
