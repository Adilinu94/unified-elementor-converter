#!/usr/bin/env node
/**
 * build-quality-gate.ts — Phase 5: Complete QA Pipeline Orchestrator
 *
 * Führt die gesamte QA-Kette aus:
 *   1. framer-pre-build-validate  (12 Guards, Score ≥85%)
 *   2. measure-quality-metrics    (DOM depth, GC coverage, GV substitution)
 *   3. validate-v4-tree           (Structural validation)
 *   4. verify-build-binding       (Invariant I check)
 *   5. section-compare            (Framer ↔ Elementor pixel diff)
 *   6. post-build-auto-fix        (Auto-fix plan generation)
 *   7. Quality report             (Consolidated summary)
 *
 * Usage:
 *   node --import tsx scripts/build-quality-gate.ts \
 *     --tree v4-tree.json \
 *     --tokens token-mapping.json \
 *     --post-id 1950 \
 *     --framer-url https://example.framer.app/ \
 *     --elementor-url https://test.example.com/?p=1950 \
 *     --output-dir reports/qa/
 */

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync, spawn, SpawnSyncReturns } from 'node:child_process';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface RunResult {
  ok: boolean;
  code: number | null;
  stdout?: string;
  stderr?: string;
  parsed?: Record<string, unknown> | null;
  reason?: string;
}

interface StepEntry {
  step: string;
  passed: boolean | null;
  skipped?: boolean;
  score?: number;
  report?: Record<string, unknown> | null;
  dryRun?: boolean;
  reason?: string;
}

interface StepReport {
  step: string;
  passed: boolean | null;
  skipped?: boolean;
  score?: number;
  report: string | null;
}

interface GateReport {
  meta: {
    generated_at: string;
    tree: string | undefined;
    post_id: string | undefined;
    min_score: number;
  };
  pipeline: {
    total_steps: number;
    passed: number;
    failed: number;
    skipped: number;
    blocked: boolean;
  };
  steps: StepReport[];
  summary: {
    status: string;
    message: string;
  };
}

interface BatchTaskDef {
  name: string;
  script: string;
  args: string[];
  optional: boolean;
}

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    tree:            { type: 'string' },
    tokens:          { type: 'string' },
    fonts:           { type: 'string' },
    'post-id':       { type: 'string' },
    'framer-url':    { type: 'string' },
    'elementor-url': { type: 'string' },
    'output-dir':    { type: 'string' },
    'dry-run':       { type: 'boolean', default: false },
    'skip-screenshots': { type: 'boolean', default: false },
    'min-score':     { type: 'string', default: '85' },
    verbose:         { type: 'boolean', default: false },
  },
  strict: false,
});

const treePath: string | undefined = args.tree as string | undefined;
const tokensPath: string | undefined = args.tokens as string | undefined;
const fontsPath: string | undefined = args.fonts as string | undefined;
const postId: string | undefined = args['post-id'] as string | undefined;
const framerUrl: string | undefined = args['framer-url'] as string | undefined;
const elementorUrl: string | undefined = args['elementor-url'] as string | undefined;
const outputDir: string | undefined = args['output-dir'] as string | undefined;

const log  = (...m: string[]) => { if (args.verbose) process.stderr.write('[gate] ' + m.join(' ') + '\n'); };
const warn = (m: string)   => process.stderr.write(`⚠ ${m}\n`);
const okFn   = (m: string)   => process.stderr.write(`✅ ${m}\n`);
const failFn = (m: string)   => process.stderr.write(`❌ ${m}\n`);

const outDir = outputDir || '.';
fs.mkdirSync(outDir, { recursive: true });

const results: StepEntry[] = [];
let blocked = false;

// ─────────────────────────────────────────────
// SYNC SCRIPT RUNNER
// ─────────────────────────────────────────────

function runScript(
  scriptName: string,
  scriptArgs: string[],
  { optional = false }: { optional?: boolean } = {},
): RunResult {
  const scriptPath = path.join(__dirname, scriptName);
  if (!fs.existsSync(scriptPath)) {
    if (optional) return { ok: false, reason: 'Script not found', code: -1 };
    throw new Error(`Script not found: ${scriptPath}`);
  }

  const result: SpawnSyncReturns<string> = spawnSync('node', [scriptPath, ...scriptArgs], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60000,
  });

  let parsed: Record<string, unknown> | null = null;
  try {
    if (result.stdout) parsed = JSON.parse(result.stdout);
  } catch { /* ignore parse errors */ }

  return {
    ok: result.status === 0,
    code: result.status,
    stdout: result.stdout?.slice(0, 2000) || '',
    stderr: result.stderr?.slice(0, 2000) || '',
    parsed,
  };
}

