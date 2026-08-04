import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import {
  WIZARD_CONTRACT_SCHEMA_ID,
  WIZARD_CONTRACT_DEFAULTS,
  migrateWizardContract,
  validateWizardContract,
} from '@elconv/core';
import {
  buildWizardContract,
  readWizardContract,
} from '../../../packages/cli/src/wizard-contract.js';
import { createWizardState } from '../../../packages/cli/src/cmd-wizard.js';
import type { WizardState } from '../../../packages/cli/src/cmd-wizard.js';

/**
 * O-12 migration — pre-O-12 wizard-contract.json artifacts.
 *
 * Contracts written before O-12 (commit a06d139) are structurally identical to
 * the consolidated versioned schema EXCEPT they lack the `$schema` self-
 * description. `migrateWizardContract` detects those files, soft-migrates them
 * (stamps `$schema`, fills missing option defaults, derives
 * `optionsAppliedToBuild`, completes the phase list) and validates the result —
 * so external tooling can read old and new artifacts with one validator.
 */

function sampleState(): WizardState {
  return createWizardState({
    target: 'v4',
    html: './page.html',
    viewports: [1280, 390],
    strictness: 'pixel-perfect',
    animations: 'gsap',
    fonts: 'system',
    tokenStrategy: 'global',
    responsiveStrategy: 'mobile-first',
    unknownWidgetStrategy: 'error',
    qaReferenceUrl: 'https://source.example.com',
    qaThreshold: 92,
    maxRepairRounds: 3,
  });
}

function sampleContract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const state = sampleState();
  state.sourceSpecPath = './out/source-spec.json';
  state.treePath = './out/tree.json';
  const contract = buildWizardContract(state, {
    phaseStatus: { preflight: 'ok', extract: 'ok', build: 'ok', validate: 'ok' },
    exitCode: 0,
    remoteStateConfigured: false,
  });
  return { ...contract, ...overrides } as unknown as Record<string, unknown>;
}

/** A pre-O-12 artifact: exactly the current shape minus `$schema`. */
function preO12Artifact(): Record<string, unknown> {
  const { $schema: _schema, ...rest } = sampleContract() as {
    $schema?: string;
  } & Record<string, unknown>;
  return rest;
}

describe('migrateWizardContract — pre-O-12 detection and soft migration', () => {
  it('detects a pre-O-12 artifact (missing $schema) and migrates it', () => {
    const artifact = preO12Artifact();
    expect(artifact.$schema).toBeUndefined();

    const result = migrateWizardContract(artifact);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migration.migrated).toBe(true);
    expect(result.migration.contract.$schema).toBe(WIZARD_CONTRACT_SCHEMA_ID);
    expect(result.migration.notes).toContain(`added $schema: ${WIZARD_CONTRACT_SCHEMA_ID}`);
  });

  it('the migrated artifact validates against the consolidated schema', () => {
    const result = migrateWizardContract(preO12Artifact());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const validation = validateWizardContract(result.migration.contract);
    expect(validation.ok).toBe(true);
  });

  it('preserves recorded phase statuses during migration', () => {
    const artifact = preO12Artifact();
    (artifact.phases as Array<{ name: string; status: string }>).find(
      (p) => p.name === 'extract',
    )!.status = 'failed';
    const result = migrateWizardContract(artifact);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byName = Object.fromEntries(
      result.migration.contract.phases.map((p) => [p.name, p.status]),
    );
    expect(byName.extract).toBe('failed');
    expect(byName.build).toBe('ok');
  });

  it('a current artifact ($schema present) validates as-is without migration', () => {
    const artifact = sampleContract();
    const result = migrateWizardContract(artifact);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migration.migrated).toBe(false);
    expect(result.migration.notes).toEqual([]);
    expect(result.migration.contract.$schema).toBe(WIZARD_CONTRACT_SCHEMA_ID);
  });

  it('rejects a different schema id as an unknown version (never coerced)', () => {
    const result = migrateWizardContract(sampleContract({ $schema: 'elconv/wizard-contract/v2' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('Unsupported wizard contract schema id');
  });

  it('rejects a wrong schemaVersion machine gate', () => {
    const result = migrateWizardContract(sampleContract({ schemaVersion: 2 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('schema version');
  });

  it('rejects a non-object payload', () => {
    for (const value of [null, 'nope', 42, [1, 2]]) {
      const result = migrateWizardContract(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(' ')).toContain('JSON object');
    }
  });

  it('never mutates the input artifact (pure migration)', () => {
    const artifact = preO12Artifact();
    // Remove a phase status so migration would want to fill it.
    const phases = artifact.phases as Array<Record<string, unknown>>;
    delete phases.find((p) => p.name === 'validate')!.status;
    const snapshot = JSON.stringify(artifact);

    const result = migrateWizardContract(artifact);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(artifact)).toBe(snapshot);
    if (!result.ok) return;
    // The migrated artifact carries the filled status; the input does not.
    const migratedValidate = result.migration.contract.phases.find((p) => p.name === 'validate')!;
    expect(migratedValidate.status).toBe('ok');
  });
});

describe('migrateWizardContract — option defaults', () => {
  it('fills missing optionsForwarded fields with the wizard defaults', () => {
    const artifact = preO12Artifact();
    const forwarded = artifact.optionsForwarded as Record<string, unknown>;
    delete forwarded.viewports;
    delete forwarded.strictness;
    delete forwarded.animations;
    delete forwarded.fonts;
    delete forwarded.sections;
    delete forwarded.qa;

    const result = migrateWizardContract(artifact);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const migratedForwarded = result.migration.contract.optionsForwarded;
    expect(migratedForwarded.viewports).toEqual(WIZARD_CONTRACT_DEFAULTS.viewports);
    expect(migratedForwarded.strictness).toBe('balanced');
    expect(migratedForwarded.animations).toBe('auto');
    expect(migratedForwarded.fonts).toBe('auto');
    expect(migratedForwarded.sections).toEqual([]);
    expect(migratedForwarded.qa).toMatchObject({
      threshold: 85,
      maxRepairRounds: 0,
      autoFix: false,
      heal: false,
      fullContextRepair: false,
    });
    expect(result.migration.notes.some((n) => n.includes('optionsForwarded.viewports'))).toBe(true);
    expect(result.migration.notes.some((n) => n.includes('optionsForwarded.strictness'))).toBe(true);
  });

  it('derives a missing optionsAppliedToBuild record from the forwarded set', () => {
    const artifact = preO12Artifact();
    delete artifact.optionsAppliedToBuild;
    const result = migrateWizardContract(artifact);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migration.contract.optionsAppliedToBuild).toMatchObject({
      strictness: 'pixel-perfect',
      animations: 'gsap',
      fonts: 'system',
      sections: [],
    });
    expect(result.migration.notes).toContain('derived optionsAppliedToBuild from optionsForwarded');
  });

  it('fills missing structural sections (remoteState, artifactPaths, dryRun)', () => {
    const artifact = preO12Artifact();
    delete artifact.remoteState;
    delete artifact.artifactPaths;
    delete artifact.dryRun;
    const result = migrateWizardContract(artifact);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migration.contract.remoteState).toEqual({ configured: false });
    expect(result.migration.contract.artifactPaths).toEqual({});
    expect(result.migration.contract.dryRun).toBe(false);
  });
});

describe('migrateWizardContract — phase completion rules', () => {
  it('missing phases become ok in a completed run (exitCode 0)', () => {
    const artifact = preO12Artifact();
    delete artifact.phases;
    const result = migrateWizardContract(artifact);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const statuses = result.migration.contract.phases.map((p) => p.status);
    expect(statuses.every((s) => s === 'ok')).toBe(true);
    expect(result.migration.notes.some((n) => n.includes('added phase'))).toBe(true);
  });

  it('missing phases become pending while a run is in progress (exitCode null)', () => {
    const artifact = sampleContract({ exitCode: null });
    delete artifact.$schema;
    delete artifact.phases;
    const result = migrateWizardContract(artifact);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migration.contract.phases.every((p) => p.status === 'pending')).toBe(true);
  });

  it('missing phases become skipped in an aborted run (exitCode 1)', () => {
    const artifact = sampleContract({ exitCode: 1 });
    delete artifact.$schema;
    delete artifact.phases;
    const result = migrateWizardContract(artifact);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migration.contract.phases.every((p) => p.status === 'skipped')).toBe(true);
  });

  it('keeps the canonical phase order after migration', () => {
    const result = migrateWizardContract(preO12Artifact());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migration.contract.phases.map((p) => p.name)).toEqual([
      'preflight', 'extract', 'build', 'validate', 'deploy', 'qa', 'done',
    ]);
  });

  it('reports honestly when a migrated artifact still fails validation', () => {
    const artifact = preO12Artifact();
    (artifact as Record<string, unknown>).target = 'v9';
    const result = migrateWizardContract(artifact);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('still fails validation');
  });
});

