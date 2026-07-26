#!/usr/bin/env node
/**
 * scripts/visual-diff.mjs  —  V3 vs V4 Visual Diff Tool  (v2.0)
 *
 * USAGE
 *   node scripts/visual-diff.mjs [options]
 *
 * REQUIRED
 *   --v3-url <url>         Source/original URL
 *   --v4-url <url>         Target/converted URL
 *
 * OPTIONS
 *   --viewports <list>     Comma-separated: desktop,tablet,mobile  (default: desktop,mobile)
 *   --output <dir>         Output directory                        (default: diff-output)
 *   --mode <mode>          fold | full | both                      (default: both)
 *                            fold = viewport height only (fast, good for hero diffs)
 *                            full = full-page scroll               (slower, complete)
 *                            both = saves fold + full separately
 *   --section <name>       Named crop: hero | services | cta       (default: all)
 *                            hero     = top 900px
 *                            services = 900–2200px
 *                            cta      = last 600px
 *   --retries <n>          Screenshot retries on blank/error       (default: 3)
 *   --threshold <0-1>      pixelmatch threshold                    (default: 0.1)
 *   --pass-pct <0-100>     Match % required to PASS                (default: 85)
 *   --baseline             Save screenshots as baseline instead of diffing
 *   --compare-baseline     Compare current screenshots against saved baseline
 *   --run-label <label>    Tag for this run (saved in summary.json)
 *
 * OUTPUTS
 *   <output>/<label>-<viewport>[-fold|-full].png   Screenshots
 *   <output>/<label>-<viewport>-diff[-fold|-full].png  Pixel diffs
 *   <output>/report.html   Self-contained HTML report with slider comparison
 *   stdout JSON            { results, summary, run_label }  (for CI/GH Actions parsing)
 *
 * EXIT CODES
 *   0  All viewports pass (>= pass-pct)
 *   1  One or more viewports fail
 *   2  Configuration / fatal error
 */

import { chromium } from "playwright";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

// ─── CLI ─────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    "v3-url":             { type: "string" },
    "v4-url":             { type: "string" },
    viewports:            { type: "string", default: "desktop,mobile" },
    output:               { type: "string", default: "diff-output" },
    mode:                 { type: "string", default: "both" },
    section:              { type: "string", default: "all" },
    retries:              { type: "string", default: "3" },
    threshold:            { type: "string", default: "0.1" },
    "pass-pct":           { type: "string", default: "85" },
    baseline:             { type: "boolean", default: false },
    "compare-baseline":   { type: "boolean", default: false },
    "run-label":          { type: "string", default: "" },
  },
  strict: true,
});

const V3_URL    = args["v3-url"];
const V4_URL    = args["v4-url"];
const MODE      = args.mode;           // fold | full | both
const SECTION   = args.section;        // all | hero | services | cta
const OUT_DIR   = args.output;
const RETRIES   = Math.max(1, parseInt(args.retries, 10));
const THRESHOLD = parseFloat(args.threshold);
const PASS_PCT  = parseFloat(args["pass-pct"]);
const IS_BASELINE = args.baseline;
const CMP_BASELINE = args["compare-baseline"];
const RUN_LABEL = args["run-label"] ||
  new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");

if (!V3_URL || !V4_URL) {
  console.error("ERROR: --v3-url and --v4-url are required");
  process.exit(2);
}
if (!["fold", "full", "both"].includes(MODE)) {
  console.error("ERROR: --mode must be fold | full | both");
  process.exit(2);
}

// ─── Viewport presets ────────────────────────────────────────────────────────

const VIEWPORT_PRESETS = {
  desktop: { width: 1440, height: 900 },
  tablet:  { width: 768,  height: 1024 },
  mobile:  { width: 390,  height: 844 },
};

const SECTION_CROPS = {
  all:      null,                          // no crop
  hero:     { top: 0,    height: 900 },
  services: { top: 900,  height: 1300 },
  cta:      { top: -600, height: 600 },   // negative = from bottom
};

const requestedViewports = args.viewports
  .split(",").map(v => v.trim().toLowerCase()).filter(v => VIEWPORT_PRESETS[v]);

if (requestedViewports.length === 0) {
  console.error("ERROR: No valid viewports. Valid: desktop, tablet, mobile");
  process.exit(2);
}

// ─── Setup ───────────────────────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });
const BASELINE_DIR = path.join(OUT_DIR, "baseline");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) { process.stderr.write(msg + "\n"); }

