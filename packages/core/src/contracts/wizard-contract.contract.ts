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
