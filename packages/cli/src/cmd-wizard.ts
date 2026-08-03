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
import {
  buildWizardContract,
  writeWizardContract,
  wizardContractPathFor,
  wizardViewportsToConfig,
  WIZARD_EXIT_CODES,
  type WizardPhaseStatus,
} from './wizard-contract.js';
import { input, select, confirm } from '@inquirer/prompts';
import {
  findWizardTargetProfile,
  type WizardTargetProfile,
} from './wizard-targets.js';

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

export type WizardStrictness = 'draft' | 'balanced' | 'pixel-perfect';
export type WizardAnimationStrategy = 'none' | 'css' | 'gsap' | 'auto';
export type WizardFontStrategy = 'auto' | 'system' | 'all';
export type WizardTokenStrategy = 'auto' | 'preserve' | 'inline' | 'global';
export type WizardResponsiveStrategy = 'auto' | 'preserve' | 'mobile-first';
export type WizardUnknownWidgetStrategy = 'fallback-html' | 'skip' | 'error';

export interface WizardQaOptions {
  referenceUrl?: string;
  threshold: number;
  maxRepairRounds: number;
  autoFix: boolean;
  heal: boolean;
  fullContextRepair: boolean;
}

export interface WizardState {
  target: 'v3' | 'v4';
  targetProfileName?: string;
  targetProfile?: Omit<WizardTargetProfile, 'name'>;
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
  viewports: number[];
  strictness: WizardStrictness;
  animations: WizardAnimationStrategy;
  fonts: WizardFontStrategy;
  sections: string[];
  tokenStrategy?: WizardTokenStrategy;
  responsiveStrategy?: WizardResponsiveStrategy;
  unknownWidgetStrategy?: WizardUnknownWidgetStrategy;
  qa: WizardQaOptions;
  remoteStateKey?: string;
  /** Persisted so a resume cannot accidentally turn a dry-run into a deploy. */
  dryRun?: boolean;
  snapshotPath?: string;
  qaScore?: number;
  startedAt: string;
  updatedAt: string;
}

export interface WizardRemoteStatePort {
  load: (key: string) => Promise<WizardState | null>;
  save: (key: string, state: WizardState) => Promise<void>;
}

export interface WizardDependencies {
  createAdapter?: (options: ConstructorParameters<typeof McpAdapter>[0]) => McpAdapter;
  runLivePreflight?: (adapter: McpAdapter, mode: 'v3' | 'v4') => Promise<LivePreflightResult>;
  captureSnapshot?: typeof capturePageSnapshot;
  saveSnapshot?: typeof writeSnapshotFile;
  pushPage?: (adapter: McpAdapter, content: unknown[], options: WpPushOptions) => Promise<WpPushResult>;
  /** Optional verified remote-state adapter; never called during dry-run unless explicitly injected. */
  remoteState?: WizardRemoteStatePort;
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
  targetProfileName?: string;
  viewports?: number[];
  strictness?: WizardStrictness;
  animations?: WizardAnimationStrategy;
  fonts?: WizardFontStrategy;
  sections?: string[];
  tokenStrategy?: WizardTokenStrategy;
  responsiveStrategy?: WizardResponsiveStrategy;
  unknownWidgetStrategy?: WizardUnknownWidgetStrategy;
  qaReferenceUrl?: string;
  qaThreshold?: number;
  maxRepairRounds?: number;
  qaAutoFix?: boolean;
  heal?: boolean;
  fullContextRepair?: boolean;
  remoteStateKey?: string;
}

function parseCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

function parseViewports(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const parsed = value.split(',').map((entry) => Number(entry.trim()));
  if (parsed.some((width) => !Number.isInteger(width) || width < 320 || width > 3840)) {
    return undefined;
  }
  return parsed.length > 0 ? parsed : undefined;
}

function parseBoundedNumber(value: string | undefined, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}

function parseEnum<const T extends readonly string[]>(value: string | undefined, allowed: T): T[number] | undefined {
  return value && (allowed as readonly string[]).includes(value) ? value as T[number] : undefined;
}

function invalidFlagValue(name: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : `Error: invalid --${name} value "${value}"`;
}

