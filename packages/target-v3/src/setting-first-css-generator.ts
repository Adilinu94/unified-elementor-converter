/**
 * Setting-First CSS Generator (#5)
 *
 * Solves the meta-problem: CSS is currently the source of truth. This generator
 * emits CSS ONLY for settings the render-compat table flags as non-rendering
 * under V4 — with a documented reason per rule. Result: minimal CSS footprint,
 * every rule justified, and the Elementor editor stays the primary source of
 * truth for everything that DOES render.
 *
 * Pipeline: V3 tree → validateV3Settings (render risks) → for each risk that has
 * a CSS fallback in the compat table, emit a scoped CSS rule + a manifest entry.
 *
 * @example
 * import { generateSettingFirstCss } from './setting-first-css-generator.js';
 * const { css, manifest } = generateSettingFirstCss(tree, { pageId: 4956 });
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateV3Settings, type RenderRiskReport, type SettingRisk } from './v3-setting-validator.js';
import type { V3Tree, V3Element } from './v3-tree-types.js';

interface CompatEntry {
  renders_reliably: boolean | string;
  fallback?: string;
  applies_to?: string[];
}

interface CompatDoc {
  settings: Record<string, CompatEntry>;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPAT_PATH = path.resolve(
  __dirname,
  '../../skills/framer-to-elementor-v3/references/v3-v4-render-compat.json',
);

let _compat: CompatDoc | null = null;
function loadCompat(): CompatDoc {
  if (_compat) return _compat;
  _compat = JSON.parse(readFileSync(COMPAT_PATH, 'utf8')) as CompatDoc;
  return _compat;
}

export interface CssManifestEntry {
  element_id: string;
  selector: string;
  setting: string;
  reason: string;
  css: string;
}

export interface CssGeneratorOptions {
  /** Page id for body.page-id-N guard. */
  pageId?: number;
  /** Include the validator report in the result. Default true. */
  includeReport?: boolean;
  /** Only emit CSS for settings flagged at this severity or higher. Default 'warning'. */
  minSeverity?: 'error' | 'warning' | 'info';
}

export interface CssGeneratorResult {
  css: string;
  manifest: CssManifestEntry[];
  report: RenderRiskReport | null;
  rulesEmitted: number;
}

/**
 * Generate CSS only for V3 settings that don't render reliably under V4.
 * Each rule is scoped to body.page-id-N .<section-class> and documented.
 */
export function generateSettingFirstCss(
  tree: V3Tree,
  opts: CssGeneratorOptions = {},
): CssGeneratorResult {
  const compat = loadCompat();
  const report = validateV3Settings(tree);
  const minSeverity = opts.minSeverity ?? 'warning';
  const severityRank = { error: 0, warning: 1, info: 2 };
  const minRank = severityRank[minSeverity];

  const manifest: CssManifestEntry[] = [];
  const rules: string[] = [];
  const guard = opts.pageId ? `body.page-id-${opts.pageId} ` : '';

  // Index elements by id for lookup
  const byId = new Map<string, V3Element>();
  for (const el of walk(tree)) {
    if (el.id) byId.set(el.id, el);
  }

  for (const risk of report.risks) {
    if (severityRank[risk.severity] > minRank) continue;
    const entry = compat.settings[risk.setting];
    if (!entry || !entry.fallback) continue;

    const el = byId.get(risk.element_id);
    if (!el) continue;

    const sectionClass = findSectionClass(el);
    const selector = buildSelector(el, sectionClass, guard);
    const css = emitCssForSetting(risk, el, entry, guard);
    if (!css) continue;

    manifest.push({
      element_id: risk.element_id,
      selector,
      setting: risk.setting,
      reason: risk.reason,
      css,
    });
    rules.push(css);
  }

  const css = rules.length
    ? `/* Setting-First CSS — emitted only for V3 settings that don't render under V4.\n   Each rule is documented in the manifest. Do NOT remove without verifying the\n   underlying Elementor setting renders. */\n${rules.join('\n')}\n`
    : '';

  return {
    css,
    manifest,
    report: opts.includeReport === false ? null : report,
    rulesEmitted: rules.length,
  };
}