describe('readWizardContract — file reader', () => {
  function tempDir(): string {
    return join(tmpdir(), `elconv-contract-migrate-${Math.random().toString(36).slice(2)}`);
  }

  it('reads and migrates a pre-O-12 artifact from disk', () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'wizard-contract.json');
    try {
      writeFileSync(path, JSON.stringify(preO12Artifact(), null, 2), 'utf-8');
      const result = readWizardContract(path);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.migration.migrated).toBe(true);
      expect(result.migration.contract.$schema).toBe(WIZARD_CONTRACT_SCHEMA_ID);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a missing file as an honest error', () => {
    const result = readWizardContract(join(tempDir(), 'nope.json'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('Cannot read wizard contract');
  });

  it('reports malformed JSON as an honest error', () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'wizard-contract.json');
    try {
      writeFileSync(path, '{ not json', 'utf-8');
      const result = readWizardContract(path);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(' ')).toContain('Invalid JSON');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('migration defaults stay aligned with the wizard state defaults (drift guard)', () => {
  it('WIZARD_CONTRACT_DEFAULTS mirror createWizardState defaults', () => {
    const state = createWizardState({ target: 'v3', html: './page.html' });
    expect(WIZARD_CONTRACT_DEFAULTS.viewports).toEqual(state.viewports);
    expect(WIZARD_CONTRACT_DEFAULTS.strictness).toBe(state.strictness);
    expect(WIZARD_CONTRACT_DEFAULTS.animations).toBe(state.animations);
    expect(WIZARD_CONTRACT_DEFAULTS.fonts).toBe(state.fonts);
    expect(WIZARD_CONTRACT_DEFAULTS.sections).toEqual(state.sections);
    expect(WIZARD_CONTRACT_DEFAULTS.qa.threshold).toBe(state.qa.threshold);
    expect(WIZARD_CONTRACT_DEFAULTS.qa.maxRepairRounds).toBe(state.qa.maxRepairRounds);
    expect(WIZARD_CONTRACT_DEFAULTS.qa.autoFix).toBe(state.qa.autoFix);
    expect(WIZARD_CONTRACT_DEFAULTS.qa.heal).toBe(state.qa.heal);
    expect(WIZARD_CONTRACT_DEFAULTS.qa.fullContextRepair).toBe(state.qa.fullContextRepair);
  });
});
