/**
 * Image-Downloader — Parallel downloads with validation.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Buffer } from 'node:buffer';
import pLimit from 'p-limit';
import { customAlphabet } from 'nanoid';
import { RateLimiter } from './rate-limiter.js';

const nanoid8 = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export interface ImageManifestEntry {
  local_path: string;
  mime: string;
  width?: number;
  height?: number;
  filesize: number;
  downloaded_at: string;
  alt?: string;
  original_name?: string;
}

export interface ImageDownload {
  url: string;
  alt?: string;
}

export interface DownloadImagesOptions {
  hostname: string;
  subdir: string;
  outputRoot: string;
  concurrency?: number;
  filenameFor?: (url: string, ext: string) => string;
  headers?: Record<string, string>;
}

export function normalizeImageUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid']) {
      u.searchParams.delete(p);
    }
    return u.toString();
  } catch {
    return url;
  }
}

export async function downloadImages(
  images: ImageDownload[],
  options: DownloadImagesOptions,
): Promise<{ manifest: ImageManifestEntry[]; errors: string[] }> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const limit = pLimit(concurrency);
  const rateLimiter = new RateLimiter({ minDelayMs: 200 });
  const outDir = join(options.outputRoot, options.subdir);
  await mkdir(outDir, { recursive: true });

  const manifest: ImageManifestEntry[] = [];
  const errors: string[] = [];

  await Promise.all(
    images.map((img) =>
      limit(async () => {
        try {
          const normalizedUrl = normalizeImageUrl(img.url);
          await rateLimiter.acquireUrl(normalizedUrl);

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

          const res = await fetch(normalizedUrl, {
            signal: controller.signal,
            headers: options.headers,
          });
          clearTimeout(timeout);

          if (!res.ok) {
            errors.push(`HTTP ${res.status}: ${normalizedUrl}`);
            return;
          }

          const arrayBuf = await res.arrayBuffer();
          const buf = Buffer.from(arrayBuf);

          if (buf.length > MAX_FILE_SIZE_BYTES) {
            errors.push(`Too large (${buf.length}): ${normalizedUrl}`);
            return;
          }

          const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
          const ext = extname(new URL(normalizedUrl).pathname) || '.jpg';
          const filename = options.filenameFor
            ? options.filenameFor(normalizedUrl, ext)
            : `${nanoid8()}${ext}`;
          const localPath = join(outDir, filename);

          await writeFile(localPath, buf);

          manifest.push({
            local_path: localPath,
            mime: contentType,
            filesize: buf.length,
            downloaded_at: new Date().toISOString(),
            alt: img.alt,
            original_name: new URL(normalizedUrl).pathname.split('/').pop(),
          });
        } catch (err) {
          errors.push(`${err instanceof Error ? err.message : String(err)}: ${img.url}`);
        }
      }),
    ),
  );

  return { manifest, errors };
}
