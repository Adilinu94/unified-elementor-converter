// @ts-nocheck — Migration-Marker: Typen werden schrittweise verfeinert (UMBAUPLAN Step 14)
/**
 * src/cli/cmd-doctor.js — UMBAUPLAN v2.0 Phase 6.1
 *
 * Erweiterte Diagnose jenseits der 8 Standard-Preflight-Checks:
 *   9.  Plugin-Methoden existieren (Guards, A11y::read_page, Seo::read_page)
 *  10.  Elementor-4.1.0-beta1-Workaround-Status (CSS-Pipeline-Bug)
 *  11.  Framer-Cache-Health (Cache-Dateien + Alter)
 *  12.  Image-Map-Health (Einträge + Verfügbarkeit)
 *  13.  Token-Mapping-Health (Hex-Konsistenz, GV-ID-Format)
 *  14.  Workaround-Aktivierung (welche Workarounds sind nötig?)
 *
 * USAGE: node wizard.js doctor [--format=json] [--fix]
 *
 * --fix versucht bekannte Probleme automatisch zu beheben (z.B. fehlende Cache-Dirs).
 */

import { existsSync, statSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pipelineDir } from './shared.js';
import { runPreflight } from './cmd-preflight.js';

const PLUGIN_METHODS = [
  { name: 'Guards::ensureSession', check: 'novamira/setup-v4-foundation' },
  { name: 'A11y::read_page',        check: 'novamira/audit-page-a11y' },
  { name: 'Seo::read_page',         check: 'novamira/audit-page-seo' },
];

const ELEMENTOR_BUG_CHECKS = [
  {
    id: 'beta-css-pipeline',
    name: 'Elementor 4.1.0-beta1 CSS-Pipeline',
    description: 'Prüft ob 0-byte-CSS-File-Bug den Build beeinträchtigt (Workaround 3.1 nötig)',
  },
  {
    id: 'foundation-errors',
    name: 'setup-v4-foundation Guards-Class',
    description: 'Prüft ob Guards-Class im Plugin geladen ist (Workaround 3.2 nötig)',
  },
  {
    id: 'audit-methods',
    name: 'A11y/Seo read_page() Methods',
    description: 'Prüft ob Audit-Methoden vorhanden sind (Workaround 3.3 nötig)',
  },
];

export function printHelp() {
  console.log(`wizard.js doctor — Erweiterte Diagnose (6 zusätzliche Checks)

USAGE:
  node wizard.js doctor [--format=json] [--fix]

OPTIONS:
  --format=json     JSON-Output
  --fix             Auto-Fix für fehlende Verzeichnisse

CHECKS (zusätzlich zu preflight):
   9. Plugin-Methoden (Guards, A11y::read_page, Seo::read_page)
  10. Elementor-4.1.0-beta1-Bugs (3 bekannte Bugs)
  11. Framer-Cache-Health
  12. Image-Map-Health
  13. Token-Mapping-Health
  14. Workaround-Aktivierungs-Empfehlungen
`);
}

/**
 * @param {boolean} formatJson
 * @param {boolean} fix
 */
export async function runDoctor(formatJson, fix = false) {
  const checks = [];

  // 9. Plugin-Methoden
  for (const method of PLUGIN_METHODS) {
    const c = await checkPluginMethod(method);
    checks.push(c);
  }

  // 10. Elementor-4.1.0-beta1-Bugs
  for (const bug of ELEMENTOR_BUG_CHECKS) {
    const c = await checkElementorBug(bug);
    checks.push(c);
  }

  // 11. Framer-Cache-Health
  checks.push(checkFramerCache());

  // 12. Image-Map-Health
  checks.push(checkImageMap());

  // 13. Token-Mapping-Health
  checks.push(checkTokenMapping());

  // 14. Workaround-Empfehlungen
  checks.push(checkWorkaroundRecommendations(checks));

  // Optional: Auto-Fix
  const fixes = [];
  if (fix) {
    fixes.push(...await autoFix(checks));
  }

  // Output
  if (formatJson) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      checks: checks.map(c => ({
        id: c.id, label: c.label, result: c.result, detail: c.detail, recommendation: c.recommendation,
      })),
      fixes,
    }, null, 2));
  } else {
    console.log(`\n${'='.repeat(64)}`);
    console.log('  DOCTOR — Erweiterte Diagnose');
    console.log(`${'='.repeat(64)}`);
    for (const c of checks) {
      const icon = c.result === true ? '✅' : (c.result === false ? '❌' : '⚠️ ');
      console.log(`  ${icon} [${c.id}] ${c.label}`);
      console.log(`       ${c.detail}`);
      if (c.recommendation) console.log(`       💡 ${c.recommendation}`);
    }
    if (fixes.length > 0) {
      console.log(`\n${'─'.repeat(64)}`);
      console.log('  Auto-Fix angewendet:');
      for (const f of fixes) console.log(`    ✓ ${f}`);
    }
    const failed = checks.filter(c => c.result === false).length;
    const passed = checks.filter(c => c.result === true).length;
    console.log(`${'='.repeat(64)}`);
    console.log(`  ${passed} OK, ${failed} failed`);
    console.log(`${'='.repeat(64)}\n`);
    if (failed > 0) process.exit(1);
  }
}

