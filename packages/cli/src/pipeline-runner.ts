/**
 * Pipeline Runner (Phase 9 — Wizard-Integration)
 *
 * Wraps runPipeline() from analysis/pipeline.ts with:
 *   - CloneState integration (save state.json after each phase)
 *   - Resume support (skip phases marked 'completed' in state.json)
 *   - chalk-based progress reporting (color-coded per stage)
 *   - Error recovery (mark failed phases, allow resume from last good state)
 *
 * Step-by-step mode (BAUPLAN 9-step wizard):
 *   Phase 1: stages 1-2 (extract + classify) → design-token review → section review
 *   Phase 2: stages 3-7 (assets + tokens + build + animations + qa) with approved sections
 *
 * Used by the `clone` command in clone-v3.ts after the wizard gathers config.
 */
import { runPipeline, type PipelineResult, type StageName } from '../analysis/pipeline.js';
import type { ClassifyAllResult } from '../classifier/section-picker.js';
import type { WizardOptions, WizardResult } from './wizard.js';
import type { CloneState } from './state-manager.js';
import {
  saveState,
  stateFileFor,
  markCompleted,
  markFailed,
  markSkipped,
  isPhaseDone,
  reconcile,
  approveSection,
  type PhaseName,
} from './state-manager.js';
import {
  promptAutoPick,
  promptSections,
  type SectionChoice,
} from './prompts.js';
import chalk from 'chalk';

/** Maps pipeline StageName to state-manager PhaseName. */
const STAGE_TO_PHASE: Record<StageName, PhaseName> = {
  extract: 'extract',
  classify: 'classify',
  assets: 'assets',
  tokens: 'tokens',
  build: 'build',
  animations: 'animations',
  qa: 'qa',
};

const PHASE_LABELS: Record<PhaseName, string> = {
  extract: 'Extract (Playwright)',
  classify: 'Classify (Section Picker)',
  assets: 'Assets (Download)',
  tokens: 'Design Tokens (MCP Sync)',
  'design-system': 'Design System',
  build: 'Build (V3 + V4)',
  qa: 'QA (Visual Diff)',
  'animations': 'Animations (WPCode)',
};

export interface PipelineRunOptions extends WizardOptions {
  state: CloneState;
  stateFile: string;
  resumeMode: boolean;
}

export interface PipelineRunResult {
  pipelineResult?: PipelineResult;
  state: CloneState;
  stateFile: string;
  /** The approved section IDs from the interactive review. */
  approvedSectionIds?: string[];
}

/**
 * Runs the full pipeline with state tracking.
 *
 * Interactive mode (step-by-step, BAUPLAN 9-step wizard):
 *   1. Extract + Classify (stages 1-2)
 *   2. Design-token review + interactive section review
 *   3. Assets + Tokens + Build + Animations (stages 3-6)
 *      Build stage uses only approved sections.
 *
 * Non-interactive mode: runs all 6 stages in one shot.
 * Resume mode: skips already-completed phases in state.json.
 */
