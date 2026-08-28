/**
 * `VisualPageIR` → deployable V3 artefacts, in one call.
 *
 * ## Why this module exists
 *
 * Every piece of the v7.0 animation path was built and unit-tested, and none of
 * it was reachable: `emitVisualIrToV3`, `buildResidualSnippets` and
 * `createAnimationParityGuard` had zero production callers. A module with no
 * caller is indistinguishable from a module that does not work — the charter's
 * point about a saved tree not being proof applies to code as much as to output.
 *
 * This is the seam that joins them, and it is deliberately placed in
 * `target-v3` rather than in the CLI:
 *
 *   - `target-v3` depends only on `core` and `qa`, so this whole chain stays
 *     testable without a Playwright browser, an MCP transport, or credentials.
 *   - The ORDER matters and is easy to get wrong. Residual snippets must be
 *     generated BEFORE parity is scored, or every fallback reads as a gap. Fixing
 *     that ordering once here is better than fixing it in each caller.
 *
 * Producing the IR (Unframer adapter, hybrid DOM merge, motion probe) stays in
 * `extractors`, where the transports live. This function starts at the IR
 * boundary the charter defines.
 *
 * ## What it guarantees, and what it does not
 *
 * It guarantees the parity guard is scored against the snippets that were
 * actually built, not against an assumption that snippets exist. It does NOT
 * guarantee the page renders: that needs a deploy, a cache clear, and a real
 * multi-viewport QA pass with a reference URL. `renderable` here means "nothing
 * we can check offline says this will fail".
 *
 * @module target-v3/visual-ir-pipeline
 */

import type {
  FidelityDecisionRecord,
  GuardReport,
  ResolvedWidgetSchema,
  VisualPageIR,
  WpcodeSnippetSpec,
} from '@elconv/core';
import { runGuards } from '@elconv/core';
import { emitVisualIrToV3, type VisualIrToV3Options } from './visual-ir-to-v3.js';
import { V3_GUARDS } from './guards.js';
import type { V3Element } from './types.js';
import type { V3Tree } from './v3-tree-types.js';
import {
  buildResidualSnippets,
  checkAnimationParity,
  createAnimationParityGuard,
  formatAnimationMappingReport,
  nativeShare,
  type AnimationParityReport,
  type AnimationResolution,
  type ResidualSkip,
} from './animation/index.js';

/**
 * The native-reproduction target from the v7.0 Definition of Done.
 *
 * "≥ 80 % of detected effects native". Reported, never enforced here: falling
 * short is a fidelity finding for the report, not a reason to refuse a build
 * that is otherwise correct.
 */
export const NATIVE_SHARE_TARGET = 0.8;

/**
 * Snippet budget from the v7.0 acceptance criteria (§4.4, "Akzeptanz B").
 *
 * One CSS plus one JS was the plan. The residual generator emits up to three
 * because an entrance needs BOTH a CSS block and its observer — a fact the plan
 * did not anticipate. Exceeding this is reported, not blocked.
 */
export const RESIDUAL_SNIPPET_BUDGET = 2;

export interface BuildV3FromVisualIrOptions extends VisualIrToV3Options {
  /**
   * Post id for the `body.page-id-N` guard on residual snippets.
   *
   * Omitting it makes the snippets site-wide. That is a real consequence, not a
   * default worth hiding, so it produces a warning.
   */
  pageId?: number;
  /** Guard score threshold. Default matches `runV3Guards`. */
  guardThreshold?: number;
  /** Title prefix for generated snippets, to keep two runs distinguishable. */
  snippetTitlePrefix?: string;
}

export interface BuildV3FromVisualIrResult {
  tree: V3Element[];
  /** Guard report INCLUDING the per-run parity guard. */
  guards: GuardReport;
  /** Residual WPCode snippets, in write order. Empty when all effects were native. */
  snippets: WpcodeSnippetSpec[];
  decisions: FidelityDecisionRecord[];
  warnings: string[];
  animation: AnimationSummary;
  /**
   * False when something checkable offline says this build must not be deployed.
   *
   * Distinct from `guards.passed`: a guard score below threshold is a quality
   * signal, whereas a blocking fidelity decision is a refusal.
   */
  canContinue: boolean;
}

export interface AnimationSummary {
  /** Per-effect verdicts from the mapper. */
  resolutions: AnimationResolution[];
  parity: AnimationParityReport;
  /** Share reproduced natively, or `null` when the page had no animations. */
  nativeShare: number | null;
  /** True when `nativeShare` reached `NATIVE_SHARE_TARGET`. Null-safe. */
  meetsNativeTarget: boolean;
  /** Effects the residual generator declined to carry, each with a reason. */
  residualSkips: ResidualSkip[];
  /** Fidelity notes about what a snippet does and does not reproduce. */
  residualNotes: string[];
  /** Human-readable mapping + parity summary for a run report. */
  report: string;
}

/**
 * Build a V3 tree, its residual snippets and its guard report from one IR.
 *
 * The sequence is the point:
 *
 *   1. emit  — writes native animation settings onto the elements
 *   2. residual — carries the effects step 1 deliberately left alone
 *   3. parity — scored against the real tree AND the real snippets
 *   4. guards — the standard set plus the per-run parity guard
 *
 * Swapping 2 and 3 is the mistake this ordering exists to prevent: parity
 * scored before the snippets exist reports every fallback as an unhandled gap,
 * which reads as a failing build when in fact nothing is wrong.
 */
