import { describe, it, expect } from 'vitest';
import { chooseDeployStrategy, measureTreeBytes, STRATEGY_THRESHOLDS } from '@elconv/core';
import {
  executeDeploy,
  planLargeDeploy,
  runPlannedDeploy,
  assertPlanUsesKnownAbilities,
  TransactionManager,
  UPLOAD_PHP_CHUNK_COUNT,
  normalizeV3Tree,
  type LargeDeployPlan,
  type McpAdapter,
} from '@elconv/mcp';
import {
  uploadPhpV3Fixture,
  splitV4Fixture,
  specialCaseV3Fixture,
  specialCaseV4Fixture,
} from './fixtures/large-trees.ts';
import { runV4Guards } from '@elconv/target-v4';

interface FixtureNode {
  id: string;
  elType: string;
  widgetType?: string;
  type?: string;
  settings?: Record<string, unknown>;
  styles?: Record<string, unknown>;
  elements?: unknown[];
}

/** Walk every node of a fixture tree (V3 or V4 shape). */
function walkTree(elements: unknown[], fn: (node: FixtureNode) => void): void {
  for (const raw of elements) {
    const node = raw as FixtureNode;
    fn(node);
    if (Array.isArray(node.elements)) walkTree(node.elements, fn);
  }
}

/**
 * O-03 offline preparation.
 *
 * These tests deliberately run WITHOUT any live WordPress/MCP target. They
 * freeze the planned parameter contract for `upload-php` and `split`, prove the
 * productive gate in `executeDeploy` stays closed, and execute the plan against
 * mock adapters only. The server-side upload/append schemas remain unverified.
 */

describe('O-03 offline fixtures land in the right size bands', () => {
  it('V3 upload-php fixture: >= directMax, < uploadPhpMax', () => {
    const tree = uploadPhpV3Fixture();
    const bytes = measureTreeBytes(tree);
    expect(bytes).toBeGreaterThanOrEqual(STRATEGY_THRESHOLDS.directMaxBytes);
    expect(bytes).toBeLessThan(STRATEGY_THRESHOLDS.uploadPhpMaxBytes);
    expect(chooseDeployStrategy(bytes)).toBe('upload-php');
  });

  it('V4 split fixture: >= uploadPhpMax', () => {
    const tree = splitV4Fixture();
    const bytes = measureTreeBytes(tree);
    expect(bytes).toBeGreaterThanOrEqual(STRATEGY_THRESHOLDS.uploadPhpMaxBytes);
    expect(chooseDeployStrategy(bytes)).toBe('split');
  });

  it('fixtures are deterministic (same bytes on every build)', () => {
    expect(measureTreeBytes(uploadPhpV3Fixture())).toBe(measureTreeBytes(uploadPhpV3Fixture()));
    expect(measureTreeBytes(splitV4Fixture())).toBe(measureTreeBytes(splitV4Fixture()));
  });
});

describe('O-03 planned contract — upload-php', () => {
  const tree = uploadPhpV3Fixture();

  function plan(): LargeDeployPlan {
    return planLargeDeploy(tree, { target: 'v3', postId: 42, strategy: 'upload-php', txId: 'tx-plan' });
  }

  it('plans exactly two chunks (replace, then append)', () => {
    const p = plan();
    expect(p.requiresSchemaVerification).toBe(true);
    expect(p.strategy).toBe('upload-php');
    expect(p.target).toBe('v3');
    expect(p.chunkCount).toBe(UPLOAD_PHP_CHUNK_COUNT);
    expect(p.treeBytes).toBe(measureTreeBytes(tree));
  });

  it('emits deploy, read-back and cache-clear per chunk with replace/append modes', () => {
    const p = plan();
    expect(p.calls).toHaveLength(UPLOAD_PHP_CHUNK_COUNT * 3);

    const deployCalls = p.calls.filter((c) => c.kind === 'deploy');
    expect(deployCalls).toHaveLength(2);
    expect(deployCalls[0]!.mode).toBe('replace');
    expect(deployCalls[1]!.mode).toBe('append');
    expect(deployCalls[0]!.params.post_id).toBe(42);
    expect(deployCalls[0]!.params.transaction_id).toBe('tx-plan');
    expect(deployCalls[0]!.params._elementor_data).toEqual(p.calls[0]!.params._elementor_data);

    // V3 planned path uses the calibrated inject ability, never the V4 builder.
    expect(deployCalls[0]!.ability).toBe('novamira-adrianv2/elementor-inject-calibrated-page');

    const readBacks = p.calls.filter((c) => c.kind === 'read-back');
    expect(readBacks).toHaveLength(2);
    expect(readBacks[0]!.params).toEqual({ post_id: 42, full_dump: true });

    const cacheClears = p.calls.filter((c) => c.kind === 'cache-clear');
    expect(cacheClears).toHaveLength(2);
    expect(cacheClears[0]!.params).toEqual({ post_ids: [42] });
  });

  it('orders calls as deploy → read-back → cache-clear per chunk', () => {
    const kinds = plan().calls.map((c) => c.kind);
    expect(kinds).toEqual(['deploy', 'read-back', 'cache-clear', 'deploy', 'read-back', 'cache-clear']);
  });
});