export async function runWizardPipeline(
  wizardResult: WizardResult,
): Promise<PipelineRunResult> {
  const { state, resumeMode, interactive, cloneUrl, postId, qaAutoFix, upgradeToV4, heal, visionEnhance, fullContextRepair, mcpUrl, mcpAuth, mcpMaxRetries, mcpBackoffMs, extractor } = wizardResult;
  const stateFile = stateFileFor(state.outputDir, state.hostname);
  const outputDir = `${state.outputDir}/${state.hostname}`;

  console.log(chalk.bold.cyan(`\n╭${'─'.repeat(56)}╮`));
  console.log(chalk.bold.cyan(`│  site-clone-to-v3 — Pipeline Execution${' '.repeat(22)}│`));
  console.log(chalk.bold.cyan(`╰${'─'.repeat(56)}╯`));
  console.log(chalk.gray(`  URL:      ${state.sourceUrl}`));
  console.log(chalk.gray(`  Output:   ${outputDir}`));
  if (resumeMode) {
    const nextPhase = reconcile(state);
    console.log(chalk.yellow(`  Resume:   from phase "${nextPhase}"`));
  }
  if (interactive) {
    console.log(chalk.cyan(`  Mode:     step-by-step (BAUPLAN 9-step wizard)`));
  }
  console.log('');

  // Compute resume skips
  const skipStages = computeResumeSkips(state, resumeMode);

  if (resumeMode || !interactive) {
    // Resume or non-interactive: run all remaining stages in one shot
    return runPhase(state, stateFile, outputDir, skipStages, cloneUrl, postId, qaAutoFix, heal, mcpUrl, mcpAuth, extractor, upgradeToV4, visionEnhance, fullContextRepair, mcpMaxRetries, mcpBackoffMs);
  }

  // ─────────────── Interactive: two-phase step-by-step ───────────────

  // Phase 1: Extract + Classify (stages 1-2)
  console.log(chalk.bold.magenta('╭── Phase 1 of 2: Extract + Classify ──╮\n'));
  const phase1Skip = new Set([...skipStages, 3, 4, 5, 6, 7]);
  const phase1 = await runPhase(state, stateFile, outputDir, phase1Skip, cloneUrl, postId, qaAutoFix, heal, mcpUrl, mcpAuth, extractor, undefined, visionEnhance, undefined, mcpMaxRetries, mcpBackoffMs);
  const phase1Result = phase1.pipelineResult;

  if (!phase1Result?.extraction) {
    console.log(chalk.red('  ✗ Phase 1 failed — no extraction result. Aborting.'));
    return phase1;
  }

  // ── Design Token Review (BAUPLAN Step 7) ──
  await reviewDesignTokensFromResult(phase1Result);

  // ── Section Review (BAUPLAN Steps 8-9) ──
  const approvedIds = await reviewSectionsFromResult(state, phase1Result);

  // ─────────────── Phase 2: Remaining stages (3-7) ───────────────
  console.log(chalk.bold.magenta('\n╭── Phase 2 of 2: Assets + Tokens + Build + Animations + QA ──╮\n'));

  // Filter classification specs to only approved sections
  const phase1Classification = phase1Result.classification as ClassifyAllResult | undefined;
  const filteredClassification: ClassifyAllResult | undefined = phase1Classification
    ? {
        ...phase1Classification,
        specs: phase1Classification.specs.filter((s) =>
          approvedIds.includes(s.section_id),
        ),
      }
    : undefined;

  const phase2Skip = new Set([...skipStages, 1, 2]);
  const phase2 = await runPipeline(state.sourceUrl, {
    url: state.sourceUrl,
    outputDir,
    dryRun: false,
    syncToMcp: !!state.options.target && approvedIds.length > 0,
    skipStages: [...phase2Skip],
    preloadedExtraction: phase1Result.extraction,
    preloadedClassification: filteredClassification,
    cloneUrl: cloneUrl ?? state.options.cloneUrl,
    postId: postId ?? state.options.postId,
    qaAutoFix: qaAutoFix ?? state.options.qaAutoFix,
    upgradeToV4: upgradeToV4 ?? state.options.upgradeToV4,
    heal: heal ?? state.options.heal,
    visionEnhance: visionEnhance ?? state.options.visionEnhance,
    fullContextRepair: fullContextRepair ?? state.options.fullContextRepair,
    mcpUrl,
    mcpAuth,
    mcpMaxRetries,
    mcpBackoffMs,
  });

  // Update state from phase 2 stages
  await syncStateFromPipeline(state, stateFile, phase2);

  // Merge phase 1 + phase 2 stage results
  const mergedStages = [...(phase1.pipelineResult?.stages ?? []), ...phase2.stages];

  // Print combined summary
  printPipelineSummary({ ...phase2, stages: mergedStages });

  return {
    pipelineResult: {
      ...phase2,
      stages: mergedStages,
      extraction: phase1Result.extraction,
      classification: phase1Result.classification,
    },
    state,
    stateFile,
    approvedSectionIds: approvedIds,
  };
}

/** Compute which stages to skip based on resume state. */
function computeResumeSkips(state: CloneState, resumeMode: boolean): Set<number> {
  const stageNumbers: Record<StageName, number> = {
    extract: 1,
    classify: 2,
    assets: 3,
    tokens: 4,
    build: 5,
    animations: 6,
    qa: 7,
  };

  const skipStages = new Set<number>();
  if (!resumeMode) return skipStages;

  for (const [stage, num] of Object.entries(stageNumbers)) {
    const phase = STAGE_TO_PHASE[stage as StageName];
    if (isPhaseDone(state, phase)) {
      skipStages.add(num);
      console.log(chalk.gray(`  ⏭ Skip stage ${num} (${stage}) — already completed`));
    }
  }
  if (skipStages.size > 0) console.log('');
  return skipStages;
}

