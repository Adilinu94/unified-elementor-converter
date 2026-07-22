/**
 * Circuit Breaker pattern for MCP calls (Improvement #7).
 * States: CLOSED → OPEN → HALF_OPEN
 * After `failureThreshold` consecutive failures, opens the circuit for `resetTimeoutMs`.
 * In HALF_OPEN, allows one probe call through.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening (default: 3) */
  failureThreshold?: number;
  /** Time in ms to wait before trying again (default: 30000) */
  resetTimeoutMs?: number;
  /** Called when state changes */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly onStateChange?: (from: CircuitState, to: CircuitState) => void;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30_000;
    this.onStateChange = opts.onStateChange;
  }

  getState(): CircuitState {
    // Check if OPEN should transition to HALF_OPEN
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.resetTimeoutMs) {
        this.transition('HALF_OPEN');
      }
    }
    return this.state;
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws CircuitOpenError if the circuit is OPEN.
   */
  async exec<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'OPEN') {
      throw new CircuitOpenError(this.resetTimeoutMs - (Date.now() - this.lastFailureTime));
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /**
   * Check if a call is allowed without executing.
   */
  canExecute(): boolean {
    return this.getState() !== 'OPEN';
  }

  /**
   * Manually reset the circuit breaker to CLOSED.
   */
  reset(): void {
    if (this.state !== 'CLOSED') {
      this.transition('CLOSED');
    }
    this.failureCount = 0;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state !== 'CLOSED') {
      this.transition('CLOSED');
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.transition('OPEN');
    } else if (this.failureCount >= this.failureThreshold) {
      this.transition('OPEN');
    }
  }

  private transition(to: CircuitState): void {
    const from = this.state;
    this.state = to;
    this.onStateChange?.(from, to);
  }
}

export class CircuitOpenError extends Error {
  constructor(public readonly remainingMs: number) {
    super(`Circuit breaker is OPEN. Retry in ${Math.ceil(remainingMs / 1000)}s.`);
    this.name = 'CircuitOpenError';
  }
}
