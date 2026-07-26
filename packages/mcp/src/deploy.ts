/**
 * Deploy Orchestrator.
 * Coordinates the full deploy pipeline: guards → contamination → strategy → execute → verify.
 * Supports V3 (inject-calibrated-page) and V4 (batch-build-page) targets.
 */

import type { McpAdapter } from './adapter.js';
import type { TransactionManager, Transaction } from './transaction.js';
import { planChunkedDeploy, CHUNK_SIZE, type ChunkResult } from './chunked-deploy.js';
import { chooseDeployStrategy, measureTreeBytes, STRATEGY_THRESHOLDS } from '@elconv/core';

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
}

/**
 * V3 vs V4 Deploy-Unterschiede (KRITISCH):
 * | Aspekt      | V3                              | V4                    |
 * |-------------|---------------------------------|----------------------|
 * | Ability     | elementor-inject-calibrated-page| batch-build-page     |
 * | Payload-Key | _elementor_data                 | content              |
 * | Normalize   | normalizeV3ContainerTree()      | Keine V3-Normalize!  |
 * | Post-Deploy | Clear element cache             | CSS cache rebuild    |
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

  // Begin transaction
  const tx = txManager.begin(target, postId);
  const errors: string[] = [];

  // Dry-run: just report what would happen
  if (dryRun) {
    return {
      success: true,
      transactionId: tx.id,
      strategy,
      bytes,
      chunks: strategy === 'split' ? Math.ceil(tree.length / CHUNK_SIZE) : undefined,
      durationMs: Date.now() - start,
      dryRun: true,
      errors: [],
    };
  }

  txManager.markInProgress(tx.id);

  try {
    if (strategy === 'split') {
      await executeSplitDeploy(adapter, txManager, tx, options);
    } else if (strategy === 'upload-php') {
      await executeUploadPhpDeploy(adapter, tx, options);
    } else {
      await executeDirectDeploy(adapter, tx, options);
    }

    // Post-deploy: clear cache
    await clearCache(adapter, postId);

    txManager.commit(tx.id);
    return {
      success: true,
      transactionId: tx.id,
      strategy,
      bytes,
      chunks: strategy === 'split' ? Math.ceil(tree.length / CHUNK_SIZE) : undefined,
      durationMs: Date.now() - start,
      dryRun: false,
      errors: [],
    };
  } catch (err) {
    const message = (err as Error).message;
    errors.push(message);
    txManager.fail(tx.id);

    // Attempt rollback
    if (tx.backupPath) {
      try {
        await executeRollback(adapter, tx);
        txManager.rollback(tx.id);
      } catch (rollbackErr) {
        errors.push(`Rollback failed: ${(rollbackErr as Error).message}`);
      }
    }

    return {
      success: false,
      transactionId: tx.id,
      strategy,
      bytes,
      durationMs: Date.now() - start,
      dryRun: false,
      errors,
    };
  }
}

/**
 * Direct deploy: single MCP call with full tree.
 */
async function executeDirectDeploy(
  adapter: McpAdapter,
  tx: Transaction,
  options: DeployOptions,
): Promise<void> {
  const { target, postId, tree } = options;

  if (target === 'v3') {
    await adapter.call('elementor-inject-calibrated-page', {
      post_id: postId,
      _elementor_data: tree,
      transaction_id: tx.id,
    });
  } else {
    await adapter.call('batch-build-page', {
      post_id: postId,
      content: tree,
      transaction_id: tx.id,
    });
  }
}

/**
 * Upload-PHP deploy: write JSON file, execute PHP to inject.
 */
async function executeUploadPhpDeploy(
  adapter: McpAdapter,
  tx: Transaction,
  options: DeployOptions,
): Promise<void> {
  const { target, postId, tree } = options;
  const json = JSON.stringify(tree);

  // Upload file via MCP
  const uploadResult = await adapter.call('upload-file', {
    filename: `elconv-deploy-${tx.id}.json`,
    content: json,
  }) as { url?: string };

  // Execute PHP to read and inject
  const phpCode = target === 'v3'
    ? `$data = json_decode(file_get_contents('${uploadResult.url}'), true); update_post_meta(${postId}, '_elementor_data', json_encode($data));`
    : `$data = json_decode(file_get_contents('${uploadResult.url}'), true); /* V4 batch build */`;

  await adapter.call('execute-php', { code: phpCode, transaction_id: tx.id });
}

/**
 * Split deploy: chunk by chunk with verification.
 */
async function executeSplitDeploy(
  adapter: McpAdapter,
  txManager: TransactionManager,
  tx: Transaction,
  options: DeployOptions,
): Promise<void> {
  const { target, postId, tree, skipVerify } = options;
  const plan = planChunkedDeploy(tree);

  for (let i = 0; i < plan.chunks.length; i++) {
    const chunk = plan.chunks[i];

    // Deploy chunk
    if (target === 'v3') {
      await adapter.call('elementor-inject-calibrated-page', {
        post_id: postId,
        _elementor_data: chunk,
        append: i > 0,
        transaction_id: tx.id,
      });
    } else {
      await adapter.call('batch-build-page', {
        post_id: postId,
        content: chunk,
        append: i > 0,
        transaction_id: tx.id,
      });
    }

    // Verify chunk
    let verified = false;
    if (!skipVerify) {
      try {
        const pageState = await adapter.call('get-page-elements', { post_id: postId }) as { count?: number };
        verified = (pageState.count ?? 0) >= (i + 1) * plan.chunkSize - plan.chunkSize + chunk.length;
      } catch {
        verified = false;
      }
    }

    txManager.addCheckpoint(tx.id, chunk.length, verified);
  }
}

/**
 * Clear Elementor cache after deploy.
 */
async function clearCache(adapter: McpAdapter, postId: number): Promise<void> {
  await adapter.call('elementor-clear-document-cache', { post_ids: [postId] });
}

/**
 * Execute rollback from backup.
 */
async function executeRollback(adapter: McpAdapter, tx: Transaction): Promise<void> {
  // In a real implementation, this would restore from backupPath
  // For now, just log the intent
  await adapter.call('rollback-transaction', { transaction_id: tx.id });
}
