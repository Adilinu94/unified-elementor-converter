/**
 * Deploy Orchestrator.
 * Coordinates strategy execution after the CLI has completed guards and taken
 * a pre-deploy snapshot. Every remote call goes through executeAbility(), so
 * ability names remain checked against the live registry.
 */

import type { McpAdapter } from './adapter.js';
import type { TransactionManager, Transaction } from './transaction.js';
import { planChunkedDeploy } from './chunked-deploy.js';
import { planLargeDeploy, runPlannedDeploy } from './large-deploy-plan.js';
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
  /**
   * Explicit, deliberate opt-in proving the server-side upload/append schemas
   * of the large-deploy contract were verified against the released test
   * target (O-03). Nothing in the CLI sets this yet — the productive unlock
   * flips it after the controlled live roundtrip. While absent, `executeDeploy`
   * keeps refusing `upload-php`/`split` with `capability-unavailable` and the
   * planned executor is never invoked.
   */
  largeDeployVerified?: boolean;
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
    if (strategy === 'upload-php' || strategy === 'split') {
      // The productive gate stays closed until the caller explicitly opts in
      // with `largeDeployVerified` (proving the server-side schemas were
      // verified against the released test target — O-03). Only then is the
      // frozen planned contract executed via runPlannedDeploy; its own
      // read-back + cache-clear per chunk IS the verification, so skipVerify
      // does not apply here.
      if (!options.largeDeployVerified) {
        failureKind = 'capability-unavailable';
        throw new Error(
          strategy === 'upload-php'
            ? 'upload-php strategy is unavailable: no verified upload/PHP-inject ability schema exists in the live registry'
            : 'split strategy is unavailable: the live append/chunk parameter contract is not verified for the target abilities',
        );
      }
      return await executePlannedLargeDeploy(adapter, txManager, tx, {
        ...options,
        strategy,
      }, bytes);
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

/**
 * Execute a large deploy through the frozen planned contract
 * (`upload-php`/`split`). Only reachable when the caller explicitly set
 * `largeDeployVerified` — the productive gate in `executeDeploy` stays closed
 * otherwise. Builds the plan from the same `planLargeDeploy` used by the
 * offline contract, runs it with the transaction id, and commits on success;
 * a failed run throws so the outer handler fails the transaction and reports
 * `deploy-failed`. Read-back + cache-clear per chunk are part of the planned
 * contract itself.
 */
async function executePlannedLargeDeploy(
  adapter: McpAdapter,
  txManager: TransactionManager,
  tx: Transaction,
  options: DeployOptions & { strategy: 'upload-php' | 'split' },
  bytes: number,
): Promise<DeployReport> {
  const start = Date.now();
  // NOTE (unlock decision): the planned path chunks the raw `options.tree` as
  // the frozen offline contract does, while the direct path deploys
  // `normalizeV3Tree(tree).tree`. The unlock commit must explicitly decide
  // whether V3 normalization must run before planning so both paths ship the
  // same payload.
  const plan = planLargeDeploy(options.tree, {
    target: options.target,
    postId: options.postId,
    strategy: options.strategy,
    txId: tx.id,
    pageTemplate: options.pageTemplate,
  });

  const report = await runPlannedDeploy(adapter, plan, tx.id);
  if (!report.success) {
    const error = new Error(
      `${options.strategy} deploy failed after ${report.executedSteps} step(s): ` +
        (report.errors.join('; ') || 'unknown failure'),
    );
    const typed = error as Error & { failureKind?: DeployReport['failureKind'] };
    typed.failureKind = 'deploy-failed';
    throw error;
  }

  txManager.commit(tx.id);
  return {
    success: true,
    transactionId: tx.id,
    strategy: options.strategy,
    bytes,
    chunks: plan.chunkCount,
    durationMs: Date.now() - start,
    dryRun: false,
    errors: [],
  };
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
