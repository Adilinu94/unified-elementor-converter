/**
 * Sprint 2B + 2C + Phase 2.5 — Live Smoke Test
 * Runs the full extractor pipeline against test4.nick-webdesign.de.
 * Outputs the final pipeline-outputs/*.json files for inspection.
 */
import { chromium } from 'playwright-core';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extractFromUrl } from '../src/extractor/playwright-extractor.js';
import { analyzeDesignTokens } from '../src/analyzer/design-token-extractor.js';
import type { ExtractionResult } from '../src/extractor/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'pipeline-outputs', 'smoke-sprint2c');

async function main() {
  const target = process.argv[2] || 'https://test4.nick-webdesign.de';
  console.log(`[smoke] Target: ${target}`);
  await fs.mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const result: ExtractionResult = await extractFromUrl({
    url: target,
    outputDir: OUT_DIR,
    browser,
    detectAnimations: true,
    detectSections: true,
    detectResponsiveStyles: true,
    extractTokens: true,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  await browser.close();

  // Persist outputs
  await fs.writeFile(
    path.join(OUT_DIR, 'extraction-result.json'),
    JSON.stringify(result, null, 2),
    'utf-8',
  );
  await fs.writeFile(
    path.join(OUT_DIR, 'fonts.json'),
    JSON.stringify(result.fontsIntercepted, null, 2),
    'utf-8',
  );
  await fs.writeFile(
    path.join(OUT_DIR, 'sections.json'),
    JSON.stringify(result.sections ?? [], null, 2),
    'utf-8',
  );
  await fs.writeFile(
    path.join(OUT_DIR, 'keyframes.json'),
    JSON.stringify(result.animations, null, 2),
    'utf-8',
  );
  await fs.writeFile(
    path.join(OUT_DIR, 'computed-styles.json'),
    JSON.stringify(result.computedStyles ?? {}, null, 2),
    'utf-8',
  );
  if (result.designTokens) {
    await fs.writeFile(
      path.join(OUT_DIR, 'design-tokens.json'),
      JSON.stringify(result.designTokens, null, 2),
      'utf-8',
    );
  }

  // Summary
  console.log('\n[smoke] === SPRINT 2B + 2C + PHASE 2.5 — RESULTS ===');
  console.log(`[smoke] URL:                       ${result.url}`);
  console.log(`[smoke] Hostname:                  ${result.hostname}`);
  console.log(`[smoke] Fonts intercepted:        ${result.fontsIntercepted.length}`);
  console.log(`[smoke] Sections detected:        ${result.sections?.length ?? 0}`);
  if (result.sections?.length) {
    for (const s of result.sections.slice(0, 5)) {
      console.log(
        `  - ${s.section_id.padEnd(20)} ${s.selector}  y=[${s.y_range[0]}..${s.y_range[1]}]  children=${s.child_count}`,
      );
    }
  }
  console.log(`[smoke] @keyframes:                ${result.animations.keyframe_names.length}`);
  console.log(`[smoke]   - same-origin:           ${result.animations.same_origin_keyframe_count ?? 0}`);
  console.log(`[smoke]   - cross-origin:          ${result.animations.cross_origin_keyframe_count ?? 0}`);
  console.log(`[smoke] Transitions:              ${result.animations.transitions?.length ?? 0}`);
  if (result.computedStyles) {
    const total = Object.values(result.computedStyles).reduce(
      (s, v) => s + v.length,
      0,
    );
    console.log(`[smoke] Computed-styles total:    ${total} snapshots`);
  }
  if (result.designTokens) {
    const t = result.designTokens;
    const colorKeys = Object.keys(t.colors ?? {}).filter(
      (k) => t.colors![k] !== null,
    );
    console.log(`[smoke] Design tokens:`);
    console.log(`  - colors detected:  ${colorKeys.length} (${colorKeys.join(', ')})`);
    console.log(
      `  - typography:       heading=${t.fonts?.heading?.family ?? 'system'}  body=${(t.fonts?.body?.family ?? 'system').slice(0, 60)}...`,
    );
    console.log(
      `  - spacing:          sectionPadding=${t.spacing?.sectionPadding}px  containerWidth=${t.spacing?.containerWidth}px`,
    );
  }
  console.log(`\n[smoke] Outputs written to: ${OUT_DIR}`);
  console.log(`[smoke] OK`);
}

main().catch((e) => {
  console.error('[smoke] FAIL:', e);
  process.exit(1);
});
