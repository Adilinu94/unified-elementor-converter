/**
 * ZIP Extraction — Extract Framer ZIP exports to working directory.
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

export interface ZipExtractResult {
  outputDir: string;
  filesExtracted: number;
  assetsDir: string | null;
  indexHtml: string | null;
  cssFiles: string[];
}

export interface ZipExtractOptions {
  zipPath: string;
  outputDir?: string;
  overwrite?: boolean;
}

/**
 * Plan the extraction of a Framer ZIP export.
 * Returns the expected directory structure after extraction.
 */
export function planExtraction(options: ZipExtractOptions): ZipExtractResult {
  const outputDir = options.outputDir ?? join(process.cwd(), 'FramerExport', basename(options.zipPath, '.zip'));

  return {
    outputDir,
    filesExtracted: 0,
    assetsDir: join(outputDir, 'assets'),
    indexHtml: join(outputDir, 'index.html'),
    cssFiles: [],
  };
}

/**
 * Scan an extracted Framer export directory for key files.
 */
export function scanExtractedDir(dir: string): ZipExtractResult {
  const assetsDir = join(dir, 'assets');
  const indexHtml = join(dir, 'index.html');

  const cssFiles: string[] = [];
  let filesExtracted = 0;

  if (existsSync(dir)) {
    const entries = readdirSync(dir, { recursive: true }) as string[];
    filesExtracted = entries.length;
    for (const entry of entries) {
      if (String(entry).endsWith('.css')) {
        cssFiles.push(join(dir, String(entry)));
      }
    }
  }

  return {
    outputDir: dir,
    filesExtracted,
    assetsDir: existsSync(assetsDir) ? assetsDir : null,
    indexHtml: existsSync(indexHtml) ? indexHtml : null,
    cssFiles,
  };
}

/**
 * Ensure the output directory exists.
 */
export function ensureOutputDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
