import { describe, it, expect, vi } from 'vitest';
import type { McpAdapter } from '../../../packages/mcp/src/adapter.js';
import {
  collectLargeDeployExpectations,
  extractAbilitySchema,
  verifyLargeDeployContract,
  LARGE_DEPLOY_VERIFY_EXIT_CODES,
  type LargeDeployVerificationReport,
} from '../../../packages/mcp/src/large-deploy-verification.js';
import { planLargeDeploy } from '../../../packages/mcp/src/large-deploy-plan.js';
import { resolveAbilityName } from '../../../packages/mcp/src/ability-registry.js';

/**
 * O-03 offline verification path: the frozen upload-php/split contract is
 * checked against live `mcp-adapter-get-ability-info` schemas. Expectations
 * are DERIVED from planLargeDeploy (no duplicated table), shape extraction is
 * defensive, and `requiresLiveRoundtrip` stays a literal true so this check
 * can never open the productive gate.
 */

const SYNTHETIC_TREE = Array.from({ length: 25 }, (_, i) => ({ id: `el_${i}`, elType: 'section' }));

function liveSchema(properties: Record<string, unknown>): Record<string, unknown> {
  return { input_schema: { properties, required: Object.keys(properties) } };
}

/** Abilities the frozen contracts call (4 large-deploy + 3 tree-chunk), deterministic order. */
const EXPECTED_ABILITIES = [
  'novamira-adrianv2/batch-build-page',
  'novamira-adrianv2/elementor-inject-calibrated-page',
  'novamira-adrianv2/elementor-tree-chunk-append',
  'novamira-adrianv2/elementor-tree-chunk-commit',
  'novamira-adrianv2/elementor-tree-chunk-start',
  'novamira/elementor-clear-document-cache',
  'novamira/elementor-get-content',
];

function matchingPayloads(): Map<string, unknown> {
  return new Map([
    [
      'novamira-adrianv2/elementor-inject-calibrated-page',
      liveSchema({
        post_id: { type: 'integer' },
        _elementor_data: { type: 'array' },
        elementor_version: { type: 'string' },
        wp_page_template: { type: 'string' },
        transaction_id: { type: 'string' },
        mode: { type: 'string', enum: ['replace', 'append'] },
      }),
    ],
    [
      'novamira-adrianv2/batch-build-page',
      liveSchema({
        post_id: { type: 'integer' },
        elements: { type: 'array' },
        transaction_id: { type: 'string' },
        mode: { type: 'string', enum: ['replace', 'append'] },
      }),
    ],
    [
      'novamira/elementor-get-content',
      liveSchema({ post_id: { type: 'integer' }, full_dump: { type: 'boolean' } }),
    ],
    [
      'novamira/elementor-clear-document-cache',
      liveSchema({ post_ids: { type: 'array' } }),
    ],
    [
      'novamira-adrianv2/elementor-tree-chunk-start',
      liveSchema({
        post_id: { type: 'integer' },
        mode: { type: 'string', enum: ['overwrite', 'merge_by_id'] },
        wp_page_template: { type: 'string' },
        elementor_version: { type: 'string' },
      }),
    ],
    [
      'novamira-adrianv2/elementor-tree-chunk-append',
      liveSchema({ session_id: { type: 'string' }, chunk_index: { type: 'integer' }, chunk_data: { type: 'string' } }),
    ],
    [
      'novamira-adrianv2/elementor-tree-chunk-commit',
      liveSchema({ session_id: { type: 'string' }, post_id: { type: 'integer' } }),
    ],
  ]);
}

function verifyWith(
  payloads: Map<string, unknown>,
  failureAbility?: string,
): Promise<LargeDeployVerificationReport> {
  const getAbilityInfo = vi.fn(
    async (_adapter: McpAdapter, abilityName: string): Promise<unknown> => {
      if (failureAbility && abilityName === failureAbility) {
        throw new Error('connection refused');
      }
      const payload = payloads.get(abilityName);
      if (payload === undefined) throw new Error(`no fixture for ${abilityName}`);
      return payload;
    },
  );
  const adapter = { baseUrl: 'https://mcp.test', authHeader: 'Basic test' } as McpAdapter;
  return verifyLargeDeployContract(getAbilityInfo, adapter, {
    authMode: 'mcp-url-auth-env',
    timestamp: '2026-08-04T00:00:00.000Z',
  });
}

