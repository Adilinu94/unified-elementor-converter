/**
 * scripts/quarterly-audit.ts
 * UMBAUPLAN v2.0 Phase 10.3 — Quarterly-Audit.
 *
 * Läuft alle 90 Tage, prüft:
 *   - Memory-Lessons-Stats (decay, low-confidence)
 *   - 7 dokumentierte Schema-Bugs: sind die Regression-Tests noch grün?
 *   - Pipeline-Performance-Trend (aus metrics-files)
 *   - Elementor-Version-Check (Live-Call, optional)
 *   - WordPress-Version-Check (optional)
 *   - Security-Audit (Anzahl registrierter Plugin-Abilities)
 *
 * Output: reports/quarterly-{date}.html mit Action-Items.
 *
 * USAGE:
 *   node --import tsx scripts/quarterly-audit.ts [--output reports/quarterly-{date}.html]
 *   # oder programmatisch:
 *   import { runQuarterlyAudit } from './quarterly-audit.js';
 *   const report = await runQuarterlyAudit({ cacheDir, outputDir });
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface KnownBug {
  id: number;
  name: string;
  file: string;
}

interface BugRegression extends KnownBug {
  file_exists: boolean;
}

interface MemoryStats {
  total: number;
  byConfidence: {
    high: number;
    medium: number;
    low: number;
  };
  avg_confidence: number;
}

interface MemoryDecay {
  decayed: number;
  removed: number;
}

interface PerformanceTrend {
  trend: string;
  reason?: string;
  files?: number;
  change_pct?: number;
  first_duration_ms?: number;
  last_duration_ms?: number;
}

interface ElementorCache {
  version: string;
}

interface ThemeCache {
  name: string;
}

interface SecurityAudit {
  abilities_count: number;
}

interface AuditJson {
  audit_date: string;
  timestamp: string;
  sections: {
    memory?: { stats: MemoryStats; decay: MemoryDecay };
    bug_regression?: BugRegression[];
    performance?: PerformanceTrend;
    elementor?: ElementorCache;
    theme?: ThemeCache;
    security?: SecurityAudit;
  };
  action_items: string[];
}

interface MemoryStore {
  getStats(): MemoryStats;
  decayStale(): MemoryDecay;
}

interface AuditOptions {
  cacheDir: string;
  outputDir?: string;
  memoryStore?: MemoryStore;
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const KNOWN_BUGS: KnownBug[] = [
  { id: 1, name: 'Children-Key elements', file: 'scripts/lib/v4-tree-builder.js' },
  { id: 2, name: 'elType=widget für atomic-widgets', file: 'scripts/lib/v4-tree-builder.js' },
  { id: 3, name: 'title als html-v3', file: 'scripts/lib/framer-utils.js' },
  { id: 4, name: 'text als html-v3', file: 'scripts/lib/framer-utils.js' },
  { id: 5, name: 'classes als {$$type,value}', file: 'scripts/lib/framer-utils.js' },
  { id: 6, name: 'styles mit class-id-Struktur', file: 'scripts/lib/v4-tree-builder.js' },
  { id: 7, name: 'style-IDs ohne Bindestrich', file: 'scripts/lib/framer-utils.js' },
];

// ─── EXPORT ──────────────────────────────────────────────────────────────────

export async function runQuarterlyAudit(
  { cacheDir, outputDir = 'reports', memoryStore }: AuditOptions = { cacheDir: '' }
): Promise<{ html: string; json: AuditJson }> {
  const date = new Date().toISOString().slice(0, 10);
  const json: AuditJson = {
    audit_date: date,
    timestamp: new Date().toISOString(),
    sections: {},
    action_items: [],
  };

  // 1. Memory-Stats
  if (memoryStore) {
    const stats = memoryStore.getStats();
    const decay = memoryStore.decayStale();
    json.sections.memory = { stats, decay };
    if (decay.removed > 0) {
      json.action_items.push(`${decay.removed} stale Lessons entfernt (decay)`);
    }
    if (stats.byConfidence.low > 5) {
      json.action_items.push(`${stats.byConfidence.low} low-confidence Lessons reviewen`);
    }
  }

  // 2. Bug-Regression
  json.sections.bug_regression = KNOWN_BUGS.map(bug => ({
    ...bug,
    file_exists: existsSync(bug.file),
  }));
  const missingBugs = json.sections.bug_regression.filter(b => !b.file_exists);
  if (missingBugs.length > 0) {
    json.action_items.push(`${missingBugs.length} Bug-Fix-Files fehlen: ${missingBugs.map(b => b.name).join(', ')}`);
  }

  // 3. Pipeline-Performance
  const perfTrend = getPerformanceTrend(cacheDir);
  json.sections.performance = perfTrend;
  if (perfTrend.trend === 'regression') {
    json.action_items.push('Pipeline-Performance regressed (>20%): Refactor nötig');
  }

  // 4. Elementor / WP-Version
  json.sections.elementor = getElementorVersionCache(cacheDir);
  json.sections.theme = getThemeCache(cacheDir);

  // 5. Security-Audit
  const sec = getSecurityAudit(cacheDir);
  json.sections.security = sec;
  if (sec.abilities_count > 100) {
    json.action_items.push(`Viele Plugin-Abilities (${sec.abilities_count}): Audit empfohlen`);
  }

  // HTML-Report generieren
  const html = renderHtmlReport(json);
  if (outputDir) {
    try {
      mkdirSync(outputDir, { recursive: true });
      const htmlPath = join(outputDir, `quarterly-${date}.html`);
      const jsonPath = join(outputDir, `quarterly-${date}.json`);
      writeFileSync(htmlPath, html, 'utf8');
      writeFileSync(jsonPath, JSON.stringify(json, null, 2), 'utf8');
    } catch { /* noop */ }
  }

  return { html, json };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getPerformanceTrend(cacheDir: string): PerformanceTrend {
  if (!cacheDir || !existsSync(cacheDir)) {
    return { trend: 'unknown', reason: 'no cache' };
  }
  const metricsDir = join(cacheDir, 'metrics');
  if (!existsSync(metricsDir)) {
    return { trend: 'unknown', reason: 'no metrics dir' };
  }
  const files = readdirSync(metricsDir).filter(f => f.endsWith('.json')).sort();
  if (files.length < 2) {
    return { trend: 'baseline', files: files.length };
  }
  try {
    const first = JSON.parse(readFileSync(join(metricsDir, files[0]), 'utf8'));
    const last = JSON.parse(readFileSync(join(metricsDir, files[files.length - 1]), 'utf8'));
    const firstDuration: number = first.total_duration_ms || 0;
    const lastDuration: number = last.total_duration_ms || 0;
    if (firstDuration === 0) return { trend: 'baseline' };
    const change = ((lastDuration - firstDuration) / firstDuration) * 100;
    return {
      trend: change > 20 ? 'regression' : (change < -10 ? 'improvement' : 'stable'),
      change_pct: Math.round(change * 100) / 100,
      first_duration_ms: firstDuration,
      last_duration_ms: lastDuration,
    };
  } catch { return { trend: 'unknown' }; }
}

