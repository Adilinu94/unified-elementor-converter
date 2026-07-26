#!/usr/bin/env node
/**
 * asset-to-wp-media.ts
 *
 * Lädt lokale Assets aus FramerExport (ZIP-Export) via adrians-media-upload
 * in die WordPress Media Library. Arbeitet als Queue-Generator: erstellt
 * MCP-Calls die der Agent abarbeitet, und schreibt Ergebnisse via --update-from zurück.
 *
 * Anders als upload-and-map-images.js (das mit image-map.json arbeitet),
 * scannt dieses Script ein beliebiges Asset-Verzeichnis rekursiv und
 * erstellt eine Upload-Queue für ALLE Medientypen (Bilder, SVGs, Fonts, Videos).
 *
 * Usage:
 *   # Queue erstellen
 *   node --import tsx scripts/asset-to-wp-media.ts \
 *     --assets-dir ./FramerExport/framer-passionate-papaya-042575/assets/ \
 *     --output ./FramerExport/tokens/asset-upload-queue.json
 *
 *   # Dry-Run (Vorschau ohne Upload)
 *   node --import tsx scripts/asset-to-wp-media.ts \
 *     --assets-dir ./FramerExport/framer-passionate-papaya-042575/assets/ \
 *     --dry-run
 *
 *   # Ergebnisse zurückschreiben
 *   node --import tsx scripts/asset-to-wp-media.ts \
 *     --assets-dir ./FramerExport/framer-passionate-papaya-042575/assets/ \
 *     --update-from ./FramerExport/tokens/asset-upload-results.json \
 *     --manifest ./FramerExport/tokens/asset-manifest.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

// ─── Typen ─────────────────────────────────────────────────────────────────────

interface ScannedFile {
  filename: string;
  relativePath: string;
  absolutePath: string;
  size: number;
}

interface McpCallParams {
  filename: string;
  mime_type: string;
  content_base64?: string;
}

interface McpCall {
  ability_name: string;
  parameters: McpCallParams;
}

interface QueueEntry {
  key: string;
  filename: string;
  originalFilename: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  mcpCall: McpCall;
  status: string;
  base64Length?: number;
  absolutePath?: string;
}

interface DryRunEntry extends Omit<QueueEntry, 'mcpCall'> {
  mcpCall: { ability_name: string; parameters: McpCallParams };
}

interface SkippedEntry {
  key: string;
  reason: string;
  wp_media_id?: number;
}

interface ErrorEntry {
  key: string;
  error: string;
}

interface QueueSummary {
  meta: {
    assetsDir: string;
    totalFiles: number;
    queued: number;
    skipped: number;
    errors: number;
    withBase64: boolean;
    generatedAt: string;
  };
  queue: (QueueEntry | DryRunEntry)[];
  skipped: SkippedEntry[];
  errors: ErrorEntry[];
}

interface UploadResult {
  key?: string;
  filename?: string;
  wp_media_id?: number;
  wp_url?: string;
  url?: string;
  error?: string;
  _key?: string;
  _original?: string;
}

interface AssetManifestEntry {
  wp_media_id?: number;
  wp_url?: string | null;
  wp_upload_error?: string;
}

interface AssetManifest {
  assets: Record<string, AssetManifestEntry>;
  meta?: {
    lastUpdated?: string;
  };
}

interface ImageMapEntry {
  wp_media_id: number;
  wp_url: string | null;
  filename: string;
  original: string;
}

interface PlanFile {
  filename: string;
  mime_type: string;
  content_base64: string;
  _key: string;
  _original: string;
}

interface PlanBatch {
  batch_index: number;
  file_count: number;
  files: PlanFile[];
}

interface UploadPlan {
  type: string;
  total_files: number;
  failed_read: number;
  batch_count: number;
  batch_size: number;
  ability: string;
  next_step: string;
  agent_instruction: string[];
  batches: PlanBatch[];
}

// ─── CLI-Args ──────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    'assets-dir':     { type: 'string' },
    'manifest':       { type: 'string' },
    'output':         { type: 'string' },
    'update-from':    { type: 'string' },
    'apply-results':  { type: 'string' },  // NEU: Agent-Ergebnisse zurueckschreiben
    'with-base64':    { type: 'boolean', default: false },
    'dry-run':        { type: 'boolean', default: false },
    'execute':        { type: 'boolean', default: false },
    'verbose':        { type: 'boolean', default: false },
    'help':           { type: 'boolean', default: false },
  },
  strict: false,
});

if (args.help) {
  console.log(`
asset-to-wp-media.ts

Scannt ein Asset-Verzeichnis rekursiv und erstellt eine Upload-Queue
für adrians-media-upload (WordPress Media Library).

MODI:
  --queue (default)   Erstellt Upload-Queue JSON für den Agent
  --dry-run           Zeigt was hochgeladen werden würde (kein Output-File)
  --update-from FILE  Schreibt MCP-Ergebnisse zurück in asset-manifest.json

OPTIONEN:
  --assets-dir DIR    Verzeichnis mit Assets (Bilder, SVGs, Fonts, Videos)  [required]
  --manifest FILE     Pfad zur asset-manifest.json (für --update-from)
  --output FILE       Output-Pfad für Queue JSON  [default: stdout]
  --with-base64       Base64-Daten direkt ins Queue JSON einbetten
  --verbose           Ausführliche Logs nach stderr
  --help              Diese Hilfe

WORKFLOW:
  1. node --import tsx asset-to-wp-media.ts --assets-dir ./assets/ --output upload-queue.json
     → Scannt alle Dateien, erstellt Queue mit MCP-Calls
  2. Agent iteriert durch queue[], führt novamira/adrians-media-upload aus
  3. Agent speichert Ergebnisse als results.json
  4. node --import tsx asset-to-wp-media.ts --update-from results.json --manifest manifest.json
     → Schreibt wp_media_id + wp_url zurück

EXIT-CODES:
  0 = Alle Assets verarbeitet
  1 = Warnungen (einige Dateien nicht gefunden/lesbar)
  2 = assets-dir nicht gefunden
`);
  process.exit(0);
}

const log  = (...msg: string[]) => {
  if (args.verbose) process.stderr.write('[verbose] ' + msg.join(' ') + '\n');
};
const warn = (...msg: string[]) =>
  process.stderr.write('[warn] ' + msg.join(' ') + '\n');
const fatal = (msg: string, code: number = 2): never => {
  process.stderr.write('[FATAL] ' + msg + '\n');
  process.exit(code);
};

// ─── --apply-results: Agent-Antworten → image-map.json schreiben ──────────────
// Liest die vom Agent gesammelten Upload-Ergebnisse und baut daraus image-map.json.
// Format: { results: [{ filename, wp_media_id, url, _key, _original }] }

if (args['apply-results']) {
  const resultsPath = path.resolve(args['apply-results'] as string);
  if (!fs.existsSync(resultsPath)) {
    fatal(`--apply-results Datei nicht gefunden: ${resultsPath}`);
  }
  let uploadResults: UploadResult[] | { results?: UploadResult[] } = [];
  try {
    uploadResults = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  } catch (e) {
    fatal(`Ungültiges JSON in ${resultsPath}: ${(e as Error).message}`);
  }

  const results: UploadResult[] = Array.isArray(uploadResults)
    ? uploadResults
    : (uploadResults.results ?? []);
  const imageMap: Record<string, ImageMapEntry> = {};
  let ok = 0, failed = 0;

  for (const r of results) {
    if (r.wp_media_id) {
      const key = r._key || r.filename || 'unknown';
      imageMap[key] = {
        wp_media_id: r.wp_media_id,
        wp_url:      r.url || r.wp_url || null,
        filename:    r.filename || key,
        original:    r._original || r.filename || key,
      };
      ok++;
    } else {
      warn(`Kein wp_media_id fuer: ${r.filename} — ${r.error || 'unbekannter Fehler'}`);
      failed++;
    }
  }

  const outputPath = (args.output as string) || 'image-map.json';
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), JSON.stringify(imageMap, null, 2), 'utf8');
  process.stderr.write(`[asset-upload] ✅ image-map.json: ${ok} OK, ${failed} fehlgeschlagen → ${outputPath}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  '.jpg':  'image/jpeg',  '.jpeg': 'image/jpeg',
  '.png':  'image/png',   '.webp': 'image/webp',
  '.svg':  'image/svg+xml','.gif':  'image/gif',
  '.avif': 'image/avif',  '.ico':  'image/x-icon',
  '.bmp':  'image/bmp',   '.tiff': 'image/tiff',
  '.woff2':'font/woff2',  '.woff': 'font/woff',
  '.ttf':  'font/ttf',    '.otf':  'font/otf',
  '.eot':  'application/vnd.ms-fontobject',
  '.mp4':  'video/mp4',   '.webm': 'video/webm',
  '.ogg':  'video/ogg',   '.mov':  'video/quicktime',
  '.mp3':  'audio/mpeg',  '.wav':  'audio/wav',
  '.pdf':  'application/pdf',
};

function mimeType(filename: string): string {
  return MIME_MAP[path.extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9.\-_]/g, '').slice(0, 60);
}

function scanDirectory(dirPath: string, baseDir: string, maxDepth: number = 10): ScannedFile[] {
  const results: ScannedFile[] = [];
  if (maxDepth <= 0) return results;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
  catch (e) { warn(`Verzeichnis nicht lesbar: ${dirPath}`); return results; }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      results.push(...scanDirectory(fullPath, baseDir, maxDepth - 1));
    } else if (entry.isFile()) {
      if (entry.name.startsWith('.') || entry.name === 'Thumbs.db') continue;
      results.push({
        filename: entry.name,
        relativePath: path.relative(baseDir, fullPath).replace(/\\/g, '/'),
        absolutePath: fullPath,
        size: fs.statSync(fullPath).size,
      });
    }
  }
  return results;
}

// ─── MODE: --update-from ──────────────────────────────────────────────────────

if (args['update-from']) {
  const resultsPath = path.resolve(args['update-from'] as string);
  if (!fs.existsSync(resultsPath)) fatal(`results.json nicht gefunden: ${resultsPath}`);

  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const resultList: UploadResult[] = Array.isArray(results) ? results : (results.results ?? []);
  const manifestPath: string | null = args.manifest ? path.resolve(args.manifest as string) : null;
  let manifest: AssetManifest = manifestPath && fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : { assets: {} };

  let updated = 0, failed = 0;

  for (const result of resultList) {
    const { key, wp_media_id, wp_url, error } = result;
    if (!key) { warn('Eintrag ohne "key", übersprungen'); continue; }
    if (error) {
      manifest.assets[key] = manifest.assets[key] ?? {};
      manifest.assets[key].wp_upload_error = error;
      failed++;
      continue;
    }
    if (!wp_media_id) { warn(`Kein wp_media_id für "${key}"`); failed++; continue; }
    manifest.assets[key] = manifest.assets[key] ?? {};
    manifest.assets[key].wp_media_id = wp_media_id;
    manifest.assets[key].wp_url = wp_url ?? null;
    delete manifest.assets[key].wp_upload_error;
    updated++;
  }

  manifest.meta = manifest.meta ?? {};
  manifest.meta.lastUpdated = new Date().toISOString();
  if (manifestPath) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  else process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');

  process.stderr.write(`[update-from] ${updated} aktualisiert, ${failed} fehlgeschlagen\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// ─── MODE: --queue oder --dry-run ─────────────────────────────────────────────

const assetsDir_: string = args['assets-dir'] as string;
if (!assetsDir_) fatal('--assets-dir ist erforderlich (oder --update-from für Update-Modus)');
const assetsDir = path.resolve(assetsDir_);
if (!fs.existsSync(assetsDir)) fatal(`assets-dir nicht gefunden: ${assetsDir}`);

const isDryRun: boolean = (args['dry-run'] as boolean) ?? false;
const withBase64: boolean = (args['with-base64'] as boolean) ?? false;

let existingManifest: AssetManifest = { assets: {} };
if (args.manifest && fs.existsSync(args.manifest as string)) {
  try { existingManifest = JSON.parse(fs.readFileSync(args.manifest as string, 'utf8')); }
  catch (e) { warn(`Manifest nicht lesbar: ${(e as Error).message}`); }
}

const allFiles = scanDirectory(assetsDir, assetsDir);
log(`${allFiles.length} Dateien gefunden`);

const queue: QueueEntry[] = [];
const skipped: SkippedEntry[] = [];
const errors: ErrorEntry[] = [];

for (const file of allFiles) {
  const key = file.relativePath;
  if (existingManifest.assets?.[key]?.wp_media_id) {
    log(`Skip: ${key}`);
    skipped.push({ key, reason: 'already_uploaded', wp_media_id: existingManifest.assets[key].wp_media_id });
    continue;
  }

  let fileContent: Buffer;
  try { fileContent = fs.readFileSync(file.absolutePath); }
  catch (e) { warn(`Nicht lesbar: ${key}`); errors.push({ key, error: (e as Error).message }); continue; }

  const mime  = mimeType(file.filename);
  const fname = slugify(path.basename(file.filename));

  const queueEntry: QueueEntry = {
    key, filename: fname, originalFilename: file.filename,
    relativePath: key, mimeType: mime, sizeBytes: file.size,
    mcpCall: {
      ability_name: 'novamira/adrians-media-upload',
      parameters: { filename: fname, mime_type: mime },
    },
    status: 'pending',
    absolutePath: file.absolutePath,
  };

  if (withBase64 && !isDryRun) {
    try {
      const b64 = fileContent.toString('base64');
      queueEntry.mcpCall.parameters.content_base64 = b64;
      queueEntry.base64Length = b64.length;
    } catch (e) {
      errors.push({ key, error: (e as Error).message });
      continue;
    }
  } else {
    queueEntry.base64Length = Math.ceil(file.size * 4 / 3);
  }

  queue.push(queueEntry);
}

const summary: QueueSummary = {
  meta: {
    assetsDir, totalFiles: allFiles.length,
    queued: queue.length, skipped: skipped.length, errors: errors.length,
    withBase64: withBase64 && !isDryRun,
    generatedAt: new Date().toISOString(),
  },
  queue: queue.map(e => {
    if (isDryRun) {
      const { mcpCall, absolutePath, ...rest } = e;
      return {
        ...rest,
        mcpCall: { ...mcpCall, parameters: { ...mcpCall.parameters, content_base64: '<omitted>' } },
      } as DryRunEntry;
    }
    return e;
  }),
  skipped, errors,
};

if (isDryRun) {
  console.log(`\n=== DRY RUN: Asset Upload Queue ===`);
  console.log(`Zu uploaden: ${queue.length}  Übersprungen: ${skipped.length}  Fehler: ${errors.length}`);
  for (const e of queue.slice(0, 20)) {
    console.log(`  ${e.key}  (${(e.sizeBytes / 1024).toFixed(1)} KB, ${e.mimeType})`);
  }
  if (queue.length > 20) console.log(`  ... und ${queue.length - 20} weitere`);
  process.exit(errors.length > 0 ? 1 : 0);
}

// ─── Fallback: Upload-Plan-Generator (wenn McpBridge nicht verfügbar) ────────

interface BatchFile {
  filename: string;
  mime_type: string;
  content_base64: string;
  _key: string;
  _original: string;
}

function generateUploadPlan(
  queue: QueueEntry[],
  batches: BatchFile[][],
  failedRead: number,
  output: string | undefined,
): void {
  const plan: UploadPlan = {
    type:        'batch-media-upload-plan',
    total_files:  queue.length - failedRead,
    failed_read:  failedRead,
    batch_count:  batches.length,
    batch_size:   30,
    ability:      'novamira/adrians-batch-media-upload',
    next_step:    `node --import tsx scripts/asset-to-wp-media.ts --apply-results <upload-results.json> --output image-map.json`,
    agent_instruction: [
      'Fuer jede Batch in batches[]:',
      '  novamira-yoursite-local:mcp-adapter-execute-ability',
      '  { ability_name: "novamira/adrians-batch-media-upload", parameters: { files: <batch.files> } }',
      'Ergebnisse als upload-results.json speichern: { results: [{filename, wp_media_id, url},...] }',
    ],
    batches: batches.map((files, i) => ({
      batch_index: i,
      file_count:  files.length,
      files: files.map(f => ({
        filename:       f.filename,
        mime_type:      f.mime_type,
        content_base64: f.content_base64,
        _key:           f._key,
        _original:      f._original,
      })),
    })),
  };

  const outputPath = output || 'upload-plan.json';
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), JSON.stringify(plan, null, 2), 'utf8');

  process.stderr.write(
    `[asset-upload] Upload-Plan fuer ${plan.total_files} Dateien in ${plan.batch_count} Batches → ${outputPath}\n` +
    `[asset-upload] Agent: adrians-batch-media-upload fuer jede Batch aufrufen, dann --apply-results\n`
  );
}

// ─── MODE: --execute (Fix B — Direkter Upload via McpBridge) ──────────────────

if (args.execute) {
  if (queue.length === 0) {
    process.stderr.write('[asset-upload] Keine neuen Assets zum Hochladen.\n');
    process.exit(0);
  }

  const BATCH_SIZE = 30; // adrians-batch-media-upload Maximum

  // Dateien als base64 einlesen und in Batches aufteilen
  const batches: BatchFile[][] = [];
  let currentBatch: BatchFile[] = [];
  let failedRead = 0;

  for (const entry of queue) {
    try {
    const b64 = fs.readFileSync(
      entry.absolutePath || path.resolve(assetsDir, entry.relativePath || entry.key)
    ).toString('base64');
      currentBatch.push({
        filename:       entry.filename,
        mime_type:      entry.mimeType,
        content_base64: b64,
        _key:           entry.key,           // intern fuer --apply-results Mapping
        _original:      entry.originalFilename,
      });
      if (currentBatch.length >= BATCH_SIZE) {
        batches.push(currentBatch);
        currentBatch = [];
      }
    } catch (e) {
      warn(`Datei nicht lesbar: ${entry.key} — ${(e as Error).message}`);
      failedRead++;
    }
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  // Direkter Upload via McpBridge (Fix B)
  // Ruft novamira/adrians-batch-media-upload fuer jede Batch auf
  // und schreibt image-map.json direkt — kein manueller Zwischenschritt.
  if (batches.length === 0) {
    process.stderr.write('[asset-upload] Keine Dateien zum Hochladen (alle Lesefehler).\n');
    process.exit(1);
  }

  process.stderr.write(`[asset-upload] Lade ${queue.length - failedRead} Dateien in ${batches.length} Batches...\n`);

  let McpBridge;
  try {
    const mod = await import('./lib/mcp-bridge.js');
    McpBridge = mod.McpBridge;
  } catch (e) {
    // Fallback: Plan-Modus wenn mcp-bridge nicht geladen werden kann
    process.stderr.write(`[asset-upload] ⚠️  McpBridge nicht ladbar (${(e as Error).message}), wechsle zu Plan-Modus.\n`);
    process.stderr.write('[asset-upload] Generiere Upload-Plan fuer manuelle Agent-Ausfuehrung...\n');
    generateUploadPlan(queue, batches, failedRead, args.output as string | undefined);
    process.exit(0);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mcp: any;
  try {
    mcp = await McpBridge.fromConfig();
    process.stderr.write(`[asset-upload] MCP-Bridge verbunden: ${mcp.mcpUrl}\n`);
  } catch (e) {
    process.stderr.write(`[asset-upload] ⚠️  MCP-Konfiguration fehlgeschlagen: ${(e as Error).message}\n`);
    process.stderr.write('[asset-upload] Generiere Upload-Plan fuer manuelle Agent-Ausfuehrung...\n');
    generateUploadPlan(queue, batches, failedRead, args.output as string | undefined);
    process.exit(0);
  }

  const imageMap: Record<string, ImageMapEntry> = {};
  let totalUploaded = 0;
  let totalFailed = 0;

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    process.stderr.write(
      `[asset-upload] Batch ${batchIdx + 1}/${batches.length} (${batch.length} Dateien)...`
    );

    try {
      const files = batch.map(f => ({
        filename:       f.filename,
        mime_type:      f.mime_type,
        content_base64: f.content_base64,
      }));

      const result = await mcp.batchMediaUpload(files);

      const resultList = result?.results || result || [];
      let batchOk = 0;

      for (let i = 0; i < batch.length; i++) {
        const entry = batch[i];
        const r = Array.isArray(resultList) ? resultList[i] || resultList.find(
          (x: { filename?: string }) => x.filename === entry.filename || x.filename === entry._original
        ) : null;

        if (r && r.wp_media_id) {
          imageMap[entry._key] = {
            wp_media_id: r.wp_media_id,
            wp_url:      r.url || r.wp_url || null,
            filename:    entry.filename,
            original:    entry._original,
          };
          batchOk++;
          totalUploaded++;
        } else {
          warn(`Kein wp_media_id fuer: ${entry._key} — ${r?.error || 'keine Antwort'}`);
          totalFailed++;
        }
      }
      process.stderr.write(` ✅ ${batchOk}/${batch.length}\n`);

    } catch (err) {
      process.stderr.write(` ❌ Fehler: ${(err as Error).message.slice(0, 200)}\n`);
      for (const entry of batch) {
        warn(`Batch-Fehler fuer: ${entry._key}`);
        totalFailed++;
      }
    }
  }

  // Direkt image-map.json schreiben — kein manueller Schritt mehr
  const outputPath = (args.output as string) || 'image-map.json';
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), JSON.stringify(imageMap, null, 2), 'utf8');

  process.stderr.write(
    `[asset-upload] ✅ ${totalUploaded} Assets hochgeladen, ${totalFailed} fehlgeschlagen → ${outputPath}\n`
  );

  if (failedRead > 0) {
    process.stderr.write(`[asset-upload] ⚠️  ${failedRead} Dateien nicht lesbar\n`);
  }

  process.exit(totalFailed > 0 || failedRead > 0 ? 1 : 0);
}

// ── Standard-Modus: Queue-Datei generieren (kein --execute) ──────────────────

const outputJson = JSON.stringify(summary, null, 2);
if (args.output) {
  fs.mkdirSync(path.dirname(path.resolve(args.output as string)), { recursive: true });
  fs.writeFileSync(path.resolve(args.output as string), outputJson, 'utf8');
  process.stderr.write(`[queue] ${queue.length} Assets → ${args.output}\n`);
} else {
  process.stdout.write(outputJson + '\n');
}

process.exit(errors.length > 0 ? 1 : 0);
