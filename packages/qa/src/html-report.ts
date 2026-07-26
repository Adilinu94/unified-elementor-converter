import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AutoFixReport } from './auto-fix.js';
import { countBySeverity, countByType, type Issue } from './issue-detector.js';
import type { IssueSeverity } from './strictness.js';

export interface HtmlReportOptions {
  report: AutoFixReport;
  originalScreenshotBase64?: string;
  cloneScreenshotBase64?: string;
  diffScreenshotBase64?: string;
  outputPath: string;
  hostname: string;
  strictnessLabel: string;
  strictness?: string;
}

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

const SEVERITY_COLORS: Record<IssueSeverity, string> = {
  high: '#ff5757',
  medium: '#ffb547',
  low: '#7ed957',
};
void SEVERITY_COLORS;

const ISSUE_TYPE_LABELS: Record<string, string> = {
  'color-mismatch': 'Color Mismatch',
  'font-missing': 'Font Missing',
  'layout-shift': 'Layout Shift',
  'size-mismatch': 'Size Mismatch',
  'image-broken': 'Image Broken',
  'animation-inactive': 'Animation Inactive',
  'blank-region': 'Blank Region',
  'size-different': 'Size Different',
};

export async function writeHtmlReport(options: HtmlReportOptions): Promise<string> {
  const html = renderHtml(options);
  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fs.writeFile(options.outputPath, html, 'utf-8');
  return options.outputPath;
}

