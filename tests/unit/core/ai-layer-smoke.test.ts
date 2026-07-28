/**
 * AI-Layer runtime smoke test (point 10 of the 10-item follow-up).
 *
 * tests/unit/core/ai-engine.test.ts only exercises the generic AIRouter
 * class with a hand-written mock VisionProvider — it never actually
 * constructs createAIRouter() or the two real providers (ClaudeProvider,
 * Gpt4VisionProvider). CRITICAL-FAILURE-POINTS.md's "AIRouter is not
 * currently instantiable" claim (P2) was never actually verified true or
 * false by any test — tsc passing proved only that it type-checks, not
 * that construction or a call actually works. This file closes that gap
 * with fetch mocked (no real network calls, no API keys needed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAIRouter } from '@elconv/core';
import { ClaudeProvider } from '@elconv/core';
import { Gpt4VisionProvider } from '@elconv/core';

describe('createAIRouter — actually instantiable', () => {
  it('constructs without throwing, with no API keys at all', () => {
    expect(() => createAIRouter()).not.toThrow();
  });

  it('constructs with explicit API keys', () => {
    expect(() => createAIRouter({ anthropicApiKey: 'sk-test', openaiApiKey: 'sk-test' })).not.toThrow();
  });

  it('the constructed router rejects a call when neither provider has a key', async () => {
    const router = createAIRouter(); // no keys -> both providers report unavailable
    await expect(router.execute({ name: 'vision-qa', prompt: 'x' })).rejects.toThrow('No AI provider');
  });
});

describe('ClaudeProvider.available()', () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalEnv;
  });

  it('is unavailable with no key configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const provider = new ClaudeProvider();
    expect(await provider.available()).toBe(false);
  });

  it('is available once a key is passed explicitly', async () => {
    const provider = new ClaudeProvider({ apiKey: 'sk-test-key' });
    expect(await provider.available()).toBe(true);
  });
});

describe('ClaudeProvider.execute() — mocked fetch, real request/response plumbing', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'Hello from Claude' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends the expected request shape and parses the response text + cost', async () => {
    const provider = new ClaudeProvider({ apiKey: 'sk-test' });
    const result = await provider.execute({ name: 'vision-qa', prompt: 'Describe this' });

    expect(global.fetch).toHaveBeenCalledOnce();
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.messages[0].content).toContainEqual({ type: 'text', text: 'Describe this' });

    expect(result.text).toBe('Hello from Claude');
    expect(result.provider).toBe('claude');
    expect(result.cost).toBeGreaterThan(0);
  });

  it('throws with the response body on a non-2xx status', async () => {
    global.fetch = vi.fn(async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    const provider = new ClaudeProvider({ apiKey: 'sk-test' });
    await expect(provider.execute({ name: 'x', prompt: 'y' })).rejects.toThrow('Claude API error 429');
  });
});

describe('Gpt4VisionProvider — mocked fetch', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('is unavailable with no key, available with one', async () => {
    const noKey = new Gpt4VisionProvider({ apiKey: '' });
    expect(await noKey.available()).toBe(false);
    const withKey = new Gpt4VisionProvider({ apiKey: 'sk-test' });
    expect(await withKey.available()).toBe(true);
  });

  it('executes and returns provider name gpt4-vision', async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Hello from GPT-4' } }],
          usage: { prompt_tokens: 80, completion_tokens: 40 },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const provider = new Gpt4VisionProvider({ apiKey: 'sk-test' });
    const result = await provider.execute({ name: 'x', prompt: 'y' });
    expect(result.provider).toBe('gpt4-vision');
    expect(result.text).toBe('Hello from GPT-4');
  });
});

describe('createAIRouter — provider selection end-to-end', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('routes an expensive task to Claude when only Claude has a key', async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const router = createAIRouter({ anthropicApiKey: 'sk-test' }); // no OpenAI key
    const result = await router.execute({ name: 'repair-block', prompt: 'fix it' }); // TASK_CATEGORY: expensive
    expect(result.provider).toBe('claude');
  });
});
