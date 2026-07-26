/**
 * Phase 3 — Live Smoke Test
 * Runs extractor + classifier + design-token analyzer against
 * test4.nick-webdesign.de and writes per-section spec files.
 */
import { chromium } from 'playwright-core';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extractFromUrl } from '../src/extractor/playwright-extractor.js';
import { classifyAll } from '../src/classifier/section-picker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'pipeline-outputs', 'smoke-sprint3');

async function main() {
  const target = process.argv[2] || 'https://test4.nick-webdesign.de';
  console.log(`[smoke3] Target: ${target}`);
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const result = await extractFromUrl({
    url: target,
    outputDir: OUT_DIR,
    browser,
    detectAnimations: true,
    detectSections: true,
    detectResponsiveStyles: true,
    extractTokens: true,
  });
  await browser.close();

  console.log(`[smoke3] Extracted: ${result.sections.length} sections, ${result.computedStyles?.desktop.length ?? 0} computed-style snapshots`);

  // Run Phase 3 classifier
  const phase3 = await classifyAll({
    url: target,
    outputDir: OUT_DIR,
    sections: result.sections,
    computedStyles: result.computedStyles ?? { desktop: [] },
    designTokens: result.designTokens,
    cssVars: result.cssVariables,
  });

  console.log(`[smoke3] === PHASE 3 RESULTS ===`);
  console.log(`[smoke3] Specs written:    ${phase3.specs.length}`);
  console.log(`[smoke3] Approved:         ${phase3.selectedManifest.approved_count}`);
  console.log(`[smoke3] Skipped:          ${phase3.selectedManifest.skipped_count}`);
  for (const spec of phase3.specs) {
    console.log(`  - ${spec.section_id} [${spec.pattern}]  columns=${spec.v3_section.columns.length}  widgets=${spec.v3_section.columns.reduce((s, c) => s + c.widgets.length, 0)}`);
    for (const col of spec.v3_section.columns) {
      for (const w of col.widgets) {
        const tokHint = w.settings['__typography_role']
          ? ` token=${w.settings['__typography_role']}`
          : '';
        console.log(`      [${w.type}] ${w.source_tag} (${w.content?.slice(0, 30) ?? ''})${tokHint}`);
      }
    }
  }
  console.log(`[smoke3] Outputs: ${OUT_DIR}`);
  console.log(`[smoke3] OK`);
}

main().catch((e) => {
  console.error('[smoke3] FAIL:', e);
  process.exit(1);
});
