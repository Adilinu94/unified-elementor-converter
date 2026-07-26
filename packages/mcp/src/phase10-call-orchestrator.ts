/**
 * Phase 10 — MCP Call-Orchestrator (Retry + Circuit-Breaker + Batch).
 *
 * V1 had `src/mcp/retry.ts` with simple retry-on-error. Phase 10 adds:
 *   1. Per-ability circuit-breaker (open after N failures, half-open after
 *      cool-down, close after K successful probes).
 *   2. Batched-call-scheduler that groups ability-calls into batches per
 *      target-page to respect server-side rate-limits.
 *   3. Failure-classification (transient vs permanent) so we don't retry
 *      validation-errors but do retry 5xx + timeout.
 */
import type { AbilityCallDescriptor } from './phase10-indirection.js';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  readonly failureThreshold: number;
  readonly coolDownMs: number;
  readonly successThreshold: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  coolDownMs: 5000,
  successThreshold: 2,
};

export interface CircuitBreakerStats {
  readonly state: CircuitState;
  readonly consecutiveFailures: number;
  readonly consecutiveSuccesses: number;
  readonly totalFailures: number;
  readonly totalSuccesses: number;
  readonly lastFailureAt: string | null;
  readonly openedAt: string | null;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastFailureAt: string | null = null;
  private openedAt: string | null = null;
  private readonly config: CircuitBreakerConfig;
  private readonly now: () => Date;

  constructor(
    config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG,
    now: () => Date = () => new Date(),
  ) {
    this.config = config;
    this.now = now;
  }

  canExecute(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'half-open') return true;
    if (this.openedAt === null) return true;
    const elapsed = this.now().getTime() - new Date(this.openedAt).getTime();
    if (elapsed >= this.config.coolDownMs) {
      this.state = 'half-open';
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses += 1;
    this.totalSuccesses += 1;
    if (this.state === 'half-open' && this.consecutiveSuccesses >= this.config.successThreshold) {
      this.state = 'closed';
      this.openedAt = null;
      this.consecutiveSuccesses = 0;
    }
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    this.consecutiveSuccesses = 0;
    this.totalFailures += 1;
    this.lastFailureAt = this.now().toISOString();
    if (this.consecutiveFailures >= this.config.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now().toISOString();
    }
  }

  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      lastFailureAt: this.lastFailureAt,
      openedAt: this.openedAt,
    };
  }

  reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.totalFailures = 0;
    this.totalSuccesses = 0;
    this.lastFailureAt = null;
    this.openedAt = null;
  }
}

export type FailureKind = 'transient' | 'permanent' | 'timeout' | 'unknown';

export function classifyFailure(error: unknown): FailureKind {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('socket hang up')
    ) {
      return 'timeout';
    }
    if (
      message.includes('5xx') ||
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504') ||
      message.includes('server error') ||
      message.includes('rate limit') ||
      message.includes('throttle')
    ) {
      return 'transient';
    }
    if (
      message.includes('4xx') ||
      message.includes('400') ||
      message.includes('401') ||
      message.includes('403') ||
      message.includes('404') ||
      message.includes('validation') ||
      message.includes('invalid') ||
      message.includes('forbidden') ||
      message.includes('unauthorized')
    ) {
      return 'permanent';
    }
    return 'unknown';
  }
  return 'unknown';
}

export interface RetryConfig {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly retryOn: readonly FailureKind[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 5000,
  retryOn: ['transient', 'timeout', 'unknown'],
};

export interface CallAttempt {
  readonly attempt: number;
  readonly success: boolean;
  readonly error: string | null;
  readonly failureKind: FailureKind | null;
  readonly delayBeforeMs: number;
  readonly durationMs: number;
}

export interface CallOrchestratorResult<T> {
  readonly success: boolean;
  readonly value: T | null;
  readonly attempts: readonly CallAttempt[];
  readonly finalFailureKind: FailureKind | null;
}

export type AbilityCallFn<T> = (
  descriptor: AbilityCallDescriptor,
) => Promise<T>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exp = baseDelayMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exp, maxDelayMs);
  return Math.floor(capped + Math.random() * capped * 0.1);
}

export async function executeWithRetry<T>(
  descriptor: AbilityCallDescriptor,
  call: AbilityCallFn<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  now: () => Date = () => new Date(),
): Promise<CallOrchestratorResult<T>> {
  const attempts: CallAttempt[] = [];
  let lastFailureKind: FailureKind | null = null;
  let value: T | null = null;
  let success = false;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    const startedAt = now().getTime();
    let delayBeforeMs = 0;
    if (attempt > 1) {
      delayBeforeMs = backoffDelay(attempt, config.baseDelayMs, config.maxDelayMs);
      await sleep(delayBeforeMs);
    }
    try {
      value = await call(descriptor);
      const durationMs = now().getTime() - startedAt;
      attempts.push({
        attempt,
        success: true,
        error: null,
        failureKind: null,
        delayBeforeMs,
        durationMs,
      });
      success = true;
      break;
    } catch (err) {
      const failureKind = classifyFailure(err);
      const durationMs = now().getTime() - startedAt;
      const errorMessage = err instanceof Error ? err.message : String(err);
      attempts.push({
        attempt,
        success: false,
        error: errorMessage,
        failureKind,
        delayBeforeMs,
        durationMs,
      });
      lastFailureKind = failureKind;
      if (!config.retryOn.includes(failureKind)) {
        break;
      }
    }
  }

  return {
    success,
    value,
    attempts,
    finalFailureKind: success ? null : lastFailureKind,
  };
}

export interface BatchGroup {
  readonly pageId: string;
  readonly operations: readonly AbilityCallDescriptor[];
}

export function groupOperationsByPageId(
  descriptors: readonly AbilityCallDescriptor[],
): readonly BatchGroup[] {
  const groups = new Map<string, AbilityCallDescriptor[]>();
  for (const descriptor of descriptors) {
    const pageId = String(descriptor.parameters.pageId ?? '__no_page__');
    if (!groups.has(pageId)) {
      groups.set(pageId, []);
    }
    groups.get(pageId)!.push(descriptor);
  }
  return Array.from(groups.entries()).map(([pageId, operations]) => ({
    pageId,
    operations,
  }));
}

export interface BatchExecutionOptions {
  readonly maxConcurrentPages: number;
}

export const DEFAULT_BATCH_EXECUTION_OPTIONS: BatchExecutionOptions = {
  maxConcurrentPages: 2,
};

export async function executeBatch<T>(
  descriptors: readonly AbilityCallDescriptor[],
  call: AbilityCallFn<T>,
  options: BatchExecutionOptions = DEFAULT_BATCH_EXECUTION_OPTIONS,
  now: () => Date = () => new Date(),
): Promise<readonly CallOrchestratorResult<T>[]> {
  const groups = groupOperationsByPageId(descriptors);
  const results: CallOrchestratorResult<T>[] = [];
  for (let i = 0; i < groups.length; i += options.maxConcurrentPages) {
    const chunk = groups.slice(i, i + options.maxConcurrentPages);
    const chunkResults = await Promise.all(
      chunk.flatMap((group) =>
        group.operations.map((op) => executeWithRetry(op, call, DEFAULT_RETRY_CONFIG, now)),
      ),
    );
    results.push(...chunkResults);
  }
  return results;
}