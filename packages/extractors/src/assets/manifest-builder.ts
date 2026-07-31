/**
 * Manifest-Builder — Aggregates all asset manifests into a single JSON.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImageManifestEntry } from './image-downloader.js';
import type { FontManifestEntry } from './font-downloader.js';
import type { SvgManifestEntry } from './svg-downloader.js';
import type { FaviconManifestEntry } from './favicon-og-downloader.js';

export interface AssetManifest {
  version: 1;
  source_url: string;
  hostname: string;
  created_at: string;
  images: ImageManifestEntry[];
  fonts: FontManifestEntry[];
  svgs: SvgManifestEntry[];
  favicons?: FaviconManifestEntry[];
  total_files: number;
  total_bytes: number;
}

export function buildManifest(
  sourceUrl: string,
  images: ImageManifestEntry[],
  fonts: FontManifestEntry[],
  svgs: SvgManifestEntry[],
  favicons: FaviconManifestEntry[] = [],
): AssetManifest {
  const totalBytes =
    images.reduce((s, i) => s + i.filesize, 0) +
    fonts.reduce((s, f) => s + f.filesize, 0) +
    svgs.reduce((s, sv) => s + sv.filesize, 0) +
    favicons.reduce((s, favicon) => s + favicon.filesize, 0);

  return {
    version: 1,
    source_url: sourceUrl,
    hostname: new URL(sourceUrl).hostname,
    created_at: new Date().toISOString(),
    images,
    fonts,
    svgs,
    favicons,
    total_files: images.length + fonts.length + svgs.length + favicons.length,
    total_bytes: totalBytes,
  };
}

export async function writeManifest(manifest: AssetManifest, outputDir: string): Promise<string> {
  const filePath = join(outputDir, 'asset-manifest.json');
  await writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf8');
  return filePath;
}

export interface BuildAndWriteManifestInput {
  hostname: string;
  url: string;
  images: { manifest: ImageManifestEntry[]; errors: unknown[] };
  fonts: { manifest: FontManifestEntry[]; errors: unknown[] };
  svgs: { manifest: Record<string, SvgManifestEntry>; errors: unknown[] };
  favicons: { manifest: Record<string, FaviconManifestEntry>; errors: unknown[] };
}

/**
 * Compatibility facade for the old pipeline. It normalizes record-based SVG/
 * favicon results into the canonical manifest arrays and writes one file.
 */
export async function buildAndWriteManifest(
  input: BuildAndWriteManifestInput,
  outputDir: string,
): Promise<{ manifest: AssetManifest; path: string }> {
  const manifest = buildManifest(
    input.url,
    input.images.manifest,
    input.fonts.manifest,
    Object.values(input.svgs.manifest),
    Object.values(input.favicons.manifest),
  );
  const filePath = await writeManifest(manifest, outputDir);
  return { manifest, path: filePath };
}

export function summarizeManifest(manifest: AssetManifest): string {
  return [
    `Asset manifest: ${manifest.total_files} files (${manifest.total_bytes} bytes)`,
    `  images=${manifest.images.length} fonts=${manifest.fonts.length} svgs=${manifest.svgs.length} favicons=${manifest.favicons?.length ?? 0}`,
  ].join('\n');
}
