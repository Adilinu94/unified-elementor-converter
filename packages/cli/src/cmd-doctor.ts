/**
 * elconv doctor — Run preflight checks against a target.
 * Validates MCP connectivity, tree integrity, and target-specific requirements.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertNoContamination, runGuards } from '@elconv/core';
import { V3_GUARDS } from '@elconv/target-v3';
import { V4_GUARDS } from '@elconv/target-v4';
import {
  McpAdapter,
  diffAbilityRegistry,
  getTarget,
  buildAuthHeader,
  verifyLargeDeployContract,
  LARGE_DEPLOY_VERIFY_EXIT_CODES,
  type LargeDeployVerificationReport,
} from '@elconv/mcp';
import { requireFlag, optionalFlag, boolFlag } from './args.js';
import {
  readWizardContract,
  wizardContractPathFor,
  stateFileForContractPath,
  WIZARD_EXIT_CODES,
} from './wizard-contract.js';
import type {
  WizardContractPhaseName,
  WizardContractPhaseStatus,
} from '@elconv/core';
import { DEFAULT_STATE_FILE } from './cmd-wizard.js';

export interface PreflightCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  message?: string;
}

export interface PreflightReport {
  target: 'v3' | 'v4';
  checks: PreflightCheck[];
  passed: boolean;
  timestamp: string;
}

export async function cmdDoctor(flags: Record<string, string | boolean>): Promise<number> {
  // --wizard-contract <state-file>: check the machine-readable contract next
  // to a wizard state file without resuming (reads, soft-migrates pre-O-12
  // artifacts, validates). Standalone — no --target needed.
  const wizardContractFlag = flags['wizard-contract'];
  if (wizardContractFlag !== undefined) {
    if (typeof wizardContractFlag !== 'string' || wizardContractFlag === '') {
      process.stderr.write('Error: --wizard-contract requires a wizard state-file path.\n');
      return WIZARD_EXIT_CODES.USAGE;
    }
    return doctorWizardContract(wizardContractFlag, boolFlag(flags, 'json'));
  }

  // --wizard-contracts <dir>: auto-discover state/contract pairs in a directory
  // (recursive) and check each without an explicit path.
  const wizardContractsDirFlag = flags['wizard-contracts'];
  if (wizardContractsDirFlag !== undefined) {
    if (typeof wizardContractsDirFlag !== 'string' || wizardContractsDirFlag === '') {
      process.stderr.write('Error: --wizard-contracts requires a directory path.\n');
      return WIZARD_EXIT_CODES.USAGE;
    }
    return doctorWizardContracts(wizardContractsDirFlag, boolFlag(flags, 'json'));
  }

  // --sync-abilities: diff the live server against the frozen registry snapshot.
  if (flags['sync-abilities']) {
    return syncAbilities(flags);
  }

  // --verify-large-deploy: fetch the live schemas of the frozen large-deploy
  // contract's abilities and compare them against the plan. Diagnostic only —
  // the productive gate stays closed (requiresLiveRoundtrip).
  if (flags['verify-large-deploy']) {
    return verifyLargeDeploy(flags);
  }

  const target = requireFlag(flags, 'target') as 'v3' | 'v4';
  if (target !== 'v3' && target !== 'v4') {
    process.stderr.write(`Error: --target must be "v3" or "v4"\n`);
    return 2;
  }

  const mcpUrl = optionalFlag(flags, 'mcp-url');
  const treePath = optionalFlag(flags, 'tree');

  const checks: PreflightCheck[] = [];

  // Check 1: MCP reachable (skip if no URL)
  if (mcpUrl) {
    try {
      const res = await fetch(mcpUrl, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'greet', id: 1 }), headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000) });
      checks.push({ id: 'mcp_reachable', label: 'MCP reachable', status: res.ok ? 'pass' : 'fail', message: `HTTP ${res.status}` });
    } catch (err) {
      checks.push({ id: 'mcp_reachable', label: 'MCP reachable', status: 'fail', message: (err as Error).message });
    }
  } else {
    checks.push({ id: 'mcp_reachable', label: 'MCP reachable', status: 'skip', message: 'No --mcp-url provided' });
  }

  // Check 2: Tree validation (if provided)
  if (treePath) {
    try {
      const raw = readFileSync(resolve(treePath), 'utf-8');
      const tree = JSON.parse(raw);

      // Contamination check
      try {
        assertNoContamination(tree, target);
        checks.push({ id: 'contamination', label: 'No cross-contamination', status: 'pass' });
      } catch (err) {
        checks.push({ id: 'contamination', label: 'No cross-contamination', status: 'fail', message: (err as Error).message });
      }

      // Guard score
      const guards = target === 'v3' ? V3_GUARDS : V4_GUARDS;
      const report = runGuards(tree, guards);
      checks.push({
        id: 'tree_guards',
        label: `Guard score ≥ ${report.threshold}`,
        status: report.passed ? 'pass' : 'fail',
        message: `Score: ${report.score}/100`,
      });

      // Tree size
      const bytes = Buffer.byteLength(raw);
      const sizeStatus = bytes > 1_200_000 ? 'fail' : bytes > 400_000 ? 'warn' : 'pass';
      checks.push({ id: 'tree_size', label: 'Tree size', status: sizeStatus, message: `${(bytes / 1024).toFixed(1)} KB` });
    } catch (err) {
      checks.push({ id: 'tree_parse', label: 'Tree JSON parse', status: 'fail', message: (err as Error).message });
    }
  } else {
    checks.push({ id: 'tree_parse', label: 'Tree validation', status: 'skip', message: 'No --tree provided' });
  }

  // Check 3: V4-specific — experiments active
  if (target === 'v4') {
    if (mcpUrl) {
      checks.push({ id: 'v4_experiments', label: 'V4 experiments active', status: 'warn', message: 'Cannot verify without MCP elementor-get-settings' });
    } else {
      checks.push({ id: 'v4_experiments', label: 'V4 experiments active', status: 'skip' });
    }
  }

  // Build report
  const hasFail = checks.some((c) => c.status === 'fail');
  const report: PreflightReport = {
    target,
    checks,
    passed: !hasFail,
    timestamp: new Date().toISOString(),
  };

  // Output
  process.stdout.write(`\n🩺 elconv doctor — target: ${target.toUpperCase()}\n${'─'.repeat(50)}\n`);
  for (const check of checks) {
    const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : check.status === 'fail' ? '✗' : '○';
    const msg = check.message ? ` — ${check.message}` : '';
    process.stdout.write(`  ${icon} ${check.label}${msg}\n`);
  }
  process.stdout.write(`${'─'.repeat(50)}\n`);
  process.stdout.write(`  Result: ${report.passed ? 'PASS' : 'FAIL'}\n\n`);

  return hasFail ? 1 : 0;
}

/**
 * elconv doctor --sync-abilities — call the live server's discover-abilities
 * and diff it against the frozen KNOWN_ABILITIES snapshot, surfacing drift.
 *
 * Auth: --target-name <name> (uses the stored target's authEnv) OR
 *       --mcp-url <url> --auth-env <ENV_VAR_NAME> (env holds "user:app-password").
 */