describe('O-03 planned contract — split', () => {
  const tree = splitV4Fixture();

  function plan(): LargeDeployPlan {
    return planLargeDeploy(tree, { target: 'v4', postId: 7, strategy: 'split', txId: 'tx-split' });
  }

  it('chunks by CHUNK_SIZE (20) and appends after the first chunk', () => {
    const p = plan();
    expect(p.strategy).toBe('split');
    expect(p.target).toBe('v4');
    expect(p.requiresSchemaVerification).toBe(true);
    expect(p.chunkCount).toBe(Math.ceil(tree.length / 20));

    const deployCalls = p.calls.filter((c) => c.kind === 'deploy');
    expect(deployCalls[0]!.mode).toBe('replace');
    for (const call of deployCalls.slice(1)) {
      expect(call.mode).toBe('append');
    }
    expect(deployCalls[0]!.ability).toBe('novamira-adrianv2/batch-build-page');
    expect(deployCalls[0]!.params.elements).toHaveLength(20);
  });

  it('emits read-back + cache-clear after every chunk', () => {
    const p = plan();
    const perChunk = new Map<number, string[]>();
    for (const call of p.calls) {
      const list = perChunk.get(call.chunkIndex) ?? [];
      list.push(call.kind);
      perChunk.set(call.chunkIndex, list);
    }
    for (const kinds of perChunk.values()) {
      expect(kinds).toEqual(['deploy', 'read-back', 'cache-clear']);
    }
  });
});

describe('O-03 registry drift guard', () => {
  it('every planned ability for both strategies resolves in the live registry', () => {
    assertPlanUsesKnownAbilities(planLargeDeploy(uploadPhpV3Fixture(), { target: 'v3', postId: 1, strategy: 'upload-php' }));
    assertPlanUsesKnownAbilities(planLargeDeploy(splitV4Fixture(), { target: 'v4', postId: 1, strategy: 'split' }));
  });

  it('never references execute-php or file reads (historical temp-file bug regression)', () => {
    const plans = [
      planLargeDeploy(uploadPhpV3Fixture(), { target: 'v3', postId: 1, strategy: 'upload-php' }),
      planLargeDeploy(splitV4Fixture(), { target: 'v4', postId: 1, strategy: 'split' }),
    ];
    for (const p of plans) {
      for (const call of p.calls) {
        expect(call.ability).not.toBe('novamira/execute-php');
        const code = call.params.code as string | undefined;
        expect(code ?? '').not.toMatch(/file_get_contents/);
      }
    }
  });

  it('throws UnknownAbilityError for a drifted ability name', () => {
    const p = planLargeDeploy(uploadPhpV3Fixture(), { target: 'v3', postId: 1, strategy: 'upload-php' });
    (p.calls[0] as { ability: string }).ability = 'novamira/does-not-exist';
    expect(() => assertPlanUsesKnownAbilities(p)).toThrow(/Unknown Novamira ability/);
  });
});

describe('O-03 honest gate — executeDeploy stays unavailable', () => {
  function okAdapter(): McpAdapter {
    return {
      executeAbility: async () => ({ success: true }),
    } as unknown as McpAdapter;
  }

  it('upload-php returns capability-unavailable with zero MCP calls', async () => {
    const calls: string[] = [];
    const adapter = {
      executeAbility: async (name: string) => {
        calls.push(name);
        return { success: true };
      },
    } as unknown as McpAdapter;

    const report = await executeDeploy(adapter, new TransactionManager(), {
      target: 'v3',
      postId: 42,
      tree: uploadPhpV3Fixture(),
      strategy: 'upload-php',
    });

    expect(report.success).toBe(false);
    expect(report.failureKind).toBe('capability-unavailable');
    expect(report.errors[0]).toContain('no verified upload/PHP-inject ability schema');
    expect(calls).toHaveLength(0);
  });

  it('split returns capability-unavailable with zero MCP calls', async () => {
    const calls: string[] = [];
    const adapter = {
      executeAbility: async (name: string) => {
        calls.push(name);
        return { success: true };
      },
    } as unknown as McpAdapter;

    const report = await executeDeploy(adapter, new TransactionManager(), {
      target: 'v4',
      postId: 42,
      tree: splitV4Fixture(),
      strategy: 'split',
    });

    expect(report.success).toBe(false);
    expect(report.failureKind).toBe('capability-unavailable');
    expect(report.errors[0]).toContain('append/chunk parameter contract');
    expect(calls).toHaveLength(0);
  });

  it('dry-run reports chunk counts without any MCP call', async () => {
    const calls: string[] = [];
    const adapter = {
      executeAbility: async (name: string) => {
        calls.push(name);
        return { success: true };
      },
    } as unknown as McpAdapter;

    const report = await executeDeploy(adapter, new TransactionManager(), {
      target: 'v3',
      postId: 42,
      tree: uploadPhpV3Fixture(),
      strategy: 'split',
      dryRun: true,
    });

    expect(report.success).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(report.chunks).toBe(Math.ceil(uploadPhpV3Fixture().length / 20));
    expect(calls).toHaveLength(0);
  });
});

