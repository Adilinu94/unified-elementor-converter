/**
 * wizard-contract.contract.ts — consolidated, versioned contract for the
 * machine-readable `wizard-contract.json` artifact (O-12).
 *
 * The wizard CLI previously wrote `wizard-contract.json` from a hand-written
 * TypeScript interface; the shape existed only in that interface. This module
 * derives the consolidated, versioned contract from a single source of truth:
 *
 *  - `WizardContractSchema` (Zod) defines the full shape — phase names,
 *    machine-readable statuses, exit codes, the forwarded option manifest and
 *    the build-option parity record. `WizardContract` is inferred from it, so
 *    the runtime validator and the TypeScript type can never drift.
 *  - `validateWizardContract()` soft-validates an arbitrary value (parsed JSON)
 *    against the schema and returns human-readable issue strings in the same
 *    "path: message" format as config validation.
 *  - `wizardContractJsonSchemaDocument()` derives a deterministic JSON-Schema
 *    document (draft 2020-12) from the Zod schema plus version metadata. The
 *    document is exported as `schemas/wizard-contract.schema.json` by
 *    `scripts/export-wizard-contract-schema.ts`; a drift-guard test pins the
 *    committed file to the generated document.
 *
 * Versioning: the contract carries `schemaVersion: 1` (machine gate) and
 * `$schema: WIZARD_CONTRACT_SCHEMA_ID` (self-describing reference to the exact
 * schema document it conforms to). Bumping the schema requires a new `$id`
 * and a versioned migration for old artifacts — old artifacts without
 * `$schema` (pre-O-12 runs) intentionally fail strict validation.
 */

import { z } from 'zod';
import { formatZodIssues } from '../config.js';

/** Stable identifier of the schema document a conforming contract refers to. */
export const WIZARD_CONTRACT_SCHEMA_ID = 'elconv/wizard-contract/v1';

/** Human-readable schema version, matching the `$id` suffix. */
export const WIZARD_CONTRACT_SCHEMA_VERSION = 'v1';

export const WIZARD_CONTRACT_PHASES = [
  'preflight',
  'extract',
  'build',
  'validate',
  'deploy',
  'qa',
  'done',
] as const;

export type WizardContractPhaseName = (typeof WIZARD_CONTRACT_PHASES)[number];

export const WIZARD_CONTRACT_PHASE_STATUSES = [
  'ok',
  'failed',
  'skipped',
  'pending',
  'unavailable',
] as const;

export type WizardContractPhaseStatus = (typeof WIZARD_CONTRACT_PHASE_STATUSES)[number];

export const WIZARD_CONTRACT_STRICTNESS = ['draft', 'balanced', 'pixel-perfect'] as const;
export const WIZARD_CONTRACT_ANIMATIONS = ['none', 'css', 'gsap', 'auto'] as const;
export const WIZARD_CONTRACT_FONTS = ['auto', 'system', 'all'] as const;

const ContractPhaseSchema = z.object({
  name: z.enum(WIZARD_CONTRACT_PHASES),
  status: z.enum(WIZARD_CONTRACT_PHASE_STATUSES),
  error: z.string().optional(),
  artifacts: z.array(z.string()),
});

const QaForwardedSchema = z.object({
  referenceUrl: z.string().optional(),
  threshold: z.number().min(0).max(100),
  maxRepairRounds: z.number().int().min(0),
  autoFix: z.boolean(),
  heal: z.boolean(),
  fullContextRepair: z.boolean(),
});

const OptionsForwardedSchema = z.object({
  viewports: z.array(z.number().int().min(320).max(3840)),
  strictness: z.enum(WIZARD_CONTRACT_STRICTNESS),
  animations: z.enum(WIZARD_CONTRACT_ANIMATIONS),
  fonts: z.enum(WIZARD_CONTRACT_FONTS),
  sections: z.array(z.string()),
  tokenStrategy: z.enum(['auto', 'preserve', 'inline', 'global']).optional(),
  responsiveStrategy: z.enum(['auto', 'preserve', 'mobile-first']).optional(),
  unknownWidgetStrategy: z.enum(['fallback-html', 'skip', 'error']).optional(),
  qa: QaForwardedSchema,
});

