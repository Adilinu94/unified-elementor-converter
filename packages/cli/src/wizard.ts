import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { hostnameFromUrl } from '@elconv/core';
import { getTarget } from '@elconv/core';
import {
  createInitialState,
  loadState,
  saveState,
  stateFileFor,
  reconcile,
  approvedSectionIds,
  type CloneState,
  type PhaseName,
} from './state-manager.js';
import {
  promptUrl,
  promptTarget,
  promptViewports,
  promptAnimation,
  promptFonts,
  promptStrictness,
  promptSections,
  promptAutoPick,
  promptResume,
  summaryFor,
  type AnimationStrategy,
  type FontStrategy,
  type StrictnessLevel,
  type SectionChoice,
  type TargetOption,
} from './prompts.js';

export interface WizardOptions {
  url?: string;
  target?: string;
  viewports?: number[];
  animations?: AnimationStrategy;
  fonts?: FontStrategy;
  strictness?: StrictnessLevel;
  autoPickSections?: boolean;
  sections?: string[];
  sourceAuth?: string;
  resume?: string;
  output: string;
  interactive: boolean;
  detectedSections?: SectionChoice[];
  targets?: TargetOption[];
  /** Deployed clone page URL for QA stage (e.g. https://yoursite.local/?p=1234). */
  cloneUrl?: string;
  /** WordPress post ID of the deployed clone page for Auto-Fix MCP calls. */
  postId?: number;
  /** Enable QA auto-fix loop after pixel-diff (requires cloneUrl + postId + MCP target). */
  qaAutoFix?: boolean;
  /** Upgrade the pushed page to Elementor V4 Atomic Widgets as the final pipeline step (requires postId + MCP target). */
  upgradeToV4?: boolean;
  /** Enable Vision-QA healing loop after pixel-diff (requires cloneUrl + postId + MCP target). */
  heal?: boolean;
  /** Enable AI vision-enhancement for ambiguous sections during classification (Modul P1, requires ANTHROPIC_API_KEY/OPENAI_API_KEY). */
  visionEnhance?: boolean;
  /** Generate an AI-proposed repair report for failing sections after QA (Modul AI2, diagnostic only — does not push to WordPress). */
  fullContextRepair?: boolean;
  /** MCP endpoint URL for WP-Push and Auto-Fix (e.g. https://test4.nick-webdesign.de/wp-json/mcp/novamira). */
  mcpUrl?: string;
  /** Basic auth credentials for MCP endpoint (format: user:pass). */
  mcpAuth?: string;
  /** Overrides McpAdapter's defaults (3/500ms) — only used if not resolved from a --target profile. */
  mcpMaxRetries?: number;
  mcpBackoffMs?: number;
  /** Browser backend for Stage 1 extraction. */
  extractor?: 'local' | 'browserbase';
}

export interface WizardResult {
  state: CloneState;
  resumeMode: boolean;
  dryRun: boolean;
  interactive: boolean;
  /** Deployed clone page URL for QA stage. */
  cloneUrl?: string;
  /** WordPress post ID of the deployed clone page for Auto-Fix MCP calls. */
  postId?: number;
  /** Enable QA auto-fix loop after pixel-diff. */
  qaAutoFix?: boolean;
  /** Upgrade the pushed page to Elementor V4 Atomic Widgets as the final pipeline step. */
  upgradeToV4?: boolean;
  /** Enable Vision-QA healing loop after pixel-diff. */
  heal?: boolean;
  /** Enable AI vision-enhancement for ambiguous sections during classification. */
  visionEnhance?: boolean;
  /** Generate an AI-proposed repair report for failing sections after QA (diagnostic only). */
  fullContextRepair?: boolean;
  /** MCP endpoint URL for WP-Push and Auto-Fix. */
  mcpUrl?: string;
  /** Basic auth credentials for MCP endpoint. */
  mcpAuth?: string;
  /** Resolved from --target profile's retryPolicy, or passed through from mcpMaxRetries/mcpBackoffMs. */
  mcpMaxRetries?: number;
  mcpBackoffMs?: number;
  /** Browser backend for Stage 1 extraction. */
  extractor?: 'local' | 'browserbase';
}

