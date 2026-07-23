/**
 * Cost-Tracker — Tracks AI API costs per task/provider.
 */
import type { CostEntry } from './types.js';

export class CostTracker {
  private entries: CostEntry[] = [];

  add(entry: CostEntry): void {
    this.entries.push(entry);
  }

  get total(): number {
    return this.entries.reduce((sum, e) => sum + e.cost, 0);
  }

  get count(): number {
    return this.entries.length;
  }

  getByTask(task: string): CostEntry[] {
    return this.entries.filter((e) => e.task === task);
  }

  getByProvider(provider: string): CostEntry[] {
    return this.entries.filter((e) => e.provider === provider);
  }

  report(): { totalCost: number; totalCalls: number; byTask: Record<string, number> } {
    const byTask: Record<string, number> = {};
    for (const e of this.entries) {
      byTask[e.task] = (byTask[e.task] ?? 0) + e.cost;
    }
    return { totalCost: this.total, totalCalls: this.count, byTask };
  }

  reset(): void {
    this.entries = [];
  }
}
