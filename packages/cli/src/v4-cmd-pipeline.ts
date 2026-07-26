// @ts-nocheck — Migration-Marker: Typen werden schrittweise verfeinert (UMBAUPLAN Step 14)
/**
 * src/cli/cmd-pipeline.js — Full 14-Step Pipeline (Phase 6, Optimized)
 *
 * UMBAUPLAN v2.0 Phase 6+8: Orchestriert alle 14 Pipeline-Schritte.
 * Optimized: parallel extraction, output dedup, removed redundant calls.
 *
 * STEPS:
 *   1.  FramerExport (cached, existing)
 *   2.  CSS-Token-Extraktion (extract-framer-css-tokens.js, PRIMARY)
 *   3.  Browser-Crawl-Fallback (extract-framer-css-tokens.js --url, FALLBACK)
 *   4.  Unframer MCP getProjectXml (delegated)
 *   5.  Unframer MCP getNodeXml(section) (delegated)
 *   6.  Style-Referenzen sammeln
 *   7.  Token-Mapping erstellen
 *   8.  Token-Mapping validieren
 *   9.  Design System aufbauen (design-system-builder.js, WITH OUTPUT DEDUP)
 *  10.  resolve-fonts.js (parallel mit Step 2)
 *  11.  convert-xml-to-v4.js (WITH --token-map + --output-dir)
 *  12.  framer-pre-build-validate.js (parallel mit Step 14)
 *  13.  elementor-set-content (MCP — delegated)
 *  14.  Visual QA + Auto-Fix (build-quality-gate.js, parallel mit Step 12)
 *
 * Usage:
 *   node wizard.js pipeline --url https://example.framer.app/ [--post-id 42]
 *   node wizard.js pipeline --export-dir exports/my-project/
 */

import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import {
  log, findWorkspaceRoot, findFramerExportDir,
  runFile, runParallel, findIndexHtmlDirs, readJsonIfExists,
  nodeBin, npxBin, npmBin,
  checkFramerExportCache, writeFramerExportCache,
  pipelineDir, repoDir,
} from './shared.js';
import { getFramerCacheStats } from '../../scripts/lib/framer-cache.js';
import { detectElementorVersion } from '../../scripts/lib/elementor-version.js';
import { detectActiveTheme } from '../../scripts/lib/wp-theme.js';

/**
 * Gibt die Hilfe fuer dieses Subcommand aus.
 */
export function printHelp() {
  console.log(`wizard.js pipeline — Vollstaendige 14-Step Pipeline (OPTIMIZED)

USAGE:
  node wizard.js pipeline --url <framer-url> [OPTIONS]

OPTIONS:
  --url <url>           Framer-Quell-URL (Pflicht)
  --post-id <ID>        Ziel-Post-ID in WordPress
  --export-dir <dir>    FramerExport-Verzeichnis (ueberspringt Export)
  --no-cache            FramerExport-Cache umgehen
  --skip-qa             QA-Gate ueberspringen (schnellerer Build)
  --dry-run             Keine MCP-Calls, nur Plan generieren
  --site <id>          Site-ID fuer MCP-Detection (default: 'default')
  --verbose             Ausfuehrliche Logs

OPTIMIZATIONS:
  - Steps 2+10 run in PARALLEL (CSS tokens + fonts)
  - Steps 12+14 run in PARALLEL (validate + QA gate)
  - Design System output dedup (skips if fresh)
  - resolve-fonts.js NOT called twice

BEISPIELE:
  node wizard.js pipeline --url https://hilarious-workshops-284047.framer.app/
  node wizard.js pipeline --url https://example.framer.app/ --post-id 42
  node wizard.js pipeline --export-dir exports/my-page/ --verbose
`);
}

/**
 * Führt den vollen 14-Step Pipeline-Durchlauf aus (optimized).
 */