function normalizeWizardState(raw: WizardState): WizardState {
  if (raw.target !== 'v3' && raw.target !== 'v4') {
    throw new Error(`Invalid wizard state target: ${String(raw.target)}`);
  }
  const target = raw.target;
  const qa = raw.qa ?? {
    referenceUrl: undefined,
    threshold: 85,
    maxRepairRounds: 0,
    autoFix: false,
    heal: false,
    fullContextRepair: false,
  };
  return {
    ...raw,
    target,
    completedPhases: Array.isArray(raw.completedPhases) ? raw.completedPhases : [],
    viewports: Array.isArray(raw.viewports) && raw.viewports.length > 0 ? raw.viewports : [1440, 768, 390],
    strictness: raw.strictness ?? 'balanced',
    animations: raw.animations ?? 'auto',
    fonts: raw.fonts ?? 'auto',
    sections: Array.isArray(raw.sections) ? raw.sections : [],
    tokenStrategy: target === 'v4' ? raw.tokenStrategy ?? 'auto' : undefined,
    responsiveStrategy: target === 'v4' ? raw.responsiveStrategy ?? 'auto' : undefined,
    unknownWidgetStrategy: target === 'v4' ? raw.unknownWidgetStrategy ?? 'fallback-html' : undefined,
    qa: {
      referenceUrl: qa.referenceUrl,
      threshold: Number.isFinite(qa.threshold) ? qa.threshold : 85,
      maxRepairRounds: Number.isFinite(qa.maxRepairRounds) ? qa.maxRepairRounds : 0,
      autoFix: qa.autoFix === true,
      heal: qa.heal === true,
      fullContextRepair: qa.fullContextRepair === true,
    },
  };
}

// ============================================================================
// State Management
// ============================================================================

const DEFAULT_STATE_FILE = '.elconv-wizard-state.json';

