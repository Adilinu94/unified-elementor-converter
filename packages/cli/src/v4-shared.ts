/**
 * src/cli/shared.ts — Shared Helpers for Wizard Sub-Commands
 * (UMBAUPLAN Phase 1.2 — Strangler Fig Pattern, Step 14)
 * Migrated from scripts/wizard/shared.js
 */

import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// From src/cli/, go up 2 levels to project root, then into scripts/
export const repoDir    = path.resolve(__dirname, '..', '..');
export const pipelineDir = path.resolve(__dirname, '..', '..', 'scripts');
export const nodeBin = process.execPath;
export const npxBin  = process.platform === 'win32' ? 'npx.cmd' : 'npx';
export const npmBin  = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export interface RunTask {
  command: string;
  args: string[];
  description: string;
  cwd?: string | null;
  optional?: boolean;
  outputFile?: string | null;
}

export interface RunResult {
  description: string;
  ok: boolean;
  error?: string;
}

export interface ExportCacheEntry {
  url: string;
  exportDir: string;
  timestamp: string;
}

export interface IndexHtmlEntry {
  dir: string;
  mtimeMs: number;
}

export interface ExportCacheResult {
  cached: boolean;
  exportDir?: string;
}

async function spawnWithRetry(command: string, args: string[], options: Parameters<typeof execFileAsync>[2]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(command, args, options) as { stdout: string; stderr: string };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (process.platform !== 'win32') throw err;
    const isSpawnErr = e.code === 'EINVAL' || e.code === 'ENOENT';
    if (!isSpawnErr) throw err;
    const isCmdExt = command.endsWith('.cmd');
    try {
      const altCmd = isCmdExt ? command.replace(/\.cmd$/, '') : command + '.cmd';
      return await execFileAsync(altCmd, args, options) as { stdout: string; stderr: string };
    } catch (err2: unknown) {
      const e2 = err2 as NodeJS.ErrnoException;
      if (e2.code !== 'EINVAL' && e2.code !== 'ENOENT') throw err2;
    }
    return await execFileAsync(command, args, { ...(options as object), shell: true }) as { stdout: string; stderr: string };
  }
}

export function createRl(): readline.Interface {
  return readline.createInterface({ input, output });
}

export const log = {
  info:    (msg: string) => console.log(`\n🔵 [INFO] ${msg}`),
  success: (msg: string) => console.log(`\n✅ [SUCCESS] ${msg}`),
  warn:    (msg: string) => console.log(`\n⚠️  [WARN] ${msg}`),
  error:   (msg: string) => console.log(`\n❌ [ERROR] ${msg}`),
  step:    (msg: string) => console.log(`\n▶️  [STEP] ${msg}`),
};

export function findWorkspaceRoot(): string {
  if (process.env.FRAMER_PIPELINE_ROOT) return path.resolve(process.env.FRAMER_PIPELINE_ROOT);
  const candidates = [process.cwd(), repoDir, path.resolve(repoDir, '..')];
  return candidates.find(dir =>
    existsSync(path.join(dir, 'tools', 'framer-export')) ||
    existsSync(path.join(dir, 'FramerExport')) ||
    existsSync(path.join(dir, 'build-manifest.json'))
  ) ?? repoDir;
}

export function findFramerExportDir(rootDir: string): string | null {
  const candidates = [
    process.env.FRAMER_EXPORT_DIR,
    path.join(rootDir, 'FramerExport'),
    path.join(rootDir, 'tools', 'framer-export'),
    path.resolve(rootDir, '..', 'FramerExport'),
  ].filter((p): p is string => Boolean(p)).map(p => path.resolve(p));

  const cliDir = candidates.find(dir =>
    existsSync(dir) && existsSync(path.join(dir, 'package.json'))
  );
  if (cliDir) return cliDir;
  return candidates.find(dir => existsSync(dir)) ?? null;
}

export async function runFile(
  command: string,
  args: string[],
  description: string,
  cwd: string | null = null,
  outputFile: string | null = null
): Promise<string> {
  const workDir = cwd ?? findWorkspaceRoot();
  log.step(description);
  try {
    const { stdout, stderr } = await spawnWithRetry(command, args, {
      cwd: workDir,
      maxBuffer: 1024 * 1024 * 20,
    });
    if (stderr) log.warn(stderr);
    log.success(`${description} abgeschlossen.`);
    return stdout;
  } catch (error: unknown) {
    if (outputFile) {
      try {
        if (existsSync(outputFile)) {
          const rescued = await fs.readFile(outputFile, 'utf8');
          if (rescued?.trim().length > 0) {
            log.warn(`${description}: Output aus gecrashtem Prozess gerettet`);
            log.success(`${description} abgeschlossen (Output gerettet).`);
            return rescued;
          }
        }
      } catch { /* genuine failure */ }
    }
    log.error(`${description} fehlgeschlagen.`);
    console.error((error as Error).message);
    throw error;
  }
}

