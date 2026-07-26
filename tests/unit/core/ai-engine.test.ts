import { describe, it, expect } from 'vitest';
import {
  CostTracker,
  AIRouter,
  TASK_CATEGORY,
  type VisionProvider,
  type AITask,
  type AIResponse,
} from '@elconv/core';

const mockProvider: VisionProvider = {
  name: 'mock-vision',
  costPerImage: 0.01,
  available: async () => true,
  execute: async (task: AITask): Promise<AIResponse> => ({
    text: JSON.stringify({ result: 'ok', task: task.name }),
    provider: 'mock-vision',
    cost: 0.01,
    durationMs: 100,
  }),
};

describe('CostTracker', () => {
  it('tracks costs', () => {
    const tracker = new CostTracker();
    tracker.add({
      task: 'vision-qa',
      provider: 'claude',
      cost: 0.05,
      durationMs: 200,
      timestamp: '',
    });
    tracker.add({
      task: 'vision-qa',
      provider: 'claude',
      cost: 0.03,
      durationMs: 150,
      timestamp: '',
    });
    expect(tracker.total).toBeCloseTo(0.08);
    expect(tracker.count).toBe(2);
  });

  it('generates report', () => {
    const tracker = new CostTracker();
    tracker.add({ task: 'a', provider: 'p', cost: 1, durationMs: 10, timestamp: '' });
    tracker.add({ task: 'b', provider: 'p', cost: 2, durationMs: 20, timestamp: '' });
    const report = tracker.report();
    expect(report.totalCost).toBe(3);
    expect(report.byTask).toEqual({ a: 1, b: 2 });
  });
});

describe('AIRouter', () => {
  it('executes task with provider', async () => {
    const router = new AIRouter([mockProvider]);
    const result = await router.execute({ name: 'vision-qa', prompt: 'test', schema: true });
    expect(result.provider).toBe('mock-vision');
    expect(result.parsed).toEqual({ result: 'ok', task: 'vision-qa' });
  });

  it('throws when no provider available', async () => {
    const offline: VisionProvider = { ...mockProvider, available: async () => false };
    const router = new AIRouter([offline]);
    await expect(router.execute({ name: 'test', prompt: '' })).rejects.toThrow('No AI provider');
  });

  it('TASK_CATEGORY maps known tasks', () => {
    expect(TASK_CATEGORY['vision-qa']).toBe('medium');
    expect(TASK_CATEGORY['repair-block']).toBe('expensive');
    expect(TASK_CATEGORY['section-classify']).toBe('cheap');
  });
});