const OptionsAppliedToBuildSchema = z.object({
  strictness: z.enum(WIZARD_CONTRACT_STRICTNESS),
  animations: z.enum(WIZARD_CONTRACT_ANIMATIONS),
  fonts: z.enum(WIZARD_CONTRACT_FONTS),
  sections: z.array(z.string()),
});

/**
 * Canonical, versioned contract schema — single source of truth for the
 * machine-readable `wizard-contract.json` artifact. `schemaVersion` is the
 * numeric machine gate; `$schema` references the exact schema document.
 */
export const WizardContractSchema = z.object({
  schemaVersion: z.literal(1),
  $schema: z.literal(WIZARD_CONTRACT_SCHEMA_ID),
  target: z.enum(['v3', 'v4']),
  dryRun: z.boolean(),
  /** Final exit code (0/1/2); null while the run is still in progress. */
  exitCode: z.union([z.literal(0), z.literal(1), z.literal(2), z.null()]),
  phases: z.array(ContractPhaseSchema),
  optionsForwarded: OptionsForwardedSchema,
  optionsAppliedToBuild: OptionsAppliedToBuildSchema,
  artifactPaths: z.record(z.string(), z.string()),
  remoteState: z.object({
    configured: z.boolean(),
    reason: z.string().optional(),
  }),
});

export type WizardContract = z.infer<typeof WizardContractSchema>;
export type WizardContractPhase = z.infer<typeof ContractPhaseSchema>;
export type WizardOptionsForwarded = z.infer<typeof OptionsForwardedSchema>;

export type WizardContractValidationResult =
  | { ok: true; value: WizardContract }
  | { ok: false; errors: string[] };

/**
 * Soft-validate an arbitrary value (e.g. JSON parsed from a contract file)
 * against the consolidated schema. Returns issue strings in "path: message"
 * format on failure, never throws.
 */
export function validateWizardContract(value: unknown): WizardContractValidationResult {
  const result = WizardContractSchema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, errors: formatZodIssues(result.error) };
}

/**
 * Deterministic JSON-Schema document (draft 2020-12) derived from the Zod
 * schema plus version metadata. This is the machine-readable `wizard-contract
 * .schema` artifact; the committed `schemas/wizard-contract.schema.json` must
 * equal this document (pinned by a drift-guard test).
 */
export function wizardContractJsonSchemaDocument(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: WIZARD_CONTRACT_SCHEMA_ID,
    title: 'elconv wizard contract',
    description:
      'Consolidated, versioned machine-readable contract for a wizard run: per-phase statuses, exit codes, forwarded build/QA options, build-option parity and artifact paths.',
    version: WIZARD_CONTRACT_SCHEMA_VERSION,
    ...(WizardContractSchema.toJSONSchema() as Record<string, unknown>),
  };
}

// ============================================================================
// Pre-O-12 artifact migration
// ============================================================================
//
// Contracts written before O-12 (commit a06d139) are structurally identical to
// the consolidated schema EXCEPT they lack the `$schema` self-description. The
// migration below soft-upgrades such artifacts so external tooling can read
// them with the same validator: it stamps `$schema`, fills any missing option
// fields with the wizard defaults, derives `optionsAppliedToBuild` when absent,
// completes the phase list from the canonical order, and finally validates the
// migrated value against the versioned schema. Honest limits: artifacts that
// claim a DIFFERENT schema id (a newer version we do not know how to migrate)
// and values that still fail validation after migration are reported as errors
// — never silently downgraded or coerced.

