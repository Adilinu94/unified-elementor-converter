#!/usr/bin/env node
/**
 * export-ability-schema.ts — Ability-Schema Codegen Export.
 *
 * Derives the consolidated, versioned JSON-Schema document for the Novamira
 * ability registry from the single source of truth (KNOWN_ABILITIES /
 * ALIAS_MAP / UNAVAILABLE_ABILITIES in @elconv/mcp) and writes it to
 * `schemas/novamira-abilities.schema.json`.
 *
 * Analogue to export-wizard-contract-schema.ts (O-12): the registry is the
 * canonical runtime artifact; this document is the machine-readable
 * `novamira-abilities.schema` derived from it. A drift-guard test pins the
 * committed file to the generated document, so the schema file can never
 * silently fall out of sync with the registry.
 *
 * Usage:
 *   node --import tsx scripts/export-ability-schema.ts
 *   node --import tsx scripts/export-ability-schema.ts --output schemas/novamira-abilities.schema.json
 *
 * This script performs no network, no writes to any target, and never calls
 * process.exit() (Node exits naturally once the event loop drains).
 */

import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ABILITY_SCHEMA_ID,
  ABILITY_SCHEMA_VERSION,
  abilityJsonSchemaDocument,
} from '../packages/mcp/src/ability-schema.js';

const { values: raw } = parseArgs({
  options: {
    output: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
  strict: false,
});

if (raw.help) {
  process.stdout.write(`
export-ability-schema.ts — Export the versioned Novamira ability-registry JSON-Schema

USAGE:
  node --import tsx scripts/export-ability-schema.ts [--output FILE]

OPTIONS:
  --output FILE  Output path [default: schemas/novamira-abilities.schema.json]
  --help         This help

The schema document is derived from the canonical registry in @elconv/mcp
(ability-registry.ts → ability-schema.ts) — schema id ${ABILITY_SCHEMA_ID} (${ABILITY_SCHEMA_VERSION}).
`);
  process.exitCode = 0;
} else {
  const outputPath = (raw.output as string | undefined)
    ? resolve(raw.output)
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'schemas', 'novamira-abilities.schema.json');

  const document = abilityJsonSchemaDocument();
  const dir = dirname(outputPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  process.stderr.write(`[export-ability-schema] ✅ Schema ${ABILITY_SCHEMA_ID} → ${outputPath}\n`);
}