describe('O-03 mock-adapter execution of the planned contract', () => {
  function recordingAdapter(overrides: Partial<Record<string, () => unknown>> = {}) {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
    const adapter = {
      executeAbility: async (name: string, params: Record<string, unknown>) => {
        calls.push({ name, params });
        const override = overrides[name];
        if (override) return override();
        if (name === 'novamira/elementor-get-content') return { content: [{ persisted: true }] };
        return { success: true };
      },
    } as unknown as McpAdapter;
    return { adapter, calls };
  }

  it('runs the full upload-php plan against a mock adapter with injected txId', async () => {
    const { adapter, calls } = recordingAdapter();
    const plan = planLargeDeploy(uploadPhpV3Fixture(), { target: 'v3', postId: 42, strategy: 'upload-php' });

    const report = await runPlannedDeploy(adapter, plan, 'tx-live-1');

    expect(report.success).toBe(true);
    expect(report.complete).toBe(true);
    expect(report.progress).toBe(100);
    expect(report.executedSteps).toBe(plan.calls.length);
    expect(report.canResume).toBe(true);

    expect(calls.map((c) => c.name)).toEqual([
      'novamira-adrianv2/elementor-inject-calibrated-page',
      'novamira/elementor-get-content',
      'novamira/elementor-clear-document-cache',
      'novamira-adrianv2/elementor-inject-calibrated-page',
      'novamira/elementor-get-content',
      'novamira/elementor-clear-document-cache',
    ]);
    expect(calls[0]!.params.transaction_id).toBe('tx-live-1');
    expect(calls[0]!.params.mode).toBe('replace');
    expect(calls[3]!.params.mode).toBe('append');
  });

  it('retries a transient deploy failure once and still completes', async () => {
    let failures = 1;
    const { adapter, calls } = recordingAdapter({
      'novamira-adrianv2/elementor-inject-calibrated-page': () => {
        if (failures-- > 0) return { success: false, error: 'transient' };
        return { success: true };
      },
    });
    const plan = planLargeDeploy(uploadPhpV3Fixture(), { target: 'v3', postId: 42, strategy: 'upload-php' });

    const report = await runPlannedDeploy(adapter, plan, 'tx-retry');

    expect(report.success).toBe(true);
    expect(report.chunkResults[0]!.attempts).toBe(2);
    expect(calls.length).toBe(plan.calls.length + 1); // one extra retry call
  });

  it('stops on a repeated chunk failure and reports a resumable checkpoint', async () => {
    const { adapter } = recordingAdapter({
      'novamira-adrianv2/elementor-inject-calibrated-page': () => ({ success: false, error: 'always down' }),
    });
    const plan = planLargeDeploy(uploadPhpV3Fixture(), { target: 'v3', postId: 42, strategy: 'upload-php' });

    const report = await runPlannedDeploy(adapter, plan, 'tx-fail');

    expect(report.success).toBe(false);
    expect(report.complete).toBe(false);
    expect(report.chunkResults[0]!.success).toBe(false);
    expect(report.chunkResults[0]!.attempts).toBe(2);
    expect(report.chunkResults[0]!.error).toContain('deploy failed after retry');
    expect(report.canResume).toBe(false); // nothing verified yet
    expect(report.resumeIndex).toBe(0);
  });

  it('resumes after the last verified chunk when a later chunk fails', async () => {
    let secondChunkFailures = 1;
    const { adapter } = recordingAdapter({
      'novamira-adrianv2/elementor-inject-calibrated-page': (() => {
        let callIndex = 0;
        return () => {
          callIndex++;
          // Fail the second deploy call once (chunk 1), succeed on retry.
          if (callIndex === 2) {
            if (secondChunkFailures-- > 0) return { success: false, error: 'timeout' };
          }
          return { success: true };
        };
      })(),
    });
    const plan = planLargeDeploy(uploadPhpV3Fixture(), { target: 'v3', postId: 42, strategy: 'upload-php' });

    const report = await runPlannedDeploy(adapter, plan, 'tx-resume');

    expect(report.success).toBe(true);
    expect(report.resumeIndex).toBe(plan.chunkCount);
    expect(report.chunkResults[1]!.attempts).toBe(2);
  });
});

