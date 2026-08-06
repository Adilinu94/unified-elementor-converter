/**
 * AI-Router — Selects provider by task category and tracks costs.
 * KI-03: added timeout, CircuitBreaker + opt-in strict parse validation.
 */
import type { AITask, AIResponse, VisionProvider } from '../contracts/ai.contract.js';
import type { TaskCategory } from './types.js';
import { TASK_CATEGORY } from './types.js';
import { CostTracker } from './cost-tracker.js';

export class AIRouterParseError extends Error {
  constructor(
    message: string,
    public readonly rawText: string,
  ) {
    super(message);
    this.name = 'AIRouterParseError';
  }
}

export interface AIRouterOptions {
  timeoutMs?: number;
  breaker?: { failureThreshold?: number; resetTimeoutMs?: number; name?: string };
  strictParse?: boolean;
}

const DEFAULT_ROUTER_TIMEOUT_MS = 70_000;

class SimpleBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  constructor(
    private readonly failureThreshold: number,
    private readonly resetTimeoutMs: number,
  ) {}
  private ensureHalfOpen(): void {
    if (this.state !== 'OPEN') return;
    if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) this.state = 'HALF_OPEN';
  }
  canExecute(): boolean {
    this.ensureHalfOpen();
    return this.state !== 'OPEN';
  }
  get isOpen(): boolean {
    this.ensureHalfOpen();
    return this.state === 'OPEN';
  }
  recordSuccess(): void {
    this.failureCount = 0;
    if (this.state !== 'CLOSED') this.state = 'CLOSED';
  }
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === 'HALF_OPEN') this.state = 'OPEN';
    else if (this.failureCount >= this.failureThreshold) this.state = 'OPEN';
  }
  reset(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }
}

export class AIRouter {
  private readonly breaker: SimpleBreaker | null;
  private readonly routerTimeoutMs: number;
  private readonly strictParse: boolean;

  constructor(
    private readonly providers: VisionProvider[],
    private readonly logger?: (msg: string) => void,
    private readonly costTracker?: CostTracker,
    options: AIRouterOptions = {},
  ) {
    this.routerTimeoutMs = options.timeoutMs ?? DEFAULT_ROUTER_TIMEOUT_MS;
    this.strictParse = options.strictParse ?? false;
    const b = options.breaker;
    this.breaker = b ? new SimpleBreaker(b.failureThreshold ?? 3, b.resetTimeoutMs ?? 30_000) : null;
  }

  isBreakerOpen(): boolean {
    return this.breaker?.isOpen ?? false;
  }

  resetBreaker(): void {
    this.breaker?.reset();
  }

  async execute<T = unknown>(task: AITask): Promise<AIResponse<T>> {
    if (this.breaker && !this.breaker.canExecute()) {
      throw new Error(`AI circuit breaker is OPEN (breaker: ${this.breaker ? 'ai-router' : 'n/a'})`);
    }
    const category: TaskCategory = TASK_CATEGORY[task.name] ?? 'medium';
    const provider = await this.selectProvider(category);
    this.logger?.(`[AI] Task '${task.name}' → Provider '${provider.name}' (category: ${category})`);

    let response: AIResponse<T>;
    try {
      response = (await this.withTimeout(provider.execute(task), this.routerTimeoutMs)) as AIResponse<T>;
    } catch (err) {
      this.breaker?.recordFailure();
      throw err;
    }
    this.breaker?.recordSuccess();

    this.costTracker?.add({
      task: task.name,
      provider: response.provider,
      cost: response.cost,
      durationMs: response.durationMs,
      timestamp: new Date().toISOString(),
    });

    if (task.schema && response.text) {
      try {
        response.parsed = JSON.parse(response.text.replace(/```json|```/g, '').trim()) as T;
      } catch (err) {
        if (this.strictParse) {
          throw new AIRouterParseError(
            `AI response JSON parse failed for task '${task.name}': ${(err as Error).message}`,
            response.text,
          );
        }
      }
      if (this.strictParse && response.parsed === undefined) {
        throw new AIRouterParseError(`AI response parsed is undefined for task '${task.name}'`, response.text);
      }
    }
    return response;
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`AI provider timeout after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    }) as Promise<T>;
  }

  private async selectProvider(category: TaskCategory): Promise<VisionProvider> {
    const available: VisionProvider[] = [];
    for (const p of this.providers) {
      if (await p.available()) available.push(p);
    }
    if (available.length === 0) throw new Error('No AI provider available');

    if (category === 'cheap') {
      const free = available.find((p) => p.costPerImage === 0);
      return free ?? [...available].sort((a, b) => a.costPerImage - b.costPerImage)[0];
    }
    if (category === 'expensive') {
      const claude = available.find((p) => p.name.includes('claude'));
      return claude ?? available[0];
    }
    return [...available].sort((a, b) => a.costPerImage - b.costPerImage)[0];
  }
}
