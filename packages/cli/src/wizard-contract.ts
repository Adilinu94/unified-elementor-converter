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

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  WIZARD_CONTRACT_SCHEMA_ID,
  migrateWizardContract,
  validateWizardContract,
  type WizardContract,
  type WizardContractMigrationResult,
  type WizardContractPhase,
  type WizardContractPhaseName,
  type WizardContractPhaseStatus,
} from '@elconv/core';
import type {
  WizardPhase,
  WizardState,
} from './cmd-wizard.js';

// Re-export the consolidated contract types (defined by the versioned Zod
// schema in @elconv/core) so existing CLI consumers keep their imports.
export type {
  WizardContract,
  WizardContractPhase,
  WizardOptionsForwarded,
} from '@elconv/core';

/** Machine-readable phase status; canonical enum lives in the core schema. */
export type WizardPhaseStatus = WizardContractPhaseStatus;
/** Canonical phase names (single source: the core schema const array). */
export type WizardPhaseName = WizardContractPhaseName;

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

// ============================================================================
// Contract
// ============================================================================
//
// `WizardContract`, `WizardContractPhase` and `WizardOptionsForwarded` are
// defined by the consolidated, versioned Zod schema in
// `@elconv/core/contracts/wizard-contract.contract.js` (O-12) — the single
// source of truth. The build function below constructs exactly that shape;
// `writeWizardContract` validates every artifact against the schema before
// writing, so a malformed contract can never be persisted.

/** Path of the machine-readable contract next to a wizard state file. */
export function wizardContractPathFor(stateFile: string): string {
  return `${stateFile}.contract.json`;
}

/**
 * Read a `wizard-contract.json` artifact from disk and soft-migrate pre-O-12
 * files (missing `$schema`) so every artifact — old and current — validates
 * against the consolidated versioned schema. Delegates to
 * `migrateWizardContract` in @elconv/core; never throws, file/JSON errors are
 * returned as `{ ok: false, errors }`.
 */
export function readWizardContract(contractPath: string): WizardContractMigrationResult {
  let raw: string;
  try {
    raw = readFileSync(contractPath, 'utf-8');
  } catch (err) {
    return {
      ok: false,
      errors: [`Cannot read wizard contract ${contractPath}: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      errors: [`Invalid JSON in wizard contract ${contractPath}: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  return migrateWizardContract(parsed);
}

/**
 * Build the machine-readable contract from the current wizard state, the
 * per-phase status map collected during this invocation, and the resolved exit
 * code (null while running). The returned object conforms to the consolidated
 * versioned schema (`$schema` references the exact schema document).
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
  // Linked to the canonical phase names so a schema change breaks the build.
  const order: WizardPhaseName[] = ['preflight', 'extract', 'build', 'validate', 'deploy', 'qa', 'done'];
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
    $schema: WIZARD_CONTRACT_SCHEMA_ID,
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

/**
 * Write the contract to disk next to the state file. The artifact is validated
 * against the consolidated versioned schema first — an invalid contract is
 * never persisted (O-12). Callers that treat the contract as best-effort wrap
 * this in try/catch.
 */
export function writeWizardContract(contract: WizardContract, contractPath: string): void {
  const validation = validateWizardContract(contract);
  if (!validation.ok) {
    throw new Error(
      `Refusing to write an invalid wizard contract:\n  - ${validation.errors.join('\n  - ')}`,
    );
  }
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
