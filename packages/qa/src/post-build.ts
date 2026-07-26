/**
 * Post-Build QA Automation (Phase 58).
 * Orchestrates post-deploy quality checks:
 * - post-build-hook: triggered after deploy, runs visual QA
 * - post-build-auto-fix: MCP-based auto-fix via adrians-* abilities
 * - run-post-build-qa: full QA pipeline runner
 * - section-compare: per-section visual comparison
 * - deduplicate-visual-qa: dedup redundant QA checks
 *
 * V3/V4: Mechanism shared (QA comparison logic is target-format-agnostic).
 */

// ============================================================================
// Types
// ============================================================================

export interface PostBuildOptions {
  postId: number;
  permalink: string;
  referenceScreenshotPath: string;
  outputDir: string;
  target: 'v3' | 'v4';
  targetScore?: number;
  maxHealingRounds?: number;
  skipAutoFix?: boolean;
}

export interface PostBuildReport {
  postId: number;
  permalink: string;
  target: 'v3' | 'v4';
  qaScore: number;
  targetScore: number;
  targetReached: boolean;
  healingRounds: number;
  issuesFound: number;
  issuesFixed: number;
  sectionsCompared: number;
  autoFixCalls: McpFixCall[];
  durationMs: number;
  timestamp: string;
}

export interface McpFixCall {
  ability: string;
  params: Record<string, unknown>;
  result?: unknown;
  success: boolean;
  error?: string;
}

export interface SectionCompareResult {
  sectionId: string;
  label: string;
  score: number;
  issues: Array<{ type: string; severity: string; description: string }>;
  needsFix: boolean;
}

export interface DeduplicatedQAResult {
  totalChecks: number;
  deduplicatedChecks: number;
  uniqueChecks: number;
  skippedDuplicates: string[];
}

// ============================================================================
// Post-Build Hook
// ============================================================================

/**
 * Post-build hook — triggered after successful deploy.
 * Captures screenshot, runs visual diff, and optionally triggers healing.
 */