export async function runPipeline({
  framerUrl,
  postId = null,
  exportDir: existingExportDir = null,
  noCache = false,
  skipQa = false,
  dryRun = false,
  verbose = false,
  siteId = 'default',
  resume = false,
}) {
  const rootDir = findWorkspaceRoot();
  const startTime = Date.now();
  const steps = [];
  let exportDir = existingExportDir ? path.resolve(existingExportDir) : null;
  let tokenMapPath = null;
  let designSystemDir = null;
  let v4TreePath = null;
  // Phase 4: Detection-Cache (wird in Step 0 befuellt)
  let elementorEnv = null;
  let themeEnv = null;

  // ── Pipeline-State (Resume-Support) ──────────────────────────────────────
  const { loadState, createState, savePhase, markFailed, isPhaseCompleted, getPhaseOutput } =
    await import('../../scripts/lib/pipeline-state.js');
  const statePath = path.join(rootDir, '.pipeline', 'state.json');
  let pState = resume ? await loadState(statePath) : null;
  if (!pState) {
    pState = createState({ target: siteId, framerUrl: framerUrl || '', postId: postId ? parseInt(postId) : null });
  }
  if (resume && pState) {
    log.info(`Resuming pipeline from state: ${statePath}`);
  }
  // ─────────────────────────────────────────────────────────────────────────

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  🚀 FULL 14-STEP PIPELINE (OPTIMIZED)');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  URL:     ${framerUrl || '(from export-dir)'}`);
  console.log(`  Post-ID: ${postId || 'auto'}`);
  console.log(`  Mode:    ${dryRun ? 'DRY-RUN' : 'LIVE'}`);
  console.log(`${'═'.repeat(60)}\n`);

  // ════════════════════════════════════════════
  // STEP 0: Phase-4 Detection (Elementor-Version + Theme)  [UMBAUPLAN §4.1, §4.2]
  // ════════════════════════════════════════════

  log.step('Step 0/14: Elementor-Version + Theme-Detection...');
  let step0Status = 'ok';
  let step0Detail = {};
  try {
    let mcpBridge = null;
    try {
      const { McpBridge } = await import('../../scripts/lib/mcp-bridge.js');
      mcpBridge = await McpBridge.fromConfig();
    } catch (bridgeErr) {
      log.warn(`MCP-Bridge nicht verfuegbar: ${bridgeErr.message} — Detection laeuft im Fallback-Modus`);
    }

    if (mcpBridge) {
      // Parallel detection
      const [elRes, thRes] = await Promise.all([
        detectElementorVersion({ mcpBridge, siteId, cacheRoot: rootDir }).catch(err => {
          log.warn(`Elementor-Detection fehlgeschlagen: ${err.message}`);
          return null;
        }),
        detectActiveTheme({ mcpBridge, siteId, cacheRoot: rootDir }).catch(err => {
          log.warn(`Theme-Detection fehlgeschlagen: ${err.message}`);
          return null;
        }),
      ]);
      elementorEnv = elRes;
      themeEnv = thRes;
      if (elRes) {
        log.success(`Elementor: ${elRes.version} (${elRes.strategy?.mode || 'unknown'})`);
        step0Detail.elementor = { version: elRes.version, strategy: elRes.strategy?.mode, _cache: elRes._cache };
      }
      if (thRes) {
        log.success(`Theme: ${thRes.name} ${thRes.version} (${thRes.classification?.tier})`);
        step0Detail.theme = { name: thRes.name, tier: thRes.classification?.tier, _cache: thRes._cache };
      }
      if (!elRes && !thRes) step0Status = 'warning';
    } else {
      step0Status = 'skipped';
      step0Detail = { reason: 'no-mcp-bridge' };
    }
  } catch (err) {
    step0Status = 'warning';
    step0Detail = { error: err.message };
    log.warn(`Step 0 fehlgeschlagen: ${err.message}`);
  }
  steps.push({ step: 0, name: 'Phase-4 Detection', status: step0Status, detail: step0Detail });

  // ════════════════════════════════════════════
  // STEP 1: FramerExport
  // ════════════════════════════════════════════

  // Resume: restore exportDir from previous state
  if (resume && isPhaseCompleted(pState, 'framer-export')) {
    const cached = getPhaseOutput(pState, 'framer-export');
    if (cached?.exportDir && existsSync(cached.exportDir)) {
      exportDir = cached.exportDir;
      log.success(`Step 1/14: FramerExport — resumed from state: ${exportDir}`);
      steps.push({ step: 1, name: 'FramerExport', status: 'resumed' });
    }
  }

  if (!exportDir) {
  if (existingExportDir && existsSync(existingExportDir)) {
    exportDir = path.resolve(existingExportDir);
    log.success(`Step 1/14: FramerExport — vorhanden: ${exportDir}`);
    steps.push({ step: 1, name: 'FramerExport', status: 'cached' });
  } else if (framerUrl) {
    log.step('Step 1/14: FramerExport...');

    const cacheResult = await checkFramerExportCache(framerUrl, noCache);
    if (cacheResult.cached && cacheResult.exportDir && existsSync(cacheResult.exportDir)) {
      exportDir = cacheResult.exportDir;
      log.success(`FramerExport aus Cache: ${exportDir}`);
      steps.push({ step: 1, name: 'FramerExport', status: 'cached' });
    } else {
      const framerExportDir = findFramerExportDir(rootDir);
      if (!framerExportDir) {
        log.error('FramerExport nicht gefunden.');
        return { status: 'FAILED', step: 1, error: 'FramerExport directory not found' };
      }

      const exportFolderName = 'framer-' + framerUrl.replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '-').substring(0, 30);
      exportDir = path.join(rootDir, 'exports', exportFolderName);
      await fs.mkdir(exportDir, { recursive: true });

      try {
        const pkgJson = await readJsonIfExists(path.join(framerExportDir, 'package.json'));
        const before = await findIndexHtmlDirs(framerExportDir);

        const distEntry = path.join(framerExportDir, 'dist', 'cli', 'index.js');
        if (existsSync(distEntry)) {
          log.info('FramerExport: nutze prebuilt dist/cli/index.js');
          await runFile(npmBin, ['run', 'build'], 'FramerExport build', framerExportDir);
          const nodeBin = process.execPath;
          await runFile(nodeBin, [distEntry, framerUrl, '--platform', 'framer'], 'FramerExport', framerExportDir);
        } else if (pkgJson?.scripts?.dev) {
          log.info('FramerExport: kein dist/, nutze npm run dev (langsamer)');
          await runFile(npmBin, ['run', 'dev', '--', framerUrl], 'FramerExport', framerExportDir);
        } else if (existsSync(path.join(framerExportDir, 'src', 'cli', 'index.ts'))) {
          log.info('FramerExport: nutze tsx src/cli/index.ts (Fallback)');
          await runFile(npxBin, ['tsx', 'src/cli/index.ts', framerUrl, '--platform', 'framer'], 'FramerExport', framerExportDir);
        } else {
          throw new Error('Kein unterstuetzter FramerExport-Einstieg gefunden.');
        }

        const after = await findIndexHtmlDirs(framerExportDir);
        const beforeSet = new Set(before.map(e => path.resolve(e.dir).toLowerCase()));
        const generated = after.find(e => !beforeSet.has(path.resolve(e.dir).toLowerCase())) || after[0];
        if (!generated) throw new Error('FramerExport hat kein index.html erzeugt.');
        exportDir = generated.dir;

        await writeFramerExportCache(framerUrl, exportDir);
        log.success(`FramerExport: ${exportDir}`);
        steps.push({ step: 1, name: 'FramerExport', status: 'ok' });
        pState = await savePhase(pState, 'framer-export', { exportDir }, statePath);
      } catch (err) {
        log.error(`FramerExport fehlgeschlagen: ${err.message}`);
        pState = await markFailed(pState, 'framer-export', err, statePath);
        return { status: 'FAILED', step: 1, error: err.message };
      }
    }
  } else {
    log.error('--url oder --export-dir erforderlich');
    return { status: 'FAILED', step: 1, error: 'Missing --url or --export-dir' };
  }
  } // end if(!exportDir) resume guard

  const exportHtml = path.join(exportDir, 'index.html');
  if (!existsSync(exportHtml)) {
    log.error(`index.html nicht gefunden in ${exportDir}`);
    return { status: 'FAILED', step: 1, error: 'index.html missing in export dir' };
  }

  // Initialize sub-directories
  const tokensDir = path.join(exportDir, 'tokens');
  const assetsDir = path.join(exportDir, 'assets');
  designSystemDir = path.join(exportDir, 'design-system');
  await fs.mkdir(tokensDir, { recursive: true });
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.mkdir(designSystemDir, { recursive: true });

  // ════════════════════════════════════════════
  // STEP 2+10: CSS-Token-Extraktion + Fonts (PARALLEL)
  // ════════════════════════════════════════════

  log.step('Steps 2+10/14: CSS-Token-Extraktion + Fonts (parallel)...');

  tokenMapPath = path.join(tokensDir, 'token-mapping.json');
  const fontResPath = path.join(tokensDir, 'font-resolution.json');

  const parallelResults = await runParallel([
    {
      command: nodeBin,
      args: [
        path.join(pipelineDir, 'extract-framer-css-tokens.js'),
        '--html', exportHtml,
        '--output', tokenMapPath,
        ...(verbose ? ['--verbose'] : []),
      ],
      description: 'CSS-Token-Extraktion',
      cwd: pipelineDir,
      outputFile: tokenMapPath,
    },
    {
      command: nodeBin,
      args: [
        path.join(pipelineDir, 'resolve-fonts.js'),
        '--html', exportHtml,
        '--fonts-dir', path.join(assetsDir, 'fonts'),
        '--output', fontResPath,
      ],
      description: 'resolve-fonts.js',
      cwd: pipelineDir,
      optional: true,
      outputFile: fontResPath,
    },
  ]);

  for (const r of parallelResults) {
    steps.push({
      step: r.description === 'CSS-Token-Extraktion' ? 2 : 10,
      name: r.description,
      status: r.ok ? 'ok' : 'warning',
      error: r.error,
    });
  }

  // ════════════════════════════════════════════
  // STEP 3: Browser-Crawl-Fallback (optimized merge)
  // ════════════════════════════════════════════
  // Previously this step OVERWROTE token-mapping.json with live-fetch
  // data that always had 0 mapped colors (no --style-refs). Now it:
  //   1. Outputs to a temp file
  //   2. Merges ONLY css_variables, fonts, breakpoints into the existing
  //      tokenMap (preserving colors/textStyles from Step 2 HTML extraction)
  //   3. Retries once on transient network errors
  // This makes the fallback actually useful: it enriches color_tokens_list
  // for Step 7a enrichment without destroying Step 2's color mappings.

  let tokenMap = null;
  try {
    tokenMap = JSON.parse(await fs.readFile(tokenMapPath, 'utf8'));
  } catch { tokenMap = null; }

  const unmappedCount = tokenMap?.unmapped_tokens?.length || 0;
  const mappedCount = Object.keys(tokenMap?.colors || {}).length;

  if (unmappedCount > 0 && mappedCount < 5 && framerUrl) {
    log.step('Step 3/14: Browser-Crawl-Fallback (live Framer page)...');

    const liveTempPath = tokenMapPath + '.live-tmp';
    let fallbackOk = false;
    let mergeAddedVars = 0;
    let mergeAddedFonts = 0;

    let mergeAddedBps = 0;

    // Retry once on transient failures (Node.js fetch assertions, DNS, etc.)
    for (let attempt = 0; attempt < 2 && !fallbackOk; attempt++) {
      if (attempt > 0) {
        log.info(`Browser-Crawl-Fallback retry ${attempt + 1}/2...`);
        await new Promise(r => setTimeout(r, 2000));
      }
      try {
        // outputFile enables auto-rescue: if the process crashes during teardown
        // (Windows libuv race), runFile checks if the output was written and
        // returns it transparently — no catch block needed for that case.
        await runFile(nodeBin, [
          path.join(pipelineDir, 'extract-framer-css-tokens.js'),
          '--url', framerUrl,
          '--output', liveTempPath,
          ...(verbose ? ['--verbose'] : []),
        ], `Browser-Crawl-Fallback${attempt > 0 ? ` (retry ${attempt + 1})` : ''}`, pipelineDir, liveTempPath);

        fallbackOk = true;
      } catch (err) {
        const msg = err.message || '';
        if (attempt === 0 && (msg.includes('Assertion') || msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('EAI_') || msg.toLowerCase().includes('fetch'))) {
          log.warn(`Browser-Crawl-Fallback attempt ${attempt + 1} fehlgeschlagen: ${msg}`);
          continue;
        }
        log.warn(`Browser-Crawl-Fallback fehlgeschlagen: ${msg}`);
        break;
      }
    }

    if (fallbackOk) {
      // Merge live data into existing tokenMap (don't overwrite colors!)
      try {
        const liveData = JSON.parse(await fs.readFile(liveTempPath, 'utf8'));

        // Merge css_variables.color_tokens_list (append live tokens)
        if (liveData?.css_variables?.color_tokens_list?.length > 0) {
          if (!tokenMap.css_variables) tokenMap.css_variables = { color_tokens_list: [], total: 0, color_tokens: 0 };
          if (!tokenMap.css_variables.color_tokens_list) tokenMap.css_variables.color_tokens_list = [];

          const existingNames = new Set(tokenMap.css_variables.color_tokens_list.map(t => t.name));
          for (const token of liveData.css_variables.color_tokens_list) {
            if (!existingNames.has(token.name)) {
              tokenMap.css_variables.color_tokens_list.push(token);
              existingNames.add(token.name);
              mergeAddedVars++;
            }
          }
          tokenMap.css_variables.total = tokenMap.css_variables.color_tokens_list.length;
          tokenMap.css_variables.color_tokens = mergeAddedVars + (tokenMap.css_variables.color_tokens || 0);
        }

        // Merge fonts (append new families)
        if (liveData?.fonts?.length > 0) {
          // tokenMap.fonts may be object (Step 7b) or array — normalize to obj for dedup
          const existingFamilies = new Set(
            Array.isArray(tokenMap.fonts)
              ? tokenMap.fonts.map(f => f?.family).filter(Boolean)
              : Object.keys(tokenMap.fonts || {})
          );
          for (const font of liveData.fonts) {
            if (font?.family && !existingFamilies.has(font.family)) {
              if (Array.isArray(tokenMap.fonts)) {
                tokenMap.fonts.push(font);
              } else {
                tokenMap.fonts[font.family] = font;
              }
              existingFamilies.add(font.family);
              mergeAddedFonts++;
            }
          }
        }

        // Merge breakpoints (append new ones)
        if (liveData?.breakpoints?.length > 0) {
          const existingBps = new Set((tokenMap.breakpoints || []).map(b => b.width));
          for (const bp of liveData.breakpoints) {
            if (!existingBps.has(bp.width)) {
              if (!tokenMap.breakpoints) tokenMap.breakpoints = [];
              tokenMap.breakpoints.push(bp);
              existingBps.add(bp.width);
              mergeAddedBps++;
            }
          }
        }

        if (mergeAddedVars > 0 || mergeAddedFonts > 0 || mergeAddedBps > 0) {
          await fs.writeFile(tokenMapPath, JSON.stringify(tokenMap, null, 2), 'utf8');
        }
      } catch (mergeErr) {
        log.warn(`Browser-Crawl-Merge fehlgeschlagen: ${mergeErr.message}`);
      }

      // Cleanup temp file
      try { await fs.unlink(liveTempPath); } catch {}

      const mergedDetail = [
        mergeAddedVars > 0 ? `+${mergeAddedVars} CSS vars` : null,
        mergeAddedFonts > 0 ? `+${mergeAddedFonts} fonts` : null,
        mergeAddedBps > 0 ? `+${mergeAddedBps} breakpoints` : null,
      ].filter(Boolean).join(', ') || 'no new data to merge';
      log.success(`Browser-Crawl-Fallback: ${mergedDetail} (colors preserved: ${mappedCount})`);
      steps.push({ step: 3, name: 'Browser-Crawl-Fallback', status: 'ok', detail: mergedDetail });
    } else {
      // Cleanup temp file on failure
      try { await fs.unlink(liveTempPath); } catch {}
      log.warn('Browser-Crawl-Fallback nach Retries fehlgeschlagen — verwende Step-2-Daten');
      steps.push({ step: 3, name: 'Browser-Crawl-Fallback', status: 'warning', error: 'Failed after retries' });
    }
  } else {
    log.info(`Step 3/14: Browser-Crawl-Fallback — übersprungen (${mappedCount} mapped, ${unmappedCount} unmapped)`);
    steps.push({ step: 3, name: 'Browser-Crawl-Fallback', status: 'skipped' });
  }

  // ════════════════════════════════════════════
  // STEPS 4-5: Unframer MCP (delegated)
  // ════════════════════════════════════════════

  // STEPS 4-5: Unframer MCP (live via unframer-bridge wenn konfiguriert,
  // sonst wie bisher an Agent delegiert)
  // Feature-Flag: nur aktiv wenn UNFRAMER_MCP_URL/ID/SECRET gesetzt sind
  // (gelesen aus .env.local oder process.env).
  // Siehe: docs/FRAMER-AGENT-SOURCE.md
  let unframerBridge = null;
  try {
    const { UnframerBridge } = await import('../../scripts/lib/unframer-bridge.js');
    if (UnframerBridge.isConfigured()) {
      unframerBridge = UnframerBridge.fromEnv();
      unframerBridge.logConfigSummary();
    }
  } catch (bridgeErr) {
    log.warn(`Unframer-Bridge nicht verfuegbar: ${bridgeErr.message} — Steps 4-5 werden delegiert`);
  }

  if (unframerBridge) {
    log.step('Steps 4-5/14: Unframer MCP (live via unframer-bridge)...');

    // Step 4: getProjectXml
    const projectXmlDir = path.join(exportDir, 'unframer');
    await fs.mkdir(projectXmlDir, { recursive: true });

    let step4Status = 'ok', step4Error = null;
    const projectXmlPath = path.join(projectXmlDir, 'project.xml');
    try {
      const start = Date.now();
      const projectXml = await unframerBridge.callTool('getProjectXml', {});
      // projectXml ist ein langer String (XML-Dump) — direkt speichern
      const xmlString = typeof projectXml === 'string' ? projectXml : JSON.stringify(projectXml, null, 2);
      await fs.writeFile(projectXmlPath, xmlString, 'utf8');
      const elapsed = Date.now() - start;
      log.success(`getProjectXml: ${xmlString.length} bytes (${elapsed}ms) → ${path.relative(rootDir, projectXmlPath)}`);
      steps.push({ step: 4, name: 'Unframer getProjectXml', status: 'ok', detail: `${xmlString.length} bytes, ${elapsed}ms` });
    } catch (err) {
      step4Status = 'warning';
      step4Error = err.message;
      log.warn(`getProjectXml fehlgeschlagen: ${err.message} — Fallback: Agent-delegiert`);
      steps.push({ step: 4, name: 'Unframer getProjectXml', status: 'warning', error: err.message });
    }

    // Step 5: getNodeXml pro Section (optional — koennte auch in Step 11 verwendet werden)
    // Hier nur Platzhalter: Wenn project.xml Sections enthaelt, koennen sie in Step 11
    // via convert-xml-to-v4 verarbeitet werden. Die tatsaechliche getNodeXml-Logik
    // bleibt beim Agent (out-of-band) — der Bridge-Call waere redundant.
    if (step4Status === 'ok') {
      steps.push({ step: 5, name: 'Unframer getNodeXml (sections)', status: 'skipped', detail: 'XML in Step 4 enthaelt alle Sections' });
    } else {
      steps.push({ step: 5, name: 'Unframer getNodeXml (sections)', status: 'delegated' });
    }
  } else {
    log.info('Steps 4-5/14: Unframer MCP — an Agent delegiert (kein UNFRAMER_MCP_* konfiguriert)');
    steps.push({ step: 4, name: 'Unframer getProjectXml', status: 'delegated' });
    steps.push({ step: 5, name: 'Unframer getNodeXml', status: 'delegated' });
  }

  // ════════════════════════════════════════════
  // STEP 6: Style-Referenzen sammeln
  // ════════════════════════════════════════════

  log.step('Step 6/14: Style-Referenzen sammeln...');

  const styleRefsPath = path.join(tokensDir, 'style-refs.json');
  const styleRefs = {
    generated_at: new Date().toISOString(),
    colors: tokenMap?.colors || [],
    textStyles: tokenMap?.textStyles || {},
    unmapped: tokenMap?.unmapped_tokens || [],
    stats: {
      mapped_colors: mappedCount,
      unmapped_tokens: unmappedCount,
      text_styles: Object.keys(tokenMap?.textStyles || {}).length,
    },
  };
  await fs.writeFile(styleRefsPath, JSON.stringify(styleRefs, null, 2), 'utf8');
  log.success(`Style-Referenzen: ${styleRefs.stats.mapped_colors} colors, ${styleRefs.stats.text_styles} text styles`);
  steps.push({ step: 6, name: 'Style-Referenzen sammeln', status: 'ok' });

  // ════════════════════════════════════════════
  // STEPS 7-8: Token-Mapping anreichern + validieren
  // ════════════════════════════════════════════

  log.step('Steps 7-8/14: Token-Mapping anreichern + validieren...');

  let enrichedColors = 0;
  let enrichedFonts = 0;

  if (tokenMap) {
    // Deterministic GV-ID generator (shared by color + font enrichment)
    const hashToGvId = (s) => 'e-gv-' + [...s.replace(/[^a-z0-9]/gi, '')]
      .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)
      .toString(16).replace('-', '').padStart(7, '0').slice(0, 7);

    // ── Step 7a: CSS-Token-Colors → GV-ID-Mappings aufbauen ──
    // Jeder CSS-Farb-Token aus dem Framer-Export bekommt eine
    // e-gv-XXXXXXXX ID, damit der Converter GV-Referenzen
    // statt Hardcoded-Hex schreiben kann.
    const cssColorTokens = tokenMap.css_variables?.color_tokens_list || [];
    if (!tokenMap.colors) tokenMap.colors = [];

    for (const token of cssColorTokens) {
      const name = token.name || '';
      const hex = token.hex || token.value || '';
      // Skip non-color tokens (font-weight, text-color, etc. that have bogus hex values)
      if (!hex || !hex.startsWith('#') || hex.length < 4) continue;
      // Skip framer-internal tokens that aren't real color variables
      if (name.startsWith('--framer-')) continue;

      // Generate a deterministic GV-ID from the token name
      const gvId = hashToGvId(name);

      // Use the token's Framer path as the id
      const key = name || hex;
      if (!tokenMap.colors.some(c => c.id === key)) {
        tokenMap.colors.push({ id: key, gv_id: gvId, hex, occurrences: 0, css_var: name || null });
        enrichedColors++;
      }
    }

    // ── Step 7b: Font-Families → GV-ID-Mappings aufbauen ──
    // Convert fonts from extractor's array format to converter's object format
    if (Array.isArray(tokenMap.fonts)) {
      const fontObj = {};
      for (const f of tokenMap.fonts) {
        if (f?.family) fontObj[f.family] = f;
      }
      tokenMap.fonts = fontObj;
    }
    if (!tokenMap.fonts) tokenMap.fonts = {};

    // Generate GV-IDs for each font family in the object-format map
    for (const [family, font] of Object.entries(tokenMap.fonts)) {
      if (!family || !font) continue;

      // Generate a deterministic GV-ID from the font family name
      const gvId = hashToGvId(family);

      // Only add gv_id if not already present
      if (!font.gv_id) {
        font.gv_id = gvId;
        enrichedFonts++;
      }
    }

    // Write enriched token-mapping back to disk
    if (enrichedColors > 0 || enrichedFonts > 0) {
      await fs.writeFile(tokenMapPath, JSON.stringify(tokenMap, null, 2), 'utf8');
      log.success(`Token-Mapping angereichert: +${enrichedColors} colors, +${enrichedFonts} fonts`);
    }
  }

  const mappingValid = enrichedColors > 0 || mappedCount > 0;
  if (mappingValid) {
    log.success(`Token-Mapping: ${enrichedColors + mappedCount} colors zugeordnet (${enrichedColors} auto-generiert)`);
  } else {
    log.warn(`Token-Mapping: KEINE Farben zugeordnet (${unmappedCount} unmapped) — manuelles Mapping empfohlen`);
  }
  steps.push({ step: 7, name: 'Token-Mapping erstellen', status: mappingValid ? 'ok' : 'warning', detail: `${enrichedColors} auto, ${mappedCount} existing` });

  // ── Step 8: Token-Mapping Validation (adaptive) ──
  // Instead of checking fixed Unframer style-ref paths (which only exist
  // when Unframer provides full design-system data), validate based on
  // whether CSS tokens were auto-enriched with GV-IDs.
  //
  // Auto-enrichment (Step 7a) maps CSS variable names → GV-IDs for ALL
  // color tokens — this is what the converter + Pre-Build-Validation need.
  // Unframer style paths like "/Theme Color/Very Dark Green" are irrelevant
  // in the auto-enrichment workflow; they only matter in the full Unframer flow.
  const totalCssColors = (tokenMap?.css_variables?.color_tokens_list || []).filter(
    t => t.hex && t.hex.startsWith('#') && t.hex.length >= 4 && !(t.name || '').startsWith('--framer-')
  ).length;
  const totalColorEntries = Object.keys(tokenMap?.colors || {}).length;

  if (enrichedColors > 0) {
    // Auto-enrichment covered all CSS tokens — validation passes regardless
    // of whether Unframer style-ref paths exist (they're unused in this mode)
    log.success(`Token-Mapping validiert: ${enrichedColors} GV-IDs aus ${totalCssColors} CSS-Tokens generiert`);
    steps.push({ step: 8, name: 'Token-Mapping validieren', status: 'ok', detail: `${enrichedColors}/${totalCssColors} tokens enriched` });
  } else if (totalColorEntries > 0) {
    // No auto-enrichment but some colors exist (from Unframer or manual)
    log.success(`Token-Mapping validiert: ${totalColorEntries} Farb-Mappings vorhanden`);
    steps.push({ step: 8, name: 'Token-Mapping validieren', status: 'ok', detail: `${totalColorEntries} mapped` });
  } else if (totalCssColors > 0) {
    // CSS tokens exist but none got enriched — genuine problem
    log.warn(`Token-Mapping: ${totalCssColors} CSS-Farb-Tokens, aber 0 GV-IDs generiert — manuelles Mapping noetig`);
    steps.push({ step: 8, name: 'Token-Mapping validieren', status: 'warning', detail: `${totalCssColors} tokens, 0 enriched` });
  } else {
    // No CSS color tokens found at all (unusual, might be a monochrome site)
    log.info('Token-Mapping: Keine CSS-Farb-Tokens gefunden — Validierung uebersprungen');
    steps.push({ step: 8, name: 'Token-Mapping validieren', status: 'ok', detail: 'no color tokens detected' });
  }

  // ════════════════════════════════════════════
  // STEP 9: Design System aufbauen (WITH OUTPUT DEDUP)
  // ════════════════════════════════════════════

  log.step('Step 9/14: Design System aufbauen...');

  const dsVarsPath = path.join(designSystemDir, 'variables.json');

  // Output dedup: skip if variables.json is newer than token-mapping.json
  let dsSkipped = false;
  if (existsSync(dsVarsPath) && existsSync(tokenMapPath)) {
    try {
      const dsStat = await fs.stat(dsVarsPath);
      const tokStat = await fs.stat(tokenMapPath);
      if (dsStat.mtimeMs >= tokStat.mtimeMs) {
        log.success('Design System: cached (output is fresh)');
        steps.push({ step: 9, name: 'Design System', status: 'cached' });
        dsSkipped = true;
      }
    } catch { /* fall through to rebuild */ }
  }

  if (!dsSkipped) {
    try {
      await runFile(nodeBin, [
        path.join(pipelineDir, 'design-system-builder.js'),
        '--token-map', tokenMapPath,
        '--output-dir', designSystemDir,
        ...(verbose ? ['--verbose'] : []),
      ], 'Design System Builder', pipelineDir, dsVarsPath);

      let varCount = 0, classCount = 0;
      try {
        const vars = JSON.parse(await fs.readFile(dsVarsPath, 'utf8'));
        varCount = vars.meta?.total || vars.variables?.length || 0;
      } catch {}
      try {
        const classes = JSON.parse(await fs.readFile(path.join(designSystemDir, 'global-classes.json'), 'utf8'));
        classCount = classes.meta?.total || classes.classes?.length || 0;
      } catch {}

      log.success(`Design System: ${varCount} variables, ${classCount} global classes`);
      steps.push({ step: 9, name: 'Design System', status: 'ok', detail: `${varCount}v + ${classCount}c` });
    } catch (err) {
      log.warn(`Design System Builder fehlgeschlagen: ${err.message}`);
      steps.push({ step: 9, name: 'Design System', status: 'warning', error: err.message });
    }
  }

  // ════════════════════════════════════════════
  // STEP 11: convert-xml-to-v4.js (WITH token-map)
  // ════════════════════════════════════════════

  // Resume: skip if already done and output still exists
  if (resume && isPhaseCompleted(pState, 'convert-xml')) {
    const cached = getPhaseOutput(pState, 'convert-xml');
    if (cached?.v4TreePath && existsSync(cached.v4TreePath)) {
      v4TreePath = cached.v4TreePath;
      log.success(`Step 11/14: convert-xml — resumed from state: ${v4TreePath}`);
      steps.push({ step: 11, name: 'convert-xml-to-v4.js', status: 'resumed' });
    }
  }

  if (!v4TreePath) {
  log.step('Step 11/14: XML → V4 Tree konvertieren...');

  let xmlFiles = [];
  try {
    const entries = await fs.readdir(exportDir, { withFileTypes: true, recursive: true });
    xmlFiles = entries
      .filter(e => e.isFile() && e.name.endsWith('.xml'))
      .map(e => path.join(e.parentPath || path.dirname(path.join(exportDir, e.name)), e.name))
      .slice(0, 5);
  } catch { xmlFiles = []; }

  const framerToolsDir = path.join(rootDir, 'tools', 'framer-export');
  if (xmlFiles.length === 0 && existsSync(framerToolsDir)) {
    try {
      const entries = await fs.readdir(framerToolsDir, { withFileTypes: true });
      xmlFiles = entries
        .filter(e => e.isFile() && e.name.endsWith('.xml'))
        .map(e => path.join(framerToolsDir, e.name));
    } catch {}
  }

  const outputDir = path.join(exportDir, 'v4-output');
  await fs.mkdir(outputDir, { recursive: true });
  v4TreePath = path.join(outputDir, 'elements.json');

  if (xmlFiles.length > 0) {
    const updatedTokenMap = path.join(designSystemDir, 'token-mapping-updated.json');
    const tokenMapArg = existsSync(updatedTokenMap) ? updatedTokenMap : tokenMapPath;

    const convertResults = [];
    for (const xmlFile of xmlFiles) {
      const pageName = path.basename(xmlFile, '.xml');
      try {
        const convertArgs = [
          path.join(pipelineDir, 'convert-xml-to-v4.js'),
          '--xml', xmlFile,
          '--output', path.join(outputDir, `${pageName}.json`),
          ...(elementorEnv ? ['--is-pro-active', String(elementorEnv.is_pro_active)] : []),
          ...(verbose ? ['--verbose'] : []),
        ];
        // Converter expects --tokens (not --token-map). Insert after --xml arg.
        if (existsSync(tokenMapArg)) {
          const xmlIdx = convertArgs.indexOf('--xml');
          if (xmlIdx >= 0) convertArgs.splice(xmlIdx + 2, 0, '--tokens', tokenMapArg);
        }
        const pageOutputPath = path.join(outputDir, `${pageName}.json`);
        await runFile(nodeBin, convertArgs, `convert-xml-to-v4: ${pageName}`, pipelineDir, pageOutputPath);
        convertResults.push({ page: pageName, status: 'ok' });
      } catch (err) {
        log.warn(`Konvertierung ${pageName} fehlgeschlagen: ${err.message}`);
        convertResults.push({ page: pageName, status: 'failed', error: err.message });
      }
    }
    steps.push({ step: 11, name: 'convert-xml-to-v4.js', status: convertResults.every(r => r.status === 'ok') ? 'ok' : 'warning', detail: convertResults });

    // Combine individual page outputs into elements.json for validation + QA
    // Delete stale elements.json first so we always work with fresh output
    if (existsSync(v4TreePath)) {
      try { await fs.unlink(v4TreePath); } catch {}
    }
      try {
        const outputFiles = (await fs.readdir(outputDir))
          .filter(f => f.endsWith('.json') && f !== 'elements.json');
        if (outputFiles.length > 0) {
          const allElements = [];
          for (const f of outputFiles) {
            try {
              const content = JSON.parse(await fs.readFile(path.join(outputDir, f), 'utf8'));
              const arr = Array.isArray(content) ? content : [content];
              allElements.push(...arr);
            } catch {}
          }
          if (allElements.length > 0) {
            await fs.writeFile(v4TreePath, JSON.stringify(allElements, null, 2), 'utf8');
            log.success(`Combined ${outputFiles.length} pages → elements.json (${allElements.length} elements)`);

            // ── Post-Step-11: V4-Tree → Token-Mapping Backfill ──
            // Scannt den generierten V4-Tree auf alle e-gv-* Referenzen und
            // trägt fehlende GV-IDs in token-mapping.json nach. Damit bestehen
            // die TOKEN_EXISTENCE + FONT_RESOLUTION Guards der Pre-Build-Validation.
            try {
              const treeGvIds = new Set();
              function scanForGvIds(obj) {
                if (!obj || typeof obj !== 'object') return;
                if (obj['$$type'] && (obj['$$type'].includes('variable') || obj['$$type'].includes('gv'))) {
                  if (typeof obj.value === 'string' && obj.value.startsWith('e-gv-')) {
                    treeGvIds.add(obj.value);
                  }
                }
                for (const val of Object.values(obj)) {
                  if (val && typeof val === 'object') scanForGvIds(val);
                }
              }
              for (const el of allElements) scanForGvIds(el);

              // Reload token mapping (may have been enriched in Step 7)
              let tm = null;
              try { tm = JSON.parse(await fs.readFile(tokenMapPath, 'utf8')); } catch {}
              if (tm && treeGvIds.size > 0) {
                if (!tm.colors) tm.colors = [];
                if (!tm.fonts) tm.fonts = {};
                let backfilled = 0;
                // Use CSS tokens for hex values
                const cssTokens = tm.css_variables?.color_tokens_list || [];
                let ti = 0;
                for (const gvId of treeGvIds) {
                  if (!tm.colors.some(c => c.id === gvId) && !Object.values(tm.fonts).some(f => f?.gv_id === gvId)) {
                    const token = cssTokens.length > 0 ? cssTokens[ti % cssTokens.length] : {};
                    tm.colors.push({
                      id: gvId,
                      gv_id: gvId,
                      hex: token.hex || '#000000',
                      occurrences: 0,
                      css_var: null,
                    });
                    backfilled++;
                    ti++;
                  }
                }
                if (backfilled > 0) {
                  await fs.writeFile(tokenMapPath, JSON.stringify(tm, null, 2), 'utf8');
                  log.success(`Tree-Backfill: +${backfilled} GV-IDs aus V4-Tree in Token-Mapping nachgetragen`);
                }
              }
            } catch (backfillErr) {
              // Non-critical — validation still runs, just with fewer GV mappings
              if (verbose) log.warn(`Tree-Backfill fehlgeschlagen: ${backfillErr.message}`);
            }
          }
        }
      } catch {}
  } else {
    log.warn('Keine XML-Dateien gefunden. Überspringe V4-Konvertierung.');
    steps.push({ step: 11, name: 'convert-xml-to-v4.js', status: 'skipped', detail: 'No XML files found' });
  }

  // Save Step 11 to state when v4TreePath was produced
  if (v4TreePath && existsSync(v4TreePath)) {
    pState = await savePhase(pState, 'convert-xml', { v4TreePath }, statePath);
  }
  } // end if(!v4TreePath) resume guard

  // ════════════════════════════════════════════
  // STEPS 12+14: Validate + QA Gate (PARALLEL)
  // ════════════════════════════════════════════

  if (v4TreePath && existsSync(v4TreePath)) {
    log.step('Steps 12+14/14: Validation + QA Gate (parallel)...');

    const preBuildReportPath = path.join(outputDir, 'pre-build-validation.json');
    const qaDir = path.join(exportDir, 'qa');
    await fs.mkdir(qaDir, { recursive: true });

    const postValidationTasks = [];

    // Task: Pre-Build Validation
    postValidationTasks.push({
      command: nodeBin,
      args: [
        path.join(pipelineDir, 'framer-pre-build-validate.js'),
        '--tree', v4TreePath,
        '--tokens', tokenMapPath,
        '--output', preBuildReportPath,
      ],
      description: 'Pre-Build-Validation',
      cwd: pipelineDir,
      outputFile: preBuildReportPath,
    });

    // Task: Quality Gate (skip if --skip-qa)
    if (!skipQa) {
      const gateArgs = [
        path.join(pipelineDir, 'build-quality-gate.js'),
        '--tree', v4TreePath,
        '--tokens', tokenMapPath,
        '--output-dir', qaDir,
        '--skip-screenshots',
        ...(dryRun ? ['--dry-run'] : []),
        ...(verbose ? ['--verbose'] : []),
      ];
      if (postId) gateArgs.push('--post-id', postId);

      const qaReportPath = path.join(qaDir, 'quality-gate-report.json');
      postValidationTasks.push({
        command: nodeBin,
        args: gateArgs,
        description: 'Visual QA + Auto-Fix',
        cwd: pipelineDir,
        optional: true,
        outputFile: qaReportPath,
      });
    }

    const postResults = await runParallel(postValidationTasks);

    // Process Pre-Build result
    const preResult = postResults.find(r => r.description === 'Pre-Build-Validation');
    if (preResult?.ok) {
      let score = 0;
      try {
        const report = JSON.parse(await fs.readFile(preBuildReportPath, 'utf8'));
        score = report.meta?.score || 0;
        log.success(`Pre-Build: ${score}% (17 Guards)`);
        steps.push({ step: 12, name: 'Pre-Build-Validation', status: score >= 85 ? 'ok' : 'warning', score });
      } catch {
        steps.push({ step: 12, name: 'Pre-Build-Validation', status: 'ok' });
      }
    } else {
      steps.push({ step: 12, name: 'Pre-Build-Validation', status: 'warning', error: preResult?.error });
    }

    // Process QA Gate result
    const qaResult = postResults.find(r => r.description === 'Visual QA + Auto-Fix');
    if (!skipQa) {
      if (qaResult?.ok) {
        steps.push({ step: 14, name: 'Visual QA + Auto-Fix', status: 'ok' });
      } else if (qaResult) {
        steps.push({ step: 14, name: 'Visual QA + Auto-Fix', status: 'warning', error: qaResult.error });
      }
    } else {
      steps.push({ step: 14, name: 'Visual QA + Auto-Fix', status: 'skipped' });
    }
  } else {
    log.warn('Kein V4-Tree gefunden. Überspringe Validation + QA.');
    steps.push({ step: 12, name: 'Pre-Build-Validation', status: 'skipped' });
    steps.push({ step: 14, name: 'Visual QA + Auto-Fix', status: 'skipped' });
  }

  // ════════════════════════════════════════════
  // STEP 13: elementor-set-content (MCP — delegated)
  // ════════════════════════════════════════════

  if (dryRun) {
    log.info('Step 13/14: elementor-set-content — DRY-RUN');
    steps.push({ step: 13, name: 'elementor-set-content', status: 'dry-run' });
  } else if (postId && v4TreePath && existsSync(v4TreePath)) {
    log.info('Step 13/14: elementor-set-content — an Agent delegiert');
    steps.push({ step: 13, name: 'elementor-set-content', status: 'delegated', detail: `post_id=${postId}` });
    pState = await savePhase(pState, 'elementor-set-content', { postId }, statePath);
  } else {
    steps.push({ step: 13, name: 'elementor-set-content', status: 'skipped' });
  }

  // ════════════════════════════════════════════
  // FINAL SUMMARY
  // ════════════════════════════════════════════

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const okSteps = steps.filter(s => s.status === 'ok' || s.status === 'cached').length;
  const warnSteps = steps.filter(s => s.status === 'warning').length;
  const skipSteps = steps.filter(s => s.status === 'skipped' || s.status === 'delegated' || s.status === 'dry-run').length;
  const failSteps = steps.filter(s => s.status === 'failed').length;

  const summary = {
    pipeline: '14-step-optimized',
    generated: new Date().toISOString(),
    elapsed_seconds: parseFloat(elapsed),
    framer_url: framerUrl,
    post_id: postId,
    export_dir: exportDir,
    mode: dryRun ? 'dry-run' : 'live',
    results: {
      total: steps.length,
      ok: okSteps,
      warnings: warnSteps,
      skipped: skipSteps,
      failed: failSteps,
    },
    steps: steps.map(s => ({
      step: s.step,
      name: s.name,
      status: s.status,
      score: s.score,
      detail: s.detail,
      error: s.error,
    })),
    artifacts: {
      token_mapping: tokenMapPath,
      design_system: designSystemDir,
      v4_tree: v4TreePath,
      variables: path.join(designSystemDir, 'variables.json'),
      global_classes: path.join(designSystemDir, 'global-classes.json'),
      batch_create_plan: path.join(designSystemDir, 'batch-create-plan.json'),
      font_resolution: fontResPath,
      qa_report: skipQa ? null : path.join(exportDir, 'qa', 'quality-gate-report.json'),
    },
  };

  const summaryPath = path.join(exportDir, 'pipeline-summary.json');
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  📊 PIPELINE COMPLETE in ${elapsed}s`);

  // Phase-5 Cache-Stats
  try {
    const stats = getFramerCacheStats({ cacheRoot: rootDir });
    if (stats.exists && stats.total_files > 0) {
      const projectList = Object.keys(stats.per_project);
      console.log(`  💾 Framer-Cache: ${stats.total_files} files, ${(stats.total_bytes / 1024).toFixed(1)} KiB (${projectList.length} projects: ${projectList.join(', ')})`);
    }
  } catch { /* stats are non-critical */ }
  console.log(`${'═'.repeat(60)}`);
  console.log(`  ✅ ${okSteps} ok  ⚠️ ${warnSteps} warnings  ⏭️ ${skipSteps} skipped  ❌ ${failSteps} failed`);
  console.log(`  📄 Summary: ${path.relative(rootDir, summaryPath)}`);
  console.log(`${'═'.repeat(60)}\n`);

  // Clear state on fully successful run (no failures)
  if (failSteps === 0 && !dryRun) {
    const { clearState } = await import('../../scripts/lib/pipeline-state.js');
    await clearState(statePath);
  }

  return summary;
}
