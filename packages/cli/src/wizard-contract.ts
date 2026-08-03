/**
 * Wizard Contract (O-04).
 *
 * Machine-readable view of a wizard run: which V3/V4/QA options were forwarded
 * to build and QA, which phases ran with which status, the artifact paths each
 * phase produced, and the final exit code. Written as `wizard-contract.json`
 * next to the wizard state file after every phase so a failed or resumed run is
 * still fully readable by tooling/agents.
 *
 * The remote `pipeline-state` adapter is NOT part of this contract: it stays
 * structurally `unavailable` until its MCP ability schema is verified against a
 * live target. The local contract file is the offline source of truth.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  WizardPhase,
  WizardState,
  WizardStrictness,
  WizardAnimationStrategy,
  WizardFontStrategy,
  WizardTokenStrategy,
  WizardResponsiveStrategy,
  WizardUnknownWidgetStrategy,
  WizardQaOptions,
} from './cmd-wizard.js';

// ============================================================================
// Exit codes
// ============================================================================

export const WIZARD_EXIT_CODES = {
  /** All phases completed (or were safely skipped). */
  OK: 0,
  /** A phase failed, or state/contract persistence failed. */
  PHASE_FAILED: 1,
  /** Invalid flags, missing prerequisites, or unavailable remote state. */
  USAGE: 2,
} as const;

export type WizardExitCode = (typeof WIZARD_EXIT_CODES)[keyof typeof WIZARD_EXIT_CODES];

export const WIZARD_EXIT_CODE_LABELS: Record<WizardExitCode, string> = {
  [WIZARD_EXIT_CODES.OK]: 'ok — all phases completed',
  [WIZARD_EXIT_CODES.PHASE_FAILED]: 'failed — a phase failed or persistence failed',
  [WIZARD_EXIT_CODES.USAGE]: 'usage — invalid flags, missing prerequisites, or unavailable remote state',
};

export function describeExitCode(code: number): { code: number; meaning: string; ok: boolean } {
  if (code === WIZARD_EXIT_CODES.OK) {
    return { code, meaning: WIZARD_EXIT_CODE_LABELS[WIZARD_EXIT_CODES.OK], ok: true };
  }
  if (code === WIZARD_EXIT_CODES.PHASE_FAILED) {
    return { code, meaning: WIZARD_EXIT_CODE_LABELS[WIZARD_EXIT_CODES.PHASE_FAILED], ok: false };
  }
  if (code === WIZARD_EXIT_CODES.USAGE) {
    return { code, meaning: WIZARD_EXIT_CODE_LABELS[WIZARD_EXIT_CODES.USAGE], ok: false };
  }
  return { code, meaning: `unknown exit code ${code}`, ok: false };
}

// ============================================================================
// Per-phase status
// ============================================================================

export type WizardPhaseStatus = 'ok' | 'failed' | 'skipped' | 'pending' | 'unavailable';

export interface WizardContractPhase {
  name: WizardPhase;
  status: WizardPhaseStatus;
  error?: string;
  artifacts: string[];
}

// ============================================================================
// Option forwarding
// ============================================================================

export interface WizardViewportConfig {
  label: string;
  width: number;
  height: number;
}

const KNOWN_VIEWPORT_LABELS: Record<number, string> = { 1440: 'desktop', 768: 'tablet', 390: 'mobile' };
const VIEWPORT_HEIGHTS: Record<string, number> = { desktop: 900, tablet: 1024, mobile: 844 };

/**
 * Map wizard viewport widths to browser-extraction viewport configs. Widths in
 * the known set (1440/768/390) get the canonical labels so the URL pipeline can
 * reuse its multi-viewport capture and responsive-matrix logic.
 */
export function wizardViewportsToConfig(viewports: number[]): WizardViewportConfig[] {
  return viewports.map((width) => {
    const label = KNOWN_VIEWPORT_LABELS[width] ?? `custom-${width}`;
    return { label, width, height: VIEWPORT_HEIGHTS[label] ?? 900 };
  });
}

/**
 * The complete option set forwarded to build and QA adapters. This is the
 * machine-readable manifest of the wizard's persisted options — every V3/V4
 * option the user chose is represented here, target-relevant or not, so tooling
 * can audit exactly what a run was configured with.
 */
