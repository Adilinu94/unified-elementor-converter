#!/usr/bin/env node
/**
 * Automated Asset Queue with ID Feedback
 * 
 * Patcht den v4-tree.json direkt, um nackte Framer-Image-URLs durch die korrekte 
 * V4 image-src Struktur mit der hochgeladenen WordPress Media ID zu ersetzen.
 * Einhaltung von Invariant IV: Wenn 'id' gesetzt ist, wird der 'url'-Schlüssel weggelassen.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface ImageMapEntry {
  wp_media_id?: string | number;
  media_id?: string | number;
  id?: string | number;
  url?: string;
  filename?: string;
}

interface ImageMap {
  [key: string]: unknown;
  images?: Record<string, ImageMapEntry> | ImageMapEntry[];
  videos?: Record<string, ImageMapEntry>;
  assets?: ImageMapEntry[];
}

interface ImageSrcNode {
  '$$type'?: string;
  value?: {
    url?: string | { value?: string; url?: string };
    id?: { '$$type'?: string; value?: string | number };
  };
  id?: unknown;
  url?: unknown;
  _url?: unknown;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function unwrapUrl(urlValue: unknown): string | null {
  if (typeof urlValue === 'string') return urlValue;
  if (urlValue && typeof urlValue === 'object') {
    const obj = urlValue as Record<string, unknown>;
    return (obj.value as string) || (obj.url as string) || null;
  }
  return null;
}

function resolveMediaId(url: string | null, imageMap: ImageMap | null): string | number | null {
  if (!url || !imageMap) return null;
  const filename = url.split('/').pop()?.split('?')[0] || '';

  const rawCandidates: (string | number | ImageMapEntry | undefined)[] = [
    (imageMap as Record<string, unknown>)[url] as string | number | ImageMapEntry | undefined,
    imageMap.images && !Array.isArray(imageMap.images)
      ? imageMap.images[filename] as ImageMapEntry | undefined
      : undefined,
    imageMap.videos?.[filename] as ImageMapEntry | undefined,
  ];
  const candidates = rawCandidates.filter((c): c is string | number | ImageMapEntry => c != null);

  if (Array.isArray(imageMap.assets)) {
    for (const a of imageMap.assets) {
      if (a.url === url || a.filename === filename) candidates.push(a);
    }
  }
  if (Array.isArray(imageMap.images)) {
    for (const a of imageMap.images) {
      if (a.url === url || a.filename === filename) candidates.push(a);
    }
  }

  for (const entry of candidates) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as ImageMapEntry;
    const id = e.wp_media_id ?? e.media_id ?? e.id;
    if (id !== null && id !== undefined) return id;
  }
  return null;
}

function walkAndPatch(obj: unknown, imageMap: ImageMap): void {
  if (typeof obj !== 'object' || obj === null) return;

  const node = obj as Record<string, unknown>;

  if (node['$$type'] === 'image-src') {
    const value = node.value && typeof node.value === 'object' ? node.value as Record<string, unknown> : node;
    const urlValue = unwrapUrl(value.url);
    const wpMediaId = resolveMediaId(urlValue, imageMap);
    if (wpMediaId) {
      node.value = { id: { '$$type': 'image-attachment-id', value: wpMediaId } };
      delete node.id;
      delete node.url;
      delete node._url;
      return;
    }
  }

  for (const key in node) {
    if (Object.prototype.hasOwnProperty.call(node, key)) {
      walkAndPatch(node[key], imageMap);
    }
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const treePath = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'v4-tree.json');
  const mapPath = process.argv[3] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'image-map.json');
  const outputPath = process.argv[4] || treePath;

  if (!fs.existsSync(treePath)) {
    console.error(`❌ Tree nicht gefunden: ${treePath}`);
    process.exit(1);
  }
  if (!fs.existsSync(mapPath)) {
    console.error(`❌ Image-Map nicht gefunden: ${mapPath}. Führe zuerst den Media-Upload durch.`);
    process.exit(1);
  }

  console.log(`▶️  Lade Tree von: ${treePath}`);
  const tree = JSON.parse(fs.readFileSync(treePath, 'utf8'));

  console.log(`▶️  Lade Image-Map von: ${mapPath}`);
  const imageMap: ImageMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

  console.log('▶️  Patche v4-tree.json mit WordPress Media IDs...');
  walkAndPatch(tree, imageMap);

  fs.writeFileSync(outputPath, JSON.stringify(tree, null, 2), 'utf8');
  console.log(`✅ Tree erfolgreich gepatcht und gespeichert unter: ${outputPath}`);
}

main();
