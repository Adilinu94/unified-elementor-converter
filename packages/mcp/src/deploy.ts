/**
 * Deploy Orchestrator.
 * Coordinates strategy execution after the CLI has completed guards and taken
 * a pre-deploy snapshot. Every remote call goes through executeAbility(), so
 * ability names remain checked against the live registry.
 */

import type { McpAdapter } from './adapter.js';
import type { TransactionManager, Transaction } from './transaction.js';
import { planChunkedDeploy } from './chunked-deploy.js';
import { chooseDeployStrategy, measureTreeBytes } from '@elconv/core';

export interface DeployOptions {
  target: 'v3' | 'v4';
  postId: number;
  tree: unknown[];
  strategy?: 'auto' | 'direct' | 'upload-php' | 'split';
  dryRun?: boolean;
  skipVerify?: boolean;
}

export interface DeployReport {
  success: boolean;
  transactionId: string;
  strategy: string;
  bytes: number;
  chunks?: number;
  durationMs: number;
  dryRun: boolean;
  errors: string[];
  failureKind?: 'capability-unavailable' | 'deploy-failed';
}

const V3_INJECT_ABILITY = 'novamira-adrianv2/elementor-inject-calibrated-page';
const V4_BUILD_ABILITY = 'novamira-adrianv2/batch-build-page';
const CLEAR_CACHE_ABILITY = 'novamira/elementor-clear-document-cache';

interface MutationResult {
  success?: boolean;
  error?: string;
  message?: string;
}

function assertMutationSucceeded(result: MutationResult, operation: string): void {
  if (!result || result.success !== true) {
    throw new Error(`${operation} failed: ${result?.error ?? result?.message ?? 'MCP did not confirm success'}`);
  }
}

/**
 * Execute a deploy strategy. Snapshot capture/restore deliberately remains
 * outside this module: the CLI owns the filesystem snapshot and restores it
 * if this function reports a failed mutation or unavailable capability.
 */
export async function executeDeploy(
  adapter: McpAdapter,
  txManager: TransactionManager,
  options: DeployOptions,
): Promise<DeployReport> {
  const start = Date.now();
  const { target, postId, tree, dryRun = false } = options;
  const bytes = measureTreeBytes(tree);
  const strategy = chooseDeployStrategy(bytes, options.strategy === 'auto' ? undefined : options.strategy);
  const tx = txManager.begin(target, postId);
  let failureKind: DeployReport['failureKind'];

  if (dryRun) {
    return {
      success: true,
      transactionId: tx.id,
      strategy,
      bytes,
      chunks: strategy === 'split' ? planChunkedDeploy(tree).chunkCount : undefined,
      durationMs: Date.now() - start,
      dryRun: true,
      errors: [],
    };
  }

  txManager.markInProgress(tx.id);
  try {
    if (strategy === 'upload-php') {
      failureKind = 'capability-unavailable';
      throw new Error(
        'upload-php strategy is unavailable: no verified upload/PHP-inject ability schema exists in the live registry',
      );
    }
    if (strategy === 'split') {
      failureKind = 'capability-unavailable';
      throw new Error(
        'split strategy is unavailable: the live append/chunk parameter contract is not verified for the target abilities',
      );
    }

    await executeDirectDeploy(adapter, tx, options);
    await clearCache(adapter, postId);
    txManager.commit(tx.id);
    return {
      success: true,
      transactionId: tx.id,
      strategy,
      bytes,
      durationMs: Date.now() - start,
      dryRun: false,
      errors: [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    txManager.fail(tx.id);
    return {
      success: false,
      transactionId: tx.id,
      strategy,
      bytes,
      durationMs: Date.now() - start,
      dryRun: false,
      errors: [message],
      ...(failureKind ? { failureKind } : {}),
    };
  }
}

async function executeDirectDeploy(
  adapter: McpAdapter,
  tx: Transaction,
  options: DeployOptions,
): Promise<void> {
  const result = options.target === 'v3'
    ? await adapter.executeAbility<MutationResult>(V3_INJECT_ABILITY, {
        post_id: options.postId,
        _elementor_data: options.tree,
        transaction_id: tx.id,
      })
    : await adapter.executeAbility<MutationResult>(V4_BUILD_ABILITY, {
        post_id: options.postId,
        elements: options.tree,
        transaction_id: tx.id,
      });
  assertMutationSucceeded(result, `${options.target} direct deploy`);
}

async function clearCache(adapter: McpAdapter, postId: number): Promise<void> {
  const result = await adapter.executeAbility<MutationResult>(CLEAR_CACHE_ABILITY, { post_id: postId });
  assertMutationSucceeded(result, 'clear Elementor cache');
}