// ============================================================================
// Wizard-contract check (O-12 doctor wiring)
// ============================================================================

export interface WizardStateConsistencyCheck {
  /** The wizard state file that was checked. */
  stateFile: string;
  /** True when the state file exists and could be read. */
  stateFileReadable: boolean;
  /** True when the state file parsed as a JSON object. */
  stateValidJson: boolean;
  /** Defensively extracted summary of the state file (present when readable). */
  state?: {
    target?: string;
    currentPhase?: string;
    completedPhases?: string[];
    startedAt?: string;
    updatedAt?: string;
  };
  /** Signed seconds between the state's updatedAt and the contract's write time (positive = state newer, contract stale). */
  stateContractDeltaSeconds?: number;
  /** Human-readable consistency findings (empty when consistent). */
  issues: string[];
  /** True when the state file was readable, valid JSON, and produced no issues. */
  consistent: boolean;
}

export interface WizardContractCheckReport {
  /**
   * The contract artifact is valid after reading/migration AND, when the state
   * file is readable, the state/contract consistency check passed (exit 0).
   */
  ok: boolean;
  /** Resolved contract path (`<state-file>.contract.json`). */
  contractPath: string;
  /** True when the artifact was a pre-O-12 file that got soft-migrated. */
  migrated: boolean;
  /** Migration notes (empty when the artifact was already current). */
  notes: string[];
  /** Read/JSON/validation errors (empty when ok). */
  errors: string[];
  /** Doctor exit code: 0 ok, 1 invalid/missing/inconsistent, 2 usage. */
  exitCode: number;
  /** Machine-readable summary of the validated contract (present when ok). */
  contractSummary?: {
    schemaVersion: number;
    $schema: string;
    target: 'v3' | 'v4';
    dryRun: boolean;
    exitCode: number | null;
    phases: { name: WizardContractPhaseName; status: WizardContractPhaseStatus; error?: string }[];
    remoteState: { configured: boolean; reason?: string };
  };
  /** State/contract consistency result (present when the contract validated). */
  stateCheck?: WizardStateConsistencyCheck;
}

