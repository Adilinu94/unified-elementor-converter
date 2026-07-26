// @ts-nocheck — Migration-Marker: Typen werden schrittweise verfeinert (UMBAUPLAN Step 14)
/**
 * src/cli/build-report.js — UMBAUPLAN v2.0 Phase 6.2
 *
 * Generiert nach jedem Pipeline-Run einen HTML-Build-Report mit:
 *   - Pipeline-Trace (welche Skripte, wie lange)
 *   - Validation-Score (vor/nach Fixes)
 *   - Elementor-Version + Theme-Detection
 *   - Workarounds-Applied-Liste
 *   - Invarianten-Status
 *   - QA-Results (Layout/Visual/A11y/SEO)
 *   - Actionable Insights
 *
 * USAGE:
 *   import { generateBuildReport } from './build-report.js';
 *   const html = generateBuildReport({ post_id, trace, validation, workarounds, qa, ... });
 *   writeFileSync('tmp/build-report-{timestamp}.html', html);
 */

/**
 * Generiert den HTML-Build-Report.
 *
 * @param {object} data
 * @param {number} data.post_id
 * @param {string} [data.framer_url]
 * @param {Array<{script: string, duration_ms: number, status: string}>} [data.trace=[]]
 * @param {object} [data.validation] - {score, errors, warnings, passed}
 * @param {object} [data.elementor] - {version, is_beta}
 * @param {object} [data.theme] - {name, supports_custom_css}
 * @param {Array<{id: string, status: string, detail: string}>} [data.workarounds=[]]
 * @param {object} [data.invariants] - {I, II, III, IV, V}
 * @param {object} [data.qa] - {layout, visual, a11y, seo}
 * @param {Array<string>} [data.insights=[]]
 * @returns {string} HTML content
 */