function emitCssForSetting(
  risk: SettingRisk,
  el: V3Element,
  _entry: CompatEntry,
  guard: string,
): string | null {
  const s = el.settings ?? {};
  switch (risk.setting) {
    case 'typography_font_size': {
      const v = s.typography_font_size as { unit?: string; size?: number } | undefined;
      if (!v?.size) return null;
      const tag = (s.header_size as string) ?? 'h2';
      return `${guard}.${sectionClassOf(el)} ${tag}.elementor-heading-title { font-size: ${v.size}${v.unit ?? 'px'} !important; }`;
    }
    case 'typography_font_weight': {
      const v = s.typography_font_weight;
      if (!v) return null;
      const tag = (s.header_size as string) ?? 'h2';
      return `${guard}.${sectionClassOf(el)} ${tag}.elementor-heading-title { font-weight: ${v} !important; }`;
    }
    case 'typography_line_height': {
      const v = s.typography_line_height as { unit?: string; size?: number } | undefined;
      if (!v?.size) return null;
      const tag = (s.header_size as string) ?? 'h2';
      return `${guard}.${sectionClassOf(el)} ${tag}.elementor-heading-title { line-height: ${v.size}${v.unit ?? 'px'} !important; }`;
    }
    case 'typography_letter_spacing': {
      const v = s.typography_letter_spacing as { unit?: string; size?: number } | undefined;
      if (!v?.size) return null;
      const tag = (s.header_size as string) ?? 'h2';
      return `${guard}.${sectionClassOf(el)} ${tag}.elementor-heading-title { letter-spacing: ${v.size}${v.unit ?? 'px'} !important; }`;
    }
    case 'title_color':
    case 'text_color': {
      const v = risk.setting === 'title_color' ? s.title_color : s.text_color;
      if (!v) return null;
      const tag = (s.header_size as string) ?? 'p';
      return `${guard}.${sectionClassOf(el)} ${tag}.elementor-heading-title { color: ${v} !important; }`;
    }
    case 'background_image': {
      const v = s.background_image as { url?: string } | undefined;
      if (!v?.url) return null;
      const overlay = s.background_overlay ? '' : '';
      return [
        `${guard}.${sectionClassOf(el)} { background-image: url('${v.url}') !important; background-size: cover !important; background-position: center !important; }`,
        overlay,
      ].filter(Boolean).join('\n');
    }
    case 'background_overlay': {
      // Emit ::before overlay
      const color = (s.background_overlay_color as string) ?? 'rgba(0,0,0,0.4)';
      return `${guard}.${sectionClassOf(el)}::before { content:''; position:absolute; inset:0; background:${color}; z-index:1; pointer-events:none; }\n${guard}.${sectionClassOf(el)} > .e-con, ${guard}.${sectionClassOf(el)} .elementor-widget { position:relative; z-index:2; }`;
    }
    case 'css_classes': {
      // Widget css_classes — no CSS needed, just a warning. Skip.
      return null;
    }
    case '_element_width':
    case '_element_custom_width': {
      const v = s._element_custom_width as { unit?: string; size?: number } | undefined;
      if (!v?.size) return null;
      return `${guard}.${sectionClassOf(el)} > .e-con { flex: 0 0 ${v.size}${v.unit ?? 'px'} !important; width: ${v.size}${v.unit ?? 'px'} !important; }`;
    }
    default:
      return null;
  }
}

function buildSelector(el: V3Element, sectionClass: string | null, guard: string): string {
  const cls = sectionClass ?? sectionClassOf(el) ?? 'elementor-element';
  return `${guard}.${cls}`;
}

function findSectionClass(el: V3Element): string | null {
  // Walk up to find the nearest container with a css_classes
  // (simplified: returns the element's own section class)
  return sectionClassOf(el);
}

function sectionClassOf(el: V3Element): string | null {
  const cls = el.settings?.css_classes;
  if (typeof cls === 'string' && cls.length) return cls.split(/\s+/)[0];
  return null;
}

function* walk(tree: V3Tree): Generator<V3Element> {
  for (const el of tree) yield* walkEl(el);
}

function* walkEl(el: V3Element): Generator<V3Element> {
  yield el;
  if (el.elements) for (const c of el.elements) yield* walkEl(c);
}

/** Format a CssManifest as a human-readable table. */
export function formatCssManifest(manifest: CssManifestEntry[]): string {
  const lines = [`Setting-First CSS Manifest: ${manifest.length} rules`];
  for (const m of manifest) {
    lines.push(`  #${m.element_id} (${m.setting})`);
    lines.push(`    reason: ${m.reason}`);
    lines.push(`    css:   ${m.css.slice(0, 120)}`);
  }
  return lines.join('\n');
}
