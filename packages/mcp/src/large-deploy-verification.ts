/**
 * Large-Deploy Schema Verification (O-03 offline verification path).
 *
 * The `upload-php` and `split` strategies stay productively gated (see
 * `large-deploy-plan.ts` for the frozen call contract and `deploy.ts` for the
 * hard `capability-unavailable` refusals). This module is the diagnostic
 * counterpart: it fetches the LIVE input schemas of the four abilities the
 * frozen contract calls (`mcp-adapter-get-ability-info` — a transport meta
 * tool, not a registry-gated content ability, so it is called directly like
 * `listAbilities`) and compares them against the contract.
 *
 * Honesty rules:
 *  - Expectations are DERIVED from `planLargeDeploy` (no duplicated table that
 *    could silently drift from the frozen contract) and run through
 *    `assertPlanUsesKnownAbilities` so the check can never verify a plan that
 *    references an unknown ability.
 *  - The live payload shape is NOT assumed: `extractAbilitySchema` recognizes
 *    a small set of plausible JSON-Schema-ish shapes and reports
 *    `shapeRecognized: false` (→ not verified) for anything else. No guessing.
 *  - `requiresLiveRoundtrip` is typed as the literal `true`, so no code path —
 *    including this check's own success — can ever treat schema verification
 *    as a productive unlock. `deploy.ts` keeps refusing both strategies until
 *    the controlled live roundtrip (snapshot → small dry-run → real deploy →
 *    read-back → cache-clear → render QA → rollback) is executed against the
 *    released test target.
 */

import type { McpAdapter } from './adapter.js';
import { resolveAbilityName } from './ability-registry.js';
import {
  planLargeDeploy,
  assertPlanUsesKnownAbilities,
  type LargeDeployStrategy,
} from './large-deploy-plan.js';
import { planTreeChunkDeploy } from './tree-chunk-deploy.js';

export const LARGE_DEPLOY_VERIFY_EXIT_CODES = { VERIFIED: 0, FAILED: 1, USAGE: 2 } as const;

export type LargeDeployAbilityKind = 'deploy' | 'read-back' | 'cache-clear';

export interface LargeDeployAbilityExpectation {
  /** Resolved live ability name (aliases mapped, registry-guarded). */
  ability: string;
  kind: LargeDeployAbilityKind;
  /** Every parameter key the frozen contract sends for this ability. */
  expectedParams: readonly string[];
  /** Deploy abilities must declare a `mode` parameter (replace/append chunking). */
  expectsMode: boolean;
}

/**
 * Derive the per-ability expectations from the frozen contract itself.
 * Generates the plan for both targets and both large-deploy strategies over a
 * synthetic tree large enough to force chunking, unions the emitted parameter
 * keys per ability and asserts every planned ability resolves in the registry.
 * Deterministic: sorted by ability name.
 */
export function collectLargeDeployExpectations(): LargeDeployAbilityExpectation[] {
  const tree = Array.from({ length: 25 }, (_, i) => ({
    id: `el_${i}`,
    elType: 'section' as const,
  }));
  const byAbility = new Map<
    string,
    { kind: LargeDeployAbilityKind; params: Set<string>; expectsMode: boolean }
  >();

  const targets = ['v3', 'v4'] as const;
  const strategies: LargeDeployStrategy[] = ['upload-php', 'split'];
  for (const target of targets) {
    for (const strategy of strategies) {
      const plan = planLargeDeploy(tree, { target, postId: 1, strategy });
      assertPlanUsesKnownAbilities(plan);
      for (const call of plan.calls) {
        const ability = resolveAbilityName(call.ability);
        const entry = byAbility.get(ability) ?? {
          kind: call.kind,
          params: new Set<string>(),
          expectsMode: false,
        };
        for (const key of Object.keys(call.params)) entry.params.add(key);
        if (call.kind === 'deploy' && call.mode !== undefined) entry.expectsMode = true;
        byAbility.set(ability, entry);
      }
    }
  }
  {
    const plan = planTreeChunkDeploy(tree, { target: 'v3', postId: 1 });
    for (const call of plan.calls) {
      const ability = resolveAbilityName(call.ability);
      const kind: LargeDeployAbilityKind = call.kind === 'start' || call.kind === 'append' || call.kind === 'commit' ? 'deploy' : call.kind;
      const entry = byAbility.get(ability) ?? { kind, params: new Set<string>(), expectsMode: false };
      for (const key of Object.keys(call.params)) entry.params.add(key);
      byAbility.set(ability, entry);
    }
  }

  return [...byAbility.entries()]
    .map(([ability, entry]) => ({
      ability,
      kind: entry.kind,
      expectedParams: [...entry.params].sort(),
      expectsMode: entry.expectsMode,
    }))
    .sort((a, b) => a.ability.localeCompare(b.ability));
}