/** Health-check: is the page non-blank and not an error page? */
async function healthCheck(page, url) {
  try {
    const info = await page.evaluate(() => ({
      bodyLen:   document.body?.innerHTML?.length ?? 0,
      hasError:  !!document.querySelector(".error-404, #error-page, .elementor-error"),
      title:     document.title,
      hasContent: !!document.querySelector(
        ".elementor-section, .e-flexbox, .elementor-container, main, article"
      ),
    }));
    return {
      ok: info.bodyLen > 3000 && !info.hasError && info.hasContent,
      ...info,
    };
  } catch {
    return { ok: false, bodyLen: 0 };
  }
}

/**
 * Capture a screenshot with retry logic.
 * Returns { path: string, pageHeight: number, ok: boolean }
 */
async function capture(browser, url, outPath, vp, fullPage) {
  let lastError = null;
  let lastReason = null;

  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const page = await browser.newPage();
    try {
      await page.setViewportSize(vp);
      await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache" });

      // Step 1: navigate
      const resp = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 25_000,
      }).catch(e => { lastError = e; return null; });

      const httpStatus = resp?.status?.() ?? 0;
      if (httpStatus >= 400) {
        lastReason = `HTTP ${httpStatus}`;
        log(`  [attempt ${attempt}] HTTP ${httpStatus} for ${url}`);
        await page.close();
        continue;
      }

      // Step 2: wait for meaningful DOM content
      await page.waitForFunction(
        () => (document.body?.innerHTML?.length ?? 0) > 3000,
        { timeout: 15_000 }
      ).catch(() => log(`  [attempt ${attempt}] DOM content wait timed out`));

      // Step 3: let JS/CSS finish (fonts, lazy images, Elementor init)
      await page.waitForTimeout(3000);

      // Step 3b: wait for page to actually be scrollable
      // Elementor compiles CSS on first load after cache-clear; until CSS is served,
      // all elements have height:0 and document.body.scrollHeight == viewportHeight.
      // This guard detects that and waits up to 12s for the page to expand.
      if (fullPage) {
        await page.waitForFunction(
          (vpH) => document.body.scrollHeight > vpH * 1.5,
          { timeout: 12_000 },
          vp.height
        ).catch(() => log(`  [attempt ${attempt}] ⚠ Page scrollHeight still == viewport — CSS may not be loaded yet`));
      }

      // Step 4: scroll full page to trigger lazy-loaded images
      if (fullPage) {
        await page.evaluate(async () => {
          await new Promise(resolve => {
            let total = 0;
            const step = () => {
              window.scrollBy(0, 400);
              total += 400;
              if (total < document.body.scrollHeight) {
                setTimeout(step, 80);
              } else {
                window.scrollTo(0, 0);
                setTimeout(resolve, 500);
              }
            };
            step();
          });
        });
        await page.waitForTimeout(1500);
      }

      // Step 5: health check
      const health = await healthCheck(page, url);
      if (!health.ok && attempt < RETRIES) {
        lastReason = `health check failed (len=${health.bodyLen}, hasContent=${health.hasContent})`;
        log(`  [attempt ${attempt}] Health check failed (len=${health.bodyLen}, hasContent=${health.hasContent}) — retrying`);
        await page.close();
        await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }

      // Step 6: final screenshot
      const pageHeight = await page.evaluate(() => document.body.scrollHeight);
      await page.screenshot({ path: outPath, fullPage });

      // Step 7: verify screenshot is not blank
      const fileSize = fs.statSync(outPath).size;
      if (fileSize < 8_000 && attempt < RETRIES) {
        lastReason = `screenshot too small (${fileSize}B, likely blank)`;
        log(`  [attempt ${attempt}] Screenshot too small (${fileSize}B, likely blank) — retrying`);
        await page.close();
        await new Promise(r => setTimeout(r, 3000 * attempt));
        continue;
      }

      log(`  [attempt ${attempt}] ✓ ${path.basename(outPath)} — HTTP ${httpStatus}, DOM ${health.bodyLen}B, img ${fileSize}B`);
      await page.close();
      return { path: outPath, pageHeight, httpStatus, ok: health.ok };

    } catch (err) {
      lastError = err;
      log(`  [attempt ${attempt}] ERROR: ${err.message}`);
      await page.close().catch(() => {});
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }

  log(`  FAILED after ${RETRIES} attempts. Last error: ${lastError?.message ?? lastReason ?? 'unknown'}`);
  return { path: outPath, pageHeight: 0, ok: false };
}

