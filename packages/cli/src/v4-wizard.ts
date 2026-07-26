#!/usr/bin/env node
// @ts-nocheck — Migration-Marker: Typen werden schrittweise verfeinert (UMBAUPLAN Step 14)
/**
 * Framer → Elementor V4 Pipeline V2: Interactive CLI Wizard
 *
 * Sprint 6: Refactored to thin router.
 * Sub-commands are modularized in src/cli/cmd-*.js.
 * Shared helpers in src/cli/shared.js.
 *
 * SUBCOMMANDS:
 *   (default)    Interaktiver Build-Wizard mit Recovery-Mode
 *   preflight    System-Checks vor dem Build (8 Checks)
 *   dry-run      Build-Plan ohne Schreibzugriff generieren
 *   preview      Preview-Page von bestehender Seite erstellen
 *   promote      Preview auf Live-Seite promovieren
 *   batch        Multi-Page Batch-Build (NEU Sprint 6)
 *   serve        HTTP-API starten (default Port 7123)
 *   help         Diese Hilfe
 */

import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoDir = __dirname;
const pipelineDir = __dirname;

// ── Shared imports (Sprint 6: modularized from src/cli/shared.js) ──
import {
  log, findWorkspaceRoot, findFramerExportDir,
  runFile, findIndexHtmlDirs, readJsonIfExists,
  promptErrorRecovery, runWithRecovery,
  nodeBin, npxBin, npmBin,
  checkFramerExportCache, writeFramerExportCache,
} from './shared.js';

// ── Sub-command imports (Sprint 6: each in its own module) ──
import { runPreflight, printHelp as phPreflight } from './cmd-preflight.js';
import { runDryRun,   printHelp as phDryRun }   from './cmd-dry-run.js';
import { runPreview,  printHelp as phPreview }  from './cmd-preview.js';
import { runPromote,  printHelp as phPromote }  from './cmd-promote.js';
import { runBatch,    printHelp as phBatch }    from './cmd-batch.js';
import { runServe,    printHelp as phServe }    from './cmd-serve.js';
import { runPipeline, printHelp as phPipeline } from './cmd-pipeline.js';
import { runDoctor,   printHelp as phDoctor }   from './cmd-doctor.js';

const cmdHelp = {
  preflight: phPreflight,
  'dry-run': phDryRun,
  preview:   phPreview,
  promote:   phPromote,
  batch:     phBatch,
  serve:     phServe,
  pipeline:  phPipeline,
  doctor:    phDoctor,
};

// ── Root dir ───────────────────────────────────────────────────────────────
const rootDir = findWorkspaceRoot();
const rl = readline.createInterface({ input, output });

// ── HELP ───────────────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
Framer -> Elementor V4 Pipeline Wizard v0.11.0

SUBCOMMANDS:
  (default)    Interaktiver Build-Wizard mit Recovery-Mode
  preflight    System-Checks vor dem Build (8 Checks)
  dry-run      Build-Plan ohne Schreibzugriff generieren
  preview      Preview-Page von bestehender Seite erstellen
  promote      Preview auf Live-Seite promovieren
  batch        Multi-Page Batch-Build (NEU Sprint 6)
  serve        HTTP-API starten (default Port 7123)
  pipeline     Vollstaendige 14-Step Pipeline (non-interactive)
  doctor       Erweiterte Diagnose (6 Checks)
  help         Diese Hilfe

OPTIONEN:
  --post-id <ID>       Post-ID für preview
  --preview-id <ID>    Preview-ID für promote
  --target-id <ID>     Ziel-Post-ID für promote
  --pages <file,...>   Komma-separierte Dateien (batch)
  --post-ids <id,...>  Komma-separierte Post-IDs (batch)
  --format=json        JSON-Output (preflight)
  --port <PORT>        Port für serve (default 7123)
  --no-cache           FramerExport-Cache umgehen (non-interactive)