/**
 * Defensively read a parameter-schema shape out of a live
 * `mcp-adapter-get-ability-info` payload. Recognizes bare `{ properties }`
 * objects plus common wrapper keys (`input_schema`, `inputSchema`,
 * `parameters`, `schema`). When `mode` declares an enum, its values are
 * extracted so the replace/append contract can be checked. Anything else is
 * reported as unrecognized — never guessed.
 */
export function extractAbilitySchema(
  payload: unknown,
): { recognized: boolean; params: string[]; modeEnum?: string[] } {
  const candidates: unknown[] = [];
  const pushIfObject = (v: unknown): void => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) candidates.push(v);
  };
  pushIfObject(payload);
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    for (const key of ['input_schema', 'inputSchema', 'parameters', 'schema']) {
      pushIfObject(record[key]);
    }
  }

  for (const candidate of candidates) {
    const record = candidate as Record<string, unknown>;
    const properties = record.properties;
    if (properties !== null && typeof properties === 'object' && !Array.isArray(properties)) {
      const params = Object.keys(properties as Record<string, unknown>).sort();
      const mode = (properties as Record<string, unknown>).mode;
      const modeEnum = extractEnum(mode);
      return { recognized: true, params, ...(modeEnum ? { modeEnum } : {}) };
    }
  }
  return { recognized: false, params: [] };
}

function extractEnum(value: unknown): string[] | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.enum !== null && typeof record.enum === 'object' && Array.isArray(record.enum)) {
    const values = (record.enum as unknown[]).filter((v): v is string => typeof v === 'string');
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}

export interface LargeDeployAbilityCheck {
  ability: string;
  kind: LargeDeployAbilityKind;
  /** `unavailable` when the live fetch failed; `checked` once a payload arrived. */
  status: 'unavailable' | 'checked';
  error?: string;
  /** True when the live payload had a recognizable schema shape. */
  shapeRecognized: boolean;
  /** Parameter names the live schema declares (sorted). */
  liveParams: string[];
  /** Expected params the live schema does not declare. */
  missingParams: string[];
  mode?: { declared: boolean; values?: string[]; supported: boolean; issue?: string };
  /** True when checked + shape recognized + no missing params + mode contract ok. */
  matches: boolean;
}

export interface LargeDeployVerificationReport {
  /** All four abilities were fetched, recognized, and match the frozen contract. */
  ok: boolean;
  /**
   * Literal `true` — schema verification alone never opens the productive
   * gate. `deploy.ts` keeps refusing both strategies with
   * `capability-unavailable` and `requiresSchemaVerification` stays the
   * literal `true` in the plan until the controlled live roundtrip (O-03)
   * against the released test target confirms the server-side behavior.
   */
  requiresLiveRoundtrip: true;
  strategies: LargeDeployStrategy[];
  checks: LargeDeployAbilityCheck[];
  issues: string[];
  /** Doctor exit code: 0 all verified, 1 any unavailable/mismatch/unrecognized. */
  exitCode: number;
  authMode: 'target-name' | 'mcp-url-auth-env';
  targetName?: string;
  timestamp: string;
}