describe('O-03 wired planned path — executeDeploy with largeDeployVerified opt-in', () => {
  function recordingAdapter(overrides: Partial<Record<string, () => unknown>> = {}) {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
    const adapter = {
      executeAbility: async (name: string, params: Record<string, unknown>) => {
        calls.push({ name, params });
        const override = overrides[name];
        if (override) return override();
        if (name === 'novamira/elementor-get-content') return { content: [{ persisted: true }] };
        return { success: true };
      },
    } as unknown as McpAdapter;
    return { adapter, calls };
  }

  it('runs the full upload-php plan through executeDeploy when verified (v3)', async () => {
    const { adapter, calls } = recordingAdapter();
    const report = await executeDeploy(adapter, new TransactionManager(), {
      target: 'v3',
      postId: 42,
      tree: uploadPhpV3Fixture(),
      strategy: 'upload-php',
      largeDeployVerified: true,
    });

    expect(report.success).toBe(true);
    expect(report.failureKind).toBeUndefined();
    expect(report.strategy).toBe('upload-php');
    expect(report.chunks).toBe(UPLOAD_PHP_CHUNK_COUNT);
    expect(report.dryRun).toBe(false);
    expect(calls).toHaveLength(UPLOAD_PHP_CHUNK_COUNT * 3);
    expect(calls.map((c) => c.name)).toEqual([
      'novamira-adrianv2/elementor-inject-calibrated-page',
      'novamira/elementor-get-content',
      'novamira/elementor-clear-document-cache',
      'novamira-adrianv2/elementor-inject-calibrated-page',
      'novamira/elementor-get-content',
      'novamira/elementor-clear-document-cache',
    ]);
    expect(calls[0]!.params.mode).toBe('replace');
    expect(calls[3]!.params.mode).toBe('append');
    expect(calls[0]!.params.transaction_id).toBe(report.transactionId);
  });

  it('runs the full split plan through executeDeploy when verified (v4)', async () => {
    const { adapter, calls } = recordingAdapter();
    const report = await executeDeploy(adapter, new TransactionManager(), {
      target: 'v4',
      postId: 7,
      tree: splitV4Fixture(),
      strategy: 'split',
      largeDeployVerified: true,
    });

    expect(report.success).toBe(true);
    expect(report.failureKind).toBeUndefined();
    expect(report.strategy).toBe('split');
    expect(report.chunks).toBe(Math.ceil(splitV4Fixture().length / 20));
    const deployCalls = calls.filter((c) => c.name === 'novamira-adrianv2/batch-build-page');
    expect(deployCalls[0]!.params.mode).toBe('replace');
    for (const call of deployCalls.slice(1)) {
      expect(call.params.mode).toBe('append');
    }
    expect(deployCalls[0]!.params.elements).toHaveLength(20);
  });

  it('reports deploy-failed and does not commit when a chunk fails repeatedly', async () => {
    const { adapter } = recordingAdapter({
      'novamira-adrianv2/elementor-inject-calibrated-page': () => ({ success: false, error: 'always down' }),
    });
    const report = await executeDeploy(adapter, new TransactionManager(), {
      target: 'v3',
      postId: 42,
      tree: uploadPhpV3Fixture(),
      strategy: 'upload-php',
      largeDeployVerified: true,
    });

    expect(report.success).toBe(false);
    expect(report.failureKind).toBe('deploy-failed');
    expect(report.errors[0]).toContain('upload-php deploy failed');
    expect(report.chunks).toBeUndefined();
  });

  it('keeps the gate closed without the opt-in even when the adapter would succeed', async () => {
    const calls: string[] = [];
    const adapter = {
      executeAbility: async (name: string) => {
        calls.push(name);
        return { success: true };
      },
    } as unknown as McpAdapter;

    const report = await executeDeploy(adapter, new TransactionManager(), {
      target: 'v3',
      postId: 42,
      tree: uploadPhpV3Fixture(),
      strategy: 'upload-php',
    });

    expect(report.success).toBe(false);
    expect(report.failureKind).toBe('capability-unavailable');
    expect(calls).toHaveLength(0);
  });

  it('resumes after a failed chunk through executeDeploy without re-deploying verified chunks', async () => {
    // Chunk 0 is verified before chunk 1 fails. executeDeploy stores that
    // checkpoint on the transaction, so the resumed call can continue at chunk
    // 1 instead of re-sending the replace chunk.
    let deployCalls = 0;
    const firstRunCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
    const failingAdapter = {
      executeAbility: async (name: string, params: Record<string, unknown>) => {
        firstRunCalls.push({ name, params });
        if (name === 'novamira-adrianv2/elementor-inject-calibrated-page') {
          deployCalls++;
          // Chunk 0 succeeds, every chunk-1 attempt fails (both retries).
          if (deployCalls > 1) return { success: false, error: 'chunk 1 always down' };
        }
        if (name === 'novamira/elementor-get-content') return { content: [{ persisted: true }] };
        return { success: true };
      },
    } as unknown as McpAdapter;
    const txManager = new TransactionManager();

    const failed = await executeDeploy(failingAdapter, txManager, {
      target: 'v3',
      postId: 42,
      tree: uploadPhpV3Fixture(),
      strategy: 'upload-php',
      largeDeployVerified: true,
    });

    expect(failed.success).toBe(false);
    expect(failed.failureKind).toBe('deploy-failed');
    expect(failed.errors[0]).toContain('upload-php deploy failed');
    expect(failed.chunks).toBeUndefined();
    expect(txManager.get(failed.transactionId)?.status).toBe('failed');
    expect(txManager.get(failed.transactionId)?.checkpoints).toMatchObject([
      { index: 0, chunkIndex: 0, verified: true },
    ]);

    // Chunk 0 was fully executed (deploy replace + read-back + cache-clear)
    // before the plan stopped at chunk 1 — the verified checkpoint exists.
    expect(firstRunCalls.slice(0, 3).map((c) => c.name)).toEqual([
      'novamira-adrianv2/elementor-inject-calibrated-page',
      'novamira/elementor-get-content',
      'novamira/elementor-clear-document-cache',
    ]);
    expect(firstRunCalls[0]!.params.mode).toBe('replace');

    // Healed resume: reuse the failed transaction. Only chunk 1 is sent and
    // it keeps append semantics; chunk 0 remains the verified checkpoint.
    const healedCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
    const healedAdapter = {
      executeAbility: async (name: string, params: Record<string, unknown>) => {
        healedCalls.push({ name, params });
        if (name === 'novamira/elementor-get-content') return { content: [{ persisted: true }] };
        return { success: true };
      },
    } as unknown as McpAdapter;

    const resumed = await executeDeploy(healedAdapter, txManager, {
      target: 'v3',
      postId: 42,
      tree: uploadPhpV3Fixture(),
      strategy: 'upload-php',
      largeDeployVerified: true,
      resumeTransactionId: failed.transactionId,
    });

    expect(resumed.success).toBe(true);
    expect(resumed.failureKind).toBeUndefined();
    expect(resumed.chunks).toBe(UPLOAD_PHP_CHUNK_COUNT);
    expect(resumed.transactionId).toBe(failed.transactionId);
    expect(txManager.get(resumed.transactionId)?.status).toBe('committed');
    expect(txManager.get(resumed.transactionId)?.checkpoints).toMatchObject([
      { index: 0, chunkIndex: 0, verified: true },
      { index: 1, chunkIndex: 1, verified: true },
    ]);
    expect(healedCalls).toHaveLength(3);
    expect(healedCalls[0]!.params.mode).toBe('append');
    expect(healedCalls.map((call) => call.name)).toEqual([
      'novamira-adrianv2/elementor-inject-calibrated-page',
      'novamira/elementor-get-content',
      'novamira/elementor-clear-document-cache',
    ]);
  });

  it('rejects resuming a different tree or page template without MCP calls', async () => {
    const failedAdapter = {
      executeAbility: async () => ({ success: false, error: 'offline' }),
    } as unknown as McpAdapter;
    const txManager = new TransactionManager();
    const first = await executeDeploy(failedAdapter, txManager, {
      target: 'v3',
      postId: 42,
      tree: uploadPhpV3Fixture(),
      strategy: 'upload-php',
      pageTemplate: 'elementor_canvas',
      largeDeployVerified: true,
    });
    expect(first.success).toBe(false);

    const calls: string[] = [];
    const adapter = {
      executeAbility: async (name: string) => {
        calls.push(name);
        return { success: true };
      },
    } as unknown as McpAdapter;

    const changedTree = [...uploadPhpV3Fixture(), { id: 'changed' }];
    const changedTreeReport = await executeDeploy(adapter, txManager, {
      target: 'v3',
      postId: 42,
      tree: changedTree,
      strategy: 'upload-php',
      pageTemplate: 'elementor_canvas',
      largeDeployVerified: true,
      resumeTransactionId: first.transactionId,
    });
    expect(changedTreeReport.success).toBe(false);
    expect(changedTreeReport.errors[0]).toContain('different tree');

    const changedTemplateReport = await executeDeploy(adapter, txManager, {
      target: 'v3',
      postId: 42,
      tree: uploadPhpV3Fixture(),
      strategy: 'upload-php',
      pageTemplate: 'elementor_header_footer',
      largeDeployVerified: true,
      resumeTransactionId: first.transactionId,
    });
    expect(changedTemplateReport.success).toBe(false);
    expect(changedTemplateReport.errors[0]).toContain('different tree or page template');
    expect(calls).toHaveLength(0);
  });

  it('rejects resuming a transaction without strategy or tree metadata', async () => {
    const txManager = new TransactionManager();
    const legacy = txManager.begin('v3', 42);
    txManager.fail(legacy.id);
    const calls: string[] = [];
    const adapter = {
      executeAbility: async (name: string) => {
        calls.push(name);
        return { success: true };
      },
    } as unknown as McpAdapter;

    const report = await executeDeploy(adapter, txManager, {
      target: 'v3',
      postId: 42,
      tree: uploadPhpV3Fixture(),
      strategy: 'upload-php',
      largeDeployVerified: true,
      resumeTransactionId: legacy.id,
    });

    expect(report.success).toBe(false);
    expect(report.errors[0]).toContain('no strategy metadata');
    expect(calls).toHaveLength(0);
  });

  it('rejects an invalid large-deploy checkpoint without MCP calls', async () => {
    const txManager = new TransactionManager();
    const tx = txManager.begin('v3', 42, undefined, 'upload-php', JSON.stringify({ tree: uploadPhpV3Fixture(), pageTemplate: 'elementor_canvas' }));
    txManager.addCheckpoint(tx.id, 1, true, 99);
    txManager.fail(tx.id);
    const calls: string[] = [];
    const adapter = {
      executeAbility: async (name: string) => {
        calls.push(name);
        return { success: true };
      },
    } as unknown as McpAdapter;

    const report = await executeDeploy(adapter, txManager, {
      target: 'v3',
      postId: 42,
      tree: uploadPhpV3Fixture(),
      strategy: 'upload-php',
      largeDeployVerified: true,
      resumeTransactionId: tx.id,
    });

    expect(report.success).toBe(false);
    expect(report.failureKind).toBe('deploy-failed');
    expect(report.errors[0]).toContain('invalid large-deploy checkpoint');
    expect(calls).toHaveLength(0);
  });

  it('normalizes V3 before automatic strategy selection and planning', async () => {
    // A small V3 tree that normalizeV3Tree demonstrably changes: a flex-row
    // section whose children lack an explicit width get one injected. Built
    // fresh per use because normalizeV3Tree mutates its input in place.
    function flexRowTree(): unknown[] {
      return [
        {
          id: 's1',
          elType: 'section',
          isInner: false,
          settings: { flex_direction: 'row' },
          elements: [
            {
              id: 'c1',
              elType: 'column',
              settings: {},
              elements: [{ id: 'w1', elType: 'widget', widgetType: 'heading', settings: { title: 'x' } }],
            },
          ],
        },
      ];
    }

    // Proof the fixture is normalization-relevant: normalizeV3Tree injects the
    // missing width, so raw and normalized payloads genuinely differ.
    const rawTree = flexRowTree();
    const sectionSettings = (rawTree[0] as { settings: Record<string, unknown> }).settings;
    sectionSettings.padding = '';
    const targetRawBytes = STRATEGY_THRESHOLDS.directMaxBytes - 4;
    sectionSettings.padding = 'x'.repeat(Math.max(0, targetRawBytes - measureTreeBytes(rawTree)));
    expect(measureTreeBytes(rawTree)).toBeLessThan(STRATEGY_THRESHOLDS.directMaxBytes);

    const normalized = normalizeV3Tree(JSON.parse(JSON.stringify(rawTree)) as unknown[]);
    expect(normalized.stats.flexRowWidthFixed).toBeGreaterThan(0);
    expect((normalized.tree[0] as { elements: Array<{ settings: Record<string, unknown> }> }).elements[0]!.settings.width).toBe('100.00%');

    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
    const adapter = {
      executeAbility: async (name: string, params: Record<string, unknown>) => {
        calls.push({ name, params });
        if (name === 'novamira/elementor-get-content') return { content: [{ persisted: true }] };
        return { success: true };
      },
    } as unknown as McpAdapter;

    const report = await executeDeploy(adapter, new TransactionManager(), {
      target: 'v3',
      postId: 42,
      tree: rawTree,
      strategy: 'auto',
      largeDeployVerified: true,
    });

    expect(report.success).toBe(true);
    expect(report.strategy).toBe('upload-php');
    // The first planned V3 chunk receives the normalized tree, proving the
    // NOTE in deploy.ts is resolved before planLargeDeploy splits the payload.
    const deployed = calls[0]!.params._elementor_data as unknown[];
    const deployedColumn = (deployed[0] as { elements: Array<{ settings: Record<string, unknown> }> }).elements[0]!;
    expect(deployedColumn.settings.width).toBe('100.00%');
  });
});

