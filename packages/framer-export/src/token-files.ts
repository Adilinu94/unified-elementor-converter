/**
 * Token Files — Generate token mapping files from Framer export.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface TokenFileSet {
  tokenMapping: string;
  fontResolution: string;
  breakpoints: string;
  styleMap: string;
}

export interface TokenGenerationOptions {
  outputDir: string;
  colors?: Record<string, string>;
  fonts?: Record<string, { family: string; weight: number; gvId?: string }>;
  breakpoints?: Record<string, number>;
}

/**
 * Generate all token files for the Framer→Elementor pipeline.
 */
export function generateTokenFiles(options: TokenGenerationOptions): TokenFileSet {
  const { outputDir } = options;
  mkdirSync(outputDir, { recursive: true });

  const paths: TokenFileSet = {
    tokenMapping: join(outputDir, 'token-mapping.json'),
    fontResolution: join(outputDir, 'font-resolution.json'),
    breakpoints: join(outputDir, 'responsive-breakpoints.json'),
    styleMap: join(outputDir, 'style-map.json'),
  };

  // Token mapping
  const tokenMapping = {
    colors: options.colors ?? {},
    fonts: Object.fromEntries(
      Object.entries(options.fonts ?? {}).map(([k, v]) => [k, { gv_id: v.gvId, family: v.family }]),
    ),
    generated: new Date().toISOString(),
  };
  writeFileSync(paths.tokenMapping, JSON.stringify(tokenMapping, null, 2), 'utf-8');

  // Font resolution
  const fontResolution = {
    fonts: Object.entries(options.fonts ?? {}).map(([label, f]) => ({
      label,
      family: f.family,
      weight: f.weight,
      gv_id: f.gvId ?? null,
      status: f.gvId ? 'RESOLVED' : 'PENDING',
    })),
    generated: new Date().toISOString(),
  };
  writeFileSync(paths.fontResolution, JSON.stringify(fontResolution, null, 2), 'utf-8');

  // Breakpoints
  const breakpoints = {
    breakpoints: options.breakpoints ?? { desktop: 1440, tablet: 768, mobile: 375 },
    generated: new Date().toISOString(),
  };
  writeFileSync(paths.breakpoints, JSON.stringify(breakpoints, null, 2), 'utf-8');

  // Style map (empty initial)
  writeFileSync(paths.styleMap, JSON.stringify({ styles: [], generated: new Date().toISOString() }, null, 2), 'utf-8');

  return paths;
}

/**
 * Write a JSON file with directory creation.
 */
export function writeJsonFile(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
