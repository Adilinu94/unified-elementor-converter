#!/usr/bin/env node
/**
 * resolve-fonts.ts  —  Phase 0.7: Font Resolution
 * Löst Framer Font-Prefixes auf, mappt sie auf lokale .woff2-Dateien,
 * generiert Google Fonts Fallback-URLs für fehlende Fonts.
 *
 * Usage:
 *   node --import tsx scripts/resolve-fonts.ts \
 *     --html   FramerExport/framer-passionate-papaya-042575/index.html \
 *     --fonts-dir FramerExport/framer-passionate-papaya-042575/assets/fonts/ \
 *     --mcp-json  FramerExport/tokens/mcp-colors.json \
 *     --output    FramerExport/tokens/font-resolution.json
 */

import fs   from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  parseFramerPrefix, generateGoogleFontsUrl, expectedFontFilenames, WEIGHT_NAME_MAP,
} from './lib/framer-utils.js';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface FontFace {
  family: string;
  weight: string;
  style: string;
  srcUrl: string | null;
}

interface FontEntry {
  family: string;
  weight: string;
  style: string;
  framerPrefix: string;
  localFile: string | null;
  localPath: string | null;
  status: 'RESOLVED' | 'MISSING';
  action: string | null;
}

interface FontSummary {
  resolvedCount: number;
  missingCount: number;
  missingFonts: Array<{ family: string; weight: string; googleFontsUrl: string }>;
}

interface FontResult {
  meta: { totalFonts: number; resolved: number; missing: number };
  fonts: FontEntry[];
  summary: FontSummary;
}

interface ParsedFont {
  family: string;
  weight: string;
}

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    html:        { type: 'string'  },
    'fonts-dir': { type: 'string'  },
    'mcp-json':  { type: 'string'  },
    output:      { type: 'string'  },
    verbose:     { type: 'boolean', default: false },
  },
  strict: false,
});

const htmlPath: string | undefined = args.html as string | undefined;
const fontsDir: string | null = (args['fonts-dir'] as string) || null;
const mcpJsonPath: string | undefined = args['mcp-json'] as string | undefined;
const outputPath: string | undefined = args.output as string | undefined;

// Help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node --import tsx scripts/resolve-fonts.ts [--help for options]');
  console.log('Run with --help for full usage.');
  process.exit(0);
}

const log = (...m: string[]) => {
  if (args.verbose) process.stderr.write('[verbose] ' + m.join(' ') + '\n');
};

if (!htmlPath && !mcpJsonPath) {
  process.stderr.write('Error: --html oder --mcp-json erforderlich\n');
  process.exit(2);
}

// ─────────────────────────────────────────────
// CSS PARSING — @font-face blocks
// ─────────────────────────────────────────────

function extractFontFaces(html: string): FontFace[] {
  const faces: FontFace[] = [];
  // Strip <style> tags to get CSS content, or scan the full file
  const blockRe = /@font-face\s*\{([^}]+)\}/gi;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(html)) !== null) {
    const inner   = block[1];
    const familyM = inner.match(/font-family\s*:\s*['"]?([^;'"]+)['"]?/i);
    const weightM = inner.match(/font-weight\s*:\s*([^;]+)/i);
    const styleM  = inner.match(/font-style\s*:\s*([^;]+)/i);
    const srcM    = inner.match(/src\s*:[^;]*url\(['"]?([^'")\s]+)['"]?\)/i);
    if (!familyM) continue;
    const weight = (weightM ? weightM[1] : '400').trim();
    faces.push({
      family: familyM[1].trim(),
      weight: /^\d+$/.test(weight) ? weight : (WEIGHT_NAME_MAP[weight] ?? '400'),
      style:  (styleM ? styleM[1] : 'normal').trim(),
      srcUrl: srcM ? srcM[1].trim() : null,
    });
  }
  // Deduplicate by family+weight
  const seen = new Map<string, FontFace>();
  for (const f of faces) {
    const key = `${f.family}::${f.weight}`;
    if (!seen.has(key)) seen.set(key, f);
  }
  return [...seen.values()];
}

// ─────────────────────────────────────────────
// FONT FILE LOOKUP
// ─────────────────────────────────────────────

function scanFontsDir(dir: string | null): string[] {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /\.(woff2?|ttf|otf)$/i.test(f));
}

function findLocalFile(family: string, weight: string, fontFiles: string[]): string | null {
  const candidates = expectedFontFilenames(family, weight);
  for (const c of candidates) {
    const match = fontFiles.find(f => f.toLowerCase() === c.toLowerCase());
    if (match) return match;
  }
  return null;
}