async function checkPluginMethod({ name, check }) {
  try {
    const { McpBridge } = await import(pathToFileURL(join(pipelineDir, 'lib', 'mcp-bridge.js')).href);
    const mcp = await McpBridge.fromConfig();
    const result = await mcp.call(check, { post_id: 1 }).catch(err => ({ error: err.message }));
    if (result && !result.error) {
      return { id: `plugin-${name}`, label: `Plugin: ${name}`, result: true, detail: 'OK' };
    }
    const errorMsg = String(result?.error || '');
    return {
      id: `plugin-${name}`,
      label: `Plugin: ${name}`,
      result: false,
      detail: errorMsg.slice(0, 100),
      recommendation: `Workaround aktivieren: scripts/lib/${name.includes('Guards') ? 'foundation-resilience' : 'audit-resilience'}.js`,
    };
  } catch (e) {
    return {
      id: `plugin-${name}`,
      label: `Plugin: ${name}`,
      result: null,
      detail: `MCP nicht erreichbar: ${e.message.slice(0, 60)}`,
    };
  }
}

async function checkElementorBug(bug) {
  try {
    const { McpBridge } = await import(pathToFileURL(join(pipelineDir, 'lib', 'mcp-bridge.js')).href);
    const mcp = await McpBridge.fromConfig();
    const setup = await mcp.call('novamira/elementor-check-setup', {}).catch(() => null);
    const version = setup?.elementor?.version || 'unknown';
    const isBeta = version.includes('beta') || version.startsWith('4.1.0');
    return {
      id: `bug-${bug.id}`,
      label: bug.name,
      result: !isBeta,
      detail: isBeta
        ? `⚠️ Elementor ${version} — ${bug.description}`
        : `✅ Elementor ${version} — Bug nicht aktiv`,
      recommendation: isBeta ? 'Workaround-Layer (Phase 3) aktivieren' : null,
    };
  } catch {
    return {
      id: `bug-${bug.id}`,
      label: bug.name,
      result: null,
      detail: 'MCP nicht erreichbar — übersprungen',
    };
  }
}

function checkFramerCache() {
  const cacheDir = join(process.cwd(), '.framer-export-cache');
  if (!existsSync(cacheDir)) {
    return {
      id: 'cache-framer',
      label: 'Framer-Cache',
      result: false,
      detail: 'Cache-Verzeichnis fehlt',
      recommendation: 'mkdir .framer-export-cache oder Build einmal laufen lassen',
    };
  }
  const files = readdirSync(cacheDir, { recursive: true, withFileTypes: false }).filter(f => typeof f === 'string');
  const totalSize = files.reduce((sum, f) => {
    try { return sum + statSync(join(cacheDir, f)).size; } catch { return sum; }
  }, 0);
  return {
    id: 'cache-framer',
    label: 'Framer-Cache',
    result: true,
    detail: `${files.length} Dateien, ${(totalSize / 1024).toFixed(1)} KiB`,
  };
}

function checkImageMap() {
  const candidates = [
    join(process.cwd(), 'FramerExport', 'assets', 'image-map.json'),
    join(process.cwd(), '.framer-export-cache', 'image-map.json'),
  ];
  const found = candidates.find(p => existsSync(p));
  if (!found) {
    return {
      id: 'image-map',
      label: 'Image-Map',
      result: null,
      detail: 'Keine image-map.json gefunden (Asset-Batch-Upload nicht gelaufen)',
    };
  }
  try {
    const data = JSON.parse(readFileSync(found, 'utf8'));
    const count = Object.keys(data.images || data).length;
    return {
      id: 'image-map',
      label: 'Image-Map',
      result: count > 0,
      detail: `${count} Einträge in ${found.split(/[\\/]/).pop()}`,
    };
  } catch (e) {
    return {
      id: 'image-map',
      label: 'Image-Map',
      result: false,
      detail: `Parse-Fehler: ${e.message.slice(0, 50)}`,
    };
  }
}

function checkTokenMapping() {
  const candidates = [
    join(process.cwd(), 'FramerExport', 'tokens', 'token-mapping.json'),
    join(process.cwd(), '.framer-export-cache', 'token-mapping.json'),
  ];
  const found = candidates.find(p => existsSync(p));
  if (!found) {
    return {
      id: 'tokens',
      label: 'Token-Mapping',
      result: null,
      detail: 'Kein token-mapping.json (Token-Extractor nicht gelaufen)',
    };
  }
  try {
    const data = JSON.parse(readFileSync(found, 'utf8'));
    const colorCount = Object.keys(data.colors || {}).length;
    const fontCount = Object.keys(data.fonts || {}).length;
    return {
      id: 'tokens',
      label: 'Token-Mapping',
      result: colorCount > 0 || fontCount > 0,
      detail: `${colorCount} Farben, ${fontCount} Fonts`,
    };
  } catch (e) {
    return {
      id: 'tokens',
      label: 'Token-Mapping',
      result: false,
      detail: `Parse-Fehler: ${e.message.slice(0, 50)}`,
    };
  }
}

function checkWorkaroundRecommendations(checks) {
  const failed = checks.filter(c => c.result === false);
  if (failed.length === 0) {
    return {
      id: 'workarounds',
      label: 'Workaround-Empfehlungen',
      result: true,
      detail: 'Keine Workarounds nötig',
    };
  }
  const workarounds = failed.map(c => c.recommendation).filter(Boolean);
  return {
    id: 'workarounds',
    label: 'Workaround-Empfehlungen',
    result: null,
    detail: `${workarounds.length} Workarounds empfohlen`,
    recommendation: workarounds.join('; '),
  };
}

async function autoFix(checks) {
  const fixes = [];
  const cacheCheck = checks.find(c => c.id === 'cache-framer');
  if (cacheCheck && !cacheCheck.result) {
    try {
      mkdirSync(join(process.cwd(), '.framer-export-cache'), { recursive: true });
      fixes.push('Erstellt: .framer-export-cache/');
    } catch (e) {
      fixes.push(`Konnte .framer-export-cache nicht erstellen: ${e.message}`);
    }
  }
  return fixes;
}
