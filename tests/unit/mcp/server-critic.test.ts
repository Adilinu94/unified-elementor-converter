import { describe, it, expect } from 'vitest';
import {
  suggestDesignFixes,
  scoreDistinctiveness,
  pipelineState,
  type McpAdapter,
} from '@elconv/mcp';

/**
 * Fake adapter that records executeAbility calls and returns a canned response.
 * The server-critic helpers only touch adapter.executeAbility, so no network
 * or JSON-RPC plumbing is needed.
 */
function fakeAdapter(response: unknown): {
  adapter: McpAdapter;
  calls: Array<{ name: string; params: Record<string, unknown> }>;
} {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const adapter = {
    executeAbility: async (name: string, params: Record<string, unknown> = {}) => {
      calls.push({ name, params });
      return response;
    },
  } as unknown as McpAdapter;
  return { adapter, calls };
}

describe('suggestDesignFixes', () => {
  it('calls the live ability with { post_id } and maps priority_order → priorityOrder', async () => {
    const { adapter, calls } = fakeAdapter({
      success: true,
      problems: [{ id: 'p1' }],
      fixes: [{ id: 'f1' }, { id: 'f2' }],
      priority_order: ['f1', 'f2'],
    });
    const res = await suggestDesignFixes(adapter, 42);
    expect(calls).toEqual([{ name: 'novamira-adrianv2/suggest-design-fixes', params: { post_id: 42 } }]);
    expect(res.success).toBe(true);
    expect(res.problems).toHaveLength(1);
    expect(res.fixes).toHaveLength(2);
    expect(res.priorityOrder).toEqual(['f1', 'f2']);
  });

  it('defaults missing arrays to [] rather than throwing', async () => {
    const { adapter } = fakeAdapter({ success: false, error: 'no post' });
    const res = await suggestDesignFixes(adapter, 7);
    expect(res.success).toBe(false);
    expect(res.problems).toEqual([]);
    expect(res.fixes).toEqual([]);
    expect(res.priorityOrder).toEqual([]);
    expect(res.error).toBe('no post');
  });
});

describe('scoreDistinctiveness', () => {
  it('calls the live ability with { post_id } and maps post_id → postId', async () => {
    const { adapter, calls } = fakeAdapter({
      success: true,
      post_id: 42,
      score: 88,
      penalties: [{ kind: 'repeat' }],
      recommendations: ['vary section rhythm'],
    });
    const res = await scoreDistinctiveness(adapter, 42);
    expect(calls).toEqual([{ name: 'novamira-adrianv2/score-distinctiveness', params: { post_id: 42 } }]);
    expect(res.postId).toBe(42);
    expect(res.score).toBe(88);
    expect(res.penalties).toHaveLength(1);
    expect(res.recommendations).toEqual(['vary section rhythm']);
  });

  it('falls back to the requested postId and defaults score to 0 when absent', async () => {
    const { adapter } = fakeAdapter({ success: true });
    const res = await scoreDistinctiveness(adapter, 99);
    expect(res.postId).toBe(99);
    expect(res.score).toBe(0);
    expect(res.penalties).toEqual([]);
    expect(res.recommendations).toEqual([]);
  });
});

describe('pipelineState', () => {
  it('throws when save/load is requested without a pipelineId', async () => {
    const { adapter } = fakeAdapter({ success: true });
    await expect(pipelineState(adapter, 'save', { state: { a: 1 } })).rejects.toThrow(/pipelineId/);
    await expect(pipelineState(adapter, 'load', {})).rejects.toThrow(/pipelineId/);
  });

  it('throws when save is requested without a state object', async () => {
    const { adapter } = fakeAdapter({ success: true });
    await expect(pipelineState(adapter, 'save', { pipelineId: 'run-1' })).rejects.toThrow(/state/);
  });

  it('builds save params (action, pipeline_id, state) and maps pipeline_id → pipelineId', async () => {
    const { adapter, calls } = fakeAdapter({ success: true, pipeline_id: 'run-1', timestamp: 't0' });
    const res = await pipelineState(adapter, 'save', { pipelineId: 'run-1', state: { step: 3 } });
    expect(calls[0]!.name).toBe('novamira-adrianv2/pipeline-state');
    expect(calls[0]!.params).toEqual({ action: 'save', pipeline_id: 'run-1', state: { step: 3 } });
    expect(res.pipelineId).toBe('run-1');
    expect(res.timestamp).toBe('t0');
  });

  it('passes max_age_days for cleanup and returns the cleaned count', async () => {
    const { adapter, calls } = fakeAdapter({ success: true, cleaned: 4 });
    const res = await pipelineState(adapter, 'cleanup', { maxAgeDays: 3 });
    expect(calls[0]!.params).toEqual({ action: 'cleanup', max_age_days: 3 });
    expect(res.cleaned).toBe(4);
  });

  it('lists pipelines without requiring a pipelineId', async () => {
    const { adapter, calls } = fakeAdapter({ success: true, pipelines: ['run-1', 'run-2'], count: 2 });
    const res = await pipelineState(adapter, 'list', {});
    expect(calls[0]!.params).toEqual({ action: 'list' });
    expect(res.count).toBe(2);
    expect(res.pipelines).toEqual(['run-1', 'run-2']);
  });
});