/**
 * Wizard option defaults mirrored from `createWizardState`/`normalizeWizardState`
 * (packages/cli/src/cmd-wizard.ts). Migration fills missing fields with these so
 * a pre-O-12 artifact validates; a drift-guard test pins them to the wizard.
 */
export const WIZARD_CONTRACT_DEFAULTS = {
  viewports: [1440, 768, 390],
  strictness: 'balanced',
  animations: 'auto',
  fonts: 'auto',
  sections: [] as string[],
  qa: {
    threshold: 85,
    maxRepairRounds: 0,
    autoFix: false,
    heal: false,
    fullContextRepair: false,
  },
} as const;

/** A successfully read contract plus what the migration changed. */
export interface WizardContractMigration {
  /** The migrated contract (identical to the input when no migration was needed). */
  contract: WizardContract;
  /** True when the input was a pre-O-12 artifact that required migration. */
  migrated: boolean;
  /** Human-readable list of applied migration steps (empty when nothing changed). */
  notes: string[];
}

export type WizardContractMigrationResult =
  | { ok: true; migration: WizardContractMigration }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a `wizard-contract.json` artifact and soft-migrate pre-O-12 files.
 *
 * - `schemaVersion !== 1` → error (unsupported schema version).
 * - `$schema` present and equal to the current id → already current; the value
 *   is strictly validated as-is, no migration.
 * - `$schema` present but different → error (a newer schema we cannot migrate). *   - `$schema` missing → pre-O-12 artifact: stamp `$schema`, fill missing option
 *   defaults, derive `optionsAppliedToBuild`, complete the phase list (status
 *   `ok` for phases in a completed run, `pending` while running, `skipped`
 *   otherwise), then validate the migrated value.
 *
 * Purity: the input value is never mutated — the migrated artifact is a fresh
 * object (recorded phases are cloned before defaults are filled). Non-record
 * entries inside a malformed `phases` array are dropped and replaced from the
 * canonical order (the replacement list still validates).
 *
 * Never throws; failures are returned as `{ ok: false, errors }`.
 */
