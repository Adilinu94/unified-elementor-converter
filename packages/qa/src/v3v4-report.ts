import fs from 'node:fs';
import path from 'node:path';
import type { Issue } from './issue-detector.js';

export interface ViewportReport {
  viewport: string;
  width: number;
  matchPercent: number;
  ssimPercent: number;
  diffPixels: number;
  totalPixels: number;
  issues: Issue[];
  originalImg: string;
  cloneImg: string;
  diffImg: string;
}

export interface V3V4Report {
  v3Url: string;
  v4Url: string;
  v3Label: string;
  v4Label: string;
  generatedAt: string;
  viewports: ViewportReport[];
  overallMatch: number;
  overallSsim: number;
  outputDir: string;
}

function imgToBase64(filePath: string): string {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch {
    return '';
  }
}

export async function generateV3V4HtmlReport(report: V3V4Report): Promise<string> {
  const htmlPath = path.join(report.outputDir, 'v3v4-diff-report.html');

  const viewportTabs = report.viewports.map((vp, i) => {
    const origB64 = imgToBase64(vp.originalImg);
    const cloneB64 = imgToBase64(vp.cloneImg);
    const diffB64 = imgToBase64(vp.diffImg);
    const active = i === 0 ? ' active' : '';
    const issuesJson = JSON.stringify(vp.issues);

    return `<div class="viewport-tab${active}" data-viewport="${vp.viewport}">
  <div class="viewport-header">
    <h2>${vp.viewport}</h2>
    <div class="viewport-metrics">
      <span class="metric ${vp.matchPercent >= 95 ? 'good' : vp.matchPercent >= 85 ? 'warn' : 'bad'}">
        Pixelmatch: ${vp.matchPercent.toFixed(2)}%
      </span>
      <span class="metric ${vp.ssimPercent >= 95 ? 'good' : vp.ssimPercent >= 85 ? 'warn' : 'bad'}">
        SSIM: ${vp.ssimPercent.toFixed(2)}%
      </span>
      <span class="metric">Diff: ${vp.diffPixels.toLocaleString()} / ${vp.totalPixels.toLocaleString()} px</span>
      <span class="metric">Issues: ${vp.issues.length}</span>
    </div>
  </div>

  <div class="compare-container">
    <div class="compare-controls">
      <button class="mode-btn active" data-mode="side">Side by Side</button>
      <button class="mode-btn" data-mode="diff">Diff Overlay</button>
      <button class="mode-btn" data-mode="swipe">Swipe</button>
    </div>

    <div class="compare-mode side-by-side active">
      <div class="compare-panel">
        <h3>V3 (Original)</h3>
        <img src="${origB64}" alt="V3 Screenshot" />
      </div>
      <div class="compare-panel">
        <h3>V4 (Converted)</h3>
        <img src="${cloneB64}" alt="V4 Screenshot" />
      </div>
    </div>

    <div class="compare-mode diff-overlay">
      <img src="${origB64}" alt="Original" class="diff-original" />
      <img src="${diffB64}" alt="Diff" class="diff-overlay-img" />
      <div class="diff-opacity-control">
        <label>Diff Opacity: <span class="opacity-value">50</span>%</label>
        <input type="range" min="0" max="100" value="50" class="opacity-slider" />
      </div>
    </div>

    <div class="compare-mode swipe-compare">
      <div class="swipe-container">
        <img src="${cloneB64}" alt="V4" class="swipe-base" />
        <div class="swipe-overlay">
          <img src="${origB64}" alt="V3" class="swipe-overlay-img" />
        </div>
        <div class="swipe-handle"></div>
      </div>
    </div>
  </div>

  ${vp.issues.length > 0 ? `<div class="issues-section">
    <h3>Detected Issues (${vp.issues.length})</h3>
    <div class="issues-list" data-issues='${issuesJson.replace(/'/g, "&#39;")}'></div>
  </div>` : '<div class="issues-section"><h3>No issues detected</h3></div>'}
</div>`;
  }).join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>V3 vs V4 Diff Report</title>