/** Run a single script asynchronously (real parallelism via spawn). */
function runScriptAsync(
  scriptName: string,
  scriptArgs: string[],
  { optional = false }: { optional?: boolean } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, scriptName);
    if (!fs.existsSync(scriptPath)) {
      if (optional) return resolve({ ok: false, reason: 'Script not found', code: -1 });
      return resolve({ ok: false, reason: `Script not found: ${scriptPath}`, code: -1 });
    }

    const child = spawn('node', [scriptPath, ...scriptArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: AbortSignal.timeout(60000),
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code: number | null) => {
      let parsed: Record<string, unknown> | null = null;
      try { if (stdout) parsed = JSON.parse(stdout); } catch { /* ignore */ }
      resolve({
        ok: code === 0,
        code,
        stdout: stdout.slice(0, 2000),
        stderr: stderr.slice(0, 2000),
        parsed,
      });
    });

    child.on('error', (err: Error) => {
      resolve({ ok: false, reason: err.message, code: -1 });
    });
  });
}

/** Run multiple analysis scripts in PARALLEL via Promise.allSettled. */
async function runScriptBatch(
  taskDefs: Array<{ name: string; script: string; args: string[]; optional: boolean }>,
): Promise<Array<{ name: string; result: RunResult }>> {
  const settled = await Promise.allSettled(
    taskDefs.map(t =>
      runScriptAsync(t.script, t.args, { optional: t.optional })
        .then(result => ({ name: t.name, result })),
    ),
  );

  return settled
    .filter((r): r is PromiseFulfilledResult<{ name: string; result: RunResult }> => r.status === 'fulfilled')
    .map(r => r.value);
}

// ─────────────────────────────────────────────
// STEP 1: Pre-Build Validation (12 Guards)
// ─────────────────────────────────────────────

log('Step 1/6: Pre-Build Validation (12 Guards)...');

const preBuildOutputPath = path.join(outDir, 'pre-build-validation.json');
const preBuildArgs: string[] = ['--tree', treePath || ''];
if (tokensPath) preBuildArgs.push('--tokens', tokensPath);
if (fontsPath)  preBuildArgs.push('--fonts', fontsPath);
preBuildArgs.push('--output', preBuildOutputPath);

const preBuildResult = runScript('framer-pre-build-validate.js', preBuildArgs);
// Primary: read from output file (script writes JSON there when --output is set, stdout stays empty)
let preBuildScore = 0;
try {
  const fileData = JSON.parse(fs.readFileSync(preBuildOutputPath, 'utf8'));
  preBuildScore = (fileData.meta?.score as number) || 0;
} catch {
  // Fallback: try stdout (when --output is not set or script version differs)
  preBuildScore = (preBuildResult.parsed?.meta as Record<string, unknown>)?.score as number || 0;
}
const minScore = parseInt(args['min-score'] as string) || 85;

if (preBuildScore >= minScore && preBuildResult.ok) {
  okFn(`Pre-Build: ${preBuildScore}% (≥${minScore}%)`);
} else {
  failFn(`Pre-Build: ${preBuildScore}% (<${minScore}%)`);
  blocked = true;
}
results.push({ step: 'pre-build-validate', score: preBuildScore, passed: preBuildScore >= minScore, report: preBuildResult.parsed });

// ─────────────────────────────────────────────
// STEPS 2-4: Quality Metrics + Validation + Binding (PARALLEL)
// ─────────────────────────────────────────────

log('Steps 2-4/6: Quality Metrics + Structural Validation + Binding (batch)...');

const parallelTasks: BatchTaskDef[] = [
  { name: 'quality-metrics', script: 'measure-quality-metrics.js', args: [treePath || '', '--output', path.join(outDir, 'quality-metrics.json')], optional: true },
  { name: 'structural-validation', script: 'validate-v4-tree.js', args: [treePath || '', '--mode=warn', '--output', path.join(outDir, 'validate-report.json')], optional: false },
  { name: 'build-binding', script: 'verify-build-binding.js', args: [treePath || ''], optional: false },
];

// Steps 2-4 run in PARALLEL (async spawn + Promise.allSettled)
const parallelResults = await runScriptBatch(parallelTasks);

for (const { name, result } of parallelResults) {
  if (name === 'quality-metrics') {
    if (result.ok) {
      const m = result.parsed?.metrics as Record<string, { value?: number }> | undefined;
      okFn(`Metrics: DOM depth ${m?.dom_depth?.value || '?'}, GC ${m?.gc_coverage?.value || '?'}%, GV ${m?.gv_color_substitution?.value || '?'}%`);
    } else {
      warn('Quality metrics failed (optional).');
    }
    results.push({ step: 'quality-metrics', passed: result.ok, report: result.parsed });
  } else if (name === 'structural-validation') {
    const validateScore = (result.parsed?.score as number) || 0;
    if (validateScore >= minScore) {
      okFn(`Validate: ${validateScore}%`);
    } else {
      warn(`Validate: ${validateScore}% (below threshold but not blocking)`);
    }
    results.push({ step: 'structural-validation', score: validateScore, passed: validateScore >= minScore, report: result.parsed });
  } else if (name === 'build-binding') {
    if (result.ok) {
      okFn('Build Binding: All styles bound');
    } else {
      warn('Build Binding: Unbound styles detected');
    }
    results.push({ step: 'build-binding', passed: result.ok });
  }
}

