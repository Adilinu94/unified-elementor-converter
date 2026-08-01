/**
 * elconv wizard — Unified step-by-step pipeline for both V3 and V4.
 * Phase 49: CLI-Unification (1 wizard, both targets).
 *
 * Guides through: preflight → extract → build → validate → deploy → QA
 * with resume support and dry-run mode.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { optionalFlag, boolFlag } from './args.js';
import {
  ProgressTracker,
  assertNoContamination,
  formatGuardReport,
  runGuards,
  type SourceSpec,
} from '@elconv/core';
import { V3_GUARDS } from '@elconv/target-v3';
import { V4_GUARDS } from '@elconv/target-v4';
import { extractFromHtml, extractFromFramerXml } from '@elconv/extractors';
import { buildV3Tree } from '@elconv/target-v3';
import { buildV4Tree } from '@elconv/target-v4';
import {
  McpAdapter,
  capturePageSnapshot,
  writeSnapshotFile,
  SNAPSHOT_DIR,
  pushToWordPress,
  type WpPushResult,
  type WpPushOptions,
} from '@elconv/mcp';
import { runPipeline } from './analysis/pipeline.js';
import { runLivePreflight, type LivePreflightResult } from './cmd-preflight.js';
import { input, select, confirm } from '@inquirer/prompts';

// ============================================================================
// Types
// ============================================================================

export type WizardPhase =
  | 'preflight'
  | 'extract'
  | 'build'
  | 'validate'
  | 'deploy'
  | 'qa'
  | 'done';

export interface WizardState {
  target: 'v3' | 'v4';
  sourceUrl?: string;
  htmlPath?: string;
  xmlPath?: string;
  outputPath: string;
  postId?: number;
  currentPhase: WizardPhase;
  completedPhases: WizardPhase[];
  treePath?: string;
  sourceSpecPath?: string;
  permalink?: string;
  mcpUrl?: string;
  authEnv?: string;
  title?: string;
  pageTemplate?: 'elementor_canvas' | 'elementor_header_footer' | 'default';
  /** Persisted so a resume cannot accidentally turn a dry-run into a deploy. */
  dryRun?: boolean;
  snapshotPath?: string;
  qaScore?: number;
  startedAt: string;
  updatedAt: string;
}

export interface WizardDependencies {
  createAdapter?: (options: ConstructorParameters<typeof McpAdapter>[0]) => McpAdapter;
  runLivePreflight?: (adapter: McpAdapter, mode: 'v3' | 'v4') => Promise<LivePreflightResult>;
  captureSnapshot?: typeof capturePageSnapshot;
  saveSnapshot?: typeof writeSnapshotFile;
  pushPage?: (adapter: McpAdapter, content: unknown[], options: WpPushOptions) => Promise<WpPushResult>;
}

export interface WizardOptions {
  target: 'v3' | 'v4';
  url?: string;
  html?: string;
  xml?: string;
  out?: string;
  postId?: string;
  dryRun?: boolean;
  resume?: boolean;
  stateFile?: string;
  mcpUrl?: string;
  authEnv?: string;
  title?: string;
  pageTemplate?: 'elementor_canvas' | 'elementor_header_footer' | 'default';
}

// ============================================================================
// State Management
// ============================================================================

const DEFAULT_STATE_FILE = '.elconv-wizard-state.json';

export function loadWizardState(stateFile: string): WizardState | null {
  if (!existsSync(stateFile)) return null;
  try {
    return JSON.parse(readFileSync(stateFile, 'utf-8')) as WizardState;
  } catch {
    return null;
  }
}