/**
 * Read, soft-migrate and validate the `wizard-contract.json` next to a wizard
 * state file — without resuming the wizard. Uses the exact same
 * `readWizardContract` path as `reportWizardContractOnResume`, so a pre-O-12
 * artifact is upgraded with the same migration and any artifact validates
 * against the versioned schema. Never throws; failures (missing file, broken
 * JSON, wrong schema version, still-invalid after migration) are reported as
 * `ok: false` with exit code 1.
 */
const WIZARD_PHASES: readonly string[] = ['preflight', 'extract', 'build', 'validate', 'deploy', 'qa', 'done'];
const CONTRACT_STALENESS_TOLERANCE_SECONDS = 5;

/**
 * Cross-check a wizard state file against the validated contract it sits next
 * to. The state file (`<state-file>.json`) holds the run's live position
 * (`currentPhase`, `completedPhases`, `updatedAt`); the contract
 * (`<state-file>.contract.json`) holds the last persisted machine-readable
 * view. Both are written together by the wizard (state first, contract after),
 * so a meaningful mismatch is a real drift signal:
 *
 *  - target coherence (a hand-edited pair cannot silently disagree)
 *  - phase/exit-code coherence (exit 0 ⇒ state reached 'done'; a failed run
 *    ⇒ the state sits on the failed phase)
 *  - completedPhases vs per-phase status (an 'ok' phase must be completed;
 *    a completed phase must not be 'pending'/'failed' — 'done' is exempt, it
 *    is never in completedPhases)
 *  - timestamp coherence (the state updated significantly after the contract
 *    was written ⇒ the contract is stale, e.g. a failed contract write)
 *
 * A missing state file is a legitimately skippable check (the contract alone
 * can be audited); a broken state file is a finding. Never throws.
 */
