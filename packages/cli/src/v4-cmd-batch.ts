// @ts-nocheck — Migration-Marker: Typen werden schrittweise verfeinert (UMBAUPLAN Step 14)
/**
 * src/cli/cmd-batch.js — Batch Multi-Page Pipeline
 *
 * Sprint 6 (Task 2): Führt die Pipeline für mehrere Seiten in einem Durchlauf aus.
 * Reduziert Multi-Page-Deployments von "N separate Sessions" auf "1 Durchlauf".
 *
 * Usage:
 *   node wizard.js batch --pages home.xml,about.xml,contact.xml
 *   node wizard.js batch --pages exports/page1/index.html,exports/page2/index.html --post-ids 42,43,44
 */

import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { pipelineDir, findWorkspaceRoot, runFile, nodeBin } from './shared.js';

/**
 * Gibt die Hilfe fuer dieses Subcommand aus.
 */
export function printHelp() {
  console.log(`wizard.js batch — Multi-Page Batch-Build

USAGE:
  node wizard.js batch --pages <files> [--post-ids <ids>]

OPTIONS:
  --pages <files>     Komma-separierte XML/HTML-Dateien (Pflicht)
  --post-ids <ids>    Komma-separierte Post-IDs (optional)

BESCHREIBUNG:
  Fuehrt die Pipeline fuer mehrere Seiten in einem Durchlauf aus.
  Reduziert Multi-Page-Deployments von "N separate Sessions" auf
  "1 Durchlauf".

  Jede Seite durchlaeuft: XML→V4 Konvertierung → Validation.
  Ergebnis wird als batch-build-summary.json gespeichert.

BEISPIELE:
  node wizard.js batch --pages exports/home.xml,exports/about.xml
  node wizard.js batch --pages home.xml,about.xml --post-ids 42,43
`);
}

/**
 * Führt einen Batch-Build für mehrere Seiten aus.
 *
 * @param {string} pagesList - Komma-separierte Liste von XML/HTML-Dateien
 * @param {string} [postIdsList] - Komma-separierte Liste von Post-IDs (optional)
 * @returns {Promise<void>}
 */
export async function runBatch(pagesList, postIdsList = '') {
  const rootDir = findWorkspaceRoot();

  // Guard: empty or missing pages list
  if (!pagesList || !pagesList.trim()) {
    console.error('Error: --pages erfordert mindestens eine Datei (komma-separiert).\n');
    console.error('Usage: node wizard.js batch --pages file1.xml,file2.xml [--post-ids 42,43]\n');
    process.exit(2);
  }

  // Parse page files
  const pages = pagesList.split(',').map(p => path.resolve(p.trim())).filter(p => p);
  if (pages.length === 0) {
    console.error('Error: --pages erfordert mindestens eine Datei.\n');
    process.exit(2);
  }

  // Parse post IDs (optional)
  const postIds = postIdsList
    ? postIdsList.split(',').map(id => id.trim()).filter(id => id)
    : [];

  if (postIds.length > 0 && postIds.length !== pages.length) {
    console.error(`Error: Anzahl --post-ids (${postIds.length}) muss mit --pages (${pages.length}) übereinstimmen.\n`);
    process.exit(2);
  }

  // Validate all files exist
  for (const page of pages) {
    if (!existsSync(page)) {
      console.error(`Error: Datei nicht gefunden: ${page}\n`);
      process.exit(2);
    }
  }

  const results = [];
  const startTime = Date.now();

  console.log(`\n${'='.repeat(56)}`);
  console.log('  BATCH BUILD — Multi-Page Pipeline');
  console.log(`${'='.repeat(56)}`);
  console.log(`  Seiten:  ${pages.length}`);
  console.log(`  IDs:     ${postIds.length > 0 ? postIds.join(', ') : 'auto'}`);
  console.log(`${'='.repeat(56)}\n`);

  for (let i = 0; i < pages.length; i++) {
    const pageFile = pages[i];
    const pageName = path.basename(pageFile, path.extname(pageFile));
    const postId = postIds[i] || null;
    const isXml = pageFile.endsWith('.xml');

    console.log(`\n▶️  [${i + 1}/${pages.length}] Verarbeite: ${pageName}`);

    const pageResult = {
      page: pageFile,
      pageName,
      postId,
      started: new Date().toISOString(),
      steps: {},
      status: 'pending',
    };

    try {
      const outputDir = path.join(rootDir, 'batch-output', pageName);
      await fs.mkdir(outputDir, { recursive: true });

      const v4TreePath = path.join(outputDir, 'v4-tree.json');

      // Step 1: Convert XML to V4 (oder nutze HTML direkt)
      if (isXml) {
        console.log(`  → Konvertiere XML → V4 Tree...`);
        await runFile(nodeBin, [
          path.join(pipelineDir, 'convert-xml-to-v4.js'),
          '--xml', pageFile,
          '--output', v4TreePath,
        ], `XML→V4: ${pageName}`);
        pageResult.steps.convert = { status: 'ok', output: v4TreePath };
      } else {
        // HTML: verwende html-to-widget-plan.js
        console.log(`  → Analysiere HTML → Widget-Plan...`);
        const widgetPlanPath = path.join(outputDir, 'widget-plan.json');
        await runFile(nodeBin, [
          path.join(pipelineDir, 'html-to-widget-plan.js'),
          '--html', pageFile,
          '--output', widgetPlanPath,
        ], `HTML→Plan: ${pageName}`);
        pageResult.steps.widgetPlan = { status: 'ok', output: widgetPlanPath };
        // Für HTML: kopiere als v4-tree reference
        pageResult.steps.convert = { status: 'skipped', note: 'HTML mode — use widget-plan' };
      }

      // Step 2: Validate (wenn V4 Tree existiert)
      if (existsSync(v4TreePath)) {
        console.log(`  → Validiere V4 Tree...`);
        try {
          await runFile(nodeBin, [
            path.join(pipelineDir, 'validate-v4-tree.js'),
            v4TreePath,
            '--mode=warn',
          ], `Validation: ${pageName}`);
          pageResult.steps.validate = { status: 'ok' };
        } catch {
          pageResult.steps.validate = { status: 'warning', note: 'Validierung hatte Warnungen' };
        }
      }

      pageResult.status = 'success';
      pageResult.completed = new Date().toISOString();
      console.log(`  ✅ ${pageName} abgeschlossen`);
    } catch (err) {
      pageResult.status = 'failed';
      pageResult.error = err.message.slice(0, 200);
      console.log(`  ❌ ${pageName} fehlgeschlagen: ${err.message.slice(0, 100)}`);
    }

    results.push(pageResult);
  }

  // ── Batch Summary ──────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successCount = results.filter(r => r.status === 'success').length;
  const failCount = results.filter(r => r.status === 'failed').length;

  const summary = {
    batch: {
      generated: new Date().toISOString(),
      elapsed_seconds: parseFloat(elapsed),
      total_pages: pages.length,
      success: successCount,
      failed: failCount,
    },
    pages: results,
  };

  const summaryPath = path.join(rootDir, 'batch-build-summary.json');
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`\n${'='.repeat(56)}`);
  console.log(`  BATCH BUILD ABGESCHLOSSEN in ${elapsed}s`);
  console.log(`  ✅ ${successCount} Erfolg  ❌ ${failCount} Fehlgeschlagen`);
  console.log(`  📄 Summary: batch-build-summary.json`);
  console.log(`${'='.repeat(56)}\n`);

  process.exit(failCount > 0 ? 1 : 0);
}