export function renderHtml(options: HtmlReportOptions): string {
  const { report } = options;
  const severities = countBySeverity(report.outstandingIssues);
  const types = countByType(report.outstandingIssues);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Clone Report — ${escapeHtml(options.hostname)} — ${escapeHtml(report.strictness)}</title>
<style>
  :root {
    --bg: #0d1117;
    --panel: #161b22;
    --border: #30363d;
    --text: #c9d1d9;
    --muted: #8b949e;
    --accent: #58a6ff;
    --good: #7ed957;
    --warn: #ffb547;
    --bad: #ff5757;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
  header { padding: 32px 40px; border-bottom: 1px solid var(--border); background: linear-gradient(180deg, #161b22 0%, #0d1117 100%); }
  h1 { margin: 0 0 8px; font-size: 28px; font-weight: 600; }
  h2 { font-size: 18px; font-weight: 600; margin: 32px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
  h3 { font-size: 14px; font-weight: 600; margin: 16px 0 8px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .subtitle { color: var(--muted); font-size: 14px; }
  main { max-width: 1200px; margin: 0 auto; padding: 24px 40px 80px; }
  .verdict { display: inline-block; padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; }
  .verdict.pass { background: rgba(126, 217, 87, 0.15); color: var(--good); border: 1px solid var(--good); }
  .verdict.fail { background: rgba(255, 87, 87, 0.15); color: var(--bad); border: 1px solid var(--bad); }
  .verdict.warning { background: rgba(255, 181, 71, 0.15); color: var(--warn); border: 1px solid var(--warn); }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 18px; }
  .metric { font-size: 32px; font-weight: 700; margin: 4px 0 0; }
  .metric-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  .progress { background: rgba(255,255,255,0.06); height: 8px; border-radius: 4px; overflow: hidden; margin-top: 8px; }
  .progress-fill { height: 100%; transition: width 0.3s; }
  .progress-fill.good { background: var(--good); }
  .progress-fill.warn { background: var(--warn); }
  .progress-fill.bad { background: var(--bad); }
  .screenshot { max-width: 100%; border: 1px solid var(--border); border-radius: 4px; }
  .screenshot-row { display: grid; grid-template-columns: 1fr; gap: 16px; }
  .round { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 12px; }
  .round-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .round-number { font-weight: 600; font-size: 16px; }
  .issue { background: var(--panel); border-left: 3px solid var(--border); padding: 12px 16px; margin-bottom: 8px; border-radius: 4px; }
  .issue.high { border-left-color: var(--bad); }
  .issue.medium { border-left-color: var(--warn); }
  .issue.low { border-left-color: var(--good); }
  .issue-type { font-weight: 600; }
  .issue-region { color: var(--muted); font-size: 12px; margin-left: 8px; }
  .issue-desc { margin: 6px 0 4px; font-size: 13px; }
  .issue-fix { color: var(--muted); font-size: 12px; font-style: italic; }
  .severity-badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
  .severity-badge.high { background: rgba(255, 87, 87, 0.2); color: var(--bad); }
  .severity-badge.medium { background: rgba(255, 181, 71, 0.2); color: var(--warn); }
  .severity-badge.low { background: rgba(126, 217, 87, 0.2); color: var(--good); }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
  td { font-size: 13px; }
  footer { padding: 24px 40px; color: var(--muted); font-size: 12px; text-align: center; border-top: 1px solid var(--border); }
  code { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 3px; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>Clone Report</h1>
  <div class="subtitle">${escapeHtml(options.hostname)} · Strictness: <code>${escapeHtml(options.strictness ?? report.strictness)}</code> (${escapeHtml(options.strictnessLabel)}) · Generated ${escapeHtml(report.generatedAt)}</div>
  <div style="margin-top: 16px;">
    <span class="verdict ${report.targetReached ? 'pass' : 'fail'}">${report.targetReached ? 'TARGET REACHED' : 'TARGET NOT REACHED'}</span>
  </div>
</header>
<main>
  <h2>Summary</h2>
  <div class="grid">
    <div class="card">
      <div class="metric-label">Match (pixelmatch)</div>
      <div class="metric">${report.finalMatchPercent.toFixed(2)}%</div>
      <div class="progress"><div class="progress-fill ${progressClass(report.finalMatchPercent)}" style="width: ${report.finalMatchPercent}%;"></div></div>
    </div>
    <div class="card">
      <div class="metric-label">Match (SSIM)</div>
      <div class="metric">${report.finalSsim.toFixed(2)}%</div>
      <div class="progress"><div class="progress-fill ${progressClass(report.finalSsim)}" style="width: ${report.finalSsim}%;"></div></div>
    </div>
    <div class="card">
      <div class="metric-label">Initial Match</div>
      <div class="metric">${report.initialMatchPercent.toFixed(2)}%</div>
      <div class="subtitle">Δ ${(report.finalMatchPercent - report.initialMatchPercent).toFixed(2)} pp</div>
    </div>
    <div class="card">
      <div class="metric-label">Rounds</div>
      <div class="metric">${report.totalRounds} / ${report.profile.maxRounds}</div>
      <div class="subtitle">${report.profile.label}</div>
    </div>
    <div class="card">
      <div class="metric-label">Target</div>
      <div class="metric">${report.profile.minMatchPercent}%</div>
      <div class="subtitle">${report.targetReached ? '✓ Achieved' : '✗ Not reached'}</div>
    </div>
    <div class="card">
      <div class="metric-label">Outstanding Issues</div>
      <div class="metric">${report.outstandingIssues.length}</div>
      <div class="subtitle">${severities.high} high · ${severities.medium} medium · ${severities.low} low</div>
    </div>
  </div>

  <h2>Issue Breakdown</h2>
  <table>
    <thead><tr><th>Type</th><th>Count</th></tr></thead>
    <tbody>
      ${Object.entries(types)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `<tr><td>${escapeHtml(ISSUE_TYPE_LABELS[type] ?? type)}</td><td>${count}</td></tr>`)
        .join('')}
    </tbody>
  </table>

  <h2>Rounds</h2>
  ${report.rounds.map(renderRound).join('\n')}

  <h2>Outstanding Issues (${report.outstandingIssues.length})</h2>
  ${report.outstandingIssues.length === 0 ? '<div class="card">No outstanding issues.</div>' : report.outstandingIssues.map(renderIssue).join('\n')}

  ${(options.originalScreenshotBase64 || options.cloneScreenshotBase64 || options.diffScreenshotBase64) ? `
  <h2>Screenshots</h2>
  <div class="screenshot-row">
    ${options.originalScreenshotBase64 ? `<div class="card"><h3>Original</h3><img class="screenshot" src="data:image/png;base64,${options.originalScreenshotBase64}" alt="Original" /></div>` : ''}
    ${options.cloneScreenshotBase64 ? `<div class="card"><h3>Final Clone</h3><img class="screenshot" src="data:image/png;base64,${options.cloneScreenshotBase64}" alt="Clone" /></div>` : ''}
    ${options.diffScreenshotBase64 ? `<div class="card"><h3>Diff</h3><img class="screenshot" src="data:image/png;base64,${options.diffScreenshotBase64}" alt="Diff" /></div>` : ''}
  </div>
  ` : ''}
</main>
<footer>
  Generated by site-clone-to-v3 (Phase 8 Visual QA) · Strictness: ${escapeHtml(report.strictness)} · ${report.generatedAt}
</footer>
</body>
</html>`;
}

function renderRound(round: AutoFixReport['rounds'][number]): string {
  return `<div class="round">
    <div class="round-header">
      <span class="round-number">Round ${round.round}</span>
      <span class="subtitle">${round.matchPercentBefore.toFixed(2)}% → ${round.matchPercentAfter.toFixed(2)}% (SSIM ${round.ssimBefore.toFixed(2)}% → ${round.ssimAfter.toFixed(2)}%)</span>
    </div>
    <div class="subtitle">Detected: ${round.issuesDetected} · Fixed: ${round.issuesFixed} · Skipped: ${round.issuesSkipped} · ${round.startedAt} → ${round.finishedAt}</div>
    ${round.fixes.length > 0 ? `<table style="margin-top: 8px;"><thead><tr><th>Issue</th><th>Fixer</th><th>Result</th></tr></thead><tbody>${round.fixes.map((f) => `<tr><td>${escapeHtml(ISSUE_TYPE_LABELS[f.issue.type] ?? f.issue.type)} (${f.issue.severity})</td><td>—</td><td>${f.ok ? '✓' : '✗'} ${escapeHtml(f.message)}</td></tr>`).join('')}</tbody></table>` : ''}
  </div>`;
}

function renderIssue(issue: Issue): string {
  return `<div class="issue ${issue.severity}">
    <span class="issue-type">${escapeHtml(ISSUE_TYPE_LABELS[issue.type] ?? issue.type)}</span>
    <span class="issue-region">(${issue.region.x}, ${issue.region.y}) ${issue.region.width}×${issue.region.height}px · ${issue.diffPixels}px diff</span>
    <span class="severity-badge ${issue.severity}" style="float: right;">${issue.severity}</span>
    <div class="issue-desc">${escapeHtml(issue.description)}</div>
    <div class="issue-fix">Fix: ${escapeHtml(issue.suggestedFix)}</div>
  </div>`;
}

function progressClass(percent: number): 'good' | 'warn' | 'bad' {
  if (percent >= 95) return 'good';
  if (percent >= 70) return 'warn';
  return 'bad';
}
