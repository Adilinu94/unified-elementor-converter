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
import { normalizeV3Tree } from './wp-push.js';
import { clearElementorDocumentCache, verifyPersistedTree, type TreeVerificationResult } from './readback.js';

export interface DeployOptions {
  target: 'v3' | 'v4';
  postId: number;
  tree: unknown[];
  strategy?: 'auto' | 'direct' | 'upload-php' | 'split';
  dryRun?: boolean;
  skipVerify?: boolean;
  pageTemplate?: 'elementor_canvas' | 'elementor_header_footer' | 'default';
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
  failureKind?: 'capability-unavailable' | 'deploy-failed' | 'verification-failed';
  verification?: TreeVerificationResult;
}

const V3_INJECT_ABILITY = 'novamira-adrianv2/elementor-inject-calibrated-page';
const V4_BUILD_ABILITY = 'novamira-adrianv2/batch-build-page';

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

    const deployTree = target === 'v3' ? normalizeV3Tree(tree).tree : tree;
    await executeDirectDeploy(adapter, tx, { ...options, tree: deployTree });

    let verification: TreeVerificationResult | undefined;
    if (!options.skipVerify) {
      verification = await verifyPersistedTree(adapter, postId, deployTree);
      if (!verification.verified) {
        failureKind = 'verification-failed';
        const error = new Error(verification.issues.join('; '));
        const typed = error as Error & {
          failureKind?: DeployReport['failureKind'];
          verification?: TreeVerificationResult;
        };
        typed.failureKind = failureKind;
        typed.verification = verification;
        throw error;
      }
      txManager.addCheckpoint(tx.id, verification.actualElementCount, true);
    } else {
      await clearElementorDocumentCache(adapter, postId);
    }

    txManager.commit(tx.id);
    return {
      success: true,
      transactionId: tx.id,
      strategy,
      bytes,
      durationMs: Date.now() - start,
      dryRun: false,
      errors: [],
      ...(verification ? { verification } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    txManager.fail(tx.id);
    const typed = err as Error & {
      failureKind?: DeployReport['failureKind'];
      verification?: TreeVerificationResult;
    };
    return {
      success: false,
      transactionId: tx.id,
      strategy,
      bytes,
      durationMs: Date.now() - start,
      dryRun: false,
      errors: [message],
      ...((typed.failureKind ?? failureKind) ? { failureKind: typed.failureKind ?? failureKind } : {}),
      ...(typed.verification ? { verification: typed.verification } : {}),
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
        elementor_version: '3.0.0',
        wp_page_template: options.pageTemplate ?? 'elementor_canvas',
        transaction_id: tx.id,
      })
    : await adapter.executeAbility<MutationResult>(V4_BUILD_ABILITY, {
        post_id: options.postId,
        elements: options.tree,
        transaction_id: tx.id,
      });
  assertMutationSucceeded(result, `${options.target} direct deploy`);
}