describe('O-03 Framer special-case fixtures land in the right size bands', () => {
  it('V3 special-case fixture (style refs + CMS + unknown widgets) -> upload-php', () => {
    const tree = specialCaseV3Fixture();
    const bytes = measureTreeBytes(tree);
    expect(bytes).toBeGreaterThanOrEqual(STRATEGY_THRESHOLDS.directMaxBytes);
    expect(bytes).toBeLessThan(STRATEGY_THRESHOLDS.uploadPhpMaxBytes);
    expect(chooseDeployStrategy(bytes)).toBe('upload-php');
  });

  it('V4 special-case fixture -> split', () => {
    const tree = specialCaseV4Fixture();
    const bytes = measureTreeBytes(tree);
    expect(bytes).toBeGreaterThanOrEqual(STRATEGY_THRESHOLDS.uploadPhpMaxBytes);
    expect(chooseDeployStrategy(bytes)).toBe('split');
  });

  it('special-case fixtures are deterministic', () => {
    expect(measureTreeBytes(specialCaseV3Fixture())).toBe(measureTreeBytes(specialCaseV3Fixture()));
    expect(measureTreeBytes(specialCaseV4Fixture())).toBe(measureTreeBytes(specialCaseV4Fixture()));
  });
});

describe('O-03 Framer special-case content shapes', () => {
  it('V3 fixture contains html fallback widgets with string html settings', () => {
    const tree = specialCaseV3Fixture();
    let htmlCount = 0;
    walkTree(tree, (node) => {
      if (node.widgetType === 'html') {
        htmlCount++;
        expect(typeof node.settings?.html).toBe('string');
        expect(String(node.settings?.html)).toContain('framer-unknown-widget');
      }
    });
    expect(htmlCount).toBeGreaterThan(0);
  });

  it('V3 fixture contains CMS collection instances (posts widget)', () => {
    const tree = specialCaseV3Fixture();
    let cmsCount = 0;
    walkTree(tree, (node) => {
      if (node.widgetType === 'posts') {
        cmsCount++;
        expect(node.settings?.source).toBe('cms-collection');
        expect(node.settings?.collection_id).toBe('coll_blog_posts');
        expect(node.settings?.cms_collection_slug).toBe('blog-posts');
        expect(typeof node.settings?.loop_template_id).toBe('string');
      }
    });
    expect(cmsCount).toBeGreaterThan(0);
  });

  it('V3 css_classes style references are always strings (gotcha regression)', () => {
    walkTree(specialCaseV3Fixture(), (node) => {
      if (node.settings && 'css_classes' in node.settings) {
        expect(typeof node.settings.css_classes).toBe('string');
      }
    });
  });

  it('V4 fixture contains e-html unknown-widget fallbacks with html-content $$type', () => {
    const tree = specialCaseV4Fixture();
    let htmlCount = 0;
    walkTree(tree, (node) => {
      if (node.type === 'e-html') {
        htmlCount++;
        const html = node.settings?.html as { '$$type'?: string; value?: string } | undefined;
        expect(html?.['$$type']).toBe('html-content');
        expect(html?.value).toContain('framer-unknown-widget');
      }
    });
    expect(htmlCount).toBeGreaterThan(0);
  });

  it('V4 fixture contains CMS collection instances (e-grid loop)', () => {
    const tree = specialCaseV4Fixture();
    let cmsCount = 0;
    walkTree(tree, (node) => {
      if (node.type === 'e-grid') {
        cmsCount++;
        const loop = node.settings?.loop as { source?: string; collectionId?: string; cmsCollectionSlug?: string } | undefined;
        expect(loop?.source).toBe('cms-collection');
        expect(loop?.collectionId).toBe('coll_blog_posts');
        expect(loop?.cmsCollectionSlug).toBe('blog-posts');
      }
    });
    expect(cmsCount).toBeGreaterThan(0);
  });

  it('V4 style references: gc-* external classes and local classes bound in styles{} (G11)', () => {
    const tree = specialCaseV4Fixture();
    let externalRefs = 0;
    walkTree(tree, (node) => {
      const classesSetting = node.settings?.classes as { '$$type'?: string; value?: unknown } | undefined;
      const classes = Array.isArray(classesSetting?.value) ? (classesSetting.value as string[]) : [];
      const styleIds = new Set(Object.keys(node.styles ?? {}));
      for (const cls of classes) {
        if (cls.startsWith('gc-')) {
          externalRefs++;
          continue; // external global classes are managed server-side
        }
        expect(styleIds.has(cls)).toBe(true); // G11: every local class is bound
      }
    });
    expect(externalRefs).toBeGreaterThan(0);
  });

  it('V4 fixture references global variables and keeps style IDs hyphen-free', () => {
    const tree = specialCaseV4Fixture();
    let globalVarRefs = 0;
    walkTree(tree, (node) => {
      for (const [styleId, styleDef] of Object.entries(node.styles ?? {})) {
        expect(styleId).toMatch(/^[a-z][a-z0-9_]*$/);
        const variants = (styleDef as { variants?: Array<{ props?: Record<string, unknown> }> }).variants ?? [];
        for (const v of variants) {
          for (const prop of Object.values(v.props ?? {})) {
            const typed = prop as { '$$type'?: string } | undefined;
            if (typed?.['$$type'] === 'global-color-variable' || typed?.['$$type'] === 'global-font-variable') {
              globalVarRefs++;
            }
          }
        }
      }
    });
    expect(globalVarRefs).toBeGreaterThan(0);
  });

  it('V4 special-case fixture passes the full V4 guard suite (realism gate)', () => {
    const report = runV4Guards(specialCaseV4Fixture() as never);
    expect(report.passed).toBe(true);
  });
});

