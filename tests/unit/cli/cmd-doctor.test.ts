import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { cmdDoctor } from '../../../packages/cli/src/cmd-doctor.js';
import { createWizardState } from '../../../packages/cli/src/cmd-wizard.js';
import {
  buildWizardContract,
  wizardContractPathFor,
} from '../../../packages/cli/src/wizard-contract.js';

/**
 * elconv doctor --wizard-contract <state-file> — standalone check of the
 * machine-readable wizard contract next to a state file, without resuming the
 * wizard. Mirrors the resume-path wiring (`reportWizardContractOnResume`) but
 * as a doctor check with exit codes: 0 valid/migrated, 1 invalid/missing,
 * 2 usage. `--json` emits the machine-readable report.
 */

function tmpRoot(): string {
  return join(tmpdir(), `elconv-doctor-contract-${Math.random().toString(36).slice(2)}`);
}

function contractState(target: 'v3' | 'v4' = 'v3', root: string) {
  const state = createWizardState({
    target,
    html: './page.html',
    out: join(root, 'tree.json'),
    strictness: 'pixel-perfect',
    animations: 'css',
    fonts: 'system',
  });
  state.currentPhase = 'done';
  state.completedPhases = ['preflight', 'extract', 'build', 'validate', 'deploy', 'qa', 'done'];
  return state;
}

function writeContractFor(stateFile: string, contract: unknown): void {
  writeFileSync(wizardContractPathFor(stateFile), JSON.stringify(contract, null, 2), 'utf8');
}

describe('cmdDoctor — --wizard-contract check', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stdoutCalls(): string {
    return vi.mocked(process.stdout.write).mock.calls.map((c) => String(c[0])).join('');
  }

  it('confirms a current-format contract as valid with exit code 0', async () => {
    const root = tmpRoot();
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      const contract = buildWizardContract(contractState('v3', root), {
        phaseStatus: { done: 'ok' },
        exitCode: 0,
        remoteStateConfigured: false,
      });
      writeContractFor(stateFile, contract);

      const code = await cmdDoctor({ 'wizard-contract': stateFile });
      expect(code).toBe(0);
      const out = stdoutCalls();
      expect(out).toContain('valid');
      expect(out).toContain('elconv/wizard-contract/v1');
      expect(out).toContain('schemaVersion 1');
      expect(out).toContain('Target: V3');
      expect(out).toContain('Phases:');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('soft-migrates a pre-O-12 contract (missing $schema) and reports it as migrated', async () => {
    const root = tmpRoot();
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      const contract = buildWizardContract(contractState('v4', root), {
        phaseStatus: { done: 'ok' },
        exitCode: 0,
        remoteStateConfigured: false,
      }) as unknown as Record<string, unknown> & { $schema?: string };
      delete contract.$schema;
      writeContractFor(stateFile, contract);

      const code = await cmdDoctor({ 'wizard-contract': stateFile });
      expect(code).toBe(0);
      const out = stdoutCalls();
      expect(out).toContain('migrated from pre-O-12');
      expect(out).toContain('change(s) applied');
      expect(out).toContain('Target: V4');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports an invalid contract with exit code 1', async () => {
    const root = tmpRoot();
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      writeContractFor(stateFile, { schemaVersion: 9 }); // unsupported machine gate
      const code = await cmdDoctor({ 'wizard-contract': stateFile });
      expect(code).toBe(1);
      expect(stdoutCalls()).toContain('invalid');
      expect(stdoutCalls()).toContain('Result: FAIL');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports a missing contract with exit code 1', async () => {
    const root = tmpRoot();
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      const code = await cmdDoctor({ 'wizard-contract': stateFile });
      expect(code).toBe(1);
      expect(stdoutCalls()).toContain('invalid');
      expect(stdoutCalls()).toContain('Cannot read');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns exit code 2 when --wizard-contract is passed without a value', async () => {
    const code = await cmdDoctor({ 'wizard-contract': true });
    expect(code).toBe(2);
    expect(vi.mocked(process.stderr.write).mock.calls.map((c) => String(c[0])).join('')).toContain(
      'requires a wizard state-file path',
    );
  });

  it('emits a machine-readable JSON report with --json', async () => {
    const root = tmpRoot();
    const stateFile = join(root, 'state.json');
    mkdirSync(root, { recursive: true });
    try {
      const contract = buildWizardContract(contractState('v3', root), {
        phaseStatus: { done: 'ok' },
        exitCode: 0,
        remoteStateConfigured: true,
        remoteStateReason: 'verified mock adapter (offline)',
      });
      (contract.phases[0] as { error?: string }).error = 'preflight failed'; // diagnostic passthrough
      writeContractFor(stateFile, contract);

      const code = await cmdDoctor({ 'wizard-contract': stateFile, json: true });
      expect(code).toBe(0);
      const parsed = JSON.parse(stdoutCalls()) as {
        ok: boolean;
        contractPath: string;
        migrated: boolean;
        errors: string[];
        contractSummary?: {
          exitCode: number | null;
          remoteState: { configured: boolean };
          phases: { name: string; status: string; error?: string }[];
        };
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.migrated).toBe(false);
      expect(parsed.errors).toEqual([]);
      expect(parsed.contractPath.endsWith('state.json.contract.json')).toBe(true);
      expect(parsed.contractSummary?.exitCode).toBe(0);
      expect(parsed.contractSummary?.remoteState.configured).toBe(true);
      expect(parsed.contractSummary?.phases[0].error).toBe('preflight failed');
    } finally {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });
});