export function checkWizardStateConsistency(
  stateFile: string,
  contractPath: string,
  contract: { target: 'v3' | 'v4'; exitCode: number | null; phases: { name: string; status: string }[] },
): WizardStateConsistencyCheck {
  const issues: string[] = [];
  let raw: string;
  try {
    raw = readFileSync(stateFile, 'utf-8');
  } catch {
    return { stateFile, stateFileReadable: false, stateValidJson: false, issues: [], consistent: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      stateFile,
      stateFileReadable: true,
      stateValidJson: false,
      issues: [`Invalid JSON in state file ${stateFile}: ${err instanceof Error ? err.message : String(err)}`],
      consistent: false,
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      stateFile,
      stateFileReadable: true,
      stateValidJson: false,
      issues: [`State file ${stateFile} must be a JSON object`],
      consistent: false,
    };
  }

  const record = parsed as Record<string, unknown>;
  const stateTarget = typeof record.target === 'string' ? record.target : undefined;
  const stateCurrentPhase = typeof record.currentPhase === 'string' ? record.currentPhase : undefined;
  const stateCompletedPhases = Array.isArray(record.completedPhases)
    ? record.completedPhases.filter((p): p is string => typeof p === 'string')
    : [];
  const stateStartedAt = typeof record.startedAt === 'string' ? record.startedAt : undefined;
  const stateUpdatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : undefined;

  // Target coherence.
  if (stateTarget !== undefined && stateTarget !== contract.target) {
    issues.push(`state file target '${stateTarget}' does not match contract target '${contract.target}'`);
  }

  // Phase/exit-code coherence.
  const exitCode = contract.exitCode;
  if (exitCode === 0 && stateCurrentPhase !== 'done') {
    issues.push(
      `contract exit code 0 says the run finished, but the state file is still at phase '${stateCurrentPhase ?? '(missing)'}'`,
    );
  }
  if (exitCode === null && stateCurrentPhase === 'done') {
    issues.push('contract exit code null says the run is still running, but the state file reached done');
  }
  if (exitCode === 1) {
    const failed = contract.phases.filter((p) => p.status === 'failed').map((p) => p.name);
    if (failed.length === 0) {
      // The wizard itself can write this pair: a state-persistence failure after
      // a successful phase leaves the contract at exit 1 without a failed phase
      // while the state file has already advanced — flag the mismatch honestly.
      issues.push('contract exit code 1 but no phase is marked failed (a state-persistence failure can produce this)');
    } else if (stateCurrentPhase !== undefined && !failed.includes(stateCurrentPhase)) {
      issues.push(`contract marks ${failed.join(', ')} as failed, but the state file is at '${stateCurrentPhase}'`);
    }
  }
  if (stateCurrentPhase !== undefined && stateCurrentPhase !== 'done' && !WIZARD_PHASES.includes(stateCurrentPhase)) {
    issues.push(`state file has unknown currentPhase '${stateCurrentPhase}'`);
  }

  // completedPhases vs per-phase status ('done' is never in completedPhases).
  for (const phase of contract.phases) {
    const completed = stateCompletedPhases.includes(phase.name);
    if (phase.status === 'ok' && !completed && phase.name !== 'done') {
      issues.push(`contract marks phase ${phase.name} as ok, but it is not in the state's completedPhases`);
    }
    if (completed && (phase.status === 'pending' || phase.status === 'failed')) {
      issues.push(`state completed phase ${phase.name}, but the contract marks it ${phase.status}`);
    }
  }

  // Timestamp coherence: state.updatedAt vs the contract's write time. A state
  // meaningfully newer than the contract means the contract was not rewritten
  // after the last state save (stale artifact).
  let stateContractDeltaSeconds: number | undefined;
  if (stateUpdatedAt !== undefined) {
    const stateMs = Date.parse(stateUpdatedAt);
    if (Number.isNaN(stateMs)) {
      issues.push(`state file updatedAt '${stateUpdatedAt}' is not a valid ISO timestamp`);
    } else {
      const contractMs = statSync(contractPath).mtimeMs;
      stateContractDeltaSeconds = Math.round((stateMs - contractMs) / 1000);
      if (stateContractDeltaSeconds > CONTRACT_STALENESS_TOLERANCE_SECONDS) {
        issues.push(
          `state file was updated ${stateContractDeltaSeconds}s after the contract was written (contract may be stale)`,
        );
      }
    }
  }

  return {
    stateFile,
    stateFileReadable: true,
    stateValidJson: true,
    state: {
      target: stateTarget,
      currentPhase: stateCurrentPhase,
      completedPhases: stateCompletedPhases,
      startedAt: stateStartedAt,
      updatedAt: stateUpdatedAt,
    },
    stateContractDeltaSeconds,
    issues,
    consistent: issues.length === 0,
  };
}

export function checkWizardContract(stateFile: string): WizardContractCheckReport {
  const contractPath = wizardContractPathFor(stateFile);
  const result = readWizardContract(contractPath);
  if (!result.ok) {
    return {
      ok: false,
      contractPath,
      migrated: false,
      notes: [],
      errors: result.errors,
      exitCode: WIZARD_EXIT_CODES.PHASE_FAILED,
    };
  }
  const { contract, migrated, notes } = result.migration;
  const stateCheck = checkWizardStateConsistency(stateFile, contractPath, contract);
  // A missing state file is a legitimately skippable check (the contract alone
  // stays auditable) — it is omitted from the report rather than reported as
  // inconsistent; a broken or inconsistent state file makes the check fail.
  const ok = stateCheck.stateFileReadable ? stateCheck.consistent : true;
  return {
    ok,
    contractPath,
    migrated,
    notes,
    errors: [],
    exitCode: ok ? WIZARD_EXIT_CODES.OK : WIZARD_EXIT_CODES.PHASE_FAILED,
    contractSummary: {
      schemaVersion: contract.schemaVersion,
      $schema: contract.$schema,
      target: contract.target,
      dryRun: contract.dryRun,
      exitCode: contract.exitCode,
      phases: contract.phases.map((p) => ({
        name: p.name,
        status: p.status,
        ...(p.error ? { error: p.error } : {}),
      })),
      remoteState: contract.remoteState,
    },
    stateCheck: stateCheck.stateFileReadable ? stateCheck : undefined,
  };
}