// ─── Image crop ──────────────────────────────────────────────────────────────

function cropPng(inputPath, outputPath, top, height) {
  const img = PNG.sync.read(fs.readFileSync(inputPath));
  const actualTop  = top < 0 ? Math.max(0, img.height + top) : Math.min(top, img.height - 1);
  const actualH    = Math.min(height, img.height - actualTop);
  const out        = new PNG({ width: img.width, height: actualH });
  img.data.copy(out.data, 0, actualTop * img.width * 4, (actualTop + actualH) * img.width * 4);
  fs.writeFileSync(outputPath, PNG.sync.write(out));
  return outputPath;
}

// ─── Pixel diff ──────────────────────────────────────────────────────────────

function pixelDiff(pathA, pathB, diffPath) {
  const imgA = PNG.sync.read(fs.readFileSync(pathA));
  const imgB = PNG.sync.read(fs.readFileSync(pathB));

  const width  = Math.min(imgA.width,  imgB.width);
  const height = Math.min(imgA.height, imgB.height);

  // Warn if heights differ significantly
  const heightDiff = Math.abs(imgA.height - imgB.height);
  const heightMismatch = heightDiff > 50;

  const cropBuf = (png) => {
    if (png.width === width && png.height === height) return png.data;
    const out = Buffer.alloc(width * height * 4, 0);
    for (let y = 0; y < height; y++) {
      const srcOff = y * png.width * 4;
      png.data.copy(out, y * width * 4, srcOff, srcOff + width * 4);
    }
    return out;
  };

  const out = new PNG({ width, height });
  const numDiff = pixelmatch(cropBuf(imgA), cropBuf(imgB), out.data, width, height, {
    threshold: THRESHOLD,
    includeAA: false, // ignore anti-aliasing differences
  });
  fs.writeFileSync(diffPath, PNG.sync.write(out));

  const total    = width * height;
  const matchPct = parseFloat(((total - numDiff) / total * 100).toFixed(2));
  const passed   = matchPct >= PASS_PCT;
  return { numDiff, total, matchPct, passed, heightMismatch,
           heightA: imgA.height, heightB: imgB.height, width };
}

// ─── HTML report ─────────────────────────────────────────────────────────────