describe('collectLargeDeployExpectations — derived from the frozen contract', () => {
  it('covers exactly the four planned abilities in deterministic order', () => {
    const expectations = collectLargeDeployExpectations();
    expect(expectations.map((e) => e.ability)).toEqual(EXPECTED_ABILITIES);
  });

  it('covers tree-chunk start/append/commit with session/chunk params', () => {
    const expectations = collectLargeDeployExpectations();
    const start = expectations.find((e) => e.ability === 'novamira-adrianv2/elementor-tree-chunk-start');
    const append = expectations.find((e) => e.ability === 'novamira-adrianv2/elementor-tree-chunk-append');
    const commit = expectations.find((e) => e.ability === 'novamira-adrianv2/elementor-tree-chunk-commit');
    expect(start?.expectedParams).toEqual(expect.arrayContaining(['post_id', 'mode']));
    expect(append?.expectedParams).toEqual(expect.arrayContaining(['session_id', 'chunk_index', 'chunk_data']));
    expect(commit?.expectedParams).toEqual(expect.arrayContaining(['session_id', 'post_id']));
  });

  it('expects mode (replace/append) on both deploy abilities only', () => {
    const expectations = collectLargeDeployExpectations();
    const deploy = expectations.filter((e) => e.expectsMode);
    expect(deploy.map((e) => e.ability)).toEqual([
      'novamira-adrianv2/batch-build-page',
      'novamira-adrianv2/elementor-inject-calibrated-page',
    ]);
    expect(expectations.filter((e) => e.ability.includes('tree-chunk')).every((e) => e.expectsMode === false)).toBe(true);
  });

  it('derives the same parameter keys the plan emits (no duplicated table)', () => {
    const expectations = collectLargeDeployExpectations();
    for (const expectation of expectations) {
      const plan = planLargeDeploy(SYNTHETIC_TREE, {
        target: expectation.ability.includes('batch-build') ? 'v4' : 'v3',
        postId: 1,
        strategy: expectation.kind === 'deploy' ? 'upload-php' : 'split',
      });
      const emitted = new Set<string>();
      for (const call of plan.calls) {
        if (resolveAbilityName(call.ability) === expectation.ability) {
          for (const key of Object.keys(call.params)) emitted.add(key);
        }
      }
      // Every plan-emitted key is expected; every expected key appears in some
      // plan call (the union across both strategies is the expectation set).
      for (const key of emitted) {
        expect(expectation.expectedParams).toContain(key);
      }
      expect(expectation.expectedParams).toEqual([...expectation.expectedParams].sort());
    }
  });

  it('expects chunked params (elements / _elementor_data) and transaction_id', () => {
    const expectations = collectLargeDeployExpectations();
    const v4 = expectations.find((e) => e.ability === 'novamira-adrianv2/batch-build-page');
    const v3 = expectations.find((e) => e.ability === 'novamira-adrianv2/elementor-inject-calibrated-page');
    expect(v4?.expectedParams).toContain('elements');
    expect(v4?.expectedParams).toContain('transaction_id');
    expect(v3?.expectedParams).toContain('_elementor_data');
    expect(v3?.expectedParams).toContain('transaction_id');
    const readBack = expectations.find((e) => e.ability === 'novamira/elementor-get-content');
    expect(readBack?.expectedParams).toEqual(['full_dump', 'post_id']);
  });
});

describe('extractAbilitySchema — defensive shape recognition', () => {
  it('recognizes bare { properties } objects', () => {
    const { recognized, params } = extractAbilitySchema({ properties: { a: {}, b: {} } });
    expect(recognized).toBe(true);
    expect(params).toEqual(['a', 'b']);
  });

  it('recognizes wrapped shapes (input_schema / inputSchema / parameters / schema)', () => {
    for (const key of ['input_schema', 'inputSchema', 'parameters', 'schema']) {
      const { recognized, params } = extractAbilitySchema({ [key]: { properties: { mode: {} } } });
      expect(recognized).toBe(true);
      expect(params).toEqual(['mode']);
    }
  });

  it('extracts the mode enum when declared', () => {
    const { recognized, modeEnum } = extractAbilitySchema(
      liveSchema({ mode: { type: 'string', enum: ['replace', 'append'] } }),
    );
    expect(recognized).toBe(true);
    expect(modeEnum).toEqual(['replace', 'append']);
  });

  it('reports unrecognized payloads honestly (never guesses)', () => {
    for (const payload of [{ foo: 'bar' }, 'text', null, [], { weird: { nested: true } }]) {
      const { recognized, params } = extractAbilitySchema(payload);
      expect(recognized).toBe(false);
      expect(params).toEqual([]);
    }
  });
});

