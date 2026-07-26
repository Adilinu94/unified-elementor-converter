/**
 * Favicon-OG-Downloader — Sprint 4D.
 *
 * Plan §4 Task 4:
 * - apple-touch-icon
 * - og:image / og:image:url / og:image:secure_url
 * - twitter:image / twitter:image:src
 *
 * The list of meta/link targets is collected at extraction time by
 * Playwright (we can hand in the discovered URLs). Each URL is
 * downloaded to assets/seo/ and recorded in the manifest.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { Buffer } from 'node:buffer';
import pLimit from 'p-limit';

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/** A single favicon / OG-image source. */
export interface FaviconSource {
  url: string;
  /** Semantic type for naming. */
  kind:
    | 'apple-touch-icon'
    | 'icon'
    | 'shortcut-icon'
    | 'og-image'
    | 'og-image-secure'
    | 'twitter-image'
    | 'manifest-icon'
    | 'favicon';
  /** Optional: original sizes attribute. */
  sizes?: string;
  /** Optional: original type attribute. */
  type?: string;
}

export interface FaviconManifestEntry {
  local_path: string;
  mime: string;
  filesize: number;
  downloaded_at: string;
  kind: FaviconSource['kind'];
  sizes?: string;
  type?: string;
  source_url: string;
}

export interface DownloadFaviconsResult {
  manifest: Record<string, FaviconManifestEntry>;
  errors: Array<{ url: string; reason: string }>;
}

export interface DownloadFaviconsOptions {
  hostname: string;
  outputRoot: string;
  concurrency?: number;
  headers?: Record<string, string>;
}

/** Map kind to a stable filename prefix. */
function prefixForKind(kind: FaviconSource['kind']): string {
  switch (kind) {
    case 'apple-touch-icon': return 'apple-touch-icon';
    case 'icon': return 'icon';
    case 'shortcut-icon': return 'shortcut-icon';
    case 'og-image': return 'og-image';
    case 'og-image-secure': return 'og-image-secure';
    case 'twitter-image': return 'twitter-image';
    case 'manifest-icon': return 'manifest-icon';
    case 'favicon': return 'favicon';
  }
}

/** Pick a stable extension from URL or MIME. */
function extensionFor(url: string, mime: string): string {
  const fromUrl = extname(new URL(url).pathname).toLowerCase();
  if (fromUrl && /^\.(png|jpg|jpeg|gif|webp|svg|ico)$/.test(fromUrl)) return fromUrl;
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return '.jpg';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/svg+xml') return '.svg';
  if (mime === 'image/x-icon' || mime === 'image/vnd.microsoft.icon') return '.ico';
  return '.bin';
}

async function fetchBuffer(
  url: string,
  options: { timeoutMs: number; maxBytes: number; headers?: Record<string, string> },
): Promise<{ body: Buffer; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; Elconv/1.0; +https://github.com/Adilinu94/unified-elementor-converter)',
        'Accept': 'image/*,*/*;q=0.8',
        ...options.headers,
      },
    });
    if (!res.ok) {
      await res.text();
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    const cl = Number(res.headers.get('content-length') ?? '0');
    if (cl > options.maxBytes) {
      await res.text();
      throw new Error(`File too large (${cl} > ${options.maxBytes})`);
    }
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > options.maxBytes) {
      throw new Error(`File exceeded ${options.maxBytes} bytes`);
    }
    return { body, contentType };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Normalize kind from a raw link/rel value.
 * Used by callers that build the source list from DOM scraping.
 */
export function normalizeFaviconKind(
  rel: string | null,
  property: string | null,
): FaviconSource['kind'] {
  if (property === 'og:image:secure_url') return 'og-image-secure';
  if (property === 'og:image') return 'og-image';
  if (property === 'twitter:image' || property === 'twitter:image:src') return 'twitter-image';
  const r = (rel ?? '').toLowerCase();
  if (r === 'apple-touch-icon' || r === 'apple-touch-icon-precomposed') return 'apple-touch-icon';
  if (r === 'shortcut icon') return 'shortcut-icon';
  if (r === 'icon') return 'icon';
  if (r === 'manifest') return 'manifest-icon';
  return 'favicon';
}

export async function downloadFavicons(
  sources: FaviconSource[],
  options: DownloadFaviconsOptions,
): Promise<DownloadFaviconsResult> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const limit = pLimit(concurrency);

  const subdir = 'seo';
  const targetDir = resolve(options.outputRoot, subdir);
  await mkdir(targetDir, { recursive: true });

  const manifest: Record<string, FaviconManifestEntry> = {};
  const errors: Array<{ url: string; reason: string }> = [];
  // Dedup by kind+url so we don't double-fetch the same href
  const seen = new Set<string>();

  const tasks = sources.map((source) =>
    limit(async () => {
      const dedupKey = `${source.kind}::${source.url}`;
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);
      try {
        const { body, contentType } = await fetchBuffer(source.url, {
          timeoutMs: DEFAULT_TIMEOUT_MS,
          maxBytes: MAX_FILE_SIZE_BYTES,
          headers: options.headers,
        });
        const prefix = prefixForKind(source.kind);
        const sizesSuffix = source.sizes ? `-${source.sizes.replace(/\s*x\s*/g, 'x')}` : '';
        const filename = `${prefix}${sizesSuffix}${extensionFor(source.url, contentType)}`;
        const localAbsPath = join(targetDir, filename);
        await writeFile(localAbsPath, body);

        const entry: FaviconManifestEntry = {
          local_path: join(subdir, filename).replace(/\\/g, '/'),
          mime: contentType || 'application/octet-stream',
          filesize: body.length,
          downloaded_at: new Date().toISOString(),
          kind: source.kind,
          source_url: source.url,
        };
        if (source.sizes) entry.sizes = source.sizes;
        if (source.type) entry.type = source.type;
        manifest[source.url] = entry;
      } catch (e) {
        errors.push({
          url: source.url,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }),
  );

  await Promise.all(tasks);
  return { manifest, errors };
}