<style>
  :root {
    --bg: #0d1117;
    --panel: #161b22;
    --border: #30363d;
    --text: #c9d1d9;
    --muted: #8b949e;
    --accent: #58a6ff;
    --good: #3fb950;
    --warn: #d29922;
    --bad: #f85149;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
  header { padding: 24px 32px; border-bottom: 1px solid var(--border); background: linear-gradient(180deg, #161b22 0%, #0d1117 100%); }
  h1 { font-size: 24px; margin-bottom: 8px; }
  .subtitle { color: var(--muted); font-size: 13px; }
  .urls { display: flex; gap: 16px; margin-top: 8px; font-size: 13px; flex-wrap: wrap; }
  .urls span { color: var(--accent); }
  main { max-width: 1400px; margin: 0 auto; padding: 20px 32px 60px; }

  .viewport-tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
  .viewport-tab-btn { padding: 8px 20px; background: none; border: none; color: var(--muted); cursor: pointer; font-size: 14px; border-bottom: 2px solid transparent; }
  .viewport-tab-btn:hover { color: var(--text); }
  .viewport-tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
  .viewport-tab { display: none; }
  .viewport-tab.active { display: block; }

  .overall-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .metric-card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 16px; text-align: center; }
  .metric-card .value { font-size: 28px; font-weight: 700; margin-top: 4px; }
  .metric-card .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  .metric-card .value.good { color: var(--good); }
  .metric-card .value.warn { color: var(--warn); }
  .metric-card .value.bad { color: var(--bad); }
  .progress { background: rgba(255,255,255,0.06); height: 6px; border-radius: 3px; margin-top: 8px; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }

  .viewport-header { margin-bottom: 16px; }
  .viewport-header h2 { font-size: 18px; margin-bottom: 8px; text-transform: capitalize; }
  .viewport-metrics { display: flex; gap: 12px; flex-wrap: wrap; }
  .viewport-metrics .metric { padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; background: var(--panel); border: 1px solid var(--border); }
  .viewport-metrics .metric.good { border-color: var(--good); color: var(--good); }
  .viewport-metrics .metric.warn { border-color: var(--warn); color: var(--warn); }
  .viewport-metrics .metric.bad { border-color: var(--bad); color: var(--bad); }

  .compare-container { margin-bottom: 20px; }
  .compare-controls { display: flex; gap: 4px; margin-bottom: 12px; }
  .mode-btn { padding: 6px 16px; background: var(--panel); border: 1px solid var(--border); color: var(--muted); cursor: pointer; border-radius: 4px; font-size: 13px; }
  .mode-btn:hover { color: var(--text); border-color: var(--accent); }
  .mode-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .compare-mode { display: none; }
  .compare-mode.active { display: flex; }

  .side-by-side { gap: 16px; flex-wrap: wrap; }
  .side-by-side .compare-panel { flex: 1; min-width: 300px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
  .side-by-side .compare-panel h3 { font-size: 13px; color: var(--muted); margin-bottom: 8px; }
  .side-by-side .compare-panel img { width: 100%; height: auto; border-radius: 4px; display: block; }

  .diff-overlay { position: relative; flex-direction: column; align-items: center; }
  .diff-overlay img { max-width: 100%; height: auto; border-radius: 4px; }
  .diff-original { position: absolute; top: 0; left: 0; width: 100%; height: auto; z-index: 1; }
  .diff-overlay-img { position: relative; z-index: 2; width: 100%; height: auto; }
  .diff-opacity-control { margin-top: 12px; display: flex; align-items: center; gap: 12px; background: var(--panel); padding: 8px 16px; border-radius: 6px; border: 1px solid var(--border); }
  .diff-opacity-control label { font-size: 13px; color: var(--muted); }
  .diff-opacity-control input { flex: 1; max-width: 200px; accent-color: var(--accent); }

  .swipe-compare { justify-content: center; }
  .swipe-container { position: relative; display: inline-block; overflow: hidden; border-radius: 4px; touch-action: none; }
  .swipe-container img { display: block; max-width: 100%; height: auto; }
  .swipe-base { width: 100%; }
  .swipe-overlay { position: absolute; top: 0; left: 0; height: 100%; overflow: hidden; z-index: 2; }
  .swipe-overlay-img { display: block; height: 100%; width: auto; max-width: none; position: absolute; top: 0; left: 0; }
  .swipe-handle { position: absolute; top: 0; bottom: 0; width: 3px; background: var(--accent); z-index: 3; cursor: ew-resize; left: 50%; }
  .swipe-handle::before { content: '◀▶'; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--accent); color: #fff; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 10px; }

  .issues-section { margin-top: 16px; }
  .issues-section h3 { font-size: 14px; margin-bottom: 8px; }
  .issue-item { background: var(--panel); border-left: 3px solid var(--border); padding: 10px 14px; margin-bottom: 6px; border-radius: 4px; font-size: 13px; }
  .issue-item.high { border-left-color: var(--bad); }
  .issue-item.medium { border-left-color: var(--warn); }
  .issue-item.low { border-left-color: var(--good); }
  .issue-severity { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; text-transform: uppercase; margin-right: 8px; }
  .issue-severity.high { background: rgba(248,81,73,0.2); color: var(--bad); }
  .issue-severity.medium { background: rgba(210,153,34,0.2); color: var(--warn); }
  .issue-severity.low { background: rgba(63,185,80,0.2); color: var(--good); }
  .issue-desc { margin-top: 4px; color: var(--muted); }
  .issue-fix { margin-top: 4px; font-style: italic; font-size: 12px; color: var(--muted); }

  footer { padding: 20px 32px; color: var(--muted); font-size: 12px; text-align: center; border-top: 1px solid var(--border); }
</style>
</head>
<body>
<header>
  <h1>V3 vs V4 Visual Diff</h1>
  <div class="subtitle">Generated ${report.generatedAt}</div>
  <div class="urls">
    <div><strong>V3:</strong> <span>${report.v3Url}</span></div>
    <div><strong>V4:</strong> <span>${report.v4Url}</span></div>
  </div>
</header>
<main>
  <h2 style="margin-bottom: 12px; font-size: 16px;">Overall Match</h2>
  <div class="overall-metrics">
    <div class="metric-card">
      <div class="label">Pixelmatch</div>
      <div class="value ${report.overallMatch >= 95 ? 'good' : report.overallMatch >= 85 ? 'warn' : 'bad'}">${report.overallMatch.toFixed(2)}%</div>
      <div class="progress"><div class="progress-fill ${report.overallMatch >= 95 ? 'good' : report.overallMatch >= 85 ? 'warn' : 'bad'}" style="width: ${report.overallMatch}%;"></div></div>
    </div>
    <div class="metric-card">
      <div class="label">SSIM</div>
      <div class="value ${report.overallSsim >= 95 ? 'good' : report.overallSsim >= 85 ? 'warn' : 'bad'}">${report.overallSsim.toFixed(2)}%</div>
      <div class="progress"><div class="progress-fill ${report.overallSsim >= 95 ? 'good' : report.overallSsim >= 85 ? 'warn' : 'bad'}" style="width: ${report.overallSsim}%;"></div></div>
    </div>
    <div class="metric-card">
      <div class="label">V3 URL</div>
      <div style="font-size: 12px; margin-top: 4px; word-break: break-all; color: var(--accent);">${report.v3Url}</div>
    </div>
    <div class="metric-card">
      <div class="label">V4 URL</div>
      <div style="font-size: 12px; margin-top: 4px; word-break: break-all; color: var(--accent);">${report.v4Url}</div>
    </div>
  </div>

  <div class="viewport-tabs">
    ${report.viewports.map((vp, i) => `<button class="viewport-tab-btn${i === 0 ? ' active' : ''}" data-target="${vp.viewport}">${vp.viewport}</button>`).join('')}
  </div>

  ${viewportTabs}

  <h2 style="margin-top: 24px; font-size: 14px; color: var(--muted);">How to Interpret</h2>
  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; margin-top: 8px;">
    <div class="metric-card" style="text-align: left;">
      <div class="label">Side by Side</div>
      <div style="font-size: 13px; margin-top: 4px; color: var(--muted);">V3 left, V4 right. Scroll both in sync.</div>
    </div>
    <div class="metric-card" style="text-align: left;">
      <div class="label">Diff Overlay</div>
      <div style="font-size: 13px; margin-top: 4px; color: var(--muted);">Red pixels = different between V3 and V4. Use opacity slider.</div>
    </div>
    <div class="metric-card" style="text-align: left;">
      <div class="label">Swipe</div>
      <div style="font-size: 13px; margin-top: 4px; color: var(--muted);">Drag the handle left/right to reveal V3 under V4.</div>
    </div>
  </div>
</main>
<footer>
  Generated by site-clone-to-v3 · v3v4-diff command · ${report.generatedAt}
</footer>
<script>
(function() {
  // Viewport tabs
  document.querySelectorAll('.viewport-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.viewport-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.viewport-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const target = document.querySelector('.viewport-tab[data-viewport="' + btn.dataset.target + '"]');
      if (target) target.classList.add('active');
    });
  });

  // Compare mode tabs (per viewport)
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const container = btn.closest('.compare-container');
      container.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      container.querySelectorAll('.compare-mode').forEach(m => m.classList.remove('active'));
      btn.classList.add('active');
      const mode = container.querySelector('.compare-mode.' + btn.dataset.mode);
      if (mode) mode.classList.add('active');
    });
  });

  // Diff overlay opacity slider
  document.querySelectorAll('.opacity-slider').forEach(slider => {
    const label = slider.closest('.diff-opacity-control').querySelector('.opacity-value');
    const overlay = slider.closest('.diff-overlay').querySelector('.diff-original');
    const update = () => {
      const val = parseInt(slider.value);
      if (label) label.textContent = val;
      overlay.style.opacity = val / 100;
    };
    slider.addEventListener('input', update);
    update();
  });

  // Swipe compare
  document.querySelectorAll('.swipe-container').forEach(container => {
    const overlay = container.querySelector('.swipe-overlay');
    const handle = container.querySelector('.swipe-handle');
    let isDragging = false;

    function setPosition(x) {
      const rect = container.getBoundingClientRect();
      let pos = x - rect.left;
      pos = Math.max(0, Math.min(pos, rect.width));
      overlay.style.width = pos + 'px';
      handle.style.left = pos + 'px';
    }

    handle.addEventListener('mousedown', () => { isDragging = true; });
    document.addEventListener('mousemove', (e) => { if (isDragging) setPosition(e.clientX); });
    document.addEventListener('mouseup', () => { isDragging = false; });

    handle.addEventListener('touchstart', () => { isDragging = true; });
    document.addEventListener('touchmove', (e) => {
      if (isDragging && e.touches.length > 0) setPosition(e.touches[0].clientX);
    });
    document.addEventListener('touchend', () => { isDragging = false; });

    setPosition(container.querySelector('.swipe-overlay-img').getBoundingClientRect().width / 2);
  });

  // Issues rendering
  document.querySelectorAll('.issues-list').forEach(list => {
    try {
      const issues = JSON.parse(list.dataset.issues);
      if (!issues.length) {
        list.innerHTML = '<div class="subtitle">No issues</div>';
        return;
      }
      list.innerHTML = issues.map(issue => {
        const sev = issue.severity || 'low';
        return '<div class="issue-item ' + sev + '">' +
          '<span class="issue-severity ' + sev + '">' + sev + '</span>' +
          '<strong>' + (issue.type || 'Unknown') + '</strong>' +
          '<div class="issue-desc">' + (issue.description || '') + '</div>' +
          '<div class="issue-fix">Fix: ' + (issue.suggestedFix || 'Inspect manually') + '</div>' +
          '</div>';
      }).join('');
    } catch(e) { list.innerHTML = '<div class="subtitle">Error parsing issues</div>'; }
  });
})();
</script>
</body>
</html>`;

  fs.mkdirSync(report.outputDir, { recursive: true });
  fs.writeFileSync(htmlPath, html, 'utf-8');
  return htmlPath;
}