function doctorWizardContract(stateFile: string, json: boolean): number {
  const report = checkWizardContract(stateFile);
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.exitCode;
  }

  process.stdout.write(`\n🩺 elconv doctor — wizard contract check\n${'─'.repeat(50)}\n`);
  if (report.ok) {
    const s = report.contractSummary;
    if (report.migrated) {
      process.stdout.write(
        `  ✓ wizard-contract ${report.contractPath} migrated from pre-O-12 (${report.notes.length} change(s) applied)\n`,
      );
    } else {
      process.stdout.write(
        `  ✓ wizard-contract ${report.contractPath} valid (${s?.$schema ?? '?'}, schemaVersion ${s?.schemaVersion ?? '?'})\n`,
      );
    }
    if (s) {
      process.stdout.write(`  Target: ${s.target.toUpperCase()} | Exit code: ${s.exitCode ?? 'running'} | Dry-run: ${String(s.dryRun)}\n`);
      process.stdout.write(`  Phases: ${s.phases.map((p) => `${p.name}:${p.status}`).join(' ')}\n`);
      process.stdout.write(
        `  Remote state: configured=${String(s.remoteState.configured)}${s.remoteState.reason ? ` (${s.remoteState.reason})` : ''}\n`,
      );
    }
  } else {
    process.stdout.write(`  ✗ wizard-contract ${report.contractPath} invalid:\n`);
    for (const err of report.errors) process.stdout.write(`      - ${err}\n`);
  }
  if (report.stateCheck) {
    const s = report.stateCheck;
    if (s.consistent) {
      process.stdout.write(`  ✓ state ${s.stateFile} consistent with contract\n`);
    } else {
      process.stdout.write(`  ✗ state ${s.stateFile} inconsistent with contract:\n`);
      for (const issue of s.issues) process.stdout.write(`      - ${issue}\n`);
    }
  }
  process.stdout.write(`${'─'.repeat(50)}\n`);
  process.stdout.write(`  Result: ${report.ok ? 'PASS' : 'FAIL'}\n\n`);
  return report.exitCode;
}

// ============================================================================
// Wizard-contract auto-discovery (doctor)
// ============================================================================

export interface WizardContractsDirReport {
  /** The scanned directory. */
  dir: string;
  /** Scan-level errors (e.g. directory not found); empty when the scan ran. */
  errors: string[];
  /** One check per discovered state/contract pair. */
  checks: WizardContractCheckReport[];
  summary: { total: number; ok: number; failed: number };
  /** 0 all pairs ok (and at least one found), 1 any failed, nothing found, or scan error. */
  exitCode: number;
}

/**
 * Recursively find wizard state files that have a machine-readable contract
 * next to them. Two anchors:
 *
 *  - contract-driven: the wizard writes every contract as
 *    `<state-file>.contract.json`, so stripping the suffix yields the state
 *    file (pair discovery);
 *  - state-driven: the default state file `.elconv-wizard-state.json` at the
 *    scanned directory's top level is added even without a contract, so an
 *    orphan state file is still checked (its missing contract is then an
 *    honest finding).
 *
 * Deterministic: results deduplicated and sorted. A missing directory yields
 * no pairs; the caller reports it as an error. Subdirectory read failures are
 * collected into `errors` instead of being silently skipped.
 */
