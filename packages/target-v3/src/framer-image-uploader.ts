/**
 * Framer Image Uploader (#3)
 *
 * background_image with id:null (external framerusercontent URL) does NOT
 * render under V4 (see v3-v4-render-compat.json). The fix is to upload every
 * framerusercontent image to WP media and replace the external URL with the
 * attachment ID — then background_image renders natively in the Elementor
 * editor (no CSS background-image hack needed).
 *
 * Uses the WP REST media endpoint (/wp-json/wp/v2/media) directly with the
 * application password — no MCP ability required. This is the standard,
 * reliable path for media upload.
 *
 * @example
 * import { FramerImageUploader } from './framer-image-uploader.js';
 * const up = new FramerImageUploader({ baseUrl: 'https://site.de', username, password });
 * const { tree, report } = await up.uploadAndReplace(tree);
 */

import { collectImageUrls, replaceImageUrl, type V3Tree } from './v3-tree-types.js';

export interface UploaderOptions {
  /** WP base URL, e.g. https://testseite.nick-webdesign.de (no trailing slash). */
  baseUrl: string;
  username: string;
  /** Application password (spaces stripped automatically). */
  password: string;
  /** Only upload URLs matching this filter (default: framerusercontent.com). */
  urlFilter?: RegExp;
  /** Concurrency for parallel uploads. Default 3. */
  concurrency?: number;
}

export interface UploadResult {
  url: string;
  attachmentId: number | null;
  wpUrl: string | null;
  error?: string;
}

export interface UploadReport {
  total: number;
  uploaded: number;
  failed: number;
  skipped: number;
  results: UploadResult[];
}

const DEFAULT_FILTER = /framerusercontent\.com/i;

export class FramerImageUploader {
  private readonly baseUrl: string;
  private readonly auth: string;
  private readonly filter: RegExp;
  private readonly concurrency: number;

  constructor(opts: UploaderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.auth =
      'Basic ' +
      Buffer.from(`${opts.username}:${opts.password.replace(/\s+/g, '')}`).toString('base64');
    this.filter = opts.urlFilter ?? DEFAULT_FILTER;
    this.concurrency = opts.concurrency ?? 3;
  }

  /**
   * Collect all framerusercontent image URLs from the tree, upload each to
   * WP media, and replace the URL + set the attachment id in the tree.
   * Returns the mutated tree + a report.
   */
  async uploadAndReplace(tree: V3Tree): Promise<{ tree: V3Tree; report: UploadReport }> {
    const urls = collectImageUrls(tree).filter((u) => this.filter.test(u));
    const results: UploadResult[] = [];

    // Simple concurrency limiter (no extra dep)
    const queue = [...urls];
    const workers = Array.from({ length: Math.min(this.concurrency, queue.length) }, async () => {
      while (queue.length) {
        const url = queue.shift()!;
        const r = await this.uploadOne(url);
        results.push(r);
        if (r.attachmentId != null && r.wpUrl) {
          replaceImageUrl(tree, url, r.wpUrl, r.attachmentId);
        }
      }
    });
    await Promise.all(workers);

    const uploaded = results.filter((r) => r.attachmentId != null).length;
    const failed = results.filter((r) => r.error).length;
    const skipped = urls.length === 0 ? 0 : 0;

    return {
      tree,
      report: { total: urls.length, uploaded, failed, skipped, results },
    };
  }

  /** Upload a single image URL to WP media. Returns attachment id + wp URL. */
  async uploadOne(url: string): Promise<UploadResult> {
    try {
      // Fetch the image bytes
      const imgRes = await fetch(url);
      if (!imgRes.ok) return { url, attachmentId: null, wpUrl: null, error: `fetch ${imgRes.status}` };
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
      const filename = filenameFromUrl(url, contentType);

      // POST to WP media
      const res = await fetch(`${this.baseUrl}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: {
          Authorization: this.auth,
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Type': contentType,
        },
        body: buf,
      });
      if (!res.ok) {
        const txt = await res.text();
        return { url, attachmentId: null, wpUrl: null, error: `wp ${res.status}: ${txt.slice(0, 120)}` };
      }
      const json = (await res.json()) as { id: number; source_url: string };
      return { url, attachmentId: json.id, wpUrl: json.source_url };
    } catch (e) {
      return { url, attachmentId: null, wpUrl: null, error: (e as Error).message };
    }
  }
}

function filenameFromUrl(url: string, contentType: string): string {
  const u = new URL(url);
  const base = (u.pathname.split('/').pop() || 'framer-image').replace(/[^a-z0-9.-]/gi, '_');
  const ext = contentType.includes('png')
    ? '.png'
    : contentType.includes('webp')
      ? '.webp'
      : contentType.includes('svg')
        ? '.svg'
        : '.jpg';
  return base.includes('.') ? base : base + ext;
}

/** Format an UploadReport as a human-readable string. */
export function formatUploadReport(r: UploadReport): string {
  const lines = [
    `Image Upload Report: ${r.uploaded}/${r.total} uploaded, ${r.failed} failed, ${r.skipped} skipped`,
    '',
  ];
  for (const res of r.results) {
    const status = res.attachmentId != null ? `OK (#${res.attachmentId})` : `FAIL: ${res.error}`;
    lines.push(`  ${status}  ${res.url.slice(0, 80)}`);
  }
  return lines.join('\n');
}