`);
}

// ── MAIN: Interaktiver Build-Wizard ────────────────────────────────────────

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 FRAMER → ELEMENTOR V4 PIPELINE V2 WIZARD');
  console.log('='.repeat(60) + '\n');

  // PHASE 0: MCP CONNECTION CHECK
  log.step('Phase 0: MCP Connector Prüfung...');
  console.log(`
  ┌─────────────────────────────────────────────────────────┐
  │  NOVAMIRA MCP CONNECTOR                                 │
  │                                                         │
  │  Tool:   novamira-yoursite-local:mcp-adapter-execute-ability│
  │  Format: { ability_name: "novamira/...", parameters: {} }│
  │                                                         │
  │  Kein .mcp.json nötig. Kein HTTP aus Node.js.          │
  │  Der Agent ruft alle Abilities direkt auf.              │
  └─────────────────────────────────────────────────────────┘
  `);

  // PHASE 0.2: SCHEMA SYNC (Fail-Fast)
  log.step('Phase 0.2: Schema-Sync mit V2-Plugin...');
  try {
    await runFile(
      nodeBin,
      [path.join(pipelineDir, 'scripts', 'sync-schema.js'), '--verbose'],
      'Prop-Schema vom V2-Plugin synchronisieren',
      pipelineDir
    );
    log.success('Prop-Schema erfolgreich synchronisiert.');
  } catch (err) {
    log.error('SCHEMA-SYNC FEHLGESCHLAGEN — Build abgebrochen.');
    log.error('Stelle sicher, dass:');
    console.error('  1. Die WordPress-Seite läuft und erreichbar ist');
    console.error('  2. Das Novamira AdrianV2 Plugin aktiviert ist');
    console.error('  3. WP_API_URL env var oder --url in sync-schema.js gesetzt ist');
    rl.close();
    process.exit(1);
  }

  // PHASE 0a: V4 ATOMIC REQUIREMENTS CHECK
  log.step('Phase 0a: V4 Atomic Requirements Check...');

  let v4CheckPassed = false;

  try {
    await runFile(
      nodeBin,
      [path.join(pipelineDir, 'scripts', 'check-v4-requirements.js'), '--auto-call'],
      'V4 Requirements Check (elementor-check-setup via McpBridge)',
      pipelineDir
    );
    v4CheckPassed = true;
    log.success('V4 Atomic Requirements erfüllt (Auto-Call).');
  } catch (err) {
    log.warn(`V4 Auto-Check fehlgeschlagen: ${String(err).slice(0, 200)}`);
  }

  if (!v4CheckPassed) {
    const setupCheckPath = path.join(rootDir, 'reports', 'elementor-check-setup.json');
    if (existsSync(setupCheckPath)) {
      try {
        await runFile(
          nodeBin,
          [path.join(pipelineDir, 'scripts', 'check-v4-requirements.js'), '--check-setup-json', setupCheckPath],
          'V4 Requirements Check (gespeicherte Datei)'
        );
        v4CheckPassed = true;
        log.success('V4 Atomic Requirements erfüllt (gespeicherte Datei).');
      } catch (err) {
        if (err.message?.includes('exit code 1') || err.code === 1) {
          log.error('HARD STOP: Elementor V4 Atomic Widgets sind nicht aktiviert!');
          log.error('Bitte zuerst in WordPress beheben:');
          console.error('\n  1. Elementor → Settings → Features → "Atomic Widgets" → ON');
          console.error('  2. Elementor → Tools → Regenerate CSS & Data → Cache leeren');
          console.error('  3. Wizard erneut starten\n');
          rl.close();
          process.exit(1);
        }
        log.warn(`V4-Check-Warnung: ${err.message} — Pipeline startet auf eigene Gefahr.`);
      }
    }
  }

  if (!v4CheckPassed) {
    await runFile(
      nodeBin,
      [path.join(pipelineDir, 'scripts', 'check-v4-requirements.js'), '--guidance'],
      'V4 Requirements Guidance'
    ).catch(() => {});
    log.info('V4-Check nicht automatisch möglich — bitte manuell in WordPress prüfen.');
    log.info('Elementor → Settings → Features → "Atomic Widgets" muss ON sein.');
  }

  let targetPostIdNum = null;
  let rollbackPlanPath = null;
  let splitPlanPath = null;

  try {
    const framerUrl = await rl.question('🌐 Framer-URL der Quellseite: ');
    if (!framerUrl.startsWith('http')) {
      throw new Error('Ungültige URL. Muss mit http:// oder https:// beginnen.');
    }

    const scope = await rl.question('🎯 Scope (Enter für "ganze Seite" oder Komma-separierte Abschnittsnamen): ');
    const targetScope = scope.trim() || 'full-page';

    const environments = ['testseite.nick-webdesign.de', 'treetsshop.local', 'anderer (manuell eingeben)'];
    console.log('\nVerfügbare Umgebungen:');
    environments.forEach((env, i) => console.log(`  ${i + 1}. ${env}`));
    const envChoice = await rl.question('🖥️  Ziel-Umgebung (1-3 oder Name): ');
    let wpEnv = envChoice.trim();
    if (envChoice === '1') wpEnv = environments[0];
    else if (envChoice === '2') wpEnv = environments[1];
    else if (envChoice === '3') wpEnv = await rl.question('Bitte gib die manuelle URL/domain ein: ');

    const postIdInput = await rl.question('📝 Ziel-Post-ID (oder "new" für neue Seite): ');
    const targetPostId = postIdInput.trim().toLowerCase() === 'new' ? 'new' : postIdInput.trim();

    console.log('\n' + '='.repeat(60));
    log.info('Konfiguration zusammengefasst. Starte Pre-Build-Pipeline...');
    console.log(`   URL: ${framerUrl}`);
    console.log(`   Scope: ${targetScope}`);
    console.log(`   Umgebung: ${wpEnv}`);
    console.log(`   Ziel-Post-ID: ${targetPostId}`);
    console.log('='.repeat(60) + '\n');

    const confirm = await rl.question('⚠️  Mit diesen Einstellungen fortfahren? (j/N): ');
    if (confirm.toLowerCase() !== 'j' && confirm.toLowerCase() !== 'y') {
      log.info('Abgebrochen.');
      rl.close();
      return;
    }

    // --- PRE-BUILD PIPELINE EXECUTION ---

    const exportFolderName = `framer-${framerUrl.replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '-').substring(0, 30)}`;
    let exportDir = path.join(rootDir, 'exports', exportFolderName);

    await runWithRecovery('FramerExport', async () => {
      log.step(`Starte FramerExport in dediziertem Ordner: ${exportDir}`);
      await fs.mkdir(exportDir, { recursive: true });

      const framerExportDir = findFramerExportDir(rootDir);
      if (!framerExportDir) {
        throw new Error('FramerExport nicht gefunden. Setze FRAMER_EXPORT_DIR oder lege FramerExport unter tools/framer-export bzw. FramerExport ab.');
      }

      const pkgJson = await readJsonIfExists(path.join(framerExportDir, 'package.json'));
      const before = await findIndexHtmlDirs(framerExportDir);
      if (pkgJson?.scripts?.dev) {
        log.info(`Befehl: npm run dev -- <framer-url> in ${framerExportDir}`);
        await runFile(npmBin, ['run', 'dev', '--', framerUrl], 'FramerExport ausführen', framerExportDir);
      } else if (existsSync(path.join(framerExportDir, 'src', 'cli', 'index.ts'))) {
        log.info(`Befehl: npx tsx src/cli/index.ts <framer-url> --platform framer in ${framerExportDir}`);
        await runFile(npxBin, ['tsx', 'src/cli/index.ts', framerUrl, '--platform', 'framer'], 'FramerExport ausführen', framerExportDir);
      } else {
        throw new Error(`Kein unterstützter FramerExport-Einstieg in ${framerExportDir} gefunden.`);
      }

      const after = await findIndexHtmlDirs(framerExportDir);
      const beforeDirs = new Set(before.map(e => path.resolve(e.dir).toLowerCase()));
      const generated = after.find(e => !beforeDirs.has(path.resolve(e.dir).toLowerCase())) || after[0];
      if (!generated) throw new Error('FramerExport hat kein index.html erzeugt.');
      exportDir = generated.dir;
      log.success('FramerExport erfolgreich abgeschlossen. Lokales Mirror erstellt.');
    }, rl);

    const exportHtml = path.join(exportDir, 'index.html');
    const tokensDir = path.join(exportDir, 'tokens');
    const assetsDir = path.join(exportDir, 'assets');
    await fs.mkdir(tokensDir, { recursive: true });
    await fs.mkdir(assetsDir, { recursive: true });
    const extractionSteps = [
      { args: ['scripts/extract-image-urls.js', '--html', exportHtml, '--output', path.join(assetsDir, 'image-manifest.json')], desc: 'Extrahiere Bild-URLs aus Framer-Export' },
      { args: ['scripts/resolve-fonts.js', '--html', exportHtml, '--fonts-dir', path.join(assetsDir, 'fonts'), '--output', path.join(tokensDir, 'font-resolution.json')], desc: 'Löse Font-Referenzen auf' },
      { args: ['scripts/extract-responsive-breakpoints.js', '--css', exportHtml, '--output', path.join(tokensDir, 'responsive-breakpoints.json')], desc: 'Extrahiere Responsive Breakpoints' },
      { args: ['scripts/extract-framer-styles.js', '--html', exportHtml, '--output', path.join(tokensDir, 'extracted-styles.json')], desc: 'Extrahiere CSS-Properties und Variablen' },
      { args: ['scripts/design-token-extractor.js', '--html', exportHtml, '--output', path.join(tokensDir, 'token-mapping.json'), '--variables-plan', path.join(tokensDir, 'variables-plan.json')], desc: 'Erzeuge Design-Token-Mapping und Variablen-Plan' },
      ...(targetPostId && targetPostId !== 'new'
        ? [{ args: ['scripts/framer-animation-extractor.js', '--html', exportHtml, '--post-id', targetPostId, '--output', path.join(tokensDir, 'animation-plan.json')], desc: 'Extrahiere Framer Animationen → GSAP ScrollTrigger Plan (RC-15, post-spezifisch)' }]
        : [{ args: ['scripts/framer-animation-extractor.js', '--html', exportHtml, '--output', path.join(tokensDir, 'animation-plan.json')], desc: 'Extrahiere Framer Animationen → GSAP ScrollTrigger Plan (RC-15)' }]),
      { args: ['scripts/html-to-widget-plan.js', '--html', exportHtml, '--output', path.join(tokensDir, 'widget-plan.json')], desc: 'HTML → Elementor Widget-Plan analysieren' }
    ];

    for (const step of extractionSteps) {
      await runWithRecovery(step.desc, async () => {
        await runFile(nodeBin, step.args, step.desc, pipelineDir);
      }, rl);
    }

    const treePath = path.join(rootDir, 'v4-tree.json');
    if (existsSync(treePath)) {
      await runWithRecovery('12-Guard Validation', async () => {
        const validationReportPath = path.join(rootDir, 'validation-report.json');
        await runFile(nodeBin, [
          'scripts/framer-pre-build-validate.js',
          '--tree', treePath,
          '--output', validationReportPath,
        ], 'Führe 12-Guard Pre-Build-Validierung durch', pipelineDir);

        try {
          const report = JSON.parse(await fs.readFile(validationReportPath, 'utf8'));
          const score = report.meta?.score || report.score || 0;
          if (score < 85) {
            throw new Error(`Validation Score zu niedrig: ${score}%. Mindestens 85% erforderlich.`);
          }
          log.success(`Validation bestanden mit Score: ${score}%`);
        } catch (e) {
          if (e.message.includes('Score zu niedrig')) throw e;
          log.warn('Konnte validation-report.json nicht parsen. Gehe von manuellem Check aus.');
        }
      }, rl);
    } else {
      log.warn('v4-tree.json nicht gefunden. Überspringe Pre-Build-Validierung.');
      log.info('Hinweis: Führe manuell `node scripts/convert-xml-to-v4.js` oder ein ähnliches Tool aus.');
    }

    targetPostIdNum = targetPostId !== 'new' ? parseInt(targetPostId, 10) : null;
    rollbackPlanPath = null;
    splitPlanPath = null;

    if (targetPostIdNum && !isNaN(targetPostIdNum)) {
      await runWithRecovery('Rollback-Backup', async () => {
        const { RollbackManager } = await import(
          pathToFileURL(path.join(pipelineDir, 'scripts', 'lib', 'rollback.js')).href
        );
        const rb = new RollbackManager();
        const { plan } = rb.backupPlan(targetPostIdNum);
        if (plan) {
          rollbackPlanPath = path.join(rootDir, 'rollback-plan.json');
          await fs.writeFile(rollbackPlanPath, JSON.stringify(plan, null, 2), 'utf8');
          log.success(`Rollback-Plan gespeichert: ${path.relative(rootDir, rollbackPlanPath)}`);
          console.error(`  → ${plan.mcp_calls.length} MCP-Calls (elementor-get-content + adrians-page-settings)`);
          console.error('  → Agent: MCP-Calls ausführen → Ergebnisse an RollbackManager.backupPlan() übergeben');
        } else {
          log.info('Backup existiert bereits — überspringe.');
        }
      }, rl);
    } else {
      log.info('Phase 1.3 übersprungen (neue Seite — kein Backup nötig).');
    }

    if (existsSync(treePath) && targetPostIdNum) {
      await runWithRecovery('Split-Large-Tree', async () => {
        const splitStdout = await runFile(
          nodeBin,
          [path.join(pipelineDir, 'scripts', 'lib', 'split-large-tree.js'), '--plan', treePath, '--post-id', String(targetPostIdNum)],
          'V4-Tree auf Section-Split prüfen',
          pipelineDir
        );
        if (splitStdout) {
          const splitResult = JSON.parse(splitStdout);
          const sectionCount = splitResult.sections?.length || 0;
          splitPlanPath = path.join(rootDir, 'split-plan.json');
          await fs.writeFile(splitPlanPath, splitStdout, 'utf8');
          if (sectionCount > 1) {
            log.warn(`Tree hat ${splitResult.totalElements} Elemente → in ${sectionCount} Sections gesplittet.`);
            console.error(`  → Split-Plan: ${path.relative(rootDir, splitPlanPath)}`);
          } else {
            log.success(`Tree passt in einen Build-Call (${splitResult.totalElements} Elemente).`);
          }
        }
      }, rl);
    }

    // Schritt D: Manifest
    log.step('Generiere Build-Manifest...');
    const manifest = {
      timestamp: new Date().toISOString(),
      framerUrl,
      scope: targetScope,
      wpEnvironment: wpEnv,
      targetPostId,
      exportFolder: exportFolderName,
      artifacts: {
        v4Tree: existsSync(treePath) ? 'v4-tree.json' : 'pending',
        imageManifest: path.relative(rootDir, path.join(exportDir, 'assets', 'image-manifest.json')).replace(/\\/g, '/'),
        fontResolution: path.relative(rootDir, path.join(exportDir, 'tokens', 'font-resolution.json')).replace(/\\/g, '/'),
        responsive: path.relative(rootDir, path.join(exportDir, 'tokens', 'responsive-breakpoints.json')).replace(/\\/g, '/'),
        extractedStyles: path.relative(rootDir, path.join(exportDir, 'tokens', 'extracted-styles.json')).replace(/\\/g, '/'),
        tokenMapping: path.relative(rootDir, path.join(exportDir, 'tokens', 'token-mapping.json')).replace(/\\/g, '/'),
        variablesPlan: path.relative(rootDir, path.join(exportDir, 'tokens', 'variables-plan.json')).replace(/\\/g, '/'),
        animationPlan: path.relative(rootDir, path.join(exportDir, 'tokens', 'animation-plan.json')).replace(/\\/g, '/'),
        validation: existsSync(treePath) ? 'validation-report.json' : 'pending',
      },
      preview: targetPostIdNum ? {
        command: `node wizard.js preview --post-id ${targetPostIdNum}`,
        promote: `node wizard.js promote --preview-id <ID> --target-id ${targetPostIdNum}`,
      } : null,
      nextSteps: [
        '=== PRE-BUILD ===',
        '1. v4-tree.json generieren (convert-xml-to-v4.js).',
        '2. MCP: novamira/adrians-export-design-system { what: all } → design-system-export.json',
        '3. GV-IDs aus design-system-export.json in v4-tree.json eintragen.',
        `4. ROLLBACK: ${rollbackPlanPath ? 'MCP-Calls aus rollback-plan.json ausführen.' : 'Kein Rollback nötig.'}`,
        `5. SPLIT: ${splitPlanPath ? 'MCP-Calls aus split-plan.json ausführen.' : 'Tree passt in einen Call.'}`,
        '=== BUILD ===',
        '6. MCP: novamira/adrians-setup-v4-foundation { post_id: <ID> }',
        '7. MCP: novamira/elementor-set-content',
        '=== POST-BUILD QA ===',
        '8. verify-build-binding.js + validate-v4-tree.js + layout-audit + visual-qa',
      ],
    };

    const manifestPath = path.join(rootDir, 'build-manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    log.success(`Build-Manifest gespeichert unter: ${manifestPath}`);

    console.log('\n' + '='.repeat(60));
    log.success('🎉 PRE-BUILD PHASE ABGESCHLOSSEN');
    console.log('='.repeat(60));

  } catch (error) {
    log.error('Ein kritischer Fehler ist im Wizard aufgetreten:');
    console.error(error);

    const action = await promptErrorRecovery('Build-Gesamt', error, rl);
    if (action === 'skip') {
      log.info('Build abgeschlossen mit Fehlern — bitte Logs prüfen.');
    }

    if (targetPostIdNum && !isNaN(targetPostIdNum)) {
      try {
        const { RollbackManager } = await import(
          pathToFileURL(path.join(pipelineDir, 'scripts', 'lib', 'rollback.js')).href
        );
        const rb = new RollbackManager();
        if (rb.hasBackup(targetPostIdNum)) {
          const restoreOutput = rb.restorePlan(targetPostIdNum);
          const restorePlanPath = path.join(rootDir, 'restore-plan.json');
          await fs.writeFile(restorePlanPath, JSON.stringify(restoreOutput.plan, null, 2), 'utf8');
          log.warn('ROLLBACK: Ein Backup existiert. Restore-Plan wurde erstellt:');
          console.error(`  → ${path.relative(rootDir, restorePlanPath)}`);
        }
      } catch (_) {}
    }
  } finally {
    rl.close();
  }
}

// ── Non-Interactive Mode (Sprint 8: ENH-12 E2E Framer-URL Test) ──────────

if (process.argv.includes('--non-interactive')) {
  const urlIdx = process.argv.indexOf('--url');
  const postIdIdx = process.argv.indexOf('--post-id');
  const framerUrl = urlIdx >= 0 ? process.argv[urlIdx + 1] : null;
  const targetPostId = postIdIdx >= 0 ? process.argv[postIdIdx + 1] : null;

  if (!framerUrl) {
    log.error('--non-interactive requires --url <framer-url>');
    process.exit(2);
  }

  log.info('Non-Interactive Mode: ' + framerUrl);
  if (targetPostId) log.info('Target Post-ID: ' + targetPostId);

  // Parse --no-cache flag (Sprint 16)
  const noCache = process.argv.includes('--no-cache');
  if (noCache) log.info('--no-cache: FramerExport-Cache umgangen.');

  // Run the same phases as interactive mode but without prompts
  try {
    // Phase 0.2: Schema Sync
    log.step('Phase 0.2: Schema-Sync mit V2-Plugin...');
    try {
      await runFile(
        nodeBin,
        [path.join(pipelineDir, 'scripts', 'sync-schema.js'), '--verbose'],
        'Prop-Schema vom V2-Plugin synchronisieren',
        pipelineDir
      );
      log.success('Prop-Schema erfolgreich synchronisiert.');
    } catch (err) {
      log.warn('Schema-Sync fehlgeschlagen: ' + String(err).slice(0, 200));
    }

    const exportFolderName = 'framer-' + framerUrl.replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '-').substring(0, 30);
    let exportDir = path.join(rootDir, 'exports', exportFolderName);

    // Sprint 16: Prüfe FramerExport-Cache bevor wir neu exportieren
    const cacheResult = await checkFramerExportCache(framerUrl, noCache);
    if (cacheResult.cached && cacheResult.exportDir && existsSync(cacheResult.exportDir)) {
      exportDir = cacheResult.exportDir;
      log.success('FramerExport aus Cache geladen: ' + exportDir);
    } else {
      // Run FramerExport (Cache miss oder --no-cache)
      log.step('Starte FramerExport...');
      const framerExportDir = findFramerExportDir(rootDir);
      if (!framerExportDir) {
        log.error('FramerExport nicht gefunden. Setze FRAMER_EXPORT_DIR.');
        process.exit(1);
      }

      await fs.mkdir(exportDir, { recursive: true });
      // Track directories before export
      const beforeDirs = await findIndexHtmlDirs(framerExportDir);

      const pkgJson = await readJsonIfExists(path.join(framerExportDir, 'package.json'));
      if (pkgJson && pkgJson.scripts && pkgJson.scripts.dev) {
        await runFile(npmBin, ['run', 'dev', '--', framerUrl], 'FramerExport', framerExportDir);
      } else if (existsSync(path.join(framerExportDir, 'src', 'cli', 'index.ts'))) {
        await runFile(npxBin, ['tsx', 'src/cli/index.ts', framerUrl, '--platform', 'framer'], 'FramerExport', framerExportDir);
      } else {
        log.error('Kein unterstuetzter FramerExport-Einstieg gefunden.');
        process.exit(1);
      }

      const after = await findIndexHtmlDirs(framerExportDir);
      const beforeSet = new Set(beforeDirs.map(function(e) { return path.resolve(e.dir).toLowerCase(); }));
      const generated = after.find(function(e) { return !beforeSet.has(path.resolve(e.dir).toLowerCase()); }) || after[0];
      if (!generated) {
        log.error('FramerExport hat kein index.html erzeugt.');
        process.exit(1);
      }
      exportDir = generated.dir;
      log.success('FramerExport: ' + exportDir);

      // Sprint 16: Cache nach erfolgreichem Export schreiben
      await writeFramerExportCache(framerUrl, exportDir);
    }

    const exportHtml = path.join(exportDir, 'index.html');
    const tokensDir = path.join(exportDir, 'tokens');
    await fs.mkdir(tokensDir, { recursive: true });

    // Run extraction steps
    const extractionSteps = [
      { args: ['scripts/extract-image-urls.js', '--html', exportHtml, '--output', path.join(exportDir, 'assets', 'image-manifest.json')], desc: 'Bild-URLs' },
      { args: ['scripts/resolve-fonts.js', '--html', exportHtml, '--fonts-dir', path.join(exportDir, 'assets', 'fonts'), '--output', path.join(tokensDir, 'font-resolution.json')], desc: 'Font-Referenzen' },
      { args: ['scripts/extract-responsive-breakpoints.js', '--css', exportHtml, '--output', path.join(tokensDir, 'responsive-breakpoints.json')], desc: 'Breakpoints' },
      { args: ['scripts/extract-framer-styles.js', '--html', exportHtml, '--output', path.join(tokensDir, 'extracted-styles.json')], desc: 'CSS-Properties' },
      { args: ['scripts/design-token-extractor.js', '--html', exportHtml, '--output', path.join(tokensDir, 'token-mapping.json'), '--variables-plan', path.join(tokensDir, 'variables-plan.json')], desc: 'Design-Tokens' },
      { args: ['scripts/framer-animation-extractor.js', '--html', exportHtml, '--output', path.join(tokensDir, 'animation-plan.json')], desc: 'Animationen' },
      { args: ['scripts/html-to-widget-plan.js', '--html', exportHtml, '--output', path.join(tokensDir, 'widget-plan.json')], desc: 'Widget-Plan' },
    ];

    for (const step of extractionSteps) {
      log.step('Extrahiere ' + step.desc + '...');
      try {
        await runFile(nodeBin, step.args, step.desc, pipelineDir);
        log.success(step.desc + ' abgeschlossen.');
      } catch (err) {
        log.warn(step.desc + ' fehlgeschlagen: ' + String(err).slice(0, 100));
      }
    }

    // Generate manifest
    const manifest = {
      timestamp: new Date().toISOString(),
      framerUrl,
      targetPostId: targetPostId || 'not-specified',
      exportFolder: exportFolderName,
      artifacts: {
        exportDir: path.relative(rootDir, exportDir).replace(/\\/g, '/'),
        tokens: path.relative(rootDir, tokensDir).replace(/\\/g, '/'),
      },
    };
    const manifestPath = path.join(rootDir, 'build-manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    log.success('Non-Interactive Pipeline abgeschlossen.');
    console.log(JSON.stringify(manifest, null, 2));

  } catch (error) {
    log.error('Non-Interactive fehlgeschlagen: ' + error.message);
    process.exit(1);
  }

  process.exit(0);
}

// ── Subcommand Dispatch (Sprint 6: thin router) ──────────────────────────

const sub = process.argv[2];

// ── help <sub> or <sub> --help ────────────────────────────────────────
const hasHelpFlag = process.argv.includes('--help') || process.argv.includes('-h');

if (hasHelpFlag) {
  // <sub> --help → show sub-command help
  if (sub && cmdHelp[sub]) {
    cmdHelp[sub]();
    process.exit(0);
  }
  showHelp();
  process.exit(0);
}

if (sub === 'help') {
  // wizard.js help <sub>
  const target = process.argv[3];
  if (target && cmdHelp[target]) {
    cmdHelp[target]();
  } else {
    showHelp();
  }
  process.exit(0);
}

if (sub === 'preflight') {
  const formatJson = process.argv.includes('--format=json');
  await runPreflight(formatJson);
  process.exit(0);
}

if (sub === 'preview') {
  const postIdIdx = process.argv.indexOf('--post-id');
  const postId = postIdIdx >= 0 ? process.argv[postIdIdx + 1] : null;
  await runPreview(postId);
}

if (sub === 'promote') {
  const pvIdx = process.argv.indexOf('--preview-id');
  const tgIdx = process.argv.indexOf('--target-id');
  const previewId = pvIdx >= 0 ? process.argv[pvIdx + 1] : null;
  const targetId = tgIdx >= 0 ? process.argv[tgIdx + 1] : null;
  await runPromote(previewId, targetId);
}

if (sub === 'batch') {
  const pagesIdx = process.argv.indexOf('--pages');
  const pages = pagesIdx >= 0 ? process.argv[pagesIdx + 1] : '';
  const postIdsIdx = process.argv.indexOf('--post-ids');
  const postIds = postIdsIdx >= 0 ? process.argv[postIdsIdx + 1] : '';
  await runBatch(pages, postIds);
}

if (sub === 'dry-run' || process.argv.includes('--dry-run')) {
  await runDryRun();
  process.exit(0);
}

if (sub === 'serve') {
  const port = parseInt(process.argv[3] || '7123', 10);
  await runServe(port);
  process.exit(0);
}

if (sub === 'pipeline') {
  const urlIdx = process.argv.indexOf('--url');
  const postIdIdx = process.argv.indexOf('--post-id');
  const exportDirIdx = process.argv.indexOf('--export-dir');
  const siteIdx = process.argv.indexOf('--site');
  const framerUrl = urlIdx >= 0 ? process.argv[urlIdx + 1] : null;
  const postId = postIdIdx >= 0 ? process.argv[postIdIdx + 1] : null;
  const exportDir = exportDirIdx >= 0 ? process.argv[exportDirIdx + 1] : null;
  const siteId = siteIdx >= 0 ? process.argv[siteIdx + 1] : (process.env.MCP_SITE_ID || 'default');
  const noCache = process.argv.includes('--no-cache');
  const skipQa = process.argv.includes('--skip-qa');
  const dryRun = process.argv.includes('--dry-run');
  const verbose = process.argv.includes('--verbose');
  const resume = process.argv.includes('--resume');

  if (!framerUrl && !exportDir && !resume) {
    log.error('pipeline requires --url <framer-url> or --export-dir <dir>');
    phPipeline();
    process.exit(2);
  }

  await runPipeline({ framerUrl, postId, exportDir, siteId, noCache, skipQa, dryRun, verbose, resume });
  process.exit(0);
}

if (sub === 'doctor') {
  const formatJson = process.argv.includes('--format=json');
  const fix = process.argv.includes('--fix');
  await runDoctor(formatJson, fix);
  process.exit(0);
}

// Default: interaktiver Build-Wizard
main();
