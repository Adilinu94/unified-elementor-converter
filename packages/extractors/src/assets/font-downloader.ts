/**
 * Font-Downloader — Downloads intercepted font files.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import pLimit from 'p-limit';
import { customAlphabet } from 'nanoid';
import type { FontIntercept } from '../browser/types.js';
import { RateLimiter } from './rate-limiter.js';

const nanoid8 = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

export interface FontManifestEntry {
  local_path: string;
  url: string;
  type: FontIntercept['type'];
  family?: string;
  filesize: number;
  downloaded_at: string;
}

export interface DownloadFontsOptions {
  outputRoot: string;
  concurrency?: number;
  headers?: Record<string, string>;
}

export async function downloadFonts(
  fonts: FontIntercept[],
  options: DownloadFontsOptions,
): Promise<{ manifest: FontManifestEntry[]; errors: string[] }> {
  const limit = pLimit(options.concurrency ?? 3);
  const rateLimiter = new RateLimiter({ minDelayMs: 300 });
  const outDir = join(options.outputRoot, 'fonts');
  await mkdir(outDir, { recursive: true });

  const manifest: FontManifestEntry[] = [];
  const errors: string[] = [];

  const fontFiles = fonts.filter((f) => f.type !== 'google-fonts-css');

  await Promise.all(
    fontFiles.map((font) =>
      limit(async () => {
        try {
          await rateLimiter.acquireUrl(font.url);
          const res = await fetch(font.url, { headers: options.headers });
          if (!res.ok) {
            errors.push(`HTTP ${res.status}: ${font.url}`);
            return;
          }

          const buf = Buffer.from(await res.arrayBuffer());
          const ext = font.type === 'woff2' ? '.woff2' : font.type === 'woff' ? '.woff' : '.ttf';
          const filename = `${nanoid8()}${ext}`;
          const localPath = join(outDir, filename);
          await writeFile(localPath, buf);

          manifest.push({
            local_path: localPath,
            url: font.url,
            type: font.type,
            family: font.family,
            filesize: buf.length,
            downloaded_at: new Date().toISOString(),
          });
        } catch (err) {
          errors.push(`${err instanceof Error ? err.message : String(err)}: ${font.url}`);
        }
      }),
    ),
  );

  return { manifest, errors };
}