async function persistWizardState(
  state: WizardState,
  stateFile: string,
  remoteState: WizardRemoteStatePort | undefined,
): Promise<void> {
  saveWizardState(state, stateFile);
  if (!state.dryRun && remoteState && state.remoteStateKey) {
    try {
      await remoteState.save(state.remoteStateKey, state);
    } catch (err) {
      throw new Error(`Remote pipeline state unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function loadWizardState(stateFile: string): WizardState | null {
  if (!existsSync(stateFile)) return null;
  try {
    return normalizeWizardState(JSON.parse(readFileSync(stateFile, 'utf-8')) as WizardState);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid wizard state target:')) throw err;
    return null;
  }
}

export function saveWizardState(state: WizardState, stateFile: string): void {
  state.updatedAt = new Date().toISOString();
  mkdirSync(resolve(stateFile, '..'), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
}

export function createWizardState(options: WizardOptions, targetProfile?: WizardTargetProfile): WizardState {
  const viewports = options.viewports ?? [1440, 768, 390];
  const qa: WizardQaOptions = {
    referenceUrl: options.qaReferenceUrl,
    threshold: options.qaThreshold ?? 85,
    maxRepairRounds: options.maxRepairRounds ?? 0,
    autoFix: options.qaAutoFix ?? false,
    heal: options.heal ?? false,
    fullContextRepair: options.fullContextRepair ?? false,
  };
  const profileMetadata: Omit<WizardTargetProfile, 'name'> | undefined = targetProfile
    ? (({ name: _profileName, ...metadata }) => metadata)(targetProfile)
    : undefined;
  return {
    target: options.target,
    targetProfileName: targetProfile?.name ?? options.targetProfileName,
    targetProfile: profileMetadata,
    sourceUrl: options.url,
    htmlPath: options.html,
    xmlPath: options.xml,
    outputPath: options.out ?? `./output/${options.target}-tree.json`,
    mcpUrl: options.mcpUrl,
    authEnv: options.authEnv,
    title: options.title,
    pageTemplate: options.pageTemplate,
    viewports,
    strictness: options.strictness ?? 'balanced',
    animations: options.animations ?? 'auto',
    fonts: options.fonts ?? 'auto',
    sections: options.sections ?? [],
    tokenStrategy: options.target === 'v4' ? options.tokenStrategy : undefined,
    responsiveStrategy: options.target === 'v4' ? options.responsiveStrategy : undefined,
    unknownWidgetStrategy: options.target === 'v4' ? options.unknownWidgetStrategy : undefined,
    qa,
    remoteStateKey: options.remoteStateKey,
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
  const remoteStateKey = optionalFlag(flags, 'remote-state-key');
  const explicitDryRun = boolFlag(flags, 'dry-run');
  if (remoteStateKey && !dependencies.remoteState && !explicitDryRun) {
    const localResumeState = resume ? loadWizardState(stateFile) : null;
    if (!localResumeState?.dryRun) {
      process.stderr.write('Remote pipeline state is unavailable: no verified remote-state adapter is configured.\n');
      return 2;
    }
  }

  if (resume) {
    let loaded: WizardState | null;
    try {
      loaded = loadWizardState(stateFile);
    } catch (err) {
      process.stderr.write(`Invalid wizard state: ${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
    if (!loaded && remoteStateKey && dependencies.remoteState && !explicitDryRun) {
      try {
        const remoteLoaded = await dependencies.remoteState.load(remoteStateKey);
        loaded = remoteLoaded ? normalizeWizardState(remoteLoaded) : null;
      } catch (err) {
        process.stderr.write(`Remote pipeline state unavailable: ${err instanceof Error ? err.message : String(err)}\n`);
        return 2;
      }
    }
    if (!loaded) {
      process.stderr.write('No wizard state found to resume. Start fresh.\n');
      return 2;
    }
    const resumeDryRun = Object.prototype.hasOwnProperty.call(flags, 'dry-run')
      ? boolFlag(flags, 'dry-run')
      : loaded.dryRun ?? false;
    loaded.dryRun = resumeDryRun;
    loaded.remoteStateKey = remoteStateKey ?? loaded.remoteStateKey;
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
    const rawViewports = optionalFlag(flags, 'viewports');
    const rawStrictness = optionalFlag(flags, 'strictness');
    const rawAnimations = optionalFlag(flags, 'animations');
    const rawFonts = optionalFlag(flags, 'fonts');
    const rawTokenStrategy = optionalFlag(flags, 'token-strategy');
    const rawResponsiveStrategy = optionalFlag(flags, 'responsive');
    const rawUnknownWidgets = optionalFlag(flags, 'unknown-widgets');
    const rawQaThreshold = optionalFlag(flags, 'qa-threshold');
    const rawRepairRounds = optionalFlag(flags, 'max-repair-rounds');
    const viewports = parseViewports(rawViewports);
    const strictness = parseEnum(rawStrictness, ['draft', 'balanced', 'pixel-perfect'] as const);
    const animations = parseEnum(rawAnimations, ['none', 'css', 'gsap', 'auto'] as const);
    const fonts = parseEnum(rawFonts, ['auto', 'system', 'all'] as const);
    const tokenStrategy = parseEnum(rawTokenStrategy, ['auto', 'preserve', 'inline', 'global'] as const);
    const responsiveStrategy = parseEnum(rawResponsiveStrategy, ['auto', 'preserve', 'mobile-first'] as const);
    const unknownWidgetStrategy = parseEnum(rawUnknownWidgets, ['fallback-html', 'skip', 'error'] as const);
    const qaThreshold = parseBoundedNumber(rawQaThreshold, 0, 100);
    const maxRepairRounds = parseBoundedNumber(rawRepairRounds, 0, 20);
    const invalid = invalidFlagValue('viewports', rawViewports && viewports ? undefined : rawViewports)
      ?? invalidFlagValue('strictness', rawStrictness && strictness ? undefined : rawStrictness)
      ?? invalidFlagValue('animations', rawAnimations && animations ? undefined : rawAnimations)
      ?? invalidFlagValue('fonts', rawFonts && fonts ? undefined : rawFonts)
      ?? invalidFlagValue('token-strategy', rawTokenStrategy && tokenStrategy ? undefined : rawTokenStrategy)
      ?? invalidFlagValue('responsive', rawResponsiveStrategy && responsiveStrategy ? undefined : rawResponsiveStrategy)
      ?? invalidFlagValue('unknown-widgets', rawUnknownWidgets && unknownWidgetStrategy ? undefined : rawUnknownWidgets)
      ?? invalidFlagValue('qa-threshold', rawQaThreshold && qaThreshold !== undefined ? undefined : rawQaThreshold)
      ?? invalidFlagValue('max-repair-rounds', rawRepairRounds && maxRepairRounds !== undefined ? undefined : rawRepairRounds);
    const v4OptionsSupplied = rawTokenStrategy !== undefined || rawResponsiveStrategy !== undefined || rawUnknownWidgets !== undefined;
    if (invalid) {
      process.stderr.write(`${invalid}\n`);
      return 2;
    }
    if (target === 'v3' && v4OptionsSupplied) {
      process.stderr.write('Error: --token-strategy, --responsive, and --unknown-widgets are V4-only options.\n');
      return 2;
    }
    options = {
      target,
      targetProfileName: optionalFlag(flags, 'target-profile'),
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
      viewports,
      strictness,
      animations,
      fonts,
      sections: parseCsv(optionalFlag(flags, 'sections')),
      tokenStrategy,
      responsiveStrategy,
      unknownWidgetStrategy,
      qaReferenceUrl: optionalFlag(flags, 'qa-ref-url'),
      qaThreshold,
      maxRepairRounds,
      qaAutoFix: boolFlag(flags, 'qa-auto-fix'),
      heal: boolFlag(flags, 'heal'),
      fullContextRepair: boolFlag(flags, 'full-context-repair'),
      remoteStateKey: optionalFlag(flags, 'remote-state-key'),
    };
  }

  const targetProfile = options.targetProfileName
    ? findWizardTargetProfile(options.targetProfileName)
    : undefined;
  if (options.targetProfileName && !targetProfile) {
    process.stderr.write(`Target profile not found: ${options.targetProfileName}\n`);
    return 2;
  }
  if (targetProfile) {
    options.mcpUrl ??= targetProfile.mcpUrl;
    options.targetProfileName = targetProfile.name;
  }
  const state = createWizardState(options, targetProfile);
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

  const viewports = await input({
    message: 'Viewport widths (comma-separated):',
    default: '1440,768,390',
    validate: (value) => parseViewports(value) ? true : 'Use widths between 320 and 3840.',
  });
  const strictness = (await select({
    message: 'V3/V4 strictness:',
    choices: [
      { name: 'Draft', value: 'draft' },
      { name: 'Balanced', value: 'balanced' },
      { name: 'Pixel-perfect', value: 'pixel-perfect' },
    ],
    default: 'balanced',
  })) as WizardStrictness;
  const animations = (await select({
    message: 'Animation strategy:',
    choices: ['none', 'css', 'gsap', 'auto'].map((value) => ({ name: value, value })),
    default: 'auto',
  })) as WizardAnimationStrategy;
  const fonts = (await select({
    message: 'Font strategy:',
    choices: ['auto', 'system', 'all'].map((value) => ({ name: value, value })),
    default: 'auto',
  })) as WizardFontStrategy;
  const targetProfileName = (await input({
    message: 'Saved target profile name (blank for none):',
    default: '',
  })) || undefined;
  let tokenStrategy: WizardTokenStrategy | undefined;
  let responsiveStrategy: WizardResponsiveStrategy | undefined;
  let unknownWidgetStrategy: WizardUnknownWidgetStrategy | undefined;
  if (target === 'v4') {
    tokenStrategy = (await select({
      message: 'V4 token / Global Class strategy:',
      choices: ['auto', 'preserve', 'inline', 'global'].map((value) => ({ name: value, value })),
      default: 'auto',
    })) as WizardTokenStrategy;
    responsiveStrategy = (await select({
      message: 'V4 responsive strategy:',
      choices: ['auto', 'preserve', 'mobile-first'].map((value) => ({ name: value, value })),
      default: 'auto',
    })) as WizardResponsiveStrategy;
    unknownWidgetStrategy = (await select({
      message: 'V4 unknown widget strategy:',
      choices: [
        { name: 'Fallback to HTML', value: 'fallback-html' },
        { name: 'Skip', value: 'skip' },
        { name: 'Fail validation', value: 'error' },
      ],
      default: 'fallback-html',
    })) as WizardUnknownWidgetStrategy;
  }
  const qaReferenceUrl = await input({ message: 'QA reference URL (blank = no score):', default: '' });
  const qaThreshold = Number(await input({
    message: 'QA threshold (0-100):',
    default: '85',
    validate: (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? true : 'Use a number from 0 to 100.';
    },
  }));
  const maxRepairRounds = Number(await input({
    message: 'Max repair rounds:',
    default: '0',
    validate: (value) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 20 ? true : 'Use an integer from 0 to 20.';
    },
  }));
  return {
    target, url, xml, html, out, postId, dryRun, mcpUrl, authEnv, title, pageTemplate,
    targetProfileName, viewports: parseViewports(viewports) ?? [1440, 768, 390], strictness, animations, fonts,
    tokenStrategy, responsiveStrategy, unknownWidgetStrategy,
    qaReferenceUrl: qaReferenceUrl || undefined, qaThreshold, maxRepairRounds,
  };
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

  // Machine-readable per-phase status, persisted as wizard-contract.json after
  // every phase so tooling can audit the run (O-04). The contract mirrors the
  // honest exit-code semantics: 0 ok, 1 phase failure, 2 usage error.
  const phaseStatus: Partial<Record<WizardPhase, WizardPhaseStatus>> = {};
  const persistContract = (exitCode: 0 | 1 | null): void => {
    try {
      const remoteStateConfigured = !state.dryRun && Boolean(dependencies.remoteState && state.remoteStateKey);
      const contract = buildWizardContract(state, {
        phaseStatus,
        exitCode,
        remoteStateConfigured,
        remoteStateReason: state.dryRun
          ? 'dry-run never touches remote state'
          : remoteStateConfigured
            ? undefined
            : dependencies.remoteState
              ? 'remote-state adapter is injected but no --remote-state-key is set'
              : 'no verified remote-state adapter is configured',
      });
      writeWizardContract(contract, wizardContractPathFor(stateFile));
    } catch {
      // The contract is best-effort; a write failure must not fail the run.
    }
  };

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
    phaseStatus[ranPhase] = result.status ?? (result.ok ? 'ok' : 'failed');

    if (!result.ok) {
      process.stderr.write(`\n✗ Phase '${state.currentPhase}' failed: ${result.error}\n`);
      process.stderr.write(`  Resume with: elconv wizard --resume\n`);
      try {
        await persistWizardState(state, stateFile, dependencies.remoteState);
      } catch (err) {
        process.stderr.write(`\n✗ State persistence failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      persistContract(WIZARD_EXIT_CODES.PHASE_FAILED);
      return WIZARD_EXIT_CODES.PHASE_FAILED;
    }

    state.completedPhases.push(state.currentPhase);
    state.currentPhase = getNextPhase(state.currentPhase);
    try {
      await persistWizardState(state, stateFile, dependencies.remoteState);
    } catch (err) {
      process.stderr.write(`\n✗ State persistence failed: ${err instanceof Error ? err.message : String(err)}\n`);
      persistContract(WIZARD_EXIT_CODES.PHASE_FAILED);
      return WIZARD_EXIT_CODES.PHASE_FAILED;
    }
    persistContract(null);

    if (result.message) {
      process.stdout.write(`  ${result.message}\n`);
    }
    progress.advance(ranPhase);
  }

  phaseStatus.done = 'ok';
  printPhaseHeader('done', target);
  process.stdout.write(`  Target:    ${target.toUpperCase()}\n`);
  process.stdout.write(`  Output:    ${state.outputPath}\n`);
  if (state.permalink) process.stdout.write(`  Permalink: ${state.permalink}\n`);
  if (state.qaScore !== undefined) process.stdout.write(`  QA Score:  ${state.qaScore}/100\n`);
  process.stdout.write(`  Phases:    ${state.completedPhases.length} completed\n`);
  process.stdout.write(`\n✓ Wizard complete!\n`);
  persistContract(WIZARD_EXIT_CODES.OK);

  return WIZARD_EXIT_CODES.OK;
}

// ============================================================================
// Phase Executors
// ============================================================================

interface PhaseResult {
  ok: boolean;
  error?: string;
  message?: string;
  /** Machine-readable phase status for the wizard contract (defaults to ok/failed). */
  status?: WizardPhaseStatus;
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
        // Forward the wizard viewports to the URL pipeline so multi-viewport
        // capture and the responsive matrix actually use what was chosen (O-04).
        viewports: wizardViewportsToConfig(state.viewports),
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
      verify: true,
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
    return { ok: true, status: 'skipped', message: 'QA skipped (dry-run)' };
  }

  if (!state.permalink) {
    return { ok: true, status: 'skipped', message: 'QA skipped (no deployed URL)' };
  }

  // A real visual score needs a reference; run it as a dedicated step:
  //   elconv qa --url <permalink> --ref-url <source>
  // (see cmd-qa.ts \u2014 pixelmatch + SSIM). The wizard never fabricates a score.
  // The contract records `unavailable` (no reference) so tooling can tell the
  // difference between a real score, a skip, and a not-verifiable state.
  if (!state.qa.referenceUrl) {
    return { ok: true, status: 'unavailable', message: 'Deployed \u2014 run `elconv qa` with a reference URL for a real visual score.' };
  }
  return { ok: true, status: 'skipped', message: 'QA pending \u2014 run `elconv qa --url <permalink> --ref-url <reference>` for the score.' };
}