/** Run a single pipeline call with error handling and state sync. */
async function runPhase(
  state: CloneState,
  stateFile: string,
  outputDir: string,
  skipStages: Set<number>,
  cloneUrl?: string,
  postId?: number,
  qaAutoFix?: boolean,
  heal?: boolean,
  mcpUrl?: string,
  mcpAuth?: string,
  extractor?: 'local' | 'browserbase',
  upgradeToV4?: boolean,
  visionEnhance?: boolean,
  fullContextRepair?: boolean,
  mcpMaxRetries?: number,
  mcpBackoffMs?: number,
): Promise<PipelineRunResult> {
  let pipelineResult: PipelineResult;
  try {
    pipelineResult = await runPipeline(state.sourceUrl, {
      url: state.sourceUrl,
      outputDir,
      dryRun: false,
      syncToMcp: !!state.options.target,
      skipStages: skipStages.size > 0 ? [...skipStages] : undefined,
      cloneUrl: cloneUrl ?? state.options.cloneUrl,
      postId: postId ?? state.options.postId,
      qaAutoFix: qaAutoFix ?? state.options.qaAutoFix,
      upgradeToV4: upgradeToV4 ?? state.options.upgradeToV4,
      heal: heal ?? state.options.heal,
      visionEnhance: visionEnhance ?? state.options.visionEnhance,
      fullContextRepair: fullContextRepair ?? state.options.fullContextRepair,
      mcpUrl,
      mcpAuth,
      mcpMaxRetries,
      mcpBackoffMs,
      extractor,
    });
  } catch (err) {
    console.error(chalk.red(`\n✗ Pipeline failed: ${err instanceof Error ? err.message : err}`));
    const nextPhase = reconcile(state);
    if (nextPhase) {
      markFailed(state, nextPhase, err instanceof Error ? err.message : String(err));
      await saveState(stateFile, state);
      console.log(chalk.gray(`  State saved → ${stateFile} (resume from "${nextPhase}")`));
    }
    throw err;
  }

  await syncStateFromPipeline(state, stateFile, pipelineResult);
  return { pipelineResult, state, stateFile };
}

/** Syncs CloneState phases with pipeline stage results. */
async function syncStateFromPipeline(
  state: CloneState,
  stateFile: string,
  pipelineResult: PipelineResult,
): Promise<void> {
  for (const stage of pipelineResult.stages) {
    const phase = STAGE_TO_PHASE[stage.name];
    switch (stage.status) {
      case 'ok':
        markCompleted(state, phase, { ...pipelineResult.artifacts });
        break;
      case 'skipped':
        markSkipped(state, phase);
        break;
      case 'failed':
        markFailed(state, phase, stage.error ?? 'unknown error');
        break;
    }
  }
  await saveState(stateFile, state);
}

function printPipelineSummary(result: PipelineResult): void {
  const totalMs = result.stages.reduce((sum, s) => sum + s.durationMs, 0);
  const okCount = result.stages.filter((s) => s.status === 'ok').length;
  const skippedCount = result.stages.filter((s) => s.status === 'skipped').length;
  const failedCount = result.stages.filter((s) => s.status === 'failed').length;

  console.log(chalk.bold.cyan(`\n╭${'─'.repeat(56)}╮`));
  console.log(chalk.bold.cyan(`│  Pipeline Complete${' '.repeat(39)}│`));
  console.log(chalk.bold.cyan(`╰${'─'.repeat(56)}╯`));
  console.log(
    chalk.gray(`  ${okCount} ok · ${skippedCount} skipped · ${failedCount} failed · ${totalMs}ms total`),
  );
  console.log('');

  for (const stage of result.stages) {
    const label = PHASE_LABELS[STAGE_TO_PHASE[stage.name]] ?? stage.name;
    const icon =
      stage.status === 'ok' ? chalk.green('✓')
      : stage.status === 'skipped' ? chalk.gray('⏭')
      : chalk.red('✗');
    const timing = chalk.gray(`(${stage.durationMs}ms)`);
    console.log(`  ${icon} ${chalk.white(label)} ${timing}`);
    if (stage.status === 'failed' && stage.error) {
      console.log(chalk.red(`    Error: ${stage.error}`));
    }
  }

  console.log('');
  console.log(chalk.bold('Artifacts:'));
  for (const [key, filepath] of Object.entries(result.artifacts)) {
    console.log(chalk.gray(`  ${key}: ${filepath}`));
  }
  console.log('');
}

