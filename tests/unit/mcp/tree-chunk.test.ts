import { describe, it, expect } from 'vitest';
import { executeDeploy, TransactionManager, type McpAdapter } from '@elconv/mcp';
import { planTreeChunkDeploy, assertTreeChunkPlanUsesKnownAbilities, TREE_CHUNK_BYTES, runTreeChunkDeploy } from '@elconv/mcp';

function smallTree(): unknown[] {
  return [{ id: 's1', elType: 'section', elements: [{ id: 'w1', elType: 'widget', widgetType: 'heading' }] }];
}

describe('tree-chunk planner', () => {
  it('splits JSON into ~2KB chunks and orders calls start→append→commit→read-back→cache-clear', () => {
    const plan = planTreeChunkDeploy(smallTree(), { target: 'v3', postId: 42 });
    expect(plan.strategy).toBe('tree-chunk');
    expect(plan.requiresSchemaVerification).toBe(true);
    expect(plan.chunkBytes).toBe(TREE_CHUNK_BYTES);
    expect(plan.calls[0]!.kind).toBe('start');
    expect(plan.calls[plan.calls.length - 2]!.kind).toBe('read-back');
    expect(plan.calls[plan.calls.length - 1]!.kind).toBe('cache-clear');
    const appends = plan.calls.filter((c) => c.kind === 'append');
    appends.forEach((c, idx) => expect(c.params.chunk_index).toBe(idx));
  });

  it('registry guard passes for known tree-chunk abilities', () => {
    const plan = planTreeChunkDeploy(smallTree(), { target: 'v3', postId: 1 });
    expect(() => assertTreeChunkPlanUsesKnownAbilities(plan)).not.toThrow();
  });

  it('fails on 5 MB overflow', () => {
    const huge = [{ id: 'x', elType: 'section', data: 'a'.repeat(5_300_000) }];
    expect(() => planTreeChunkDeploy(huge, { target: 'v3', postId: 1 })).toThrow(/5 MB cap/);
  });

  it('runTreeChunkDeploy happy path with mock adapter', async () => {
    const plan = planTreeChunkDeploy(smallTree(), { target: 'v3', postId: 42 });
    const calls: string[] = [];
    const adapter = {
      executeAbility: async (name: string) => {
        calls.push(name);
        if (name === 'novamira-adrianv2/elementor-tree-chunk-start') return { success: true, session_id: 'abc123', expires_at: new Date().toISOString() };
        if (name === 'novamira-adrianv2/elementor-tree-chunk-append') return { success: true, chunk_index: 0, bytes_received_total: 10 };
        if (name === 'novamira-adrianv2/elementor-tree-chunk-commit') return { success: true, post_id: 42, sections_count: 1 };
        if (name === 'novamira/elementor-get-content') return { content: [{ persisted: true }] };
        if (name === 'novamira/elementor-clear-document-cache') return { success: true };
        return { success: true };
      },
    } as unknown as McpAdapter;
    const report = await runTreeChunkDeploy(adapter, plan);
    expect(report.success).toBe(true);
    expect(report.sessionId).toBe('abc123');
    expect(calls).toContain('novamira-adrianv2/elementor-tree-chunk-start');
  });
});

describe('tree-chunk gate in executeDeploy', () => {
  it('tree-chunk without verified gate returns capability-unavailable with 0 calls (v3)', async () => {
    const calls: string[] = [];
    const adapter = { executeAbility: async (n: string) => { calls.push(n); return { success: true }; } } as unknown as McpAdapter;
    const report = await executeDeploy(adapter, new TransactionManager(), { target: 'v3', postId: 1, tree: smallTree(), strategy: 'tree-chunk' });
    expect(report.success).toBe(false);
    expect(report.failureKind).toBe('capability-unavailable');
    expect(calls).toHaveLength(0);
  });

  it('tree-chunk for v4 returns capability-unavailable even when verified', async () => {
    const calls: string[] = [];
    const adapter = { executeAbility: async (n: string) => { calls.push(n); return { success: true }; } } as unknown as McpAdapter;
    const report = await executeDeploy(adapter, new TransactionManager(), { target: 'v4', postId: 1, tree: smallTree(), strategy: 'tree-chunk', largeDeployVerified: true });
    expect(report.success).toBe(false);
    expect(report.failureKind).toBe('capability-unavailable');
    expect(report.errors[0]).toMatch(/V4/);
  });
});
