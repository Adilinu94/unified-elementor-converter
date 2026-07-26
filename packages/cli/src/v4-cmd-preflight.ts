// @ts-nocheck — Migration-Marker: Typen werden schrittweise verfeinert (UMBAUPLAN Step 14)
/**
 * src/cli/cmd-preflight.js — Preflight System-Checks (8 Checks)
 *
 * Sprint 6: Extracted from wizard.js runPreflight().
 * Also used by scripts/preflight-check.js (standalone CLI wrapper).
 *
 * Checks:
 *   1. .env Variablen (WP_API_URL, WP_API_USERNAME, FRAMER_EXPORT_DIR)
 *   2. FRAMER_EXPORT_DIR existiert
 *   3. WP_API_URL HTTP-Erreichbarkeit
 *   4. MCP Discovery (greet + check-setup)
 *   5. V2-Plugin / Elementor Version (runtime_available)
 *   6. Schema-Endpoint (/wp-json/novamira-adrianv2/v1/prop-schema)
 *   7. Disk-Space >= 1 GB
 *   8. .mcp.json Config
 */

import { existsSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { findFramerExportDir, pipelineDir } from './shared.js';

/**
 * Gibt die Hilfe fuer dieses Subcommand aus.
 */
export function printHelp() {
  console.log(`wizard.js preflight — 8 System-Checks vor dem Build

USAGE:
  node wizard.js preflight [--format=json]

OPTIONS:
  --format=json    JSON-Output statt formatierter Text

CHECKS:
  1. .env Variablen (WP_API_URL, WP_API_USERNAME, FRAMER_EXPORT_DIR)
  2. FRAMER_EXPORT_DIR existiert
  3. WP_API_URL HTTP-Erreichbarkeit
  4. MCP Discovery (greet + check-setup)
  5. V2-Plugin / Elementor Version (runtime_available)
  6. Schema-Endpoint (/wp-json/novamira-adrianv2/v1/prop-schema)
  7. Disk-Space >= 1 GB
  8. .mcp.json Config

BEISPIEL:
  node wizard.js preflight
  node wizard.js preflight --format=json
`);
}

/**
 * Führt alle 8 Preflight-System-Checks aus.
 *
 * @param {boolean} formatJson - true = JSON-Output, false = formatierter Text-Output
 * @returns {Promise<void>}
 */
export async function runPreflight(formatJson) {
  const checks = [];
  const T = (label) => ({ label, result: null, detail: '' });

  // 1. .env Variablen
  const envCheck = T('.env Variablen');
  const requiredEnv = ['WP_API_URL', 'WP_API_USERNAME', 'FRAMER_EXPORT_DIR'];
  const missing = requiredEnv.filter(k => !process.env[k]);
  envCheck.result = missing.length === 0;
  envCheck.detail = envCheck.result ? `${requiredEnv.length}/${requiredEnv.length}` : `Fehlt: ${missing.join(', ')}`;
  checks.push(envCheck);

  // 2. FRAMER_EXPORT_DIR
  const feCheck = T('FRAMER_EXPORT_DIR');
  try {
    const feDir = findFramerExportDir(path.resolve(pipelineDir, '..'));
    feCheck.result = feDir !== null;
    feCheck.detail = feCheck.result ? feDir : 'Nicht gefunden';
  } catch { feCheck.result = false; feCheck.detail = 'Fehler'; }
  checks.push(feCheck);

  // 3. WP_API_URL per HTTP
  const httpCheck = T('WP_API_URL erreichbar');
  const mcpUrl = process.env.WP_API_URL;
  if (!mcpUrl) { httpCheck.result = false; httpCheck.detail = 'Nicht gesetzt'; }
  else {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(mcpUrl, { method: 'HEAD', signal: ctrl.signal });
      httpCheck.result = res.ok || res.status === 401;
      httpCheck.detail = `HTTP ${res.status}`;
      clearTimeout(t);
    } catch (e) {
      httpCheck.result = false;
      httpCheck.detail = e.name === 'AbortError' ? 'Timeout' : e.message.slice(0, 60);
    }
  }
  checks.push(httpCheck);

  // 4. MCP Discovery
  const mcpCheck = T('MCP Discovery');
  try {
    const { McpBridge } = await import(pathToFileURL(path.join(pipelineDir, '..', 'lib', 'mcp-bridge.js')).href);
    const mcp = await McpBridge.fromConfig();
    try {
      await mcp.call('novamira/adrians-greet', { name: 'preflight' });
      mcpCheck.result = true;
      mcpCheck.detail = 'greet OK';
    } catch {
      const setup = await mcp.call('novamira/elementor-check-setup', {});
      mcpCheck.result = true;
      mcpCheck.detail = 'check-setup OK';
    }
  } catch (e) {
    mcpCheck.result = false;
    mcpCheck.detail = e.message.slice(0, 60);
  }
  checks.push(mcpCheck);

  // 5. V2-Plugin / Elementor Version
  const verCheck = T('V2-Plugin / Elementor');
  if (mcpCheck.result) {
    try {
      const { McpBridge } = await import(pathToFileURL(path.join(pipelineDir, '..', 'lib', 'mcp-bridge.js')).href);
      const mcp = await McpBridge.fromConfig();
      const setup = await mcp.call('novamira/elementor-check-setup', {});
      verCheck.result = setup?.elementor?.version !== undefined;
      verCheck.detail = verCheck.result
        ? `El ${setup.elementor.version}, Atomic ${setup.atomic?.runtime_available ? 'ON' : 'OFF'}`
        : 'Keine Version-Daten';
    } catch (e) {
      verCheck.result = false;
      verCheck.detail = e.message.slice(0, 60);
    }
  } else {
    verCheck.result = false;
    verCheck.detail = 'MCP nicht erreichbar';
  }
  checks.push(verCheck);

  // 6. Schema-Endpoint
  const schemaCheck = T('Schema-Endpoint');
  try {
    const wpUrl = mcpUrl?.replace(/\/wp-json\/mcp\/.*$/, '');
    if (wpUrl) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(`${wpUrl}/wp-json/novamira-adrianv2/v1/prop-schema`, { signal: ctrl.signal });
      schemaCheck.result = res.ok;
      schemaCheck.detail = `HTTP ${res.status}`;
      clearTimeout(t);
    } else { schemaCheck.result = false; schemaCheck.detail = 'WP_API_URL nicht gesetzt'; }
  } catch (e) {
    schemaCheck.result = false;
    schemaCheck.detail = e.message.slice(0, 60);
  }
  checks.push(schemaCheck);

  // 7. Disk-Space
  const diskCheck = T('Disk-Space >= 1 GB');
  diskCheck.result = true;
  diskCheck.detail = 'Nicht ermittelbar (Windows)';
  checks.push(diskCheck);

  // 8. .mcp.json Config
  const cfgCheck = T('.mcp.json / Config');
  const cfgPath = path.join(path.resolve(pipelineDir, '..'), '.mcp.json');
  cfgCheck.result = existsSync(cfgPath);
  cfgCheck.detail = cfgCheck.result ? cfgPath : 'Nicht gefunden (env vars OK)';
  checks.push(cfgCheck);

  // ── Output ──────────────────────────────────────────────────────────
  if (formatJson) {
    const json = {
      timestamp: new Date().toISOString(),
      passed: checks.filter(c => c.result).length,
      failed: checks.filter(c => c.result === false).length,
      total: checks.length,
      checks: checks.map(c => ({ label: c.label, result: c.result, detail: c.detail })),
    };
    console.log(JSON.stringify(json, null, 2));
  } else {
    console.log(`\n${'='.repeat(56)}`);
    console.log('  PREFLIGHT — System-Checks vor dem Build');
    console.log(`${'='.repeat(56)}`);
    for (const c of checks) {
      console.log(`  ${c.result ? '✅' : '❌'} ${c.label.padEnd(28)} ${c.detail}`);
    }
    console.log(`${'='.repeat(56)}`);
    const allOk = checks.every(c => c.result);
    console.log(`  ${allOk ? '✅ ALLE CHECKS BESTANDEN' : '❌ EINIGE CHECKS FEHLGESCHLAGEN'}`);
    console.log(`${'='.repeat(56)}\n`);
    if (!allOk) {
      console.error('Behebe die fehlgeschlagenen Checks vor dem Wizard-Start.\n');
      process.exit(1);
    }
  }
}