export function generateBuildReport(data) {
  const ts = new Date().toISOString();
  const totalDuration = (data.trace || []).reduce((s, t) => s + (t.duration_ms || 0), 0);

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Build Report — post_id=${data.post_id}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 1200px; margin: 20px auto; padding: 20px; background: #f7f7f9; color: #222; }
    h1 { margin: 0 0 4px 0; }
    h2 { margin: 24px 0 8px 0; padding-bottom: 4px; border-bottom: 1px solid #ddd; }
    .meta { color: #666; font-size: 14px; margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 12px 0; }
    .card { background: white; border: 1px solid #e1e1e8; border-radius: 6px; padding: 12px; }
    .card .label { font-size: 12px; color: #666; text-transform: uppercase; }
    .card .value { font-size: 24px; font-weight: 600; margin: 4px 0; }
    .pass { color: #0a7e29; }
    .fail { color: #c92121; }
    .warn { color: #b25e09; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 6px; overflow: hidden; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }
    th { background: #f0f0f4; font-size: 12px; text-transform: uppercase; }
    .insight { background: #fff8e1; border-left: 4px solid #ffb300; padding: 8px 12px; margin: 4px 0; border-radius: 0 4px 4px 0; }
  </style>
</head>
<body>
  <h1>Build Report</h1>
  <div class="meta">
    post_id=${data.post_id}${data.framer_url ? ` · framer_url=${escape(data.framer_url)}` : ''} · ${ts} · total ${(totalDuration / 1000).toFixed(1)}s
  </div>

  ${renderSummaryCards(data, totalDuration)}
  ${renderTraceTable(data.trace || [])}
  ${renderValidationCard(data.validation)}
  ${renderEnvironmentCard(data.elementor, data.theme)}
  ${renderWorkarounds(data.workarounds || [])}
  ${renderInvariants(data.invariants)}
  ${renderQaGrid(data.qa)}
  ${renderInsights(data.insights || [])}
</body>
</html>`;
}

function renderSummaryCards(data, totalDuration) {
  const v = data.validation || {};
  const w = (data.workarounds || []).filter(x => x.status === 'applied').length;
  return `<h2>Summary</h2>
  <div class="grid">
    <div class="card"><div class="label">Validation Score</div><div class="value ${v.passed ? 'pass' : 'fail'}">${v.score ?? '—'}${v.score != null ? '%' : ''}</div></div>
    <div class="card"><div class="label">Errors</div><div class="value ${v.errors > 0 ? 'fail' : 'pass'}">${v.errors ?? 0}</div></div>
    <div class="card"><div class="label">Warnings</div><div class="value warn">${v.warnings ?? 0}</div></div>
    <div class="card"><div class="label">Workarounds</div><div class="value">${w}</div></div>
    <div class="card"><div class="label">Total Duration</div><div class="value">${(totalDuration / 1000).toFixed(1)}s</div></div>
  </div>`;
}

function renderTraceTable(trace) {
  if (trace.length === 0) return '';
  return `<h2>Pipeline Trace</h2>
  <table>
    <thead><tr><th>Script</th><th>Status</th><th>Duration</th></tr></thead>
    <tbody>
      ${trace.map(t => `<tr><td>${escape(t.script)}</td><td class="${t.status === 'ok' ? 'pass' : 'fail'}">${t.status}</td><td>${t.duration_ms}ms</td></tr>`).join('')}
    </tbody>
  </table>`;
}

function renderValidationCard(v) {
  if (!v) return '';
  return `<h2>Validation</h2>
  <div class="card">
    <div>Score: <strong>${v.score ?? '—'}%</strong> (${v.passed ? 'PASS' : 'FAIL'})</div>
    <div>Errors: ${v.errors ?? 0} · Warnings: ${v.warnings ?? 0}</div>
  </div>`;
}

function renderEnvironmentCard(elementor, theme) {
  if (!elementor && !theme) return '';
  return `<h2>Environment</h2>
  <div class="grid">
    ${elementor ? `<div class="card"><div class="label">Elementor</div><div class="value">${escape(elementor.version || '—')}</div>${elementor.is_beta ? '<div class="warn">⚠️ Beta — Workarounds aktiv</div>' : ''}</div>` : ''}
    ${theme ? `<div class="card"><div class="label">Theme</div><div class="value">${escape(theme.name || '—')}</div><div>${theme.supports_custom_css ? 'Custom-CSS: ✅' : 'Custom-CSS: ❌'}</div></div>` : ''}
  </div>`;
}

function renderWorkarounds(workarounds) {
  if (workarounds.length === 0) return '';
  return `<h2>Workarounds</h2>
  <table>
    <thead><tr><th>ID</th><th>Status</th><th>Detail</th></tr></thead>
    <tbody>
      ${workarounds.map(w => `<tr><td>${escape(w.id)}</td><td class="${w.status === 'applied' ? 'pass' : 'warn'}">${w.status}</td><td>${escape(w.detail || '')}</td></tr>`).join('')}
    </tbody>
  </table>`;
}

function renderInvariants(inv) {
  if (!inv) return '';
  const keys = ['I', 'II', 'III', 'IV', 'V'];
  return `<h2>Invariants</h2>
  <div class="grid">
    ${keys.map(k => {
      const v = inv[k];
      return `<div class="card"><div class="label">Invariant ${k}</div><div class="value ${v?.passed ? 'pass' : 'fail'}">${v?.passed ? '✓' : '✗'}</div><div>${escape(v?.detail || '—')}</div></div>`;
    }).join('')}
  </div>`;
}

function renderQaGrid(qa) {
  if (!qa) return '';
  return `<h2>QA Results</h2>
  <div class="grid">
    ${Object.entries(qa).map(([key, val]) => {
      const passed = val?.score != null ? val.score >= 85 : val?.passed;
      return `<div class="card"><div class="label">${key}</div><div class="value ${passed ? 'pass' : 'fail'}">${val?.score != null ? val.score + '%' : (val?.passed ? '✓' : '✗')}</div><div>${escape(val?.detail || '')}</div></div>`;
    }).join('')}
  </div>`;
}

function renderInsights(insights) {
  if (insights.length === 0) return '';
  return `<h2>Actionable Insights</h2>
  ${insights.map(i => `<div class="insight">💡 ${escape(i)}</div>`).join('')}`;
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