export function migrateWizardContract(value: unknown): WizardContractMigrationResult {
  if (!isRecord(value)) {
    return { ok: false, errors: ['wizard contract must be a JSON object'] };
  }
  if (value.schemaVersion !== 1) {
    return {
      ok: false,
      errors: [`Unsupported wizard contract schema version: ${String(value.schemaVersion)}`],
    };
  }

  const hasSchema = value.$schema !== undefined && value.$schema !== null;
  if (hasSchema) {
    if (value.$schema !== WIZARD_CONTRACT_SCHEMA_ID) {
      return {
        ok: false,
        errors: [
          `Unsupported wizard contract schema id: ${String(value.$schema)} ` +
            `(expected ${WIZARD_CONTRACT_SCHEMA_ID})`,
        ],
      };
    }
    const current = validateWizardContract(value);
    if (!current.ok) return { ok: false, errors: current.errors };
    return { ok: true, migration: { contract: current.value, migrated: false, notes: [] } };
  }

  // ---- Pre-O-12 artifact: soft-migrate ----
  const notes: string[] = [];
  const migrated = { ...value };
  migrated.$schema = WIZARD_CONTRACT_SCHEMA_ID;
  notes.push(`added $schema: ${WIZARD_CONTRACT_SCHEMA_ID}`);

  // optionsForwarded: fill missing fields with the wizard defaults.
  const optionsForwarded = isRecord(migrated.optionsForwarded)
    ? { ...migrated.optionsForwarded }
    : {};
  if (!isRecord(migrated.optionsForwarded)) {
    notes.push('created empty optionsForwarded (defaults filled below)');
  }
  const fillOption = (key: string, fallback: unknown): void => {
    if (optionsForwarded[key] === undefined) {
      optionsForwarded[key] = fallback;
      notes.push(`filled optionsForwarded.${key} with default ${JSON.stringify(fallback)}`);
    }
  };
  fillOption('viewports', WIZARD_CONTRACT_DEFAULTS.viewports);
  fillOption('strictness', WIZARD_CONTRACT_DEFAULTS.strictness);
  fillOption('animations', WIZARD_CONTRACT_DEFAULTS.animations);
  fillOption('fonts', WIZARD_CONTRACT_DEFAULTS.fonts);
  fillOption('sections', WIZARD_CONTRACT_DEFAULTS.sections);
  const qa = isRecord(optionsForwarded.qa) ? { ...optionsForwarded.qa } : {};
  for (const key of ['threshold', 'maxRepairRounds', 'autoFix', 'heal', 'fullContextRepair'] as const) {
    if (qa[key] === undefined) {
      qa[key] = WIZARD_CONTRACT_DEFAULTS.qa[key];
      notes.push(`filled optionsForwarded.qa.${key} with default ${String(WIZARD_CONTRACT_DEFAULTS.qa[key])}`);
    }
  }
  optionsForwarded.qa = qa;
  migrated.optionsForwarded = optionsForwarded;

  // optionsAppliedToBuild: derive from the (filled) forwarded set when absent.
  if (!isRecord(migrated.optionsAppliedToBuild)) {
    migrated.optionsAppliedToBuild = {
      strictness: optionsForwarded.strictness,
      animations: optionsForwarded.animations,
      fonts: optionsForwarded.fonts,
      sections: optionsForwarded.sections,
    };
    notes.push('derived optionsAppliedToBuild from optionsForwarded');
  }

  // phases: complete from the canonical order, preserving recorded statuses.
  // A phase recorded as completed keeps its status; missing entries get 'ok'
  // in a finished run (exitCode 0), 'pending' while running (exitCode null),
  // and 'skipped' for aborted runs — mirroring buildWizardContract's fallback.
  const recordedByName = new Map<string, unknown>();
  if (Array.isArray(migrated.phases)) {
    for (const phase of migrated.phases) {
      if (isRecord(phase) && typeof phase.name === 'string') recordedByName.set(phase.name, phase);
    }
  } else {
    notes.push('created empty phases (completed from canonical order)');
  }
  const fallbackStatus = migrated.exitCode === 0 ? 'ok' : migrated.exitCode === null ? 'pending' : 'skipped';
  const phases = WIZARD_CONTRACT_PHASES.map((name) => {
    const recorded = recordedByName.get(name);
    if (recorded) {
      // Clone so filling defaults never mutates the caller's input object.
      const recordedPhase = { ...(recorded as Record<string, unknown>) };
      if (recordedPhase.status === undefined) {
        recordedPhase.status = fallbackStatus;
        notes.push(`filled phases.${name}.status with default ${fallbackStatus}`);
      }
      if (!Array.isArray(recordedPhase.artifacts)) {
        recordedPhase.artifacts = [];
        notes.push(`filled phases.${name}.artifacts with default []`);
      }
      return recordedPhase;
    }
    notes.push(`added phase ${name} with status ${fallbackStatus}`);
    return { name, status: fallbackStatus, artifacts: [] };
  });
  migrated.phases = phases;

  // Structural defaults for the remaining sections.
  if (!isRecord(migrated.remoteState)) {
    migrated.remoteState = { configured: false };
    notes.push('created remoteState with configured: false');
  }
  if (!isRecord(migrated.artifactPaths)) {
    migrated.artifactPaths = {};
    notes.push('created empty artifactPaths');
  }
  if (migrated.dryRun === undefined) {
    migrated.dryRun = false;
    notes.push('filled dryRun with default false');
  }

  const result = validateWizardContract(migrated);
  if (!result.ok) {
    return {
      ok: false,
      errors: [
        `Migrated pre-O-12 wizard contract still fails validation:\n  - ${result.errors.join('\n  - ')}`,
      ],
    };
  }
  return { ok: true, migration: { contract: result.value, migrated: true, notes } };
}