export function buildV3FromVisualIr(
  ir: VisualPageIR,
  options: BuildV3FromVisualIrOptions = {},
): BuildV3FromVisualIrResult {
  const emitted = emitVisualIrToV3(ir, options);
  const warnings = [...emitted.warnings];

  const residual = buildResidualSnippets({
    resolutions: emitted.animationResolutions,
    animations: ir.animations,
    elementIdBySourceId: emitted.elementIdBySourceId,
    ...(options.pageId !== undefined ? { pageId: options.pageId } : {}),
    ...(options.snippetTitlePrefix !== undefined ? { titlePrefix: options.snippetTitlePrefix } : {}),
  });

  if (residual.snippets.length > 0 && options.pageId === undefined) {
    warnings.push(
      `${residual.snippets.length} residual snippet(s) were generated without a pageId, so they ` +
        'will apply site-wide. Pass options.pageId to scope them to one page.',
    );
  }
  if (residual.snippets.length > RESIDUAL_SNIPPET_BUDGET) {
    warnings.push(
      `${residual.snippets.length} residual snippets exceed the budget of ${RESIDUAL_SNIPPET_BUDGET} ` +
        '(an entrance needs both a CSS block and its observer, so 3 is expected when both an ' +
        'entrance and a scroll effect fall back)',
    );
  }
  for (const skip of residual.skipped) {
    warnings.push(`animation ${skip.animationId} on ${skip.targetSourceId} was not carried: ${skip.reason}`);
  }

  const parityInput = {
    resolutions: emitted.animationResolutions,
    snippetCoveredSourceIds: residual.coveredSourceIds,
  };
  const parity = checkAnimationParity(parityInput, emitted.tree);
  const share = nativeShare(parity);

  if (share !== null && share < NATIVE_SHARE_TARGET) {
    warnings.push(
      `only ${(share * 100).toFixed(0)}% of ${parity.total} detected effect(s) were reproduced ` +
        `natively, below the ${NATIVE_SHARE_TARGET * 100}% target`,
    );
  }

  const guards = runGuards(
    emitted.tree as V3Tree,
    [...V3_GUARDS, createAnimationParityGuard(parityInput)],
    options.guardThreshold,
  );

  return {
    tree: emitted.tree,
    guards,
    snippets: residual.snippets,
    decisions: emitted.decisions,
    warnings,
    animation: {
      resolutions: emitted.animationResolutions,
      parity,
      nativeShare: share,
      // `null` share means the page had no animations. It has not met the target;
      // it had no target to meet, so `false` is the honest value.
      meetsNativeTarget: share !== null && share >= NATIVE_SHARE_TARGET,
      residualSkips: residual.skipped,
      residualNotes: residual.notes,
      report: formatAnimationSummary(emitted.animationResolutions, parity, share, residual.notes),
    },
    canContinue: emitted.canContinue,
  };
}

/** Mapping verdicts, parity and residual notes as one report section. */
export function formatAnimationSummary(
  resolutions: readonly AnimationResolution[],
  parity: AnimationParityReport,
  share: number | null,
  residualNotes: readonly string[],
): string {
  if (resolutions.length === 0) {
    return 'Animations: none detected in the source.';
  }

  const nativeCount = resolutions.filter((r) => r.decision === 'native').length;
  const lines = [
    formatAnimationMappingReport({
      resolutions: [...resolutions],
      nativeCount,
      fallbackCount: resolutions.length - nativeCount,
      settingsByTarget: {},
      warnings: [],
    }),
    '',
    'Parity:',
    `  ${parity.nativeCovered} carried by native settings present in the tree`,
    `  ${parity.snippetCovered} carried by a residual snippet`,
    `  ${parity.gaps.length} unhandled`,
    share === null
      ? '  native share: n/a (no animations)'
      : `  native share: ${(share * 100).toFixed(0)}% (target ${NATIVE_SHARE_TARGET * 100}%)`,
  ];

  if (parity.gaps.length > 0) {
    lines.push('', `Unhandled effects (${parity.gaps.length}):`);
    for (const gap of parity.gaps) {
      lines.push(`  ! ${gap.targetSourceId} [${gap.decision}]: ${gap.reason}`);
    }
  }
  if (parity.orphanAnimatedElementIds.length > 0) {
    lines.push(
      '',
      `Animated elements no resolution explains (${parity.orphanAnimatedElementIds.length}): ` +
        parity.orphanAnimatedElementIds.slice(0, 10).join(', '),
    );
  }
  if (residualNotes.length > 0) {
    lines.push('', 'Residual snippet fidelity:');
    for (const note of residualNotes) lines.push(`  ~ ${note}`);
  }

  return lines.join('\n');
}

/**
 * Convenience for callers that only want to know whether a schema was usable.
 *
 * Without a schema `emitVisualIrToV3` writes NO animation setting — the
 * container/widget control-name split cannot be guessed and a wrong id makes the
 * server reject the entire write. A caller that silently accepts that would
 * deploy a page with every animation missing, which is exactly the failure v7.0
 * was written to end.
 */
export function schemaIsUsableForAnimations(
  schema: ResolvedWidgetSchema | undefined,
): { usable: boolean; reason: string } {
  if (schema === undefined) {
    return {
      usable: false,
      reason:
        'no control schema was passed, so no animation setting can be written ' +
        "(use loadWidgetSchemaFromSnapshot() from @elconv/mcp for an offline schema)",
    };
  }
  if (schema.degraded) {
    return {
      usable: true,
      reason: `schema is flagged degraded: ${schema.degradedReasons.join('; ')} — a control reported as absent here may exist live`,
    };
  }
  return { usable: true, reason: `${schema.source} schema` };
}
