import { describe, it, expect } from 'vitest';
import {
  createSession,
  buildDetectVersionCall,
  buildInjectPageCall,
  buildCreateWpcodeCall,
  buildUpdateWpcodeCall,
  buildClearCacheCall,
  determineDeployStrategy,
  buildDeployPlan,
  simulateDeploy,
} from '@elconv/mcp';

describe('createSession', () => {
  it('merges partial config over the defaults (dryRun:true, 3 retries)', () => {
    const session = createSession({ siteUrl: 'https://x.com' });
    expect(session.config.dryRun).toBe(true);
    expect(session.config.maxRetries).toBe(3);
    expect(session.config.siteUrl).toBe('https://x.com');
    expect(session.callLog).toEqual([]);
  });
});

describe('call builders', () => {
  it('buildDetectVersionCall targets the canonical execute-php ability', () => {
    // `novamira-adrianv2/execute-php` does not exist live; the registry alias
    // used to rewrite it, which hid the drift from code review.
    expect(buildDetectVersionCall().ability).toBe('novamira/execute-php');
  });

  it('buildInjectPageCall carries post_id and content', () => {
    const call = buildInjectPageCall(42, '[]');
    expect(call.params).toEqual({ post_id: 42, content: '[]' });
  });

  it('buildCreateWpcodeCall sends the live-schema activation fields, never status', () => {
    const call = buildCreateWpcodeCall({ title: 'T', code: 'x', code_type: 'css', location: 'header' });
    // `status` is OUTPUT-only. Sending it left every snippet an invisible draft.
    expect(call.params).not.toHaveProperty('status');
    expect(call.params.active).toBe(true);
    // Without auto_insert, `location` is inert and the snippet is never emitted.
    expect(call.params.auto_insert).toBe(true);
    expect(call.params.tags).toEqual(['elconv']);
  });

  it('buildClearCacheCall targets the canonical execute-php ability', () => {
    expect(buildClearCacheCall().ability).toBe('novamira/execute-php');
  });

  it('buildUpdateWpcodeCall targets the given snippet_id', () => {
    expect(buildUpdateWpcodeCall(7, 'x').params.snippet_id).toBe(7);
  });

  // buildRenderPreviewCall used to be duplicated here (a strict subset of
  // render-preview.ts's version) under the same export name, which silently
  // collided in the @elconv/mcp barrel. Removed; see
  // tests/unit/mcp/render-preview.test.ts for that function's coverage.
});

describe('determineDeployStrategy', () => {
  it('picks direct below 400KB, upload-php between 400KB-1.2MB, split-sections above', () => {
    expect(determineDeployStrategy(100 * 1024)).toBe('direct');
    expect(determineDeployStrategy(600 * 1024)).toBe('upload-php');
    expect(determineDeployStrategy(1500 * 1024)).toBe('split-sections');
  });

  it('is right at the boundary correctly (exclusive upper bound)', () => {
    expect(determineDeployStrategy(400 * 1024 - 1)).toBe('direct');
    expect(determineDeployStrategy(400 * 1024)).toBe('upload-php');
  });
});

describe('buildDeployPlan', () => {
  it('direct strategy: one inject call + one cache-clear call', () => {
    const plan = buildDeployPlan(1, JSON.stringify({ small: true }));
    expect(plan.strategy).toBe('direct');
    expect(plan.calls).toHaveLength(2);
    expect(plan.calls[0]!.ability).toBe('novamira-adrianv2/set-page-content');
  });

  it('every generated call is self-contained — none reads from a path nothing in the plan wrote to', () => {
    // Regression test for a real bug: the upload-php tier used to emit PHP
    // that read a temp file (`/tmp/elconv-deploy-{id}.json`) which no call
    // in the plan ever created — the deploy would fail at runtime.
    const bigContent = JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: i, big: 'x'.repeat(30000) })));
    const plan = buildDeployPlan(1, bigContent);
    expect(plan.strategy).toBe('upload-php');
    for (const call of plan.calls) {
      const code = call.params.code as string | undefined;
      expect(code ?? '').not.toMatch(/file_get_contents/);
    }
  });

  it('upload-php strategy: chunks content into 2 set-page-content calls (replace then append) + cache clear', () => {
    const bigContent = JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ id: i, big: 'x'.repeat(60000) })));
    const plan = buildDeployPlan(1, bigContent);
    expect(plan.strategy).toBe('upload-php');
    const contentCalls = plan.calls.filter((c) => c.ability === 'novamira-adrianv2/set-page-content');
    expect(contentCalls).toHaveLength(2);
    expect(contentCalls[0]!.params.mode).toBe('replace');
    expect(contentCalls[1]!.params.mode).toBe('append');
  });

  it('split-sections strategy: chunks content into 3 set-page-content calls', () => {
    const hugeContent = JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ id: i, big: 'x'.repeat(50000) })));
    const plan = buildDeployPlan(1, hugeContent);
    expect(plan.strategy).toBe('split-sections');
    const contentCalls = plan.calls.filter((c) => c.ability === 'novamira-adrianv2/set-page-content');
    expect(contentCalls).toHaveLength(3);
  });

  it('adds rollback calls (restore + clear cache) only when existingContent is given', () => {
    const withRollback = buildDeployPlan(1, '[]', '[{"old":true}]');
    expect(withRollback.rollbackCalls).toHaveLength(2);
    const withoutRollback = buildDeployPlan(1, '[]');
    expect(withoutRollback.rollbackCalls).toEqual([]);
  });

  it('estimatedDurationMs scales with the number of calls', () => {
    const plan = buildDeployPlan(1, '[]');
    expect(plan.estimatedDurationMs).toBe(plan.calls.length * 2000);
  });
});

describe('simulateDeploy', () => {
  it('produces one summarized step per call, tagged dryRun:true', () => {
    const plan = buildDeployPlan(1, JSON.stringify([{ a: 1 }]));
    const sim = simulateDeploy(plan);
    expect(sim.dryRun).toBe(true);
    expect(sim.stepsCount).toBe(plan.calls.length);
    expect(sim.steps[0]!.step).toBe(1);
  });

  it('summarizes a call by post_id when present', () => {
    const plan = buildDeployPlan(99, JSON.stringify([{ a: 1 }]));
    const sim = simulateDeploy(plan);
    expect(sim.steps[0]!.summary).toBe('post_id=99');
  });
});
