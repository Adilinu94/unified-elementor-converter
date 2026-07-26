/**
 * Directory Structure — Manage the standard FramerExport directory layout.
 *
 * Standard layout:
 *   FramerExport/
 *   ├── assets/          (images, fonts, videos)
 *   ├── tokens/          (token-mapping.json, style-map.json, etc.)
 *   ├── design-system/   (global classes, variables)
 *   ├── reports/         (QA reports, validation results)
 *   ├── xml/             (Elementor XML exports)
 *   └── output/          (final build artifacts)
 */

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Standard subdirectories within a FramerExport workspace. */
export const STANDARD_DIRS = [
  'assets',
  'tokens',
  'design-system',
  'reports',
  'xml',
  'output',
] as const;

export type StandardDir = (typeof STANDARD_DIRS)[number];

export interface DirectoryLayout {
  root: string;
  assets: string;
  tokens: string;
  designSystem: string;
  reports: string;
  xml: string;
  output: string;
}

export interface DirectoryStatus {
  layout: DirectoryLayout;
  existing: StandardDir[];
  missing: StandardDir[];
  fileCount: number;
}

/**
 * Resolve the full directory layout from a root path.
 */
export function resolveLayout(root: string): DirectoryLayout {
  return {
    root,
    assets: join(root, 'assets'),
    tokens: join(root, 'tokens'),
    designSystem: join(root, 'design-system'),
    reports: join(root, 'reports'),
    xml: join(root, 'xml'),
    output: join(root, 'output'),
  };
}

/**
 * Ensure all standard directories exist.
 * Creates missing directories recursively.
 */
export function ensureDirectoryStructure(root: string): DirectoryLayout {
  const layout = resolveLayout(root);

  mkdirSync(layout.root, { recursive: true });
  mkdirSync(layout.assets, { recursive: true });
  mkdirSync(layout.tokens, { recursive: true });
  mkdirSync(layout.designSystem, { recursive: true });
  mkdirSync(layout.reports, { recursive: true });
  mkdirSync(layout.xml, { recursive: true });
  mkdirSync(layout.output, { recursive: true });

  return layout;
}

/**
 * Check the status of the directory structure without creating anything.
 */
export function checkDirectoryStatus(root: string): DirectoryStatus {
  const layout = resolveLayout(root);
  const existing: StandardDir[] = [];
  const missing: StandardDir[] = [];

  const dirMap: Record<StandardDir, string> = {
    assets: layout.assets,
    tokens: layout.tokens,
    'design-system': layout.designSystem,
    reports: layout.reports,
    xml: layout.xml,
    output: layout.output,
  };

  for (const dir of STANDARD_DIRS) {
    if (existsSync(dirMap[dir])) {
      existing.push(dir);
    } else {
      missing.push(dir);
    }
  }

  let fileCount = 0;
  if (existsSync(root)) {
    try {
      const entries = readdirSync(root, { recursive: true }) as string[];
      fileCount = entries.length;
    } catch {
      fileCount = 0;
    }
  }

  return { layout, existing, missing, fileCount };
}

/**
 * Clean a specific subdirectory (remove all contents, keep the directory).
 */
export function cleanSubdirectory(root: string, dir: StandardDir): void {
  const target = join(root, dir);
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
  }
}

/**
 * Get a relative path from the export root for display/logging.
 */
export function toRelativePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).replace(/\\/g, '/');
}

/**
 * Validate that a directory looks like a valid Framer export.
 * Requires at minimum: root exists + (index.html OR assets/ directory).
 */
export function isValidFramerExport(root: string): boolean {
  if (!existsSync(root)) return false;

  const hasIndex = existsSync(join(root, 'index.html'));
  const hasAssets = existsSync(join(root, 'assets'));
  const hasAnyHtml = existsSync(root) &&
    (readdirSync(root) as string[]).some((f) => String(f).endsWith('.html'));

  return hasIndex || hasAssets || hasAnyHtml;
}
