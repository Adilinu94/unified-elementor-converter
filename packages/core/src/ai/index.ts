export * from './types.js';
export * from './cost-tracker.js';
export * from './router.js';
export * from './claude-provider.js';
export * from './gpt4-vision-provider.js';
export * from './tasks/index.js';

import type { CreateAIRouterOptions, AIRouter as AIRouterInterface } from '../contracts/ai.contract.js';
import { AIRouter } from './router.js';
import { ClaudeProvider } from './claude-provider.js';
import { Gpt4VisionProvider } from './gpt4-vision-provider.js';
import { CostTracker } from './cost-tracker.js';

/**
 * Factory: Create an AIRouter with both providers configured.
 * Claude is preferred for expensive tasks, GPT-4o for cheap/medium.
 */
export function createAIRouter(options: CreateAIRouterOptions = {}): AIRouterInterface {
  const providers = [];

  const claude = new ClaudeProvider({ apiKey: options.anthropicApiKey });
  const gpt4 = new Gpt4VisionProvider({ apiKey: options.openaiApiKey });

  providers.push(claude, gpt4);

  const costTracker = new CostTracker();
  return new AIRouter(providers, options.logger, costTracker);
}
