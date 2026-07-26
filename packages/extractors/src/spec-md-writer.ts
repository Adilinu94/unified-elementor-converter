/**
 * Spec-Markdown-Writer — P1-3
 *
 * Generates human-readable Markdown alongside spec.json for code review,
 * client handover, and debugging.
 *
 * Outputs (all inside outputDir/spec-md/):
 *   spec-overview.md              — full page table + design tokens
 *   section-01-hero.spec.md       — per-section widget table + notes + tokens
 *   section-02-features.spec.md
 *   ...
 *
 * Pure rendering functions (renderOverviewMd, renderSectionMd) contain no
 * filesystem I/O, so they can be unit-tested without disk access.
 * writeSpecMarkdown() is the only async function and just calls them + fs.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PageSpec, SectionSpec, WidgetSpec, TokenRef } from './spec-schema.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write one spec-overview.md + one .spec.md per section.
 * Files go into `outputDir/spec-md/` (created if absent).
 * Returns the list of written file paths.
 */
export async function writeSpecMarkdown(
  spec: PageSpec,
  outputDir: string,
): Promise<string[]> {
  const mdDir = path.join(outputDir, 'spec-md');
  await fs.mkdir(mdDir, { recursive: true });

  const written: string[] = [];

  // overview
  const overviewPath = path.join(mdDir, 'spec-overview.md');
  await fs.writeFile(overviewPath, renderOverviewMd(spec), 'utf-8');
  written.push(overviewPath);

  // per-section
  spec.sections.forEach((section, i) => {
    const filename = sectionFilename(i, section.kind);
    const filepath = path.join(mdDir, filename);
    // We queue writes — collect the promises, but return paths immediately
    written.push(filepath);
  });

  // Actually write section files (fire all concurrently after paths are collected)
  await Promise.all(
    spec.sections.map((section, i) => {
      const filename = sectionFilename(i, section.kind);
      const filepath = path.join(mdDir, filename);
      return fs.writeFile(filepath, renderSectionMd(section, i + 1, spec.sourceUrl), 'utf-8');
    }),
  );

  return written;
}

// ---------------------------------------------------------------------------
// Pure renderers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Render the spec-overview.md: page table + design tokens.
 */
