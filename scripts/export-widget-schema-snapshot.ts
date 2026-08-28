#!/usr/bin/env node
/**
 * export-widget-schema-snapshot.ts — capture the live Elementor control schema
 * into the committed offline fallback `schemas/elementor-v3-controls.snapshot.json`.
 *
 * Why a committed snapshot: the schema gate (work package P2) must be able to
 * reject an unknown control id in `elconv convert`, which runs without MCP
 * credentials. Without a snapshot the offline path could only warn, and the
 * "110 unknown keys" class of deploy failure would survive in every offline
 * build.
 *
 * The capture uses `include_styles: true` WITHOUT tab/section/control_names
 * narrowing — live-verified as the only call shape that returns the complete
 * control set. Narrowed calls return `controls: []` for v3 widgets.
 *
 * Usage:
 *   $env:ELCONV_MCP_AUTH = "user:app-password"
 *   node --import tsx scripts/export-widget-schema-snapshot.ts `
 *     --mcp-url https://<host>/wp-json/mcp/novamira --auth-env ELCONV_MCP_AUTH
 *
 * Never prints credentials. Writes only the snapshot file.
 */

import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpAdapter } from '../packages/mcp/src/adapter.js';
import {
  SCHEMA_ABILITY,
  WIDGET_SCHEMA_SNAPSHOT_ID,
  parseSchemaResponse,
  type WidgetSchemaSnapshotFile,
} from '../packages/mcp/src/widget-schema.js';
import { SNAPSHOT_WIDGET_TYPES } from '../packages/core/src/elementor/snapshot-widget-types.js';

const { values: raw } = parseArgs({
  options: {
    'mcp-url': { type: 'string' },
    'auth-env': { type: 'string' },
    output: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
  strict: false,
});

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (raw.help) {
  process.stdout.write(`
export-widget-schema-snapshot.ts — capture the live Elementor control schema

USAGE:
  node --import tsx scripts/export-widget-schema-snapshot.ts \\
    --mcp-url <url> --auth-env <ENV_VAR> [--output FILE]

OPTIONS:
  --mcp-url   Novamira MCP endpoint
  --auth-env  Name of the env var holding "user:app-password"
  --output    Output path [default: schemas/elementor-v3-controls.snapshot.json]

Captures: ${SNAPSHOT_WIDGET_TYPES.join(', ')}
Schema id: ${WIDGET_SCHEMA_SNAPSHOT_ID}
`);
  process.exitCode = 0;
} else {
  const mcpUrl = raw['mcp-url'] as string | undefined;
  const authEnv = raw['auth-env'] as string | undefined;
  if (!mcpUrl || !authEnv) {
    process.stderr.write('Error: --mcp-url and --auth-env are both required.\n');
    process.exitCode = 2;
  } else {
    const credentials = process.env[authEnv];
    if (!credentials) {
      process.stderr.write(`Error: env var "${authEnv}" is not set (expected "user:app-password").\n`);
      process.exitCode = 2;
    } else {
      const outputPath = raw.output
        ? resolve(raw.output as string)
        : resolve(repoRoot, 'schemas', 'elementor-v3-controls.snapshot.json');
      await capture(mcpUrl, credentials, outputPath);
    }
  }
}

async function capture(mcpUrl: string, credentials: string, outputPath: string): Promise<void> {
  const adapter = new McpAdapter({
    baseUrl: mcpUrl,
    authHeader: `Basic ${Buffer.from(credentials).toString('base64')}`,
    timeoutMs: 120_000,
  });

  const compat = await adapter.executeAbility<{
    data?: { elementor?: { version?: string }; elementor_pro?: { version?: string } };
    elementor?: { version?: string };
    elementor_pro?: { version?: string };
  }>('novamira/elementor-check-setup', {});
  const compatData = compat.data ?? compat;
  const elementorVersion = compatData.elementor?.version ?? 'unknown';
  const proVersion = compatData.elementor_pro?.version;

  // One call per widget type: a single broad call for every type at once
  // exceeds the response budget (the server warns that broad include_styles
  // reads are very large for v3 widgets).
  const widgets: WidgetSchemaSnapshotFile['widgets'] = {};
  const missing: string[] = [];
  for (const widgetType of SNAPSHOT_WIDGET_TYPES) {
    const payload = await adapter.executeAbility(SCHEMA_ABILITY, {
      action: 'get',
      widget_types: [widgetType],
      include_styles: true,
    });
    const parsed = parseSchemaResponse(payload, true);
    if (!parsed.recognized) {
      process.stderr.write(`[export-widget-schema-snapshot] ⚠ ${widgetType}: unrecognized payload\n`);
      continue;
    }
    for (const name of parsed.missing) if (!missing.includes(name)) missing.push(name);
    const entry = parsed.widgets[widgetType];
    if (entry === undefined) {
      process.stderr.write(`[export-widget-schema-snapshot] ⚠ ${widgetType}: no controls returned\n`);
      if (!missing.includes(widgetType)) missing.push(widgetType);
      continue;
    }
    widgets[widgetType] = entry;
    process.stderr.write(
      `[export-widget-schema-snapshot] ✓ ${widgetType}: ${Object.keys(entry.controls).length} controls\n`,
    );
  }

  const snapshot: WidgetSchemaSnapshotFile = {
    schemaVersion: 1,
    $schema: WIDGET_SCHEMA_SNAPSHOT_ID,
    capturedFrom: new URL(mcpUrl).host,
    capturedAt: new Date().toISOString(),
    elementor: { version: elementorVersion, ...(proVersion ? { pro: proVersion } : {}) },
    missing: missing.sort(),
    widgets: sortWidgets(widgets),
  };

  const dir = dirname(outputPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  process.stderr.write(
    `[export-widget-schema-snapshot] ✅ ${Object.keys(snapshot.widgets).length} widget type(s) → ${outputPath}\n`,
  );
}

/** Deterministic key order so the committed file has a stable diff. */
function sortWidgets(widgets: WidgetSchemaSnapshotFile['widgets']): WidgetSchemaSnapshotFile['widgets'] {
  const out: WidgetSchemaSnapshotFile['widgets'] = {};
  for (const key of Object.keys(widgets).sort()) {
    const entry = widgets[key];
    const controls: typeof entry.controls = {};
    for (const controlId of Object.keys(entry.controls).sort()) {
      controls[controlId] = entry.controls[controlId];
    }
    out[key] = { ...entry, controls };
  }
  return out;
}