export function findWizardContractPairs(dir: string): { pairs: string[]; errors: string[] } {
  const states = new Set<string>();
  const errors: string[] = [];
  // Explicit recursive walk instead of `readdirSync(recursive)` so the
  // directory of every entry is tracked deterministically regardless of how
  // the runtime composes recursive entry names (basename vs relative path).
  const walk = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (err) {
      errors.push(`Cannot read directory ${current}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.contract.json')) {
        states.add(join(current, stateFileForContractPath(entry.name)));
      }
    }
  };
  walk(dir);
  // Secondary anchor: the default state file at the top level is checked even
  // when its contract is missing (an orphan is an honest finding).
  const defaultState = join(dir, DEFAULT_STATE_FILE);
  if (existsSync(defaultState)) states.add(defaultState);
  return { pairs: [...states].sort(), errors };
}

/**
 * Discover all state/contract pairs in a directory (recursive), check each via
 * `checkWizardContract` (contract + state consistency) and aggregate the
 * results. Exit code: 0 when at least one pair was found and all passed;
 * 1 when the directory is missing, nothing was found, or any pair failed.
 */
export function checkWizardContractsInDir(dir: string): WizardContractsDirReport {
  if (!existsSync(dir)) {
    return {
      dir,
      errors: [`Directory not found: ${dir}`],
      checks: [],
      summary: { total: 0, ok: 0, failed: 0 },
      exitCode: WIZARD_EXIT_CODES.PHASE_FAILED,
    };
  }
  const { pairs, errors } = findWizardContractPairs(dir);
  const checks = pairs.map((stateFile) => checkWizardContract(stateFile));
  const failed = checks.filter((c) => !c.ok).length;
  return {
    dir,
    errors,
    checks,
    summary: { total: checks.length, ok: checks.length - failed, failed },
    exitCode:
      checks.length === 0 || failed > 0 ? WIZARD_EXIT_CODES.PHASE_FAILED : WIZARD_EXIT_CODES.OK,
  };
}

function doctorWizardContracts(dir: string, json: boolean): number {
  const report = checkWizardContractsInDir(dir);
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.exitCode;
  }

  process.stdout.write(`\n🩺 elconv doctor — wizard contracts in ${dir}\n${'─'.repeat(50)}\n`);
  if (report.errors.length > 0) {
    for (const err of report.errors) process.stdout.write(`  ✗ ${err}\n`);
  } else if (report.checks.length === 0) {
    process.stdout.write('  ○ no wizard contract pairs found\n');
  } else {
    for (const check of report.checks) {
      const stateCheck = check.stateCheck;
      if (check.ok) {
        const migration = check.migrated ? ` (migrated, ${check.notes.length} change(s))` : '';
        const statePart = stateCheck
          ? stateCheck.consistent
            ? ' + state consistent'
            : ' + state INCONSISTENT'
          : ' (state check skipped)';
        process.stdout.write(`  ✓ ${check.contractPath} valid${migration}${statePart}\n`);
      } else if (check.errors.length > 0) {
        process.stdout.write(`  ✗ ${check.contractPath} invalid: ${check.errors[0]}\n`);
      } else {
        process.stdout.write(`  ✗ ${check.contractPath} inconsistent: ${stateCheck?.issues[0] ?? 'state issue'}\n`);
      }
    }
  }
  process.stdout.write(`${'─'.repeat(50)}\n`);
  process.stdout.write(`  Result: ${report.summary.total} pair(s), ${report.summary.ok} PASS, ${report.summary.failed} FAIL\n\n`);
  return report.exitCode;
}

// ============================================================================
// Ability sync (--sync-abilities)
// ============================================================================

/** Doctor exit codes for the ability-sync command (not a wizard command). */
const SYNC_EXIT_CODES = { OK: 0, FAILED: 1, USAGE: 2 } as const;

interface DoctorAuth {
  baseUrl: string;
  authHeader: string;
  authMode: 'target-name' | 'mcp-url-auth-env';
  targetName?: string;
}

/**
 * Shared credential resolution for doctor commands that probe the live server
 * (`--sync-abilities`, `--verify-large-deploy`): `--target-name <name>` uses
 * the stored target's authEnv, otherwise `--mcp-url <url> --auth-env <ENV>`
 * must both be present with the env var holding "user:app-password". Never
 * throws; returns a structured error so the caller controls output and code.
 */
function resolveDoctorAuth(
  flags: Record<string, string | boolean>,
  commandLabel: string,
): { ok: true; auth: DoctorAuth } | { ok: false; error: string } {
  const targetNameFlag = optionalFlag(flags, 'target-name');
  try {
    if (targetNameFlag) {
      const t = getTarget(targetNameFlag);
      return {
        ok: true,
        auth: {
          baseUrl: t.mcpEndpoint,
          authHeader: buildAuthHeader(t),
          authMode: 'target-name',
          targetName: targetNameFlag,
        },
      };
    }
    const mcpUrl = optionalFlag(flags, 'mcp-url');
    const authEnv = optionalFlag(flags, 'auth-env');
    if (!mcpUrl || !authEnv) {
      return {
        ok: false,
        error: `--${commandLabel} needs either --target-name <name> or --mcp-url <url> --auth-env <ENV_VAR>.`,
      };
    }
    const creds = process.env[authEnv];
    if (!creds) {
      return {
        ok: false,
        error: `env var "${authEnv}" is not set (expected "user:app-password").`,
      };
    }
    return {
      ok: true,
      auth: {
        baseUrl: mcpUrl,
        authHeader: `Basic ${Buffer.from(creds).toString('base64')}`,
        authMode: 'mcp-url-auth-env',
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Successful, machine-readable ability-sync report. */
export interface AbilitySyncSuccessReport {
  ok: true;
  inSync: boolean;
  liveCount: number;
  snapshotCount: number;
  addedOnServer: string[];
  removedFromServer: string[];
  nowAvailable: string[];
  /** How credentials were resolved. */
  authMode: 'target-name' | 'mcp-url-auth-env';
  /** Resolved target profile name (present when authMode is target-name). */
  targetName?: string;
  /** ISO timestamp of the live discovery. */
  timestamp: string;
  /** Doctor exit code: 0 in sync, 1 drift. */
  exitCode: number;
}

/**
 * Machine-readable ability-sync report. On success (`ok: true`) it mirrors the
 * `AbilityDriftReport` plus credential metadata and the doctor exit code; on a
 * live discovery failure (`ok: false`) it carries the error and exit 1. Usage
 * errors (exit 2) return before any report is built.
 */
export type AbilitySyncReport = { ok: false; error: string; exitCode: number } | AbilitySyncSuccessReport;

/**
 * Build the machine-readable ability-sync report from a live ability list.
 * Pure and deterministic: delegates the drift computation to
 * `diffAbilityRegistry` (frozen registry snapshot as reference).
 */
export function buildAbilitySyncReport(
  live: readonly string[],
  options: { authMode: 'target-name' | 'mcp-url-auth-env'; targetName?: string; timestamp?: string },
): AbilitySyncSuccessReport {
  const drift = diffAbilityRegistry(live);
  return {
    ok: true,
    inSync: drift.inSync,
    liveCount: drift.liveCount,
    snapshotCount: drift.snapshotCount,
    addedOnServer: [...drift.addedOnServer],
    removedFromServer: [...drift.removedFromServer],
    nowAvailable: [...drift.nowAvailable],
    authMode: options.authMode,
    ...(options.targetName ? { targetName: options.targetName } : {}),
    timestamp: options.timestamp ?? new Date().toISOString(),
    exitCode: drift.inSync ? SYNC_EXIT_CODES.OK : SYNC_EXIT_CODES.FAILED,
  };
}

/**
 * elconv doctor --sync-abilities — call the live server's discover-abilities
 * and diff it against the frozen KNOWN_ABILITIES snapshot, surfacing drift.
 * `--json` emits the machine-readable `AbilitySyncReport` for CI. The optional
 * `listAbilities` dependency injects the live probe so tests run fully offline.
 *
 * Auth: --target-name <name> (uses the stored target's authEnv) OR
 *       --mcp-url <url> --auth-env <ENV_VAR_NAME> (env holds "user:app-password").
 */
export async function syncAbilities(
  flags: Record<string, string | boolean>,
  dependencies: { listAbilities?: (adapter: McpAdapter) => Promise<string[]> } = {},
): Promise<number> {
  const json = boolFlag(flags, 'json');
  const resolved = resolveDoctorAuth(flags, 'sync-abilities');
  if (!resolved.ok) {
    process.stderr.write(`Error: ${resolved.error}\n`);
    return SYNC_EXIT_CODES.USAGE;
  }
  const { baseUrl, authHeader, authMode, targetName } = resolved.auth;

  const adapter = new McpAdapter({ baseUrl, authHeader });
  let live: string[];
  try {
    live = dependencies.listAbilities
      ? await dependencies.listAbilities(adapter)
      : await adapter.listAbilities();
  } catch (err) {
    const message = `discover-abilities failed: ${err instanceof Error ? err.message : String(err)}`;
    if (json) {
      const report: AbilitySyncReport = { ok: false, error: message, exitCode: SYNC_EXIT_CODES.FAILED };
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return report.exitCode;
    }
    process.stderr.write(`Error: ${message}\n`);
    return SYNC_EXIT_CODES.FAILED;
  }

  const report = buildAbilitySyncReport(live, { authMode, targetName });
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.exitCode;
  }

  process.stdout.write(`\n🔄 Novamira ability sync\n${'─'.repeat(50)}\n`);
  process.stdout.write(`  Live: ${report.liveCount}   Snapshot: ${report.snapshotCount}\n`);
  if (report.inSync) {
    process.stdout.write('  ✓ Registry is in sync with the live server.\n');
  } else {
    if (report.addedOnServer.length > 0) {
      process.stdout.write(`\n  + New on server (add to KNOWN_ABILITIES): ${report.addedOnServer.length}\n`);
      for (const n of report.addedOnServer) process.stdout.write(`      + ${n}\n`);
    }
    if (report.removedFromServer.length > 0) {
      process.stdout.write(`\n  - Removed from server (stale in snapshot): ${report.removedFromServer.length}\n`);
      for (const n of report.removedFromServer) process.stdout.write(`      - ${n}\n`);
    }
  }
  if (report.nowAvailable.length > 0) {
    process.stdout.write(`\n  ★ Previously-unavailable, now live (close the gap): ${report.nowAvailable.length}\n`);
    for (const n of report.nowAvailable) process.stdout.write(`      ★ ${n}\n`);
  }
  process.stdout.write(`${'─'.repeat(50)}\n\n`);

  return report.exitCode;
}

// ============================================================================
// Large-deploy contract verification (--verify-large-deploy)
// ============================================================================

/**
 * elconv doctor --verify-large-deploy — fetch the live input schemas of the
 * four abilities the frozen upload-php/split contract calls (via
 * `mcp-adapter-get-ability-info`) and compare them against the contract
 * derived from `planLargeDeploy`. Diagnostic only: the productive gate stays
 * closed (`requiresLiveRoundtrip: true`) — deploy.ts keeps refusing both
 * strategies until the controlled live roundtrip against the released test
 * target. `--json` emits the machine-readable report; the optional
 * `getAbilityInfo` dependency injects the live probe so tests run fully
 * offline. Same auth contract as --sync-abilities.
 */
export async function verifyLargeDeploy(
  flags: Record<string, string | boolean>,
  dependencies: {
    getAbilityInfo?: (adapter: McpAdapter, abilityName: string) => Promise<unknown>;
  } = {},
): Promise<number> {
  const json = boolFlag(flags, 'json');
  const resolved = resolveDoctorAuth(flags, 'verify-large-deploy');
  if (!resolved.ok) {
    process.stderr.write(`Error: ${resolved.error}\n`);
    return LARGE_DEPLOY_VERIFY_EXIT_CODES.USAGE;
  }
  const { baseUrl, authHeader, authMode, targetName } = resolved.auth;

  const adapter = new McpAdapter({ baseUrl, authHeader });
  const getAbilityInfo = dependencies.getAbilityInfo ?? ((a: McpAdapter, n: string) => a.getAbilityInfo(n));

  let report: LargeDeployVerificationReport;
  try {
    report = await verifyLargeDeployContract(getAbilityInfo, adapter, { authMode, targetName });
  } catch (err) {
    const message = `large-deploy verification failed: ${err instanceof Error ? err.message : String(err)}`;
    if (json) {
      const failure: { ok: false; error: string; exitCode: number } = {
        ok: false,
        error: message,
        exitCode: LARGE_DEPLOY_VERIFY_EXIT_CODES.FAILED,
      };
      process.stdout.write(`${JSON.stringify(failure, null, 2)}\n`);
      return failure.exitCode;
    }
    process.stderr.write(`Error: ${message}\n`);
    return LARGE_DEPLOY_VERIFY_EXIT_CODES.FAILED;
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.exitCode;
  }

  process.stdout.write(`\n🩺 elconv doctor — large-deploy schema verification\n${'─'.repeat(50)}\n`);
  for (const check of report.checks) {
    if (check.status === 'unavailable') {
      process.stdout.write(`  ✗ ${check.ability} (${check.kind}): unavailable — ${check.error ?? 'probe failed'}\n`);
    } else if (!check.matches) {
      process.stdout.write(`  ✗ ${check.ability} (${check.kind}): contract not verified\n`);
      if (!check.shapeRecognized) {
        process.stdout.write('      - live schema shape not recognized\n');
      }
      for (const p of check.missingParams) process.stdout.write(`      - missing param: ${p}\n`);
      if (check.mode && !check.mode.supported && check.mode.issue) {
        process.stdout.write(`      - ${check.mode.issue}\n`);
      }
    } else {
      const modePart = check.mode?.values ? `, mode ${JSON.stringify(check.mode.values)}` : '';
      process.stdout.write(`  ✓ ${check.ability} (${check.kind}): ${check.liveParams.length} params${modePart}\n`);
    }
  }
  process.stdout.write(`${'─'.repeat(50)}\n`);
  process.stdout.write(
    '  Productive gate: CLOSED — requiresLiveRoundtrip (deploy.ts keeps refusing both strategies)\n',
  );
  process.stdout.write(`  Result: ${report.ok ? 'VERIFIED' : 'NOT VERIFIED'}\n\n`);

  return report.exitCode;
}