export interface LoadedState {
  state: CloneState;
  stateFile: string;
}

async function step1Url(opts: WizardOptions): Promise<string> {
  if (opts.url) return opts.url;
  return promptUrl();
}

async function step2Target(opts: WizardOptions): Promise<string | undefined> {
  if (opts.target) return opts.target;
  if (!opts.interactive) return undefined;
  return promptTarget(opts.targets ?? []);
}

async function step3Viewports(opts: WizardOptions): Promise<number[]> {
  if (opts.viewports) return opts.viewports;
  if (!opts.interactive) return [1440, 768, 390];
  return promptViewports();
}

async function step4Animations(opts: WizardOptions): Promise<AnimationStrategy> {
  if (opts.animations) return opts.animations;
  if (!opts.interactive) return 'auto';
  return promptAnimation();
}

async function step5Fonts(opts: WizardOptions): Promise<FontStrategy> {
  if (opts.fonts) return opts.fonts;
  if (!opts.interactive) return 'auto';
  return promptFonts();
}

async function step6Strictness(opts: WizardOptions): Promise<StrictnessLevel> {
  if (opts.strictness) return opts.strictness;
  if (!opts.interactive) return 'balanced';
  return promptStrictness();
}

async function step7Sections(
  opts: WizardOptions,
  state: CloneState,
): Promise<string[]> {
  if (opts.sections && opts.sections.length > 0) return opts.sections;
  if (opts.autoPickSections) return opts.detectedSections?.map((s) => s.id) ?? [];
  if (!opts.interactive) return [];
  if (!opts.detectedSections || opts.detectedSections.length === 0) return [];

  const autoPick = await promptAutoPick();
  if (autoPick) {
    return opts.detectedSections.map((s) => s.id);
  }
  const selected = await promptSections(opts.detectedSections);
  for (const s of selected) {
    if (!approvedSectionIds(state).includes(s)) {
      state.approvedSections.push({ sectionId: s, approved: true });
    }
  }
  return selected;
}

