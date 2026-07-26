/**
 * Asset Scanner — Recursively scan Framer export assets directory.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

export interface ScannedAsset {
  filename: string;
  relativePath: string;
  absolutePath: string;
  size: number;
  mimeType: string;
  category: 'image' | 'font' | 'video' | 'svg' | 'other';
}

export interface AssetScanResult {
  totalFiles: number;
  totalSizeBytes: number;
  assets: ScannedAsset[];
  byCategory: Record<string, number>;
}

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function categorize(ext: string): ScannedAsset['category'] {
  if (ext === '.svg') return 'svg';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'].includes(ext)) return 'image';
  if (['.woff', '.woff2', '.ttf', '.otf'].includes(ext)) return 'font';
  if (['.mp4', '.webm'].includes(ext)) return 'video';
  return 'other';
}

/**
 * Recursively scan a directory for assets.
 */
export function scanAssets(dir: string, options: { extensions?: string[] } = {}): AssetScanResult {
  const assets: ScannedAsset[] = [];
  const byCategory: Record<string, number> = {};
  let totalSizeBytes = 0;

  if (!existsSync(dir)) {
    return { totalFiles: 0, totalSizeBytes: 0, assets: [], byCategory: {} };
  }

  const allowedExts = options.extensions
    ? new Set(options.extensions.map((e) => e.startsWith('.') ? e : `.${e}`))
    : null;

  function walk(currentDir: string): void {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        walk(fullPath);
      } else {
        const ext = extname(entry).toLowerCase();
        if (allowedExts && !allowedExts.has(ext)) continue;

        const asset: ScannedAsset = {
          filename: entry,
          relativePath: relative(dir, fullPath),
          absolutePath: fullPath,
          size: stat.size,
          mimeType: MIME_MAP[ext] ?? 'application/octet-stream',
          category: categorize(ext),
        };

        assets.push(asset);
        totalSizeBytes += stat.size;
        byCategory[asset.category] = (byCategory[asset.category] ?? 0) + 1;
      }
    }
  }

  walk(dir);

  return { totalFiles: assets.length, totalSizeBytes, assets, byCategory };
}