/** Display design tokens from extraction result (read-only). */
async function reviewDesignTokensFromResult(
  pipelineResult: PipelineResult,
): Promise<void> {
  const extraction = pipelineResult.extraction;
  if (!extraction?.designTokens) {
    console.log(chalk.gray('  No design tokens detected — skipping review.'));
    return;
  }

  const tokens = extraction.designTokens;
  const colors = tokens.colors.filter((t) => t.hex);
  const fonts = tokens.fonts.filter((t) => t.family);

  console.log(chalk.bold.cyan('\n╭── Design Token Review ──╮'));
  console.log(chalk.gray(`  ${colors.length} colors · ${fonts.length} fonts · spacing detected`));

  if (colors.length > 0) {
    console.log(chalk.white('\n  Colors:'));
    for (const token of colors.slice(0, 12)) {
      const hex = token.hex ?? '';
      console.log(`    ${chalk.hex(hex || '#888')('■')} ${token.role ?? token.id}  ${chalk.gray(hex)}`);
    }
    if (colors.length > 12) {
      console.log(chalk.gray(`    ... and ${colors.length - 12} more`));
    }
  }

  if (fonts.length > 0) {
    console.log(chalk.white('\n  Fonts:'));
    for (const token of fonts) {
      console.log(chalk.gray(`    ${token.role ?? token.id}: ${token.family ?? 'system'}`));
    }
  }

  console.log('');
}

/** Interactive section review — prompts user to approve/reject detected sections. */
async function reviewSectionsFromResult(
  state: CloneState,
  pipelineResult: PipelineResult,
): Promise<string[]> {
  const classification = pipelineResult.classification;
  if (!classification?.specs || classification.specs.length === 0) {
    console.log(chalk.gray('  No sections detected — skipping review.'));
    return [];
  }

  const specs = classification.specs;
  const sectionChoices: SectionChoice[] = specs.map((s) => ({
    id: s.section_id,
    label: `${s.section_id} [${s.source.selector}]`,
    preview: `y:${s.source.y_range[0]}-${s.source.y_range[1]}`,
  }));

  console.log(chalk.bold.cyan('\n╭── Section Review ──╮'));
  console.log(chalk.gray(`  ${sectionChoices.length} sections detected`));

  let approved: string[];

  console.log('');
  const autoPick = await promptAutoPick();
  if (autoPick) {
    approved = sectionChoices.map((s) => s.id);
    console.log(chalk.green(`  ✓ Auto-approved all ${approved.length} sections`));
  } else {
    approved = await promptSections(sectionChoices);
    if (approved.length === 0) {
      console.log(chalk.yellow('  ⚠ No sections selected — build will produce an empty page'));
    } else {
      console.log(chalk.green(`  ✓ ${approved.length}/${sectionChoices.length} sections approved`));
    }
  }

  // Save approved sections to state
  const approvedSet = new Set(approved);
  for (const section of sectionChoices) {
    approveSection(state, section.id, approvedSet.has(section.id));
  }
  const stateFile = stateFileFor(state.outputDir, state.hostname);
  await saveState(stateFile, state);

  const rejected = sectionChoices.filter((s) => !approvedSet.has(s.id));
  if (rejected.length > 0) {
    console.log(chalk.gray(`  Skipped: ${rejected.map((s) => s.id).join(', ')}`));
  }
  console.log('');

  return approved;
}

// ── Public exports (for external callers) ──

export async function reviewDesignTokens(
  pipelineResult: PipelineResult,
): Promise<void> {
  await reviewDesignTokensFromResult(pipelineResult);
}

export async function reviewSections(
  state: CloneState,
  pipelineResult: PipelineResult,
): Promise<string[]> {
  return reviewSectionsFromResult(state, pipelineResult);
}
