/**
 * Batch-Scheduler — Prioritized batch execution with concurrency control.
 */
export interface BatchSchedulerOptions {
  name?: string;
  concurrency?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  timeout?: number;
}

export interface ScheduleOptions {
  priority?: number;
  ability?: string;
  params?: Record<string, unknown>;
  timeout?: number;
  maxRetries?: number;
}

interface QueuedTask<T = unknown> {
  id: number;
  fn: () => Promise<T>;
  options: Required<ScheduleOptions>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class BatchScheduler {
  readonly name: string;
  readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly timeout: number;
  private queue: QueuedTask[] = [];
  private running = 0;
  private completed = 0;
  private failed = 0;
  private idCounter = 0;

  constructor(options: BatchSchedulerOptions = {}) {
    this.name = options.name ?? 'batch';
    this.concurrency = options.concurrency ?? 5;
    this.maxRetries = options.maxRetries ?? 2;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.timeout = options.timeout ?? 60_000;
  }

  async schedule<T>(fn: () => Promise<T>, options: ScheduleOptions = {}): Promise<T> {
    const task: QueuedTask<T> = {
      id: ++this.idCounter,
      fn,
      options: {
        priority: options.priority ?? 5,
        ability: options.ability ?? 'unknown',
        params: options.params ?? {},
        timeout: options.timeout ?? this.timeout,
        maxRetries: options.maxRetries ?? this.maxRetries,
      },
      resolve: () => {},
      reject: () => {},
    };

    return new Promise<T>((resolve, reject) => {
      task.resolve = resolve as (value: unknown) => void;
      task.reject = reject;
      this.queue.push(task as QueuedTask);
      this.queue.sort((a, b) => a.options.priority - b.options.priority);
      this.drain();
    });
  }

  async scheduleAll<T>(
    tasks: Array<{ fn: () => Promise<T>; options?: ScheduleOptions }>,
  ): Promise<Array<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: Error }>> {
    // Enqueue all tasks first (sorted), then drain — so priority order is respected
    // even when concurrency > 1 and callers fire scheduleAll in one shot.
    const promises = tasks.map((t) => {
      return new Promise<T>((resolve, reject) => {
        const task: QueuedTask<T> = {
          id: ++this.idCounter,
          fn: t.fn,
          options: {
            priority: t.options?.priority ?? 5,
            ability: t.options?.ability ?? 'unknown',
            params: t.options?.params ?? {},
            timeout: t.options?.timeout ?? this.timeout,
            maxRetries: t.options?.maxRetries ?? this.maxRetries,
          },
          resolve: resolve as (value: unknown) => void,
          reject,
        };
        this.queue.push(task as QueuedTask);
      })
        .then((value) => ({ status: 'fulfilled' as const, value }))
        .catch((reason) => ({
          status: 'rejected' as const,
          reason: reason instanceof Error ? reason : new Error(String(reason)),
        }));
    });
    this.queue.sort((a, b) => a.options.priority - b.options.priority);
    this.drain();
    return Promise.all(promises);
  }

  private drain(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.running++;
      this.executeTask(task).finally(() => {
        this.running--;
        this.drain();
      });
    }
  }

  private async executeTask(task: QueuedTask): Promise<void> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= task.options.maxRetries; attempt++) {
      try {
        const result = await Promise.race([
          task.fn(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), task.options.timeout),
          ),
        ]);
        this.completed++;
        task.resolve(result);
        return;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (attempt < task.options.maxRetries) {
          await new Promise((r) => setTimeout(r, this.baseDelayMs * Math.pow(2, attempt)));
        }
      }
    }
    this.failed++;
    task.reject(lastErr!);
  }

  get status() {
    return {
      name: this.name,
      queued: this.queue.length,
      running: this.running,
      completed: this.completed,
      failed: this.failed,
    };
  }
}