export async function runWizard(opts: WizardOptions): Promise<WizardResult> {
  const url = await step1Url(opts);
  const hostname = hostnameFromUrl(url);
  const stateFile = opts.resume ?? stateFileFor(opts.output, hostname);

  let state: CloneState;
  let resumeMode = false;

  if (opts.resume) {
    try {
      state = await loadState(opts.resume);
      resumeMode = true;
      console.log(chalk.cyan(`[wizard] Resuming from ${opts.resume}`));
    } catch (err) {
      throw new Error(
        `Could not load resume file: ${err instanceof Error ? err.message : err}`,
      );
    }
  } else {
    try {
      await loadState(stateFile);
      if (opts.interactive) {
        const useExisting = await promptResume(hostname);
        if (useExisting) {
          state = await loadState(stateFile);
          resumeMode = true;
          console.log(chalk.cyan(`[wizard] Resumed existing state for ${hostname}`));
        } else {
          state = await buildFreshState(opts, url);
        }
      } else {
        state = await buildFreshState(opts, url);
      }
    } catch {
      state = await buildFreshState(opts, url);
    }
  }

  const target = await step2Target(opts);
  if (target) state.options.target = target;

  const viewports = await step3Viewports(opts);
  state.options.viewports = viewports;

  const animations = await step4Animations(opts);
  state.options.animations = animations;

  const fonts = await step5Fonts(opts);
  state.options.fonts = fonts;

  const strictness = await step6Strictness(opts);
  state.options.strictness = strictness;

  const sections = await step7Sections(opts, state);
  state.approvedSections = sections.map((id) => ({ sectionId: id, approved: true }));

  await saveState(stateFile, state);

  const resumePhase: PhaseName | null = resumeMode ? reconcile(state) : null;

  if (opts.interactive) {
    console.log(chalk.bold('\n=== Clone Plan ==='));
    console.log(summaryFor(url, {
      target: state.options.target,
      viewports: state.options.viewports,
      animations: state.options.animations,
      fonts: state.options.fonts,
      strictness: state.options.strictness,
      sections,
    }));
    if (resumePhase) {
      console.log(chalk.yellow(`\nResume from phase: ${resumePhase}`));
    }
    const ok = await confirm({
      message: 'Proceed with this plan?',
      default: true,
    });
    if (!ok) {
      throw new Error('Aborted by user');
    }
  }

  // Wire cloneUrl + postId + qaAutoFix + upgradeToV4 + heal + visionEnhance + fullContextRepair into state for QA/upgrade stages
  if (opts.cloneUrl) state.options.cloneUrl = opts.cloneUrl;
  if (opts.postId !== undefined) state.options.postId = opts.postId;
  if (opts.qaAutoFix) state.options.qaAutoFix = opts.qaAutoFix;
  if (opts.upgradeToV4) state.options.upgradeToV4 = opts.upgradeToV4;
  if (opts.heal) state.options.heal = opts.heal;
  if (opts.visionEnhance) state.options.visionEnhance = opts.visionEnhance;
  if (opts.fullContextRepair) state.options.fullContextRepair = opts.fullContextRepair;

  // Resolve --target <name> against ~/.clone-v3/profiles.json. Explicit
  // --mcp-url/--mcp-auth/--mcp-max-retries/--mcp-backoff-ms always win over
  // whatever the profile says — a named profile is a shortcut, not an
  // override for someone who typed the connection details directly.
  let mcpUrl = opts.mcpUrl;
  let mcpAuth = opts.mcpAuth;
  let mcpMaxRetries = opts.mcpMaxRetries;
  let mcpBackoffMs = opts.mcpBackoffMs;
  if (target && (mcpUrl === undefined || mcpAuth === undefined)) {
    const profile = await getTarget(target);
    if (profile) {
      mcpUrl = mcpUrl ?? profile.mcp_endpoint;
      mcpAuth = mcpAuth ?? profile.auth_token;
      mcpMaxRetries = mcpMaxRetries ?? profile.retryPolicy?.maxRetries;
      mcpBackoffMs = mcpBackoffMs ?? profile.retryPolicy?.backoffMs;
    } else {
      console.warn(
        chalk.yellow(`[wizard] --target ${target} not found in ~/.clone-v3/profiles.json — falling back to --mcp-url/--mcp-auth (if given).`),
      );
    }
  }

  return { state, resumeMode, dryRun: false, interactive: opts.interactive, cloneUrl: opts.cloneUrl, postId: opts.postId, qaAutoFix: opts.qaAutoFix, upgradeToV4: opts.upgradeToV4, heal: opts.heal, visionEnhance: opts.visionEnhance, fullContextRepair: opts.fullContextRepair, mcpUrl, mcpAuth, mcpMaxRetries, mcpBackoffMs, extractor: opts.extractor };
}

async function buildFreshState(opts: WizardOptions, url: string): Promise<CloneState> {
  return createInitialState(url, opts.output, {
    target: opts.target,
    viewports: opts.viewports ?? [1440, 768, 390],
    animations: opts.animations ?? 'auto',
    fonts: opts.fonts ?? 'auto',
    strictness: opts.strictness ?? 'balanced',
    cloneUrl: opts.cloneUrl,
    postId: opts.postId,
    qaAutoFix: opts.qaAutoFix,
    upgradeToV4: opts.upgradeToV4,
    heal: opts.heal,
    visionEnhance: opts.visionEnhance,
    fullContextRepair: opts.fullContextRepair,
  });
}