export async function runParallel(tasks: RunTask[]): Promise<RunResult[]> {
  const results = await Promise.allSettled(
    tasks.map(async (task) => {
      try {
        await runFile(task.command, task.args, task.description, task.cwd ?? null, task.outputFile ?? null);
        return { description: task.description, ok: true } satisfies RunResult;
      } catch (err: unknown) {
        const msg = (err as Error).message ?? String(err);
        if (task.optional) {
          log.warn(`${task.description} (optional) fehlgeschlagen: ${msg}`);
        } else {
          log.error(`${task.description} fehlgeschlagen: ${msg}`);
        }
        return { description: task.description, ok: false, error: msg } satisfies RunResult;
      }
    })
  );
  return results.map(r =>
    r.status === 'fulfilled' ? r.value : { description: 'unknown', ok: false, error: (r.reason as Error)?.message }
  );
}

export async function findIndexHtmlDirs(baseDir: string): Promise<IndexHtmlEntry[]> {
  const found: IndexHtmlEntry[] = [];
  async function scan(dir: string, depth = 0): Promise<void> {
    if (depth > 3) return;
    if (!existsSync(dir)) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    if (entries.some(e => e.isFile() && e.name === 'index.html')) {
      const stat = await fs.stat(path.join(dir, 'index.html'));
      found.push({ dir, mtimeMs: stat.mtimeMs });
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        await scan(path.join(dir, entry.name), depth + 1);
      }
    }
  }
  await scan(baseDir);
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export async function readJsonIfExists(filePath: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(filePath)) return null;
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>;
}

export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}

const CACHE_FILE = path.join(pipelineDir, '.framer-export-cache.json');
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function checkFramerExportCache(framerUrl: string, forceRefresh = false): Promise<ExportCacheResult> {
  if (forceRefresh) return { cached: false };
  let cache: ExportCacheEntry | null = null;
  try {
    cache = await readJsonIfExists(CACHE_FILE) as ExportCacheEntry | null;
  } catch {
    return { cached: false };
  }
  if (!cache || cache.url !== framerUrl) return { cached: false };
  if (cache.exportDir && existsSync(cache.exportDir)) {
    const stat = await fs.stat(cache.exportDir);
    if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
      return { cached: true, exportDir: cache.exportDir };
    }
  }
  return { cached: false };
}

export async function writeFramerExportCache(framerUrl: string, exportDir: string): Promise<void> {
  if (!existsSync(exportDir)) return;
  await writeJsonAtomic(CACHE_FILE, { url: framerUrl, exportDir, timestamp: new Date().toISOString() });
}

export async function promptErrorRecovery(stepName: string, error: unknown, rl: readline.Interface): Promise<'retry' | 'skip'> {
  const msg = (error as Error)?.message ?? String(error);
  console.log(`\n${'─'.repeat(56)}`);
  console.log(`  ⚡ FEHLER in Schritt: ${stepName}`);
  console.log(`  ${msg}`);
  console.log(`${'─'.repeat(56)}`);
  console.log('  [R]etry — Schritt wiederholen');
  console.log('  [S]kip  — Schritt überspringen und fortsetzen');
  console.log('  [F]ix   — Manuell beheben, dann weitermachen');
  console.log('  [A]bort — Build abbrechen');

  while (true) {
    const choice = (await rl.question('  Auswahl [R/S/F/A]: ')).trim().toLowerCase();
    switch (choice) {
      case 'r': return 'retry';
      case 's': log.warn(`Schritt "${stepName}" übersprungen.`); return 'skip';
      case 'f':
        log.info('Warte auf manuelle Behebung... (Enter zum Fortfahren)');
        await rl.question('');
        return 'retry';
      case 'a':
        log.error('Build durch Benutzer abgebrochen.');
        rl.close();
        process.exit(1);
      default:
        console.log('  Ungültige Eingabe. [R]etry [S]kip [F]ix [A]bort');
    }
  }
}

export async function runWithRecovery(stepName: string, fn: () => Promise<void>, rl: readline.Interface): Promise<void> {
  while (true) {
    try {
      await fn();
      return;
    } catch (err: unknown) {
      const action = await promptErrorRecovery(stepName, err, rl);
      if (action === 'skip') return;
    }
  }
}