export function saveWizardState(state: WizardState, stateFile: string): void {
  state.updatedAt = new Date().toISOString();
  mkdirSync(resolve(stateFile, '..'), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
}

export function createWizardState(options: WizardOptions): WizardState {
  return {
    target: options.target,
    sourceUrl: options.url,
    htmlPath: options.html,
    xmlPath: options.xml,
    outputPath: options.out ?? `./output/${options.target}-tree.json`,
    mcpUrl: options.mcpUrl,
    authEnv: options.authEnv,
    title: options.title,
    pageTemplate: options.pageTemplate,
    dryRun: options.dryRun ?? false,
    postId: options.postId ? parseInt(options.postId, 10) : undefined,
    currentPhase: 'preflight',
    completedPhases: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Phase Execution
// ============================================================================

const PHASE_ORDER: WizardPhase[] = ['preflight', 'extract', 'build', 'validate', 'deploy', 'qa', 'done'];

function getNextPhase(current: WizardPhase): WizardPhase {
  const idx = PHASE_ORDER.indexOf(current);
  return PHASE_ORDER[Math.min(idx + 1, PHASE_ORDER.length - 1)];
}

function printPhaseHeader(phase: WizardPhase, target: string): void {
  const labels: Record<string, string> = {
    preflight: '🩺 Preflight Checks',
    extract: '📥 Extraction',
    build: `🔨 Build ${target.toUpperCase()} Tree`,
    validate: '✅ Validation & Guards',
    deploy: '🚀 Deploy to WordPress',
    qa: '📊 Visual QA',
    done: '🎉 Complete',
  };
  process.stdout.write(`\n${'═'.repeat(60)}\n`);
  process.stdout.write(`  ${labels[phase] ?? phase}\n`);
  process.stdout.write(`${'═'.repeat(60)}\n\n`);
}

// ============================================================================
// Main Wizard Command
// ============================================================================

export async function cmdWizard(
  flags: Record<string, string | boolean>,
  dependencies: WizardDependencies = {},
): Promise<number> {
  const stateFile = optionalFlag(flags, 'state-file') ?? DEFAULT_STATE_FILE;
  const resume = boolFlag(flags, 'resume');
  const noInteractive = boolFlag(flags, 'no-interactive');
  const hasTarget = optionalFlag(flags, 'target') !== undefined;

  // Resume replays a saved state file regardless of interactivity.
  if (resume) {
    const loaded = loadWizardState(stateFile);
    if (!loaded) {
      process.stderr.write('No wizard state found to resume. Start fresh.\n');
      return 2;
    }
    const resumeDryRun = Object.prototype.hasOwnProperty.call(flags, 'dry-run')
      ? boolFlag(flags, 'dry-run')
      : loaded.dryRun ?? false;
    loaded.dryRun = resumeDryRun;
    process.stdout.write(`Resuming from phase: ${loaded.currentPhase}\n`);
    return runWizardStateMachine(loaded, stateFile, resumeDryRun, dependencies);
  }

  // Collect options either interactively (no --target, a TTY, interactivity on)
  // or from flags (the classic non-interactive path). Both feed one state machine.
  let options: WizardOptions;
  if (!noInteractive && !hasTarget) {
    if (!process.stdin.isTTY) {
      process.stderr.write(
        'Error: interactive wizard needs a TTY. Pass --target (+ --url/--html/--xml) or --no-interactive.\n',
      );
      return 2;
    }
    options = await collectWizardOptionsInteractive();
  } else {
    const target = optionalFlag(flags, 'target');
    if (target !== 'v3' && target !== 'v4') {
      process.stderr.write(`Error: --target must be "v3" or "v4"\n`);
      return 2;
    }
    options = {
      target,
      url: optionalFlag(flags, 'url'),
      html: optionalFlag(flags, 'html'),
      xml: optionalFlag(flags, 'xml'),
      out: optionalFlag(flags, 'out'),
      postId: optionalFlag(flags, 'post-id'),
      dryRun: boolFlag(flags, 'dry-run'),
      mcpUrl: optionalFlag(flags, 'mcp-url'),
      authEnv: optionalFlag(flags, 'auth-env'),
      title: optionalFlag(flags, 'title'),
      pageTemplate: (optionalFlag(flags, 'page-template') as WizardOptions['pageTemplate']) ?? 'elementor_canvas',
    };
  }

  const state = createWizardState(options);
  return runWizardStateMachine(state, stateFile, options.dryRun ?? false, dependencies);
}

/**
 * Interactively collect wizard options via @inquirer/prompts. Runs when
 * `elconv wizard` is invoked with no --target and interactivity enabled. It
 * produces the exact same WizardOptions shape as the flag path so both share a
 * single state machine (interactive UX harvested from the former standalone
 * framer-build-wizard, now unified for both V3 and V4 targets).
 */
export async function collectWizardOptionsInteractive(): Promise<WizardOptions> {
  process.stdout.write('\n🧙 elconv Wizard — interactive mode\n\n');

  const target = (await select({
    message: 'Which Elementor target should the page be built for?',
    choices: [
      { name: 'V3 Design System (Container + Widgets)', value: 'v3' },
      { name: 'V4 Atomic System (e-flexbox, atomic widgets, Global Classes)', value: 'v4' },
    ],
    default: 'v3',
  })) as 'v3' | 'v4';

  const sourceType = await select({
    message: 'What is the source to rebuild?',
    choices: [
      { name: 'Live URL (extracted via Playwright)', value: 'url' },
      { name: 'Framer XML export', value: 'xml' },
      { name: 'Static HTML file', value: 'html' },
    ],
  });

  let url: string | undefined;
  let xml: string | undefined;
  let html: string | undefined;
  if (sourceType === 'url') {
    url = await input({
      message: 'Source URL:',
      validate: (v) => (/^https?:\/\//i.test(v) ? true : 'Must be a valid http(s) URL'),
    });
  } else if (sourceType === 'xml') {
    xml = await input({
      message: 'Path to Framer XML export:',
      validate: (v) => (existsSync(resolve(v)) ? true : 'File not found'),
    });
  } else {
    html = await input({
      message: 'Path to HTML file:',
      validate: (v) => (existsSync(resolve(v)) ? true : 'File not found'),
    });
  }

  const out = await input({
    message: 'Output path for the built tree:',
    default: `./output/${target}-tree.json`,
  });

  const deployNow = await confirm({
    message: 'Deploy into an existing WordPress page now?',
    default: false,
  });
  let postId: string | undefined;
  let mcpUrl: string | undefined;
  let authEnv: string | undefined;
  let title: string | undefined;
  let pageTemplate: WizardOptions['pageTemplate'] = 'elementor_canvas';
  if (deployNow) {
    postId = await input({
      message: 'Existing WordPress post ID:',
      validate: (v) => (/^\d+$/.test(v) ? true : 'Must be a number'),
    });
    mcpUrl = await input({
      message: 'Novamira MCP endpoint:',
      validate: (v) => (/^https?:\/\//i.test(v) ? true : 'Must be a valid http(s) URL'),
    });
    authEnv = await input({
      message: 'Environment variable containing user:application-password:',
      validate: (v) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? true : 'Must be a valid environment variable name'),
    });
    title = await input({
      message: 'Page title (used for new-page-compatible metadata):',
      default: `Converted ${target.toUpperCase()} page`,
    });
    pageTemplate = (await select({
      message: 'Elementor page template:',
      choices: [
        { name: 'Elementor Canvas', value: 'elementor_canvas' },
        { name: 'Elementor Header & Footer', value: 'elementor_header_footer' },
        { name: 'WordPress default', value: 'default' },
      ],
      default: 'elementor_canvas',
    })) as WizardOptions['pageTemplate'];
  }

  const dryRun = await confirm({
    message: 'Dry run? (build + validate only, nothing pushed)',
    default: !deployNow,
  });

  return { target, url, xml, html, out, postId, dryRun, mcpUrl, authEnv, title, pageTemplate };
}

/**
 * Drive the phase state machine to completion (or first failure), persisting
 * state after every phase so `--resume` can continue. Shared by the interactive
 * and flag entry points.
 */
async function runWizardStateMachine(
  state: WizardState,
  stateFile: string,
  dryRun: boolean,
  dependencies: WizardDependencies = {},
): Promise<number> {
  const target = state.target;
  process.stdout.write(`\n🧙 elconv Wizard — Target: ${target.toUpperCase()}\n`);
  if (dryRun) process.stdout.write('   Mode: DRY-RUN (no changes will be made)\n');
  process.stdout.write(`   State: ${resolve(stateFile)}\n`);

  // Streaming progress + ETA over the phases that will actually run this
  // invocation (fewer on --resume). ETA is derived from the average phase
  // duration observed so far.
  const remainingPhases = PHASE_ORDER.slice(
    PHASE_ORDER.indexOf(state.currentPhase),
    PHASE_ORDER.indexOf('done'),
  );
  const progress = new ProgressTracker({
    total: remainingPhases.length,
    sink: (line) => process.stdout.write(`  ⏱  ${line}\n`),
  });
  progress.start();

  while (state.currentPhase !== 'done') {
    printPhaseHeader(state.currentPhase, target);

    const ranPhase = state.currentPhase;
    state.dryRun = dryRun;
    const result = await executePhase(state, dryRun, dependencies);

    if (!result.ok) {
      process.stderr.write(`\n✗ Phase '${state.currentPhase}' failed: ${result.error}\n`);
      process.stderr.write(`  Resume with: elconv wizard --resume\n`);
      saveWizardState(state, stateFile);
      return 1;
    }

    state.completedPhases.push(state.currentPhase);
    state.currentPhase = getNextPhase(state.currentPhase);
    saveWizardState(state, stateFile);

    if (result.message) {
      process.stdout.write(`  ${result.message}\n`);
    }
    progress.advance(ranPhase);
  }

  printPhaseHeader('done', target);
  process.stdout.write(`  Target:    ${target.toUpperCase()}\n`);
  process.stdout.write(`  Output:    ${state.outputPath}\n`);
  if (state.permalink) process.stdout.write(`  Permalink: ${state.permalink}\n`);
  if (state.qaScore !== undefined) process.stdout.write(`  QA Score:  ${state.qaScore}/100\n`);
  process.stdout.write(`  Phases:    ${state.completedPhases.length} completed\n`);
  process.stdout.write(`\n✓ Wizard complete!\n`);

  return 0;
}

// ============================================================================
// Phase Executors
// ============================================================================

interface PhaseResult {
  ok: boolean;
  error?: string;
  message?: string;
}

async function executePhase(
  state: WizardState,
  dryRun: boolean,
  dependencies: WizardDependencies,
): Promise<PhaseResult> {
  switch (state.currentPhase) {
    case 'preflight':
      return executePreflight(state, dryRun, dependencies);
    case 'extract':
      return executeExtract(state, dryRun);
    case 'build':
      return executeBuild(state, dryRun);
    case 'validate':
      return executeValidate(state, dryRun);
    case 'deploy':
      return executeDeploy(state, dryRun, dependencies);
    case 'qa':
      return executeQa(state, dryRun);
    default:
      return { ok: true };
  }
}

async function executePreflight(
  state: WizardState,
  dryRun: boolean,
  dependencies: WizardDependencies,
): Promise<PhaseResult> {
  process.stdout.write('  Running preflight checks...\n');

  if (!state.sourceUrl && !state.htmlPath && !state.xmlPath) {
    return { ok: false, error: 'No source specified. Use --url, --html, or --xml.' };
  }

  if (dryRun) {
    return { ok: true, message: 'Preflight skipped (dry-run)' };
  }

  if (!state.postId) {
    return { ok: true, message: 'Local preflight passed (no deployment requested)' };
  }
  if (!state.mcpUrl || !state.authEnv || !process.env[state.authEnv]) {
    return { ok: false, error: 'Deploy requested but --mcp-url and --auth-env (set to user:app-password) are missing.' };
  }

  try {
    const authEnv = state.authEnv;
    const credentials = process.env[authEnv];
    if (!credentials) {
      return { ok: false, error: `Deploy requested but environment variable ${authEnv} is empty.` };
    }
    const adapter = (dependencies.createAdapter ?? ((options) => new McpAdapter(options)))({
      baseUrl: state.mcpUrl,
      authHeader: `Basic ${Buffer.from(credentials).toString('base64')}`,
    });
    const result = await (dependencies.runLivePreflight ?? runLivePreflight)(adapter, state.target);
    if (!result.passed) return { ok: false, error: `Live preflight failed: ${result.message}` };
    return { ok: true, message: result.message };
  } catch (err) {
    return { ok: false, error: `Live preflight unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function executeExtract(state: WizardState, _dryRun: boolean): Promise<PhaseResult> {
  process.stdout.write('  Extracting source...\n');

  try {
    let spec: SourceSpec;
    if (state.htmlPath) {
      spec = (await extractFromHtml(resolve(state.htmlPath))).spec;
    } else if (state.xmlPath) {
      spec = (await extractFromFramerXml(resolve(state.xmlPath))).spec;
    } else if (state.sourceUrl) {
      const outputDir = resolve(state.outputPath, '..', `${state.target}-url-pipeline`);
      const pipeline = await runPipeline(state.sourceUrl, {
        outputDir,
        url: state.sourceUrl,
        dryRun: true,
        skipStages: [7],
      });
      const treePath = pipeline.artifacts[state.target === 'v3' ? 'v3-build' : 'v4-build'];
      if (!treePath || !existsSync(treePath)) {
        return { ok: false, error: 'URL pipeline completed without producing a target tree artifact.' };
      }
      state.treePath = treePath;
      return { ok: true, message: `URL extracted and classified → ${treePath}` };
    } else {
      return { ok: false, error: 'No extraction source available.' };
    }

    const sourceSpecPath = `${state.outputPath}.source-spec.json`;
    mkdirSync(resolve(sourceSpecPath, '..'), { recursive: true });
    writeFileSync(sourceSpecPath, JSON.stringify(spec, null, 2), 'utf-8');
    state.sourceSpecPath = sourceSpecPath;
    return { ok: true, message: `Source extracted → ${sourceSpecPath}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function executeBuild(state: WizardState, _dryRun: boolean): Promise<PhaseResult> {
  process.stdout.write(`  Building ${state.target.toUpperCase()} tree...\n`);

  if (state.treePath && !state.sourceSpecPath && existsSync(state.treePath)) {
    try {
      const tree = JSON.parse(readFileSync(state.treePath, 'utf-8')) as unknown[];
      assertNoContamination(tree, state.target);
      const outPath = resolve(state.outputPath);
      mkdirSync(resolve(outPath, '..'), { recursive: true });
      writeFileSync(outPath, JSON.stringify(tree, null, 2), 'utf-8');
      state.treePath = outPath;
      return { ok: true, message: `Tree artifact copied → ${outPath}` };
    } catch (err) {
      return { ok: false, error: `Build failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (!state.sourceSpecPath || !existsSync(state.sourceSpecPath)) {
    return { ok: false, error: 'Build input is missing; extraction did not produce a SourceSpec artifact.' };
  }

  try {
    const spec = JSON.parse(readFileSync(state.sourceSpecPath, 'utf-8')) as SourceSpec;
    const tree = state.target === 'v3' ? buildV3Tree(spec) : buildV4Tree(spec);
    assertNoContamination(tree, state.target);
    const outPath = resolve(state.outputPath);
    mkdirSync(resolve(outPath, '..'), { recursive: true });
    writeFileSync(outPath, JSON.stringify(tree, null, 2), 'utf-8');
    state.treePath = outPath;
    return { ok: true, message: `Tree built → ${outPath}` };
  } catch (err) {
    return { ok: false, error: `Build failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function executeValidate(state: WizardState, _dryRun: boolean): Promise<PhaseResult> {
  process.stdout.write('  Running guards and contamination check...\n');

  if (!state.treePath || !existsSync(state.treePath)) {
    return { ok: false, error: 'Validation input is missing; build did not produce a tree artifact.' };
  }

  try {
    const tree = JSON.parse(readFileSync(state.treePath, 'utf-8')) as unknown[];
    assertNoContamination(tree, state.target);
    const guards = state.target === 'v3' ? V3_GUARDS : V4_GUARDS;
    const report = runGuards(tree, guards);
    if (!report.passed) {
      return {
        ok: false,
        error: `Guard score ${report.score}/${100} below threshold ${report.threshold}: ${formatGuardReport(report)}`,
      };
    }
    return { ok: true, message: `Validation passed — guards ${report.score}/100 and no contamination` };
  } catch (err) {
    return { ok: false, error: `Validation failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function executeDeploy(
  state: WizardState,
  dryRun: boolean,
  dependencies: WizardDependencies,
): Promise<PhaseResult> {
  process.stdout.write('  Deploying to WordPress...\n');

  if (dryRun) {
    return { ok: true, message: 'Deploy skipped (dry-run)' };
  }

  if (!state.postId) {
    return { ok: true, message: 'Deploy skipped (no --post-id provided)' };
  }
  if (!state.treePath || !existsSync(state.treePath)) {
    return { ok: false, error: 'Deploy input is missing; validation did not produce a tree artifact.' };
  }
  if (!state.mcpUrl || !state.authEnv || !process.env[state.authEnv]) {
    return { ok: false, error: 'Deploy unavailable: provide --mcp-url and --auth-env with user:app-password.' };
  }

  try {
    const tree = JSON.parse(readFileSync(state.treePath, 'utf-8')) as unknown[];
    const credentials = process.env[state.authEnv];
    if (!credentials) {
      return { ok: false, error: 'Deploy unavailable: the configured auth environment variable is empty.' };
    }
    const adapter = (dependencies.createAdapter ?? ((options) => new McpAdapter(options)))({
      baseUrl: state.mcpUrl,
      authHeader: `Basic ${Buffer.from(credentials).toString('base64')}`,
    });
    const snapshot = await (dependencies.captureSnapshot ?? capturePageSnapshot)(adapter, state.postId);
    state.snapshotPath = (dependencies.saveSnapshot ?? writeSnapshotFile)(SNAPSHOT_DIR, snapshot);
    const result = await (dependencies.pushPage ?? pushToWordPress)(adapter, tree, {
      postId: state.postId,
      title: state.title ?? `Converted ${state.target.toUpperCase()} page`,
      status: 'draft',
      pageTemplate: state.pageTemplate ?? 'elementor_canvas',
      target: state.target,
    });
    state.permalink = result.permalink || undefined;
    return { ok: true, message: `Deployed to post ${result.postId} — snapshot ${state.snapshotPath}` };
  } catch (err) {
    return { ok: false, error: `Deploy failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function executeQa(state: WizardState, dryRun: boolean): Promise<PhaseResult> {
  process.stdout.write('  Running visual QA...\n');

  if (dryRun) {
    return { ok: true, message: 'QA skipped (dry-run)' };
  }

  if (!state.permalink) {
    return { ok: true, message: 'QA skipped (no deployed URL)' };
  }

  // A real visual score needs a reference; run it as a dedicated step:
  //   elconv qa --url <permalink> --ref-url <source>
  // (see cmd-qa.ts \u2014 pixelmatch + SSIM). The wizard never fabricates a score.
  return { ok: true, message: 'Deployed \u2014 run `elconv qa` for a real visual score.' };
}