function toDataUri(p) {
  return `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
}

function buildReport(results, meta) {
  const tableRows = results.map(r => {
    const color  = r.matchPct >= PASS_PCT ? "#2d7d46" : "#c0392b";
    const icon   = r.matchPct >= PASS_PCT ? "✅ PASS" : "⚠️ FAIL";
    const hWarn  = r.heightMismatch ? `<span style="color:#e67e22" title="Heights differ: ${r.heightA}px vs ${r.heightB}px">⚠️ height mismatch</span>` : "";
    return `<tr>
      <td>${r.label}</td><td>${r.mode}</td>
      <td style="color:${color};font-weight:bold">${r.matchPct}%</td>
      <td>${r.numDiff.toLocaleString()} / ${r.total.toLocaleString()}</td>
      <td>${icon} ${hWarn}</td>
    </tr>`;
  }).join("");

  const sections = results.map(r => {
    const v3Uri  = toDataUri(r.v3Path);
    const v4Uri  = toDataUri(r.v4Path);
    const difUri = toDataUri(r.diffPath);
    const id = r.label.replace(/\W/g, "_");
    return `
<h2>${r.label} — ${r.mode} <small style="color:${r.matchPct>=PASS_PCT?'#2d7d46':'#c0392b'}">${r.matchPct}% match</small></h2>
${r.heightMismatch ? `<p class="warn">⚠️ Height mismatch: V3=${r.heightA}px, V4=${r.heightB}px. Comparison was cropped to ${r.width}×${Math.min(r.heightA,r.heightB)}px.</p>` : ""}
<div class="compare">
  <div class="pane">
    <h3>V3 Original</h3>
    <img src="${v3Uri}" loading="lazy">
  </div>
  <div class="pane slider-wrap" id="sw-${id}">
    <h3>Slider: V3 ← → V4</h3>
    <div class="slider-container">
      <img class="slider-v3" src="${v3Uri}" draggable="false">
      <img class="slider-v4" src="${v4Uri}" draggable="false">
      <div class="slider-handle"></div>
    </div>
  </div>
  <div class="pane">
    <h3>Pixel Diff <small>(red = changed)</small></h3>
    <img src="${difUri}" loading="lazy">
  </div>
</div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Visual Diff — ${meta.run_label}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#f0f0f0;color:#222;padding:20px}
h1{font-size:1.4rem;margin-bottom:12px;border-bottom:3px solid #333;padding-bottom:8px}
h2{margin:32px 0 8px;font-size:1.1rem}
h3{font-size:.8rem;color:#555;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em}
small{font-weight:normal}
table{border-collapse:collapse;width:100%;background:#fff;border-radius:8px;overflow:hidden;margin-bottom:24px}
th,td{border:1px solid #ddd;padding:10px 14px;text-align:left;font-size:.9rem}
th{background:#333;color:#fff}
.meta{background:#fff;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:.85rem;line-height:1.7}
.meta code{background:#eee;padding:1px 5px;border-radius:3px;font-size:.8rem}
.warn{background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:.85rem}
.compare{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px}
.pane{background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.pane img{width:100%;border:1px solid #e0e0e0;border-radius:4px;display:block}

/* Slider */
.slider-wrap h3{margin-bottom:6px}
.slider-container{position:relative;overflow:hidden;cursor:ew-resize;user-select:none;border:1px solid #e0e0e0;border-radius:4px}
.slider-v3,.slider-v4{display:block;width:100%;position:absolute;top:0;left:0}
.slider-v4{clip-path:inset(0 50% 0 0)}
.slider-v3{position:relative}
.slider-handle{position:absolute;top:0;left:50%;width:3px;background:#fff;box-shadow:0 0 6px rgba(0,0,0,.5);cursor:ew-resize;height:100%;transform:translateX(-50%)}
.slider-handle::before,.slider-handle::after{content:'◀▶';position:absolute;top:50%;transform:translate(-50%,-50%);background:#fff;padding:4px 6px;border-radius:4px;font-size:.75rem;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.3)}
.slider-handle::before{content:'◀ ▶'}
</style>
</head>
<body>
<h1>📸 Visual Diff Report — ${meta.run_label}</h1>
<div class="meta">
  <strong>V3 (Original):</strong> <code>${meta.v3_url}</code><br>
  <strong>V4 (Converted):</strong> <code>${meta.v4_url}</code><br>
  <strong>Mode:</strong> ${meta.mode} &nbsp;|&nbsp;
  <strong>Section:</strong> ${meta.section} &nbsp;|&nbsp;
  <strong>Threshold:</strong> ${THRESHOLD} &nbsp;|&nbsp;
  <strong>Pass ≥:</strong> ${PASS_PCT}%<br>
  <strong>Generated:</strong> ${new Date().toISOString()}
</div>
<table>
  <tr><th>Viewport</th><th>Mode</th><th>Match %</th><th>Diff Pixels</th><th>Status</th></tr>
  ${tableRows}
</table>
${sections}

<script>
// Drag-to-compare slider
document.querySelectorAll('.slider-container').forEach(container => {
  const v4 = container.querySelector('.slider-v4');
  const handle = container.querySelector('.slider-handle');
  let dragging = false;

  const setPos = (x) => {
    const rect = container.getBoundingClientRect();
    const pct = Math.min(100, Math.max(0, (x - rect.left) / rect.width * 100));
    v4.style.clipPath = 'inset(0 ' + (100-pct) + '% 0 0)';
    handle.style.left = pct + '%';
  };

  container.addEventListener('mousedown', e => { dragging = true; setPos(e.clientX); });
  document.addEventListener('mousemove', e => { if (dragging) setPos(e.clientX); });
  document.addEventListener('mouseup', () => { dragging = false; });
  container.addEventListener('touchstart', e => { dragging = true; setPos(e.touches[0].clientX); });
  document.addEventListener('touchmove', e => { if (dragging) setPos(e.touches[0].clientX); });
  document.addEventListener('touchend', () => { dragging = false; });
});
</script>
</body>
</html>`;
}

// ─── Terminal summary ─────────────────────────────────────────────────────────

function printSummary(results) {
  const bar = (pct) => {
    const filled = Math.round(pct / 5);
    return "█".repeat(filled) + "░".repeat(20 - filled) + ` ${pct}%`;
  };
  log("\n──────────────────────────────────────────");
  log(`  Visual Diff — ${RUN_LABEL}`);
  log("──────────────────────────────────────────");
  for (const r of results) {
    const icon = r.passed ? "✅" : "⚠️";
    log(`  ${icon} ${r.label.padEnd(16)} [${bar(r.matchPct)}]`);
    if (r.heightMismatch) {
      log(`     ⚠ height mismatch: V3=${r.heightA}px V4=${r.heightB}px (comparison at ${Math.min(r.heightA,r.heightB)}px)`);
    }
  }
  log("──────────────────────────────────────────\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

const allResults = [];
const modes = MODE === "both" ? ["fold", "full"] : [MODE];
const cropSpec = SECTION_CROPS[SECTION] ?? null;

for (const vpLabel of requestedViewports) {
  const vp = VIEWPORT_PRESETS[vpLabel];

  for (const runMode of modes) {
    const fullPage = runMode === "full";
    const suffix = modes.length > 1 ? `-${runMode}` : "";
    const label = `${vpLabel}${suffix}`;

    log(`\n[${label}] Capturing V3 (${fullPage ? "full-page" : "above-fold"})...`);
    const v3Raw  = path.join(OUT_DIR, `${label}-v3-raw.png`);
    const v4Raw  = path.join(OUT_DIR, `${label}-v4-raw.png`);
    const v3Path = path.join(OUT_DIR, `${label}-v3.png`);
    const v4Path = path.join(OUT_DIR, `${label}-v4.png`);
    const difPath = path.join(OUT_DIR, `${label}-diff.png`);

    const r3 = await capture(browser, V3_URL, v3Raw, vp, fullPage);
    log(`[${label}] Capturing V4...`);
    const r4 = await capture(browser, V4_URL, v4Raw, vp, fullPage);

    // Apply section crop if requested
    if (cropSpec) {
      log(`[${label}] Cropping to section '${SECTION}'...`);
      cropPng(v3Raw, v3Path, cropSpec.top, cropSpec.height);
      cropPng(v4Raw, v4Path, cropSpec.top, cropSpec.height);
    } else {
      fs.copyFileSync(v3Raw, v3Path);
      fs.copyFileSync(v4Raw, v4Path);
    }
    // Clean up raw files
    fs.unlinkSync(v3Raw);
    fs.unlinkSync(v4Raw);

    // Baseline mode: just save screenshots, skip diff
    if (IS_BASELINE) {
      fs.mkdirSync(BASELINE_DIR, { recursive: true });
      fs.copyFileSync(v3Path, path.join(BASELINE_DIR, `${label}-v3.png`));
      fs.copyFileSync(v4Path, path.join(BASELINE_DIR, `${label}-v4.png`));
      log(`[${label}] Baseline saved.`);
      continue;
    }

    // Compare baseline mode: compare v4 against saved baseline
    let comparePath = v3Path;
    if (CMP_BASELINE) {
      const bPath = path.join(BASELINE_DIR, `${label}-v3.png`);
      if (!fs.existsSync(bPath)) {
        log(`[${label}] ⚠ No baseline found at ${bPath} — skipping`);
        continue;
      }
      comparePath = bPath;
    }

    log(`[${label}] Computing pixel diff...`);
    const stats = pixelDiff(comparePath, v4Path, difPath);
    log(`[${label}] ${stats.passed ? "✅" : "⚠️"} ${stats.matchPct}% match (${stats.numDiff.toLocaleString()} px differ)`);
    if (stats.heightMismatch) {
      log(`[${label}] ⚠ Height mismatch: V3=${stats.heightA}px V4=${stats.heightB}px — diff cropped to ${Math.min(stats.heightA, stats.heightB)}px`);
    }

    allResults.push({
      label, mode: runMode, vpLabel,
      v3Path, v4Path, diffPath: difPath,
      ...stats,
      v3PageHeight: r3.pageHeight, v4PageHeight: r4.pageHeight,
    });
  }
}

await browser.close();

if (IS_BASELINE) {
  log("\n✓ Baseline saved. Run without --baseline to compare against it.");
  process.exit(0);
}

// ─── Report + summary ────────────────────────────────────────────────────────

printSummary(allResults);

const reportPath = path.join(OUT_DIR, "report.html");
fs.writeFileSync(reportPath, buildReport(allResults, {
  v3_url: V3_URL, v4_url: V4_URL,
  mode: MODE, section: SECTION, run_label: RUN_LABEL,
}));

// JSON output on stdout (for GH Actions / CI parsing)
const jsonOut = {
  run_label: RUN_LABEL,
  v3_url: V3_URL, v4_url: V4_URL,
  mode: MODE, section: SECTION,
  results: allResults.map(({ v3Path, v4Path, diffPath, ...rest }) => rest),
  reportPath,
};
console.log(JSON.stringify(jsonOut, null, 2));

// Exit code
process.exit(allResults.every(r => r.passed) ? 0 : 1);
