/**
 * AI-Router — Selects provider by task category and tracks costs.
 */
import type { AITask, AIResponse, VisionProvider } from '../contracts/ai.contract.js';
import type { TaskCategory } from './types.js';
import { TASK_CATEGORY } from './types.js';
import { CostTracker } from './cost-tracker.js';

export class AIRouter {
  constructor(
    private readonly providers: VisionProvider[],
    private readonly logger?: (msg: string) => void,
    private readonly costTracker?: CostTracker,
  ) {}

  async execute<T = unknown>(task: AITask): Promise<AIResponse<T>> {
    const category: TaskCategory = TASK_CATEGORY[task.name] ?? 'medium';
    const provider = await this.selectProvider(category);
    this.logger?.(`[AI] Task '${task.name}' → Provider '${provider.name}' (category: ${category})`);

    const response = (await provider.execute(task)) as AIResponse<T>;

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
      } catch {
        /* keep raw */
      }
    }
    return response;
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