export interface WizardOptionsForwarded {
  viewports: number[];
  strictness: WizardStrictness;
  animations: WizardAnimationStrategy;
  fonts: WizardFontStrategy;
  sections: string[];
  tokenStrategy?: WizardTokenStrategy;
  responsiveStrategy?: WizardResponsiveStrategy;
  unknownWidgetStrategy?: WizardUnknownWidgetStrategy;
  qa: WizardQaOptions;
}

// ============================================================================
// Contract
// ============================================================================

export interface WizardContract {
  schemaVersion: 1;
  target: 'v3' | 'v4';
  dryRun: boolean;
  /** Final exit code; null while the run is still in progress. */
  exitCode: WizardExitCode | null;
  phases: WizardContractPhase[];
  optionsForwarded: WizardOptionsForwarded;
  /**
   * The exact build options actually passed to the build adapter in the build
   * phase (O-04 parity). `optionsForwarded` documents what the run was
   * configured with; this records what the adapter received, so tooling can
   * compare both to audit adapter parity.
   */
  optionsAppliedToBuild: {
    strictness: WizardStrictness;
    animations: WizardAnimationStrategy;
    fonts: WizardFontStrategy;
    sections: string[];
  };
  artifactPaths: Record<string, string>;
  remoteState: { configured: boolean; reason?: string };
}

/** Path of the machine-readable contract next to a wizard state file. */
export function wizardContractPathFor(stateFile: string): string {
  return `${stateFile}.contract.json`;
}

/**
 * Build the machine-readable contract from the current wizard state, the
 * per-phase status map collected during this invocation, and the resolved exit
 * code (null while running).
 */
export function buildWizardContract(
  state: WizardState,
  options: {
    phaseStatus: Partial<Record<WizardPhase, WizardPhaseStatus>>;
    exitCode: WizardExitCode | null;
    remoteStateConfigured: boolean;
    remoteStateReason?: string;
  },
): WizardContract {
  const order: WizardPhase[] = ['preflight', 'extract', 'build', 'validate', 'deploy', 'qa', 'done'];
  const phases: WizardContractPhase[] = order.map((name) => {
    // Explicit status from this invocation wins; otherwise a phase completed in
    // an earlier run is 'ok', a not-yet-reached phase in a live (exitCode null)
    // contract is 'pending', and anything else in a finished contract is
    // 'skipped' — tooling can distinguish "not reached yet" from "intentionally
    // skipped" and from "ran and failed".
    const status = options.phaseStatus[name]
      ?? (state.completedPhases.includes(name)
        ? 'ok'
        : options.exitCode === null
          ? 'pending'
          : 'skipped');
    return { name, status, artifacts: artifactPathsForPhase(state, name) };
  });

  return {
    schemaVersion: 1,
    target: state.target,
    dryRun: state.dryRun ?? false,
    exitCode: options.exitCode,
    phases,
    optionsForwarded: {
      viewports: state.viewports,
      strictness: state.strictness,
      animations: state.animations,
      fonts: state.fonts,
      sections: state.sections,
      tokenStrategy: state.tokenStrategy,
      responsiveStrategy: state.responsiveStrategy,
      unknownWidgetStrategy: state.unknownWidgetStrategy,
      qa: state.qa,
    },
    optionsAppliedToBuild: {
      strictness: state.strictness,
      animations: state.animations,
      fonts: state.fonts,
      sections: state.sections,
    },
    artifactPaths: {
      ...(state.sourceSpecPath ? { sourceSpec: state.sourceSpecPath } : {}),
      ...(state.treePath ? { tree: state.treePath } : {}),
      ...(state.snapshotPath ? { snapshot: state.snapshotPath } : {}),
      ...(state.permalink ? { permalink: state.permalink } : {}),
    },
    remoteState: {
      configured: options.remoteStateConfigured,
      ...(options.remoteStateReason ? { reason: options.remoteStateReason } : {}),
    },
  };
}

/** Write the contract to disk next to the state file. */
export function writeWizardContract(contract: WizardContract, contractPath: string): void {
  mkdirSync(resolve(contractPath, '..'), { recursive: true });
  writeFileSync(contractPath, JSON.stringify(contract, null, 2), 'utf-8');
}

function artifactPathsForPhase(state: WizardState, phase: WizardPhase): string[] {
  switch (phase) {
    case 'extract':
      return state.sourceSpecPath ? [state.sourceSpecPath] : [];
    case 'build':
      return state.treePath ? [state.treePath] : [];
    case 'deploy':
      return [state.snapshotPath, state.permalink].filter((p): p is string => Boolean(p));
    default:
      return [];
  }
}
