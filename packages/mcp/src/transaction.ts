/**
 * MCP Transaction Layer.
 * Provides transaction_id tracking and rollback capability for deploys.
 * Verbesserung #5: transaction_id pro Deploy, rollback-transaction bei Fehler.
 */

import { randomUUID } from 'node:crypto';

export interface Transaction {
  id: string;
  target: 'v3' | 'v4';
  postId: number;
  startedAt: string;
  status: 'pending' | 'in-progress' | 'committed' | 'rolled-back' | 'failed';
  checkpoints: Checkpoint[];
  backupPath?: string;
}

export interface Checkpoint {
  index: number;
  timestamp: string;
  elementCount: number;
  verified: boolean;
}

export class TransactionManager {
  private transactions = new Map<string, Transaction>();

  /**
   * Start a new deploy transaction.
   */
  begin(target: 'v3' | 'v4', postId: number, backupPath?: string): Transaction {
    const tx: Transaction = {
      id: randomUUID(),
      target,
      postId,
      startedAt: new Date().toISOString(),
      status: 'pending',
      checkpoints: [],
      backupPath,
    };
    this.transactions.set(tx.id, tx);
    return tx;
  }

  /**
   * Get a transaction by ID.
   */
  get(id: string): Transaction | undefined {
    return this.transactions.get(id);
  }

  /**
   * Mark transaction as in-progress.
   */
  markInProgress(id: string): void {
    const tx = this.transactions.get(id);
    if (tx) tx.status = 'in-progress';
  }

  /**
   * Add a checkpoint after successful chunk deploy.
   */
  addCheckpoint(id: string, elementCount: number, verified: boolean): Checkpoint {
    const tx = this.transactions.get(id);
    if (!tx) throw new Error(`Transaction ${id} not found`);

    const checkpoint: Checkpoint = {
      index: tx.checkpoints.length,
      timestamp: new Date().toISOString(),
      elementCount,
      verified,
    };
    tx.checkpoints.push(checkpoint);
    return checkpoint;
  }

  /**
   * Mark transaction as committed (success).
   */
  commit(id: string): void {
    const tx = this.transactions.get(id);
    if (tx) tx.status = 'committed';
  }

  /**
   * Mark transaction as rolled-back.
   */
  rollback(id: string): void {
    const tx = this.transactions.get(id);
    if (tx) tx.status = 'rolled-back';
  }

  /**
   * Mark transaction as failed.
   */
  fail(id: string): void {
    const tx = this.transactions.get(id);
    if (tx) tx.status = 'failed';
  }

  /**
   * Get the last verified checkpoint for resume.
   */
  getLastVerifiedCheckpoint(id: string): Checkpoint | undefined {
    const tx = this.transactions.get(id);
    if (!tx) return undefined;
    return [...tx.checkpoints].reverse().find((cp) => cp.verified);
  }

  /**
   * List all transactions.
   */
  list(): Transaction[] {
    return [...this.transactions.values()];
  }

  /**
   * Clear completed transactions (older than maxAgeMs).
   */
  prune(maxAgeMs = 3600_000): number {
    const cutoff = Date.now() - maxAgeMs;
    let pruned = 0;
    for (const [id, tx] of this.transactions) {
      const age = Date.now() - new Date(tx.startedAt).getTime();
      if (age > maxAgeMs && (tx.status === 'committed' || tx.status === 'rolled-back')) {
        this.transactions.delete(id);
        pruned++;
      }
    }
    return pruned;
  }
}

/**
 * Singleton transaction manager for CLI usage.
 */
export const transactionManager = new TransactionManager();
