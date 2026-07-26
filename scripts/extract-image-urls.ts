#!/usr/bin/env node
/**
 * extract-image-urls.ts  —  Phase 4: Framer Asset URL Extraction
 *
 * Usage:
 *   node --import tsx scripts/extract-image-urls.ts \
 *     --html FramerExport/index.html \
 *     --element-tree FramerExport/element-tree/homepage-element-tree.json \
 *     --output FramerExport/assets/image-manifest.json
 */

import fs   from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface UrlEntry {
  url: string;
  source: string;
}

interface AssetEntry {
  url: string;
  type: string;
  extension: string;
  filename: string;
  sources: string[];
  width: null;
  height: null;
}

interface ImageManifest {
  source: string;
  extracted_at: string;
  total_urls: number;
  unique_urls: number;
  duplicates_removed: number;
  assets: AssetEntry[];
  summary: {
    images: number;
    videos: number;
    svg: number;
    other: number;
    total_size_estimate_mb: null;
  };
}

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    html:            { type: 'string' },
    'element-tree':  { type: 'string' },
    'unframer-xml':  { type: 'string' },
    output:          { type: 'string' },
    format:          { type: 'string',  default: 'json' },
    only:            { type: 'string',  default: 'all' },
    'local-only':    { type: 'boolean', default: false },
    verbose:         { type: 'boolean', default: false },
  },
  strict: false,
});

const htmlPath: string | undefined = args.html as string | undefined;
const elementTreePath: string | undefined = args['element-tree'] as string | undefined;
const unframerXmlPath: string | undefined = args['unframer-xml'] as string | undefined;
const outputPath: string | undefined = args.output as string | undefined;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node --import tsx scripts/extract-image-urls.ts [--help for options]');
  console.log('Run with --help for full usage.');
  process.exit(0);
}

const log = (...msg: string[]) => { if (args.verbose) process.stderr.write('[verbose] ' + msg.join(' ') + '\n'); };

if (!htmlPath && !elementTreePath && !unframerXmlPath) {
  process.stderr.write('Error: At least one input required: --html, --element-tree, or --unframer-xml\n');
  process.exit(2);
}

// ─────────────────────────────────────────────
// URL CLASSIFICATION
// ─────────────────────────────────────────────

function classifyUrl(url: string): string {
  const lower = url.toLowerCase().split('?')[0];
  if (/\.(mp4|webm|mov|ogg|avi)$/.test(lower))                   return 'video';
  if (/\.(svg)$/.test(lower) || lower.startsWith('data:image/svg')) return 'svg';
  if (/\.(png|jpg|jpeg|gif|webp|avif|bmp|ico|tiff?)$/.test(lower)) return 'image';
  if (lower.includes('framerusercontent.com/images/'))             return 'image';
  if (lower.includes('framerusercontent.com/assets/')) {
    return /\.(mp4|webm|mov)/.test(lower) ? 'video' : 'image';
  }
  return 'other';
}

function getExtension(url: string): string {
  const base = url.split('?')[0];
  return path.extname(base).replace('.', '').toLowerCase() || 'unknown';
}

function getFilename(url: string): string {
  const base = url.split('?')[0];
  return path.basename(base) || url.slice(-20);
}

// ─────────────────────────────────────────────
// HTML EXTRACTION
// ─────────────────────────────────────────────

function extractFromHtml(html: string): UrlEntry[] {
  const found: UrlEntry[] = [];

  const push = (url: string, src: string) => {
    if (url && !url.startsWith('data:') && url.startsWith('http')) found.push({ url, source: src });
  };

  let m: RegExpExecArray | null;

  const imgSrcRe = /<img[^>]+src=["']([^"']+)["']/gi;
  while ((m = imgSrcRe.exec(html)) !== null) push(m[1], 'html:img[src]');

  const srcsetRe = /<img[^>]+srcset=["']([^"']+)["']/gi;
  while ((m = srcsetRe.exec(html)) !== null) {
    for (const part of m[1].split(',')) {
      const u = part.trim().split(/\s+/)[0];
      push(u, 'html:img[srcset]');
    }
  }

  const bgRe = /background(?:-image)?\s*:[^;]*url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  while ((m = bgRe.exec(html)) !== null) push(m[1].trim(), 'html:background-image');

  const videoRe = /<video[^>]+src=["']([^"']+)["']/gi;
  while ((m = videoRe.exec(html)) !== null) push(m[1], 'html:video[src]');

  const sourceRe = /<source[^>]+src=["']([^"']+)["']/gi;
  while ((m = sourceRe.exec(html)) !== null) push(m[1], 'html:source[src]');

  return found;
}

// ─────────────────────────────────────────────
// ELEMENT-TREE EXTRACTION
// ─────────────────────────────────────────────

function extractFromTree(node: unknown, results: UrlEntry[], nodeId: string): void {
  if (!node || typeof node !== 'object') return;

  const n = node as Record<string, unknown>;

  const settings = n.settings as Record<string, Record<string, unknown>> | undefined;
  const canonicalImageSrc = ((settings?.['image-src'] as Record<string, unknown>)?.value as Record<string, unknown>)?.url as string | undefined;
  const imageUrl: string | undefined =
    canonicalImageSrc ||
    (settings?.image_src as Record<string, unknown>)?.url as string | undefined ||
    (settings?.['image-src'] as Record<string, unknown>)?.url as string | undefined ||
    (n.image_src as Record<string, unknown>)?.url as string | undefined;

  if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
    const id = n.id || n.name || nodeId || '?';
    results.push({ url: imageUrl, source: `element-tree:${id}` });
  }

  for (const val of Object.values(n)) {
    if (Array.isArray(val)) {
      val.forEach((item: unknown, i: number) => extractFromTree(item, results, `${nodeId}[${i}]`));
    } else if (val && typeof val === 'object') {
      extractFromTree(val, results, nodeId);
    }
  }
}