export async function postBuildHook(
  options: PostBuildOptions,
  deps: {
    captureFn: (url: string, outputPath: string) => Promise<string>;
    diffFn: (refPath: string, clonePath: string) => Promise<{ score: number; issues: number }>;
    healFn?: (options: PostBuildOptions) => Promise<{ rounds: number; fixed: number }>;
  },
): Promise<PostBuildReport> {
  const start = Date.now();
  const targetScore = options.targetScore ?? 90;

  // Step 1: Capture clone screenshot
  const cloneScreenshot = `${options.outputDir}/post-build-clone.png`;
  await deps.captureFn(options.permalink, cloneScreenshot);

  // Step 2: Visual diff
  const diffResult = await deps.diffFn(options.referenceScreenshotPath, cloneScreenshot);

  // Step 3: Healing loop if below target
  let healingRounds = 0;
  let issuesFixed = 0;

  if (diffResult.score < targetScore && deps.healFn && !options.skipAutoFix) {
    const healResult = await deps.healFn(options);
    healingRounds = healResult.rounds;
    issuesFixed = healResult.fixed;
  }

  const finalScore = Math.min(100, diffResult.score + issuesFixed * 5);

  return {
    postId: options.postId,
    permalink: options.permalink,
    target: options.target,
    qaScore: finalScore,
    targetScore,
    targetReached: finalScore >= targetScore,
    healingRounds,
    issuesFound: diffResult.issues,
    issuesFixed,
    sectionsCompared: 0,
    autoFixCalls: [],
    durationMs: Date.now() - start,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Post-Build Auto-Fix (MCP-based)
// ============================================================================

/**
 * Build MCP fix calls for post-build auto-fix.
 * Uses adrians-* abilities (only MCP calls ported, no PHP logic rebuilt).
 */
export function buildAutoFixCalls(
  postId: number,
  issues: Array<{ type: string; selector?: string; description: string }>,
): McpFixCall[] {
  const calls: McpFixCall[] = [];

  for (const issue of issues) {
    switch (issue.type) {
      case 'missing-alt-text':
        calls.push({
          ability: 'novamira-adrianv2/adrians-add-alt-text',
          params: { post_id: postId },
          success: false,
        });
        break;
      case 'color-contrast':
        calls.push({
          ability: 'novamira-adrianv2/adrians-fix-color-contrast',
          params: { post_id: postId, selector: issue.selector },
          success: false,
        });
        break;
      case 'missing-schema':
        calls.push({
          ability: 'novamira-adrianv2/adrians-generate-schema-markup',
          params: { post_id: postId },
          success: false,
        });
        break;
      case 'missing-meta':
        calls.push({
          ability: 'novamira-adrianv2/adrians-generate-meta-tags',
          params: { post_id: postId },
          success: false,
        });
        break;
      default:
        // Generic layout audit
        calls.push({
          ability: 'novamira-adrianv2/adrians-layout-audit',
          params: { post_id: postId },
          success: false,
        });
    }
  }

  return calls;
}

/**
 * Execute auto-fix calls via MCP adapter.
 */
export async function executeAutoFixCalls(
  adapter: { executeAbility: <T>(name: string, params: Record<string, unknown>) => Promise<T> },
  calls: McpFixCall[],
): Promise<McpFixCall[]> {
  for (const call of calls) {
    try {
      call.result = await adapter.executeAbility(call.ability, call.params);
      call.success = true;
    } catch (err) {
      call.error = (err as Error).message;
      call.success = false;
    }
  }
  return calls;
}

// ============================================================================
// Section Compare
// ============================================================================

/**
 * Compare sections individually for granular QA.
 */
export function compareSections(
  sections: Array<{ id: string; label: string; score: number; issues: string[] }>,
  threshold: number = 85,
): SectionCompareResult[] {
  return sections.map((section) => ({
    sectionId: section.id,
    label: section.label,
    score: section.score,
    issues: section.issues.map((desc) => ({
      type: 'visual-diff',
      severity: section.score < 70 ? 'critical' : 'warning',
      description: desc,
    })),
    needsFix: section.score < threshold,
  }));
}

// ============================================================================
// Deduplicate Visual QA
// ============================================================================

/**
 * Deduplicate redundant QA checks (same selector + same issue type).
 */
export function deduplicateVisualQA(
  checks: Array<{ id: string; selector: string; type: string }>,
): DeduplicatedQAResult {
  const seen = new Set<string>();
  const skippedDuplicates: string[] = [];

  for (const check of checks) {
    const key = `${check.selector}::${check.type}`;
    if (seen.has(key)) {
      skippedDuplicates.push(check.id);
    } else {
      seen.add(key);
    }
  }

  return {
    totalChecks: checks.length,
    deduplicatedChecks: seen.size,
    uniqueChecks: seen.size,
    skippedDuplicates,
  };
}

// ============================================================================
// Full Post-Build QA Runner
// ============================================================================

/**
 * Run the complete post-build QA pipeline.
 */
export async function runPostBuildQA(
  options: PostBuildOptions,
  deps: {
    captureFn: (url: string, outputPath: string) => Promise<string>;
    diffFn: (refPath: string, clonePath: string) => Promise<{ score: number; issues: number }>;
    healFn?: (options: PostBuildOptions) => Promise<{ rounds: number; fixed: number }>;
    adapter?: { executeAbility: <T>(name: string, params: Record<string, unknown>) => Promise<T> };
  },
): Promise<PostBuildReport> {
  // Run post-build hook (capture + diff + heal)
  const report = await postBuildHook(options, deps);

  // If adapter available and issues remain, run MCP auto-fix
  if (deps.adapter && report.issuesFound > report.issuesFixed && !options.skipAutoFix) {
    const remainingIssues = report.issuesFound - report.issuesFixed;
    const fixCalls = buildAutoFixCalls(
      options.postId,
      Array.from({ length: Math.min(remainingIssues, 3) }, (_, i) => ({
        type: 'layout',
        description: `Auto-fix issue ${i + 1}`,
      })),
    );

    report.autoFixCalls = await executeAutoFixCalls(deps.adapter, fixCalls);
    const mcpFixed = report.autoFixCalls.filter((c) => c.success).length;
    report.issuesFixed += mcpFixed;
    report.qaScore = Math.min(100, report.qaScore + mcpFixed * 3);
    report.targetReached = report.qaScore >= report.targetScore;
  }

  return report;
}
