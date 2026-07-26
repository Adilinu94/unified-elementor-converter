/**
 * GPT-4 Vision Provider — OpenAI GPT-4o Vision API.
 * Implements VisionProvider for the AI Router.
 * Used as fallback/cheaper alternative to Claude.
 */

import { readFileSync } from 'node:fs';
import type { AITask, AIResponse, VisionProvider } from '../contracts/ai.contract.js';

export interface Gpt4VisionProviderOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  timeout?: number;
}

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT = 60000;
const API_URL = 'https://api.openai.com/v1/chat/completions';

export class Gpt4VisionProvider implements VisionProvider {
  readonly name = 'gpt4-vision';
  readonly costPerImage = 0.005; // ~$0.005 per image (low-res)

  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly timeout: number;

  constructor(options: Gpt4VisionProviderOptions = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || '';
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

    // Add text prompt first
    content.push({ type: 'text', text: task.prompt });

    // Add images if present
    if (task.images && task.images.length > 0) {
      for (const img of task.images) {
        const imageData = readFileSync(img.path);
        const base64 = imageData.toString('base64');
        const mediaType = img.path.endsWith('.png') ? 'image/png' : 'image/jpeg';

        content.push({
          type: 'image_url',
          image_url: { url: `data:${mediaType};base64,${base64}`, detail: 'high' },
        });
      }
    }

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
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
      }

      const result = await response.json() as {
        choices: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };

      const text = result.choices[0]?.message?.content ?? '';

      // Calculate cost based on tokens (GPT-4o pricing)
      const promptTokens = result.usage?.prompt_tokens ?? 0;
      const completionTokens = result.usage?.completion_tokens ?? 0;
      const cost = (promptTokens * 0.0000025) + (completionTokens * 0.00001);

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
