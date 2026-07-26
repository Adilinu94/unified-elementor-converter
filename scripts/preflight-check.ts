#!/usr/bin/env node
/**
 * scripts/preflight-check.ts — Standalone Preflight System Checks
 *
 * Sprint 6 (Task 1): Extracted from wizard.js preflight subcommand.
 * Führt 8 System-Checks VOR dem Pipeline-Start aus:
 *   1. .env Variablen
 *   2. FRAMER_EXPORT_DIR
 *   3. WP_API_URL HTTP-Erreichbarkeit
 *   4. MCP Discovery (greet + check-setup)
 *   5. V2-Plugin / Elementor Version
 *   6. Schema-Endpoint
 *   7. Disk-Space
 *   8. .mcp.json Config
 *
 * Usage:
 *   node --import tsx scripts/preflight-check.ts              # Formatierter Output
 *   node --import tsx scripts/preflight-check.ts --json       # JSON-Output
 *   node --import tsx scripts/preflight-check.ts --help       # Diese Hilfe
 *
 * Exit-Codes:
 *   0 = Alle Checks bestanden
 *   1 = Mindestens ein Check fehlgeschlagen
 */

import { runPreflight } from './wizard/cmd-preflight.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`preflight-check.ts — 8 System-Checks vor dem Pipeline-Start

USAGE:
  node --import tsx scripts/preflight-check.ts           # Formatierter Text-Output
  node --import tsx scripts/preflight-check.ts --json    # JSON-Output
  node --import tsx scripts/preflight-check.ts --help    # Diese Hilfe

CHECKS:
  1. .env Variablen (WP_API_URL, WP_API_USERNAME, FRAMER_EXPORT_DIR)
  2. FRAMER_EXPORT_DIR existiert
  3. WP_API_URL HTTP-Erreichbarkeit
  4. MCP Discovery (greet + check-setup)
  5. V2-Plugin / Elementor Version (runtime_available)
  6. Schema-Endpoint
  7. Disk-Space >= 1 GB
  8. .mcp.json Config

EXIT-CODES:
  0 = Alle Checks bestanden
  1 = Mindestens ein Check fehlgeschlagen`);
  process.exit(0);
}

const formatJson = args.includes('--json');
await runPreflight(formatJson);