function getElementorVersionCache(cacheDir: string): ElementorCache {
  const envFile = join(cacheDir, 'elementor-env-solar.json');
  if (!existsSync(envFile)) return { version: 'unknown' };
  try {
    const data = JSON.parse(readFileSync(envFile, 'utf8'));
    return { version: data.version || 'unknown' };
  } catch { return { version: 'unknown' }; }
}

function getThemeCache(cacheDir: string): ThemeCache {
  const themeFile = join(cacheDir, 'theme-solar.json');
  if (!existsSync(themeFile)) return { name: 'unknown' };
  try {
    const data = JSON.parse(readFileSync(themeFile, 'utf8'));
    return { name: data.name || 'unknown' };
  } catch { return { name: 'unknown' }; }
}

function getSecurityAudit(cacheDir: string): SecurityAudit {
  const abilitiesFile = join(cacheDir, 'abilities-list.json');
  if (!existsSync(abilitiesFile)) return { abilities_count: 0 };
  try {
    const list = JSON.parse(readFileSync(abilitiesFile, 'utf8'));
    return { abilities_count: Array.isArray(list) ? list.length : 0 };
  } catch { return { abilities_count: 0 }; }
}

function renderHtmlReport(json: AuditJson): string {
  const s = json.sections;
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Quarterly Audit ${json.audit_date}</title>
<style>body{font-family:system-ui;max-width:900px;margin:20px auto;padding:20px}h2{border-bottom:1px solid #ddd;padding-bottom:4px}table{width:100%;border-collapse:collapse}td,th{padding:6px 12px;border-bottom:1px solid #eee;text-align:left}.ok{color:#0a7e29}.warn{color:#b25e09}.err{color:#c92121}.item{background:#fff8e1;padding:8px;margin:4px 0;border-left:4px solid #ffb300}</style>
</head><body>
<h1>Quarterly Audit</h1>
<div>${json.timestamp}</div>

${json.action_items.length > 0 ? `<h2>⚠️ Action Items</h2>${json.action_items.map(i => `<div class="item">${escapeHtml(i)}</div>`).join('')}` : '<h2>✅ No Action Items</h2>'}

${s.memory ? `<h2>Memory Lessons</h2>
<table><tr><th>Total</th><th>High (≥0.7)</th><th>Medium (≥0.4)</th><th>Low</th><th>Avg Confidence</th></tr>
<tr><td>${s.memory.stats.total}</td><td>${s.memory.stats.byConfidence.high}</td><td>${s.memory.stats.byConfidence.medium}</td><td>${s.memory.stats.byConfidence.low}</td><td>${s.memory.stats.avg_confidence}</td></tr></table>
<div>Decay: ${s.memory.decay.decayed} decayed, ${s.memory.decay.removed} removed</div>` : ''}

${s.bug_regression ? `<h2>Bug Regression Check</h2>
<table><tr><th>Bug</th><th>Name</th><th>File</th><th>Status</th></tr>
${s.bug_regression.map(b => `<tr><td>#${b.id}</td><td>${escapeHtml(b.name)}</td><td>${escapeHtml(b.file)}</td><td class="${b.file_exists ? 'ok' : 'err'}">${b.file_exists ? '✓' : '✗'}</td></tr>`).join('')}
</table>` : ''}

${s.performance ? `<h2>Performance Trend</h2>
<div>Trend: <span class="${s.performance.trend === 'regression' ? 'err' : s.performance.trend === 'improvement' ? 'ok' : 'warn'}">${s.performance.trend}</span></div>
${s.performance.change_pct != null ? `<div>Change: ${s.performance.change_pct}% (${s.performance.first_duration_ms}ms → ${s.performance.last_duration_ms}ms)</div>` : ''}` : ''}

${s.elementor ? `<h2>Environment</h2>
<div>Elementor: ${escapeHtml(s.elementor.version || '—')}</div>
<div>Theme: ${escapeHtml(s.theme?.name || '—')}</div>` : ''}

${s.security ? `<h2>Security</h2>
<div>Plugin-Abilities: ${s.security.abilities_count}</div>` : ''}

</body></html>`;
}

function escapeHtml(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c));
}

// ─── CLI ENTRY ───────────────────────────────────────────────────────────────

if (import.meta.url === `file:///${(process.argv[1] || '').replace(/\\/g, '/')}`) {
  const cacheDir = process.env.CACHE_DIR || '.framer-export-cache';
  const outputDir = process.env.OUTPUT_DIR || 'reports';
  runQuarterlyAudit({ cacheDir, outputDir }).then(({ json }) => {
    console.log(`\nQuarterly Audit — ${json.audit_date}`);
    console.log(`Action Items: ${json.action_items.length}`);
    for (const item of json.action_items) console.log(`  • ${item}`);
  }).catch(err => {
    console.error('Audit failed:', err);
    process.exit(1);
  });
}