export function renderOverviewMd(spec: PageSpec): string {
  const url = spec.sourceUrl;
  const host = safeHostname(url);
  const date = spec.extractedAt.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# Page Spec — ${host}`);
  lines.push('');
  lines.push(`**Source:** ${url}  `);
  lines.push(`**Extracted:** ${date}  `);
  lines.push(
    `**Sections:** ${spec.sectionCount} | **Header:** ${spec.hasHeader ? 'yes' : 'no'} | **Footer:** ${spec.hasFooter ? 'yes' : 'no'}  `,
  );
  if (spec.sourceFramework) {
    lines.push(`**Framework:** ${spec.sourceFramework}  `);
  }
  lines.push('');

  // Section table
  lines.push('## Sections');
  lines.push('');
  lines.push('| # | File | Kind | Selector | Y-range | Widgets |');
  lines.push('|---|------|------|----------|---------|---------|');
  spec.sections.forEach((s, i) => {
    const idx = i + 1;
    const file = sectionFilename(i, s.kind);
    const yr = s.y_range ? `${s.y_range[0]}–${s.y_range[1]} px` : '?–? px';
    const sel = inlineCode(s.selector);
    lines.push(`| ${idx} | [${file}](./${file}) | ${s.kind} | ${sel} | ${yr} | ${s.widgets.length} |`);
  });
  lines.push('');

  // Asset summary
  lines.push('## Assets');
  lines.push('');
  lines.push(`| Images | SVGs | Fonts | Favicons |`);
  lines.push(`|--------|------|-------|----------|`);
  const a = spec.assetSummary;
  lines.push(`| ${a.images} | ${a.svgs} | ${a.fonts} | ${a.favicons} |`);
  lines.push('');

  // Design tokens
  const t = spec.tokens;
  const hasTokens =
    Object.keys(t.colors).length > 0 ||
    Object.keys(t.fonts).length > 0 ||
    Object.keys(t.spacing).length > 0;

  if (hasTokens) {
    lines.push('## Design Tokens');
    lines.push('');
    if (Object.keys(t.colors).length > 0) {
      lines.push('### Colors');
      for (const [k, v] of Object.entries(t.colors)) {
        lines.push(`- \`${k}\`: ${v}`);
      }
      lines.push('');
    }
    if (Object.keys(t.fonts).length > 0) {
      lines.push('### Fonts');
      for (const [k, v] of Object.entries(t.fonts)) {
        lines.push(`- \`${k}\`: ${v}`);
      }
      lines.push('');
    }
    if (Object.keys(t.spacing).length > 0) {
      lines.push('### Spacing');
      for (const [k, v] of Object.entries(t.spacing)) {
        lines.push(`- \`${k}\`: ${v}`);
      }
      lines.push('');
    }
    if (Object.keys(t.radii).length > 0) {
      lines.push('### Radii');
      for (const [k, v] of Object.entries(t.radii)) {
        lines.push(`- \`${k}\`: ${v}`);
      }
      lines.push('');
    }
  }

  // Warnings
  if (spec.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const w of spec.warnings) {
      lines.push(`- ⚠️ ${w}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render one section .spec.md: widget table + style + tokens + notes.
 *
 * @param section - SectionSpec from PageSpec.sections
 * @param index   - 1-based human index (shown in heading)
 * @param sourceUrl - Page URL (for context header)
 */
export function renderSectionMd(
  section: SectionSpec,
  index: number,
  sourceUrl: string,
): string {
  const lines: string[] = [];

  lines.push(`# Section ${index} — ${section.kind}`);
  lines.push('');
  lines.push(`**Source:** ${inlineCode(section.selector)}  `);
  lines.push(`**Page:** ${sourceUrl}  `);
  const yr = section.y_range
    ? `${section.y_range[0]}–${section.y_range[1]} px`
    : '?–? px';
  lines.push(`**Y-range:** ${yr}  `);
  lines.push(`**Kind:** ${section.kind}`);
  lines.push('');

  // Widgets table
  if (section.widgets.length > 0) {
    lines.push(`## Widgets (${section.widgets.length})`);
    lines.push('');
    lines.push('| # | Kind | Text | Asset | Href |');
    lines.push('|---|------|------|-------|------|');
    section.widgets.forEach((w, i) => {
      lines.push(widgetRow(i + 1, w));
    });
    lines.push('');
  } else {
    lines.push('## Widgets');
    lines.push('');
    lines.push('_No widgets detected._');
    lines.push('');
  }

  // Style overrides
  if (section.style && Object.keys(section.style).length > 0) {
    lines.push('## Style');
    lines.push('');
    lines.push('```css');
    for (const [prop, val] of Object.entries(section.style)) {
      lines.push(`${prop}: ${val};`);
    }
    lines.push('```');
    lines.push('');
  }

  // Section-level token refs
  if (section.tokens && Object.keys(section.tokens).length > 0) {
    lines.push('## Token References');
    lines.push('');
    lines.push('| Key | Token path | Fallback |');
    lines.push('|-----|-----------|----------|');
    for (const [key, ref] of Object.entries(section.tokens)) {
      lines.push(tokenRow(key, ref));
    }
    lines.push('');
  }

  // Notes
  if (section.notes && section.notes.length > 0) {
    lines.push('## Notes');
    lines.push('');
    for (const note of section.notes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sectionFilename(zeroIndex: number, kind: string): string {
  const n = String(zeroIndex + 1).padStart(2, '0');
  const safeKind = kind.replace(/[^a-z0-9-]/g, '-');
  return `section-${n}-${safeKind}.spec.md`;
}

function widgetRow(index: number, w: WidgetSpec): string {
  const text = w.text ? truncate(w.text, 50) : '—';
  const asset = w.asset ? inlineCode(path.basename(w.asset)) : '—';
  const href = w.href ? inlineCode(w.href) : '—';
  return `| ${index} | ${w.kind} | ${text} | ${asset} | ${href} |`;
}

function tokenRow(key: string, ref: TokenRef): string {
  return `| ${key} | \`${ref.path}\` | ${ref.fallback ?? '—'} |`;
}

function inlineCode(s: string): string {
  return `\`${s.replace(/`/g, "'")}\``;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