// ─────────────────────────────────────────────
// STEP 5: Section Compare (Screenshot Diff)
// ─────────────────────────────────────────────

if (!args['skip-screenshots'] && framerUrl && elementorUrl) {
  log('Step 5/6: Section Compare (Screenshot Diff)...');

  if (args['dry-run']) {
    runScript('section-compare.js', [
      '--framer-url', framerUrl,
      '--elementor-url', elementorUrl,
      '--section', 'hero',
      '--dry-run',
      '--output', path.join(outDir, 'section-compare'),
    ], { optional: true });

    log('Section Compare: dry-run completed');
    results.push({ step: 'section-compare', passed: true, dryRun: true });
  } else {
    warn('Section Compare requires browser (Playwright/Puppeteer). Use --dry-run for CI. Skipping.');
    results.push({ step: 'section-compare', passed: null, skipped: true, reason: 'No browser in CI mode' });
  }
} else {
  log('Step 5/6: Section Compare skipped (--skip-screenshots or missing URLs)');
  results.push({ step: 'section-compare', passed: null, skipped: true });
}

// ─────────────────────────────────────────────
// STEP 6: Auto-Fix Plan
// ─────────────────────────────────────────────

log('Step 6/6: Auto-Fix Plan...');

const autoFixResult = runScript('post-build-auto-fix.js', [
  '--post-id', postId || '0',
  '--qa-report', path.join(outDir, 'pre-build-validation.json'),
  '--output', path.join(outDir, 'auto-fix-plan.json'),
  '--fix-types', 'contrast,alt-text,layout,variables,seo',
], { optional: true });

if (autoFixResult.ok || (autoFixResult.code !== null && autoFixResult.code > 0)) {
  const stats = autoFixResult.parsed?.stats as Record<string, number> | undefined;
  const totalIssues = stats?.total_issues || stats?.unique_calls || 0;
  okFn(`Auto-Fix: ${totalIssues} issue(s) → ${stats?.unique_calls || '?'} MCP call(s)`);
} else {
  warn('Auto-Fix: no issues to fix or script failed');
}
results.push({ step: 'auto-fix', passed: autoFixResult.ok || (autoFixResult.code !== null && autoFixResult.code > 0), report: autoFixResult.parsed });

// ─────────────────────────────────────────────
// CONSOLIDATED REPORT
// ─────────────────────────────────────────────

const totalSteps = results.length;
const passedSteps = results.filter(r => r.passed === true).length;
const skippedSteps = results.filter(r => r.skipped).length;
const failedSteps = results.filter(r => r.passed === false).length;

const report: GateReport = {
  meta: {
    generated_at: new Date().toISOString(),
    tree: treePath,
    post_id: postId,
    min_score: minScore,
  },
  pipeline: {
    total_steps: totalSteps,
    passed: passedSteps,
    failed: failedSteps,
    skipped: skippedSteps,
    blocked,
  },
  steps: results.map(r => ({
    step: r.step,
    passed: r.passed,
    skipped: r.skipped,
    score: r.score,
    report: r.report ? Object.keys(r.report).slice(0, 5).join(',') : null,
  })),
  summary: {
    status: blocked ? 'BLOCKED' : (failedSteps > 0 ? 'WARNINGS' : 'PASS'),
    message: blocked
      ? `Build blocked: Pre-build validation score ${preBuildScore}% < ${minScore}%`
      : failedSteps > 0
        ? `Build allowed with ${failedSteps} warnings`
        : 'All quality gates passed',
  },
};

const reportPath = path.join(outDir, 'quality-gate-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

// ─────────────────────────────────────────────
// CONSOLE SUMMARY
// ─────────────────────────────────────────────

process.stderr.write(`\n${'═'.repeat(60)}\n`);
process.stderr.write('📊 Build Quality Gate Report\n');
process.stderr.write(`${'═'.repeat(60)}\n`);
process.stderr.write(`  Status:  ${report.summary.status}\n`);
process.stderr.write(`  Steps:   ${passedSteps}/${totalSteps} passed`);
if (skippedSteps > 0) process.stderr.write(`, ${skippedSteps} skipped`);
process.stderr.write('\n');
process.stderr.write(`  Report:  ${path.relative(process.cwd(), reportPath)}\n`);
process.stderr.write(`${'═'.repeat(60)}\n\n`);

process.exit(blocked ? 1 : 0);