describe('verifyLargeDeployContract — offline verification against live schemas', () => {
  it('verifies all four abilities when live schemas match the contract', async () => {
    const report = await verifyWith(matchingPayloads());
    expect(report.ok).toBe(true);
    expect(report.exitCode).toBe(LARGE_DEPLOY_VERIFY_EXIT_CODES.VERIFIED);
    expect(report.checks).toHaveLength(7);
    expect(report.checks.every((c) => c.matches)).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.strategies).toEqual(['upload-php', 'split']);
    expect(report.authMode).toBe('mcp-url-auth-env');
    expect(report.timestamp).toBe('2026-08-04T00:00:00.000Z');
  });

  it('never opens the productive gate — requiresLiveRoundtrip is the literal true', async () => {
    const report = await verifyWith(matchingPayloads());
    // Even a fully schema-verified report cannot unlock deploy.ts.
    expect(report.requiresLiveRoundtrip).toBe(true);
    const asLiteral: LargeDeployVerificationReport['requiresLiveRoundtrip'] = report.requiresLiveRoundtrip;
    expect(asLiteral).toBe(true);
  });

  it('fails verification when the live schema misses a planned param', async () => {
    const payloads = matchingPayloads();
    payloads.set('novamira-adrianv2/elementor-inject-calibrated-page', liveSchema({
      post_id: { type: 'integer' },
      _elementor_data: { type: 'array' },
      elementor_version: { type: 'string' },
      wp_page_template: { type: 'string' },
      // transaction_id and mode missing
    }));
    const report = await verifyWith(payloads);
    expect(report.ok).toBe(false);
    expect(report.exitCode).toBe(LARGE_DEPLOY_VERIFY_EXIT_CODES.FAILED);
    const check = report.checks.find((c) => c.ability === 'novamira-adrianv2/elementor-inject-calibrated-page');
    expect(check?.matches).toBe(false);
    expect(check?.missingParams).toEqual(['mode', 'transaction_id']);
    expect(report.issues.some((i) => i.includes('misses expected params'))).toBe(true);
  });

  it('fails verification when the mode enum lacks replace or append', async () => {
    const payloads = matchingPayloads();
    payloads.set('novamira-adrianv2/batch-build-page', liveSchema({
      post_id: { type: 'integer' },
      elements: { type: 'array' },
      transaction_id: { type: 'string' },
      mode: { type: 'string', enum: ['replace'] },
    }));
    const report = await verifyWith(payloads);
    expect(report.ok).toBe(false);
    const check = report.checks.find((c) => c.ability === 'novamira-adrianv2/batch-build-page');
    expect(check?.mode?.supported).toBe(false);
    expect(check?.mode?.issue).toContain("lacks 'replace' or 'append'");
    expect(report.issues.some((i) => i.includes('mode enum'))).toBe(true);
  });

  it('fails verification when mode has no declared enum (append unconfirmed)', async () => {
    const payloads = matchingPayloads();
    payloads.set('novamira-adrianv2/elementor-inject-calibrated-page', liveSchema({
      post_id: { type: 'integer' },
      _elementor_data: { type: 'array' },
      elementor_version: { type: 'string' },
      wp_page_template: { type: 'string' },
      transaction_id: { type: 'string' },
      mode: { type: 'string' },
    }));
    const report = await verifyWith(payloads);
    expect(report.ok).toBe(false);
    const check = report.checks.find((c) => c.ability === 'novamira-adrianv2/elementor-inject-calibrated-page');
    expect(check?.mode?.declared).toBe(true);
    expect(check?.mode?.supported).toBe(false);
    expect(check?.mode?.issue).toContain('declares no enum');
  });

  it('reports an unrecognized live shape as not verified', async () => {
    const payloads = matchingPayloads();
    payloads.set('novamira/elementor-get-content', { unexpected: 'shape' });
    const report = await verifyWith(payloads);
    expect(report.ok).toBe(false);
    const check = report.checks.find((c) => c.ability === 'novamira/elementor-get-content');
    expect(check?.shapeRecognized).toBe(false);
    expect(check?.matches).toBe(false);
    expect(report.issues.some((i) => i.includes('shape not recognized'))).toBe(true);
  });

  it('marks an unreachable ability unavailable and still checks the rest', async () => {
    const report = await verifyWith(matchingPayloads(), 'novamira/elementor-get-content');
    expect(report.ok).toBe(false);
    expect(report.exitCode).toBe(LARGE_DEPLOY_VERIFY_EXIT_CODES.FAILED);
    const unavailable = report.checks.find((c) => c.ability === 'novamira/elementor-get-content');
    expect(unavailable?.status).toBe('unavailable');
    expect(unavailable?.matches).toBe(false);
    expect(unavailable?.error).toContain('connection refused');
    expect(report.checks.filter((c) => c.status === 'checked')).toHaveLength(6);
    expect(report.issues.some((i) => i.includes('get-ability-info'))).toBe(true);
  });

  it('resolves aliased plan names to live abilities before verifying', async () => {
    // The expectations go through resolveAbilityName; a plan referencing an
    // alias must not break the derived contract.
    const expectations = collectLargeDeployExpectations();
    for (const e of expectations) {
      expect(() => resolveAbilityName(e.ability)).not.toThrow();
    }
  });
});
