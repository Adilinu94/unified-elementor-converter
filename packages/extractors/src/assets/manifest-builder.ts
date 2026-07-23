/**
 * Manifest-Builder — Aggregates all asset manifests into a single JSON.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImageManifestEntry } from './image-downloader.js';
import type { FontManifestEntry } from './font-downloader.js';

export interface AssetManifest {
  version: 1;
  source_url: string;
  hostname: string;
  created_at: string;
  images: ImageManifestEntry[];
  fonts: FontManifestEntry[];
  svgs: Array<{ local_path: string; kind: string; filesize: number }>;
  total_files: number;
  total_bytes: number;
}

export function buildManifest(
  sourceUrl: string,
  images: ImageManifestEntry[],
  fonts: FontManifestEntry[],
  svgs: Array<{ local_path: string; kind: string; filesize: number }>,
): AssetManifest {
  const totalBytes =
    images.reduce((s, i) => s + i.filesize, 0) +
    fonts.reduce((s, f) => s + f.filesize, 0) +
    svgs.reduce((s, sv) => s + sv.filesize, 0);

  return {
    version: 1,
    source_url: sourceUrl,
    hostname: new URL(sourceUrl).hostname,
    created_at: new Date().toISOString(),
    images,
    fonts,
    svgs,
    total_files: images.length + fonts.length + svgs.length,
    total_bytes: totalBytes,
  };
}

export async function writeManifest(manifest: AssetManifest, outputDir: string): Promise<string> {
  const path = join(outputDir, 'asset-manifest.json');
  await writeFile(path, JSON.stringify(manifest, null, 2), 'utf8');
  return path;
}
