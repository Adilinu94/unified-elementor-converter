/**
 * Claude Provider — Anthropic Claude Vision API.
 * Implements VisionProvider for the AI Router.
 * Used for expensive/high-quality tasks (repair, visual QA).
 */

import { readFileSync } from 'node:fs';
import type { AITask, AIResponse, VisionProvider } from '../contracts/ai.contract.js';

export interface ClaudeProviderOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  timeout?: number;
}

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT = 60000;
const API_URL = 'https://api.anthropic.com/v1/messages';

export class ClaudeProvider implements VisionProvider {
  readonly name = 'claude';
  readonly costPerImage = 0.01; // ~$0.01 per image input

  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly timeout: number;

  constructor(options: ClaudeProviderOptions = {}) {
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.model = options.model || DEFAULT_MODEL;
    this.maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async execute(task: AITask): Promise<AIResponse> {
    const start = Date.now();

    const content: Array<Record<string, unknown>> = [];

    // Add images if present
    if (task.images && task.images.length > 0) {
      for (const img of task.images) {
        const imageData = readFileSync(img.path);
        const base64 = imageData.toString('base64');
        const mediaType = img.path.endsWith('.png') ? 'image/png' : 'image/jpeg';

        content.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 },
        });
      }
    }

    // Add text prompt
    content.push({ type: 'text', text: task.prompt });

    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [{ role: 'user', content }],
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude API error ${response.status}: ${errorText}`);
      }

      const result = await response.json() as {
        content: Array<{ type: string; text?: string }>;
        usage?: { input_tokens: number; output_tokens: number };
      };

      const text = result.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n');

      // Calculate cost based on tokens
      const inputTokens = result.usage?.input_tokens ?? 0;
      const outputTokens = result.usage?.output_tokens ?? 0;
      const cost = (inputTokens * 0.000003) + (outputTokens * 0.000015);

      return {
        text,
        cost,
        provider: this.name,
        durationMs: Date.now() - start,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