describe('O-03 planned contract over Framer special-case fixtures', () => {
  it('V3 special-case tree plans the upload-php contract (replace -> append, read-back + cache-clear per chunk)', () => {
    const p = planLargeDeploy(specialCaseV3Fixture(), { target: 'v3', postId: 42, strategy: 'upload-php' });
    expect(p.requiresSchemaVerification).toBe(true);
    expect(p.chunkCount).toBe(UPLOAD_PHP_CHUNK_COUNT);
    expect(p.calls).toHaveLength(UPLOAD_PHP_CHUNK_COUNT * 3);

    const deployCalls = p.calls.filter((c) => c.kind === 'deploy');
    expect(deployCalls[0]!.mode).toBe('replace');
    expect(deployCalls[1]!.mode).toBe('append');
    expect(deployCalls[0]!.ability).toBe('novamira-adrianv2/elementor-inject-calibrated-page');
    expect(deployCalls[0]!.params._elementor_data).toHaveLength(Math.ceil(135 / 2));

    const kinds = p.calls.map((c) => c.kind);
    expect(kinds).toEqual(['deploy', 'read-back', 'cache-clear', 'deploy', 'read-back', 'cache-clear']);
  });

  it('V4 special-case tree chunks by 20 and appends after the first chunk', () => {
    const p = planLargeDeploy(specialCaseV4Fixture(), { target: 'v4', postId: 7, strategy: 'split' });
    expect(p.chunkCount).toBe(Math.ceil(205 / 20));
    expect(p.requiresSchemaVerification).toBe(true);

    const deployCalls = p.calls.filter((c) => c.kind === 'deploy');
    expect(deployCalls[0]!.mode).toBe('replace');
    for (const call of deployCalls.slice(1)) {
      expect(call.mode).toBe('append');
    }
    expect(deployCalls[0]!.params.elements).toHaveLength(20);
    expect(deployCalls[0]!.ability).toBe('novamira-adrianv2/batch-build-page');
  });

  it('registry guard passes and no execute-php/file_read regression for special-case plans', () => {
    const plans = [
      planLargeDeploy(specialCaseV3Fixture(), { target: 'v3', postId: 1, strategy: 'upload-php' }),
      planLargeDeploy(specialCaseV4Fixture(), { target: 'v4', postId: 1, strategy: 'split' }),
    ];
    for (const p of plans) {
      assertPlanUsesKnownAbilities(p);
      for (const call of p.calls) {
        expect(call.ability).not.toBe('novamira/execute-php');
        expect(String(call.params.code ?? '')).not.toMatch(/file_get_contents/);
      }
    }
  });

  it('mock adapter executes both special-case plans end-to-end', async () => {
    const v3Plan = planLargeDeploy(specialCaseV3Fixture(), { target: 'v3', postId: 42, strategy: 'upload-php' });
    const v4Plan = planLargeDeploy(specialCaseV4Fixture(), { target: 'v4', postId: 7, strategy: 'split' });

    for (const plan of [v3Plan, v4Plan]) {
      const calls: string[] = [];
      const adapter = {
        executeAbility: async (name: string) => {
          calls.push(name);
          if (name === 'novamira/elementor-get-content') return { content: [{ persisted: true }] };
          return { success: true };
        },
      } as unknown as McpAdapter;

      const report = await runPlannedDeploy(adapter, plan, 'tx-special');
      expect(report.success).toBe(true);
      expect(report.complete).toBe(true);
      expect(report.progress).toBe(100);
      expect(report.executedSteps).toBe(plan.calls.length);
      expect(report.resumeIndex).toBe(plan.chunkCount);
      expect(calls.length).toBe(plan.calls.length);
    }
  });

  it('honest gate: executeDeploy still refuses both strategies for special-case trees with zero MCP calls', async () => {
    const calls: string[] = [];
    const adapter = {
      executeAbility: async (name: string) => {
        calls.push(name);
        return { success: true };
      },
    } as unknown as McpAdapter;

    const v3 = await executeDeploy(adapter, new TransactionManager(), {
      target: 'v3',
      postId: 42,
      tree: specialCaseV3Fixture(),
      strategy: 'upload-php',
    });
    expect(v3.success).toBe(false);
    expect(v3.failureKind).toBe('capability-unavailable');

    const v4 = await executeDeploy(adapter, new TransactionManager(), {
      target: 'v4',
      postId: 7,
      tree: specialCaseV4Fixture(),
      strategy: 'split',
    });
    expect(v4.success).toBe(false);
    expect(v4.failureKind).toBe('capability-unavailable');

    expect(calls).toHaveLength(0);
  });
});
