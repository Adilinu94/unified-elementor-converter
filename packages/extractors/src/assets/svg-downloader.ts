/**
 * SVG-Downloader — Sprint 4C.
 *
 * Plan §4 Task 3:
 * - Inline-SVGs aus dem DOM als separate Dateien extrahieren
 * - Externe SVG-URLs herunterladen
 *
 * Strategy:
 * - Inline SVGs: serialized via XMLSerializer (browser-side via Playwright)
 * - External SVGs: HTTP fetch + write to assets/svgs/<hash>.svg
 *
 * Inlining-IDs werden so vergeben, dass Konflikte zwischen identischen
 * SVGs (z.B. das gleiche Icon 5x) vermieden werden. Wir deduplizieren
 * per `id` Attribut oder per sha256 der normalisierten SVG-Markup.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import pLimit from 'p-limit';

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

/** Single SVG source (inline or external). */
export type SvgSource =
  | { kind: 'inline'; markup: string; sourceElement?: string; existingId?: string }
  | { kind: 'external'; url: string };

/** Manifest entry. */
export interface SvgManifestEntry {
  local_path: string;
  filesize: number;
  downloaded_at: string;
  source: 'inline' | 'external';
  source_url?: string;
  source_element?: string;
  /** Hash of the SVG markup (for de-duplication). */
  hash: string;
  /** Existing id attribute (if any). */
  existing_id?: string;
}

export interface DownloadSvgsResult {
  manifest: Record<string, SvgManifestEntry>;
  errors: Array<{ key: string; reason: string }>;
}

export interface DownloadSvgsOptions {
  hostname: string;
  outputRoot: string;
  concurrency?: number;
  headers?: Record<string, string>;
}

/** Hash a normalized SVG markup for dedup. */
export function hashSvg(markup: string): string {
  // Normalize: drop comments, collapse all whitespace, strip xml decl
  const norm = markup
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?xml[^?]*\?>/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

/** Generate a filename for an SVG. */
export function generateSvgFilename(markup: string, existingId?: string, hash?: string): string {
  if (existingId) {
    return `${sanitizeId(existingId)}-${(hash ?? hashSvg(markup)).slice(0, 6)}.svg`;
  }
  return `${(hash ?? hashSvg(markup)).slice(0, 12)}.svg`;
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'svg';
}

/** External URL → buffer. */
async function fetchSvg(url: string, options: { timeoutMs: number; maxBytes: number; headers?: Record<string, string> }): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; Elconv/1.0; +https://github.com/Adilinu94/unified-elementor-converter)',
        'Accept': 'image/svg+xml,*/*;q=0.8',
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
      throw new Error(`SVG too large (${cl} > ${options.maxBytes})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > options.maxBytes) {
      throw new Error(`SVG exceeded ${options.maxBytes} bytes`);
    }
    return buf;
  } finally {
    clearTimeout(timeout);
  }
}

/** Detect if a string is a valid SVG. */
export function looksLikeSvg(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('<svg') || trimmed.startsWith('<?xml');
}

/** Strip XML declaration (optional, but typically unused inline). */
export function stripXmlDecl(markup: string): string {
  return markup.replace(/<\?xml[^?]*\?>\s*/, '');
}

/**
 * Process inline + external SVGs.
 * Inline SVGs are deduped by hash; external SVGs are stored as-is.
 */
export async function downloadSvgs(
  sources: SvgSource[],
  options: DownloadSvgsOptions,
): Promise<DownloadSvgsResult> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const limit = pLimit(concurrency);

  const subdir = 'svgs';
  const targetDir = resolve(options.outputRoot, subdir);
  await mkdir(targetDir, { recursive: true });

  const manifest: Record<string, SvgManifestEntry> = {};
  const errors: Array<{ key: string; reason: string }> = [];
  // Track which hashes have been written (to dedup inline SVGs)
  const writtenHashes = new Set<string>();

  const tasks = sources.map((source, idx) =>
    limit(async () => {
      const key = source.kind === 'inline'
        ? `inline#${idx}`
        : source.url;
      try {
        let body: Buffer;
        let hash: string;
        let existingId: string | undefined;
        let sourceElement: string | undefined;
        let sourceUrl: string | undefined;

        if (source.kind === 'inline') {
          if (!looksLikeSvg(source.markup)) {
            errors.push({ key, reason: 'not_svg_markup' });
            return;
          }
          const cleaned = stripXmlDecl(source.markup);
          hash = hashSvg(cleaned);
          existingId = source.existingId;
          sourceElement = source.sourceElement;
          if (writtenHashes.has(hash)) {
            // Dedup — still record the manifest entry pointing to the same file
            const filename = generateSvgFilename(cleaned, existingId, hash);
            manifest[key] = {
              local_path: join(subdir, filename).replace(/\\/g, '/'),
              filesize: Buffer.byteLength(cleaned, 'utf-8'),
              downloaded_at: new Date().toISOString(),
              source: 'inline',
              hash,
              ...(existingId ? { existing_id: existingId } : {}),
              ...(sourceElement ? { source_element: sourceElement } : {}),
            };
            return;
          }
          body = Buffer.from(cleaned, 'utf-8');
          writtenHashes.add(hash);
        } else {
          // External
          sourceUrl = source.url;
          const fetched = await fetchSvg(source.url, {
            timeoutMs: DEFAULT_TIMEOUT_MS,
            maxBytes: MAX_FILE_SIZE_BYTES,
            headers: options.headers,
          });
          if (!looksLikeSvg(fetched.toString('utf-8'))) {
            errors.push({ key, reason: 'fetched_content_not_svg' });
            return;
          }
          body = fetched;
          hash = hashSvg(body.toString('utf-8'));
        }

        const filename = generateSvgFilename(
          body.toString('utf-8'),
          existingId,
          hash,
        );
        const localAbsPath = join(targetDir, filename);
        await writeFile(localAbsPath, body);

        const entry: SvgManifestEntry = {
          local_path: join(subdir, filename).replace(/\\/g, '/'),
          filesize: body.length,
          downloaded_at: new Date().toISOString(),
          source: source.kind,
          hash,
        };
        if (sourceUrl) entry.source_url = sourceUrl;
        if (sourceElement) entry.source_element = sourceElement;
        if (existingId) entry.existing_id = existingId;
        manifest[key] = entry;
      } catch (e) {
        errors.push({
          key,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }),
  );

  await Promise.all(tasks);
  return { manifest, errors };
}