// ─────────────────────────────────────────────
// MCP XML EXTRACTION
// ─────────────────────────────────────────────

function extractFromXml(xml: string): UrlEntry[] {
  const found: UrlEntry[] = [];
  const re = /src=["']?(https?:\/\/framerusercontent\.com\/[^"'\s>]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    found.push({ url: m[1], source: 'mcp-xml:src' });
  }
  return found;
}

// ─────────────────────────────────────────────
// LOAD INPUTS
// ─────────────────────────────────────────────

const rawUrls: UrlEntry[] = [];
const sourcesUsed: string[] = [];

if (htmlPath) {
  if (!fs.existsSync(htmlPath)) {
    process.stderr.write(`Error: HTML file not found: ${htmlPath}\n`);
    process.exit(2);
  }
  log('Reading HTML:', htmlPath);
  const html      = fs.readFileSync(htmlPath, 'utf8');
  const extracted = extractFromHtml(html);
  log(`  Found ${extracted.length} URL references in HTML`);
  rawUrls.push(...extracted);
  sourcesUsed.push(htmlPath);
}

if (elementTreePath) {
  if (!fs.existsSync(elementTreePath)) {
    process.stderr.write(`Error: Element-tree file not found: ${elementTreePath}\n`);
    process.exit(2);
  }
  log('Reading element-tree:', elementTreePath);
  let tree: unknown;
  try {
    tree = JSON.parse(fs.readFileSync(elementTreePath, 'utf8'));
  } catch (e) {
    process.stderr.write(`Error: JSON parse failed in ${elementTreePath}: ${(e as Error).message}\n`);
    process.exit(2);
  }
  const treeUrls: UrlEntry[] = [];
  extractFromTree(tree, treeUrls, 'root');
  log(`  Found ${treeUrls.length} URL references in element-tree`);
  rawUrls.push(...treeUrls);
  sourcesUsed.push(elementTreePath);
}

if (unframerXmlPath) {
  if (!fs.existsSync(unframerXmlPath)) {
    process.stderr.write(`Error: MCP XML file not found: ${unframerXmlPath}\n`);
    process.exit(2);
  }
  log('Reading MCP XML:', unframerXmlPath);
  const xml    = fs.readFileSync(unframerXmlPath, 'utf8');
  const xmlUrls = extractFromXml(xml);
  log(`  Found ${xmlUrls.length} URL references in XML`);
  rawUrls.push(...xmlUrls);
  sourcesUsed.push(unframerXmlPath);
}

// ─────────────────────────────────────────────
// FILTER
// ─────────────────────────────────────────────

let filtered = rawUrls;

if (args['local-only']) {
  filtered = filtered.filter(({ url }) => url.includes('framerusercontent.com'));
}

const onlyFilter: string = (args.only as string) || 'all';
if (onlyFilter && onlyFilter !== 'all') {
  filtered = filtered.filter(({ url }) => classifyUrl(url) === onlyFilter);
}

// ─────────────────────────────────────────────
// DEDUPLICATE
// ─────────────────────────────────────────────

const seen = new Map<string, { url: string; sources: string[] }>();
let totalUrls = 0;
let dupCount  = 0;

for (const { url, source } of filtered) {
  totalUrls++;
  const key = url.toLowerCase();
  if (seen.has(key)) {
    const existing = seen.get(key)!;
    if (!existing.sources.includes(source)) existing.sources.push(source);
    dupCount++;
  } else {
    seen.set(key, { url, sources: [source] });
  }
}

// ─────────────────────────────────────────────
// BUILD ASSET LIST
// ─────────────────────────────────────────────

const assets: AssetEntry[] = [...seen.values()].map(({ url, sources }) => ({
  url,
  type:      classifyUrl(url),
  extension: getExtension(url),
  filename:  getFilename(url),
  sources,
  width:     null,
  height:    null,
}));

if (assets.length === 0) {
  process.stderr.write('⚠ Warning: No URLs found in the provided sources.\n');
  process.stderr.write('  (FramerExport embeds assets locally — this is normal for local exports.)\n');
  process.exit(0);
}

// ─────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────

const images = assets.filter(a => a.type === 'image').length;
const videos = assets.filter(a => a.type === 'video').length;
const svgs   = assets.filter(a => a.type === 'svg').length;
const others = assets.filter(a => a.type === 'other').length;

const manifest: ImageManifest = {
  source:             sourcesUsed.join(', '),
  extracted_at:       new Date().toISOString(),
  total_urls:         totalUrls,
  unique_urls:        assets.length,
  duplicates_removed: dupCount,
  assets,
  summary: {
    images,
    videos,
    svg:                   svgs,
    other:                 others,
    total_size_estimate_mb: null,
  },
};

// ─────────────────────────────────────────────
// OUTPUT
// ─────────────────────────────────────────────

const outputStr = JSON.stringify(manifest, null, 2);

if (outputPath) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, outputStr, 'utf8');
  process.stderr.write(`Saved to ${outputPath}\n`);
} else {
  process.stdout.write(outputStr + '\n');
}

process.stderr.write(`✓ ${assets.length} unique URLs extracted (${images} images, ${videos} videos, ${svgs} SVGs, ${others} other)\n`);
if (dupCount > 0) process.stderr.write(`⚠ ${dupCount} duplicate references removed\n`);

process.exit(0);
