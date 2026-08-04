import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  WIZARD_CONTRACT_SCHEMA_ID,
  WIZARD_CONTRACT_SCHEMA_VERSION,
  WIZARD_CONTRACT_PHASES,
  WIZARD_CONTRACT_PHASE_STATUSES,
  validateWizardContract,
  wizardContractJsonSchemaDocument,
  type WizardContract,
} from '@elconv/core';
import { buildWizardContract } from '../../../packages/cli/src/wizard-contract.js';
import { createWizardState } from '../../../packages/cli/src/cmd-wizard.js';
import type { WizardState } from '../../../packages/cli/src/cmd-wizard.js';

/**
 * O-12 — consolidated, versioned wizard-contract schema.
 *
 * The machine-readable `wizard-contract.json` is now derived from a single
 * versioned source of truth (`WizardContractSchema` in @elconv/core): the
 * runtime validator, the inferred TypeScript type and the exported
 * `schemas/wizard-contract.schema.json` document all come from it. These tests
 * pin the validator, the schema document metadata, the committed schema file
 * (drift guard) and the wizard-written artifact.
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

function sampleContract(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
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

describe('validateWizardContract — consolidated versioned schema', () => {
  it('accepts a real contract built by the wizard', () => {
    const result = validateWizardContract(sampleContract());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.$schema).toBe(WIZARD_CONTRACT_SCHEMA_ID);
      expect(result.value.schemaVersion).toBe(1);
    }
  });

  it('accepts an in-progress contract (exitCode null) with pending phases', () => {
    const state = sampleState();
    const contract = buildWizardContract(state, {
      phaseStatus: { preflight: 'ok', extract: 'ok' },
      exitCode: null,
      remoteStateConfigured: false,
      remoteStateReason: 'no verified remote-state adapter is configured',
    });
    const result = validateWizardContract(contract);
    expect(result.ok).toBe(true);
  });

  it('rejects a wrong schemaVersion (machine gate)', () => {
    const result = validateWizardContract(sampleContract({ schemaVersion: 2 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('schemaVersion');
  });

  it('rejects a missing $schema reference', () => {
    const { $schema: _schema, ...rest } = sampleContract() as { $schema?: string } & Record<string, unknown>;
    const result = validateWizardContract(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('$schema');
  });

  it('rejects an unknown exit code', () => {
    const result = validateWizardContract(sampleContract({ exitCode: 3 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('exitCode');
  });

  it('rejects an unknown phase status', () => {
    const contract = sampleContract();
    (contract.phases as Array<{ status: string }>)[0]!.status = 'weird';
    const result = validateWizardContract(contract);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('status');
  });

  it('rejects a missing optionsAppliedToBuild parity record', () => {
    const { optionsAppliedToBuild: _ob, ...rest } = sampleContract() as {
      optionsAppliedToBuild?: unknown;
    } & Record<string, unknown>;
    const result = validateWizardContract(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('optionsAppliedToBuild');
  });

  it('rejects a bad strictness value in the parity record', () => {
    const contract = sampleContract();
    (contract.optionsAppliedToBuild as { strictness: string }).strictness = 'ultra';
    const result = validateWizardContract(contract);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('strictness');
  });

  it('rejects a missing phases array and a bad target', () => {
    const noPhases = validateWizardContract(sampleContract({ phases: undefined }));
    expect(noPhases.ok).toBe(false);
    const badTarget = validateWizardContract(sampleContract({ target: 'v5' }));
    expect(badTarget.ok).toBe(false);
  });

  it('reports errors as path-prefixed messages for tooling', () => {
    const result = validateWizardContract({ schemaVersion: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/^[^:]+: .+/); // "path: message"
    }
  });
});

describe('wizardContractJsonSchemaDocument — versioned JSON-Schema artifact', () => {
  it('carries the schema id, draft and version metadata', () => {
    const doc = wizardContractJsonSchemaDocument();
    expect(doc.$id).toBe(WIZARD_CONTRACT_SCHEMA_ID);
    expect(doc.$schema).toContain('draft/2020-12');
    expect(doc.version).toBe(WIZARD_CONTRACT_SCHEMA_VERSION);
    expect(doc.title).toBe('elconv wizard contract');
    expect(doc.type).toBe('object');
  });

  it('describes every contract property including the parity record', () => {
    const doc = wizardContractJsonSchemaDocument();
    const properties = (doc.properties ?? {}) as Record<string, unknown>;
    for (const key of [
      'schemaVersion',
      '$schema',
      'target',
      'dryRun',
      'exitCode',
      'phases',
      'optionsForwarded',
      'optionsAppliedToBuild',
      'artifactPaths',
      'remoteState',
    ]) {
      expect(properties[key], `property ${key}`).toBeDefined();
    }
    expect(properties.schemaVersion).toMatchObject({ const: 1 });
  });

  it('is deterministic (same document on every call)', () => {
    expect(JSON.stringify(wizardContractJsonSchemaDocument())).toBe(
      JSON.stringify(wizardContractJsonSchemaDocument()),
    );
  });

  it('the committed schemas/wizard-contract.schema.json matches the generated document (drift guard)', () => {
    const committed = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../../schemas/wizard-contract.schema.json'), 'utf8'),
    ) as Record<string, unknown>;
    // Regenerate if it drifts:
    //   node --import tsx scripts/export-wizard-contract-schema.ts
    expect(committed).toEqual(wizardContractJsonSchemaDocument());
  });
});

describe('schema constants stay aligned with the contract surface', () => {
  it('the phase/status enums cover the machine-readable statuses', () => {
    expect(WIZARD_CONTRACT_PHASES).toEqual([
      'preflight', 'extract', 'build', 'validate', 'deploy', 'qa', 'done',
    ]);
    expect(WIZARD_CONTRACT_PHASE_STATUSES).toEqual([
      'ok', 'failed', 'skipped', 'pending', 'unavailable',
    ]);
  });

  it('a wizard-written contract artifact validates against the schema', () => {
    const state = sampleState();
    const contract = buildWizardContract(state, {
      phaseStatus: { done: 'ok' },
      exitCode: 0,
      remoteStateConfigured: false,
    });
    const result = validateWizardContract(contract as unknown as WizardContract);
    expect(result.ok).toBe(true);
  });
});
