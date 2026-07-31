import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { diffScreenshots } from '@elconv/qa';

/**
 * Visual-Regression Pixel-Diff (Phase 112, BAUPLAN v4.0 item V9).
 *
 * Renders a deterministic local fixture (solid color blocks only — no text,
 * no fonts, no network) at a fixed viewport and pixel-diffs it against a
 * committed baseline PNG. Catches unintended rendering drift in the
 * screenshot → pixelmatch pipeline itself.
 *
 * Baseline workflow:
 *   - baseline missing locally  → it is created (bootstrap) and the test passes
 *   - baseline missing in CI    → hard fail (the baseline must be committed)
 *   - UPDATE_BASELINE=1         → baseline is regenerated from the current render
 */

// Deterministic fixture: integer-sized solid rectangles, zero text.
const FIXTURE_HTML = `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; }
  body { width: 800px; height: 600px; background: #ffffff; }
  .hero { width: 800px; height: 200px; background: #1e3a8a; }
  .row { display: flex; }
  .card-a { width: 400px; height: 240px; background: #f59e0b; }
  .card-b { width: 400px; height: 240px; background: #10b981; }
  .footer { width: 800px; height: 160px; background: #111827; }
</style></head>
<body>
  <div class="hero"></div>
  <div class="row"><div class="card-a"></div><div class="card-b"></div></div>
  <div class="footer"></div>
</body></html>`;

const BASELINE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'baseline');
const BASELINE_PATH = join(BASELINE_DIR, 'fixture-800x600.png');
const MIN_MATCH_PERCENT = 99;

async function hasBrowserRuntime(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const HAS_BROWSER = await hasBrowserRuntime();

async function renderFixture(outPath: string): Promise<void> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(FIXTURE_HTML, { waitUntil: 'load' });
    await page.screenshot({ path: outPath });
  } finally {
    await browser.close();
  }
}

describe.skipIf(!HAS_BROWSER)('Visual regression (pixel diff vs committed baseline)', () => {
  it(
    'the rendered fixture matches the baseline within the threshold',
    async () => {
      const workDir = mkdtempSync(join(tmpdir(), 'elconv-visual-'));
      const shotPath = join(workDir, 'current.png');
      try {
        await renderFixture(shotPath);

        if (process.env.UPDATE_BASELINE === '1' || !existsSync(BASELINE_PATH)) {
          if (!existsSync(BASELINE_PATH) && process.env.CI && process.env.UPDATE_BASELINE !== '1') {
            throw new Error(
              `Visual baseline missing in CI: ${BASELINE_PATH}. Generate it locally (UPDATE_BASELINE=1) and commit it.`,
            );
          }
          mkdirSync(BASELINE_DIR, { recursive: true });
          copyFileSync(shotPath, BASELINE_PATH);
          // Freshly (re)created baseline is trivially identical — done.
          return;
        }

        const result = await diffScreenshots({
          originalPath: BASELINE_PATH,
          clonePath: shotPath,
          outputDiffPath: join(workDir, 'diff.png'),
        });
        expect(
          result.matchPercent,
          `pixel match ${result.matchPercent.toFixed(2)}% below ${MIN_MATCH_PERCENT}% — ` +
            `unintended visual drift (diff: ${result.diffPath}). ` +
            `If the change is intentional, regenerate with UPDATE_BASELINE=1.`,
        ).toBeGreaterThanOrEqual(MIN_MATCH_PERCENT);
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it('a deliberately different render is flagged (the gate actually bites)', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'elconv-visual-neg-'));
    try {
      const changedPath = join(workDir, 'changed.png');
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
        // Same layout, hero recolored — must push the match below the gate.
        await page.setContent(FIXTURE_HTML.replace('#1e3a8a', '#dc2626'), { waitUntil: 'load' });
        await page.screenshot({ path: changedPath });
      } finally {
        await browser.close();
      }

      const result = await diffScreenshots({
        originalPath: BASELINE_PATH,
        clonePath: changedPath,
      });
      expect(result.matchPercent).toBeLessThan(MIN_MATCH_PERCENT);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 60_000);
});