function toFramerPrefix(family: string, weight: string): string {
  const fc = family.replace(/\s+/g, '');
  const wn = WEIGHT_NAME_MAP[weight] || weight;
  return `FR;${fc}-${wn}`;
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

const fontFiles = scanFontsDir(fontsDir);
log(`Font files in directory: ${fontFiles.length}`);

const entries = new Map<string, FontEntry>(); // `Family::weight` → entry

// ── Source A: HTML @font-face declarations ──
if (htmlPath) {
  if (!fs.existsSync(htmlPath)) {
    process.stderr.write(`Error: HTML nicht gefunden: ${htmlPath}\n`); process.exit(2);
  }
  const html  = fs.readFileSync(htmlPath, 'utf8');
  const faces = extractFontFaces(html);
  log(`@font-face blocks: ${faces.length}`);
  for (const f of faces) {
    const key  = `${f.family}::${f.weight}`;
    const file = findLocalFile(f.family, f.weight, fontFiles);
    const gfUrl = generateGoogleFontsUrl(f.family, f.weight);
    entries.set(key, {
      family:       f.family,
      weight:       f.weight,
      style:        f.style,
      framerPrefix: toFramerPrefix(f.family, f.weight),
      localFile:    file ?? null,
      localPath:    file && fontsDir ? `./${path.relative(process.cwd(), path.join(fontsDir, file)).replace(/\\/g, '/')}` : null,
      status:       file ? 'RESOLVED' : 'MISSING',
      action:       file ? null : `Download from Google Fonts: ${gfUrl}`,
    });
  }
}

// ── Source B: MCP JSON fonts ──
if (mcpJsonPath) {
  if (!fs.existsSync(mcpJsonPath)) {
    process.stderr.write(`Error: MCP JSON nicht gefunden: ${mcpJsonPath}\n`); process.exit(2);
  }
  const mcp = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8'));
  for (const f of (mcp.fonts || []) as Array<{ font?: string; name?: string }>) {
    const prefix = f.font || f.name || '';
    const parsed: ParsedFont = parseFramerPrefix(prefix);
    const key = `${parsed.family}::${parsed.weight}`;

    if (entries.has(key)) {
      // Override framerPrefix with the actual MCP value if more specific
      if (prefix) entries.get(key)!.framerPrefix = prefix;
      log(`MCP confirms existing font: ${key}`);
    } else {
      const file  = findLocalFile(parsed.family, parsed.weight, fontFiles);
      const gfUrl = generateGoogleFontsUrl(parsed.family, parsed.weight);
      entries.set(key, {
        family:       parsed.family,
        weight:       parsed.weight,
        style:        'normal',
        framerPrefix: prefix,
        localFile:    file ?? null,
        localPath:    file && fontsDir ? `./${path.relative(process.cwd(), path.join(fontsDir, file)).replace(/\\/g, '/')}` : null,
        status:       file ? 'RESOLVED' : 'MISSING',
        action:       file ? null : `Download from Google Fonts: ${gfUrl}`,
      });
      log(`MCP added font: ${parsed.family} ${parsed.weight}`);
    }
  }
}

if (entries.size === 0) {
  process.stderr.write('⚠ Warning: Keine Fonts gefunden. HTML könnte keine @font-face enthalten.\n');
  process.exit(0);
}

const fonts    = [...entries.values()];
const resolved = fonts.filter(f => f.status === 'RESOLVED');
const missing  = fonts.filter(f => f.status === 'MISSING');

const result: FontResult = {
  meta: { totalFonts: fonts.length, resolved: resolved.length, missing: missing.length },
  fonts,
  summary: {
    resolvedCount: resolved.length,
    missingCount:  missing.length,
    missingFonts:  missing.map(f => ({
      family:         f.family,
      weight:         f.weight,
      googleFontsUrl: generateGoogleFontsUrl(f.family, f.weight),
    })),
  },
};

// ─────────────────────────────────────────────
// OUTPUT
// ─────────────────────────────────────────────

const outputStr = JSON.stringify(result, null, 2);
if (outputPath) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, outputStr, 'utf8');
  process.stderr.write(`Saved to ${outputPath}\n`);
} else {
  process.stdout.write(outputStr + '\n');
}

process.stderr.write(`✓ ${resolved.length} fonts resolved, ${missing.length} missing\n`);
if (missing.length > 0) {
  for (const f of missing) process.stderr.write(`  ✗ ${f.family} ${f.weight} — ${f.action}\n`);
}

process.exit(0);
// NB: missing fonts produce stderr warnings but exit 0 — the font plan
//     includes Google Fonts URLs for download; this is not a pipeline error.
