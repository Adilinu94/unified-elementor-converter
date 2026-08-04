#!/usr/bin/env node
/**
 * export-wizard-contract-schema.ts — O-12 Schema Export.
 *
 * Derives the consolidated, versioned JSON-Schema document for the
 * machine-readable `wizard-contract.json` artifact from the canonical Zod
 * schema (`@elconv/core` contracts) and writes it to
 * `schemas/wizard-contract.schema.json`.
 *
 * The Zod schema is the single source of truth; this document is the
 * machine-readable `wizard-contract.schema` artifact derived from it. A
 * drift-guard test pins the committed file to the generated document, so the
 * schema file can never silently fall out of sync with the validator.
 *
 * Usage:
 *   node --import tsx scripts/export-wizard-contract-schema.ts
 *   node --import tsx scripts/export-wizard-contract-schema.ts --output schemas/wizard-contract.schema.json
 *
 * This script performs no network, no writes to any target, and never calls
 * process.exit() (Node exits naturally once the event loop drains).
 */

import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WIZARD_CONTRACT_SCHEMA_ID,
  WIZARD_CONTRACT_SCHEMA_VERSION,
  wizardContractJsonSchemaDocument,
} from '../packages/core/src/contracts/wizard-contract.contract.js';

const { values: raw } = parseArgs({
  options: {
    output: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
  strict: false,
});

if (raw.help) {
  process.stdout.write(`
export-wizard-contract-schema.ts — Export the consolidated wizard-contract JSON-Schema

USAGE:
  node --import tsx scripts/export-wizard-contract-schema.ts [--output FILE]

OPTIONS:
  --output FILE  Output path [default: schemas/wizard-contract.schema.json]
  --help         This help

The schema document is derived from the canonical Zod schema in
@elconv/core (wizard-contract.contract.ts) — schema id ${WIZARD_CONTRACT_SCHEMA_ID} (${WIZARD_CONTRACT_SCHEMA_VERSION}).
`);
  process.exitCode = 0;
} else {
  const outputPath = (raw.output as string | undefined)
    ? resolve(raw.output)
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'schemas', 'wizard-contract.schema.json');

  const document = wizardContractJsonSchemaDocument();
  const dir = dirname(outputPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  process.stderr.write(`[export-wizard-contract-schema] ✅ Schema ${WIZARD_CONTRACT_SCHEMA_ID} → ${outputPath}\n`);
}