function checkAbility(
  expectation: LargeDeployAbilityExpectation,
  payload: unknown,
  error: string | undefined,
): LargeDeployAbilityCheck {
  if (error !== undefined) {
    return {
      ability: expectation.ability,
      kind: expectation.kind,
      status: 'unavailable',
      error,
      shapeRecognized: false,
      liveParams: [],
      // Empty on purpose: the fetch failed, so no live schema was compared —
      // missingParams must not suggest the schema lacked these parameters.
      missingParams: [],
      matches: false,
    };
  }

  const { recognized, params, modeEnum } = extractAbilitySchema(payload);
  const missingParams = expectation.expectedParams.filter((p) => !params.includes(p));

  let mode: LargeDeployAbilityCheck['mode'];
  let matches = recognized && missingParams.length === 0;
  if (expectation.expectsMode) {
    const declared = params.includes('mode');
    const hasBoth = modeEnum !== undefined && modeEnum.includes('replace') && modeEnum.includes('append');
    mode = {
      declared,
      ...(modeEnum ? { values: modeEnum } : {}),
      supported: declared && hasBoth,
      issue:
        !declared
          ? 'mode parameter is not declared by the live schema (append chunking not supported)'
          : modeEnum === undefined
            ? 'mode declares no enum — replace/append values are unconfirmed'
            : !hasBoth
              ? `mode enum ${JSON.stringify(modeEnum)} lacks 'replace' or 'append'`
              : undefined,
    };
    matches = matches && mode.supported;
  }

  return {
    ability: expectation.ability,
    kind: expectation.kind,
    status: 'checked',
    shapeRecognized: recognized,
    liveParams: params,
    missingParams,
    ...(mode ? { mode } : {}),
    matches,
  };
}

/**
 * Verify the frozen large-deploy contract against live ability schemas.
 *
 * Fetches the input schema of every expected ability via the injected
 * `getAbilityInfo` port (offline-injectable in tests), compares it against the
 * contract-derived expectations and aggregates one report. Never throws:
 * per-ability fetch failures become `unavailable` checks and the report
 * collects the full evidence. The productive gate stays closed regardless of
 * the outcome (`requiresLiveRoundtrip: true`).
 */
export async function verifyLargeDeployContract(
  getAbilityInfo: (adapter: McpAdapter, abilityName: string) => Promise<unknown>,
  adapter: McpAdapter,
  options: { authMode: 'target-name' | 'mcp-url-auth-env'; targetName?: string; timestamp?: string },
): Promise<LargeDeployVerificationReport> {
  const expectations = collectLargeDeployExpectations();
  const checks: LargeDeployAbilityCheck[] = [];
  const issues: string[] = [];

  for (const expectation of expectations) {
    let payload: unknown;
    let error: string | undefined;
    try {
      payload = await getAbilityInfo(adapter, expectation.ability);
    } catch (err) {
      error = `get-ability-info(${expectation.ability}) failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    const check = checkAbility(expectation, payload, error);
    checks.push(check);
    if (!check.matches) {
      if (check.status === 'unavailable') {
        issues.push(`${check.ability}: ${check.error}`);
      } else if (!check.shapeRecognized) {
        issues.push(`${check.ability}: live payload shape not recognized — schema cannot be verified`);
      } else if (check.missingParams.length > 0) {
        issues.push(
          `${check.ability}: live schema misses expected params ${JSON.stringify(check.missingParams)}`,
        );
      } else if (check.mode && !check.mode.supported) {
        issues.push(`${check.ability}: ${check.mode.issue}`);
      }
    }
  }

  const ok = checks.length > 0 && checks.every((c) => c.matches);
  return {
    ok,
    requiresLiveRoundtrip: true,
    strategies: ['upload-php', 'split'],
    checks,
    issues,
    exitCode: ok ? LARGE_DEPLOY_VERIFY_EXIT_CODES.VERIFIED : LARGE_DEPLOY_VERIFY_EXIT_CODES.FAILED,
    authMode: options.authMode,
    ...(options.targetName ? { targetName: options.targetName } : {}),
    timestamp: options.timestamp ?? new Date().toISOString(),
  };
}

