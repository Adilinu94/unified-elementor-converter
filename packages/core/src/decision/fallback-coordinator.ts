import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import type { AIRouter } from '../contracts/ai.contract.js';
import type { DecisionResult, DecisionSource, DecisionStatus } from '../contracts/decision.contract.js';
import { isConflict } from '../contracts/decision.contract.js';
import type { FallbackPolicy, AiMode } from '../config.js';

export interface FallbackCoordinatorOptions {
  aiMode: AiMode;
  policy: FallbackPolicy;
  router: AIRouter;
}

function hashScreenshot(base64OrPath: string): string {
  if (existsSync(base64OrPath)) {
    try {
      const bytes = readFileSync(base64OrPath);
      return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    } catch { /* fall through to string hash */ }
  }
  return createHash('sha256').update(base64OrPath).digest('hex').slice(0, 16);
}

export class FallbackCoordinator {
  private usedCalls = 0;
  private perSection = new Map<string, number>();
  private cache = new Map<string, DecisionResult<unknown>>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly opts: FallbackCoordinatorOptions) {}

  private cacheKey(sectionSelector: string, taskName: string, screenshotHash?: string): string {
    return `${this.opts.aiMode}:${this.opts.policy.minConfidence}:${sectionSelector}::${taskName}::${screenshotHash ?? 'noimg'}`;
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let res!: T;
    let err: unknown;
    const prev = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((r) => { release = r; });
    await prev;
    try {
      res = await fn();
    } catch (e) {
      err = e;
    } finally {
      release();
    }
    if (err) throw err;
    return res;
  }

  async decide<T>(params: {
    sectionSelector: string;
    taskName: string;
    screenshotBase64OrPath?: string;
    deterministic: { value: T; confidence: number; source: DecisionSource; reasons: string[]; evidenceIds?: string[] };
    aiCall: () => Promise<{ value: T; confidence: number; provider?: string; promptVersion?: string }>;
  }): Promise<DecisionResult<T>> {
    const screenshotHash = params.screenshotBase64OrPath ? hashScreenshot(params.screenshotBase64OrPath) : undefined;
    const key = this.cacheKey(params.sectionSelector, params.taskName, screenshotHash);
    const cached = this.cache.get(key) as DecisionResult<T> | undefined;
    if (cached) return cached;

    if (this.opts.aiMode === 'deterministic') {
      const r = this.okResult(params.deterministic, false, false);
      this.cache.set(key, r as unknown as DecisionResult<unknown>);
      return r;
    }

    const policy = this.opts.policy;
    if (!policy.allowedTasks.includes(params.taskName as never)) {
      const r = this.okResult(params.deterministic, false, false);
      this.cache.set(key, r as unknown as DecisionResult<unknown>);
      return r;
    }

    const needFallback = this.opts.aiMode === 'required' || params.deterministic.confidence < policy.minConfidence;
    if (!needFallback) {
      const r = this.okResult(params.deterministic, false, false);
      this.cache.set(key, r as unknown as DecisionResult<unknown>);
      return r;
    }

    return this.withLock(async () => {
      const cachedInside = this.cache.get(key) as DecisionResult<T> | undefined;
      if (cachedInside) return cachedInside;
      if (this.usedCalls >= policy.maxCallsPerRun) {
        return this.unavailableResult(params.deterministic, 'maxCallsPerRun exceeded', params.taskName);
      }
      const per = this.perSection.get(params.sectionSelector) ?? 0;
      if (per >= policy.maxCallsPerSection) {
        return this.unavailableResult(params.deterministic, 'maxCallsPerSection exceeded', params.taskName);
      }
      if ((this.opts.router as unknown as { isBreakerOpen?: () => boolean }).isBreakerOpen?.()) {
        return this.unavailableResult(params.deterministic, 'breaker open', params.taskName);
      }

      this.usedCalls++;
      this.perSection.set(params.sectionSelector, per + 1);

      try {
        const ai = await params.aiCall();
        if (ai.confidence === undefined || ai.confidence === null) {
          return this.failedResult(params.deterministic, 'ai parsed undefined', params.taskName);
        }
        const conflict = isConflict(params.deterministic.value, ai.value, Math.abs(params.deterministic.confidence - ai.confidence));
        const status: DecisionStatus = conflict ? 'conflict' : ai.confidence >= policy.minConfidence ? 'ok' : 'uncertain';
        const result: DecisionResult<T> = {
          value: ai.value,
          confidence: ai.confidence,
          status,
          source: 'ai',
          reasons: [...params.deterministic.reasons, 'ai-fallback used'],
          evidenceIds: params.deterministic.evidenceIds ?? [],
          fallback: { attempted: true, used: true, task: params.taskName, provider: ai.provider, promptVersion: ai.promptVersion },
          warnings: conflict ? ['deterministic vs AI conflict'] : [],
        };
        this.cache.set(key, result as unknown as DecisionResult<unknown>);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isUnavailable = /No AI provider available|breaker/i.test(msg);
        return isUnavailable
          ? this.unavailableResult(params.deterministic, msg, params.taskName)
          : this.failedResult(params.deterministic, msg, params.taskName);
      }
    });
  }

  private okResult<T>(det: { value: T; confidence: number; source: DecisionSource; reasons: string[]; evidenceIds?: string[] }, attempted: boolean, used: boolean): DecisionResult<T> {
    return {
      value: det.value,
      confidence: det.confidence,
      status: det.confidence >= this.opts.policy.minConfidence ? 'ok' : 'uncertain',
      source: det.source,
      reasons: det.reasons,
      evidenceIds: det.evidenceIds ?? [],
      fallback: { attempted, used },
      warnings: [],
    };
  }

  private unavailableResult<T>(det: { value: T; confidence: number; source: DecisionSource; reasons: string[]; evidenceIds?: string[] }, reason: string, task?: string): DecisionResult<T> {
    return {
      value: det.value,
      confidence: det.confidence,
      status: 'unavailable',
      source: det.source,
      reasons: det.reasons,
      evidenceIds: det.evidenceIds ?? [],
      fallback: { attempted: true, used: false, task, failureReason: reason },
      warnings: [reason],
    };
  }

  private failedResult<T>(det: { value: T; confidence: number; source: DecisionSource; reasons: string[]; evidenceIds?: string[] }, reason: string, task?: string): DecisionResult<T> {
    return {
      value: det.value,
      confidence: det.confidence,
      status: 'failed',
      source: det.source,
      reasons: det.reasons,
      evidenceIds: det.evidenceIds ?? [],
      fallback: { attempted: true, used: false, task, failureReason: reason },
      warnings: [reason],
    };
  }
}
