/**
 * Section-Picker — Phase 3 Sprint 3E + Modul A2 + Modul P1
 * Orchestrates the section selection and classification process.
 *
 * Portiert aus site-clone-to-v3/src/classifier/section-picker.ts (Phase 45).
 * Anpassung: sharp ist optionale Dependency — Vision-Crop wird übersprungen wenn nicht verfügbar.
 */
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { SectionInfo, ComputedStyleSnapshot, DesignTokens } from '@elconv/core';
import type { AIRouter } from '@elconv/core';
import { runSectionClassification } from '@elconv/core';
import { classifySection } from './style-classifier.js';
import { detectComponentMultiLayer } from './component-detector.js';
import { mapElementsToWidgets } from './widget-mapper.js';
import { resolveColorToken, resolveFontRole } from './token-resolver.js';
import { buildResponsiveSettings } from './responsive-settings.js';
import type {
  PickerDecision,
  SectionSpec,
  SelectedSections,
  V3Column,
  V3LayoutPattern,
  V3Section,
  V3Widget,
} from './types.js';

const AUTO_SKIP_SELECTORS = [
  'cookie', 'consent', 'gdpr', 'banner-cookie', 'modal', 'overlay',
  'popup', 'chat-widget', 'newsletter-modal', 'subscribe-modal',
];

const AUTO_SKIP_TAGS = new Set(['script', 'style', 'noscript', 'iframe']);

export interface ClassifyAllInput {
  url: string;
  outputDir: string;
  sections: SectionInfo[];
  computedStyles: Record<string, ComputedStyleSnapshot[]>;
  designTokens?: DesignTokens;
  cssVars?: Record<string, string>;
  interactive?: boolean;
  autoApprove?: boolean;
  pageScreenshotPath?: string;
  visionRouter?: AIRouter;
  domConfidenceThreshold?: number;
}

export interface ClassifyAllResult {
  specs: SectionSpec[];
  selectedManifest: SelectedSections;
}

export type ClassifyResult = ClassifyAllResult;

/**
 * Classify all sections and write per-section spec files.
 */
export async function classifyAll(input: ClassifyAllInput): Promise<ClassifyAllResult> {
  const specs: SectionSpec[] = [];
  const decisions: PickerDecision[] = [];

  const sectionsDir = path.join(input.outputDir, 'sections');
  await mkdir(sectionsDir, { recursive: true });

  for (let i = 0; i < input.sections.length; i++) {
    const section = input.sections[i];
    const allSnapshots = input.computedStyles.desktop ?? [];
    const scoped = allSnapshots.filter(
      (s) => s.selector === section.selector || s.selector.startsWith(`${section.selector} >`),
    );

    let pattern = classifySection(
      { selector: section.selector, tag: section.tag ?? 'section', styles: scoped[0]?.styles ?? {}, yRange: section.y_range },
      scoped.map((s) => ({ selector: s.selector, tag: s.tag, styles: s.styles })),
    );
    if (pattern === 'content') {
      pattern = (await enhanceWithStructure(section, scoped)) ?? pattern;
    }
    const decision = makeAutoDecision(section, pattern, input.autoApprove);
    decisions.push(decision);

    if (decision.decision === 'skip') continue;

    const spec = buildSpec(section, pattern, scoped, input.designTokens, input.cssVars);
    spec.source.url = input.url;

    if (input.pageScreenshotPath && input.visionRouter) {
      await enhanceWithVision(spec, section, pattern, input.pageScreenshotPath, input.visionRouter, input.domConfidenceThreshold);
    }

    specs.push(spec);

    const filename = `${String(i + 1).padStart(2, '0')}-${section.section_id}.spec.json`;
    await writeFile(path.join(sectionsDir, filename), JSON.stringify(spec, null, 2), 'utf-8');
  }

  const selectedManifest: SelectedSections = {
    url: input.url,
    extracted_at: new Date().toISOString(),
    decisions,
    approved_count: decisions.filter((d) => d.decision === 'approve').length,
    skipped_count: decisions.filter((d) => d.decision === 'skip').length,
  };

  await writeFile(
    path.join(input.outputDir, 'selected-sections.json'),
    JSON.stringify(selectedManifest, null, 2),
    'utf-8',
  );

  return { specs, selectedManifest };
}

// ─── Modul A2: Structure Enhancement ─────────────────────────────────────────

const STRUCTURE_TYPE_MAP: Partial<Record<string, V3LayoutPattern>> = {
  'card-grid': 'card-grid',
  'feature-list': 'feature-list',
  'stat-row': 'stat-row',
  'logo-grid': 'logo-grid',
};

async function enhanceWithStructure(
  section: SectionInfo,
  snapshots: ComputedStyleSnapshot[],
): Promise<V3LayoutPattern | null> {
  if (snapshots[0]?.selector !== section.selector) return null;
  const result = await detectComponentMultiLayer({ section, snapshots });
  return STRUCTURE_TYPE_MAP[result.type] ?? null;
}

export interface DomConfidenceInput {
  pattern: V3LayoutPattern;
  selector: string;
  tag?: string;
  styles: Record<string, string>;
  childCount: number;
  yRange?: [number, number];
  hasHeadingChild?: boolean;
  hasImageChild?: boolean;
  isMultiCol?: boolean;
}

export function computeDomConfidence(input: DomConfidenceInput): number {
  let score = input.pattern === 'content' ? 0.35 : 0.75;
  if (input.pattern !== 'content') score += 0.12;
  if (input.hasHeadingChild) score += 0.08;
  if (input.hasImageChild && input.pattern === 'image-text-sbs') score += 0.06;
  if (input.isMultiCol && (input.pattern === 'card-grid' || input.pattern === 'pricing')) score += 0.06;
  const height = input.yRange ? input.yRange[1] - input.yRange[0] : 0;
  if (input.pattern === 'hero' && height > 500) score += 0.05;
  if (input.pattern === 'content' && (input.childCount <= 1 || (!input.hasHeadingChild && !input.hasImageChild))) score -= 0.12;
  if (/^(section|header|footer|main)$/.test(input.tag ?? '')) score += 0.04;
  if (input.selector.includes('>') && input.selector.split('>').length > 3) score -= 0.05;
  return Math.max(0, Math.min(1, score));
}

function estimateDomConfidence(pattern: V3LayoutPattern): number {
  return computeDomConfidence({ pattern, selector: '', styles: {}, childCount: 0 });
}

async function cropSectionForVision(pageScreenshotPath: string, section: SectionInfo): Promise<string | null> {
  let sharp: typeof import('sharp');
  try {
    sharp = (await import('sharp')).default;
  } catch {
    return null;
  }
  const [yTop, yBottom] = section.y_range;
  const tempPath = path.join(os.tmpdir(), `section-picker-${section.section_id}-${Date.now()}.png`);
  const image = sharp(pageScreenshotPath);
  const metadata = await image.metadata();
  const width = metadata.width ?? 1440;
  await image
    .extract({ left: 0, top: Math.max(0, yTop), width, height: Math.max(1, yBottom - yTop) })
    .toFile(tempPath);
  return tempPath;
}

async function enhanceWithVision(
  spec: SectionSpec,
  section: SectionInfo,
  pattern: V3LayoutPattern,
  pageScreenshotPath: string,
  router: AIRouter,
  threshold = 0.6,
): Promise<void> {
  if (router.isBreakerOpen?.()) return;
  const domConfidence = estimateDomConfidence(pattern);
  if (domConfidence >= threshold) return;

  const croppedPath = await cropSectionForVision(pageScreenshotPath, section);
  if (!croppedPath) return;
  try {
    const { value, confidence } = await runSectionClassification(router, croppedPath);
    spec.semanticType = value.type;
    spec.layoutDescription = value.layoutDescription;
    spec.visionConfidence = confidence;
  } finally {
    await unlink(croppedPath).catch(() => {});
  }
}

// ─── Decision + Spec Building ────────────────────────────────────────────────

function makeAutoDecision(section: SectionInfo, pattern: V3LayoutPattern, autoApprove?: boolean): PickerDecision {
  if (section.tag && AUTO_SKIP_TAGS.has(section.tag)) {
    return { section_id: section.section_id, decision: 'skip', notes: `auto-skip: tag=${section.tag}` };
  }
  if (AUTO_SKIP_SELECTORS.some((s) => (section.selector + ' ' + (section.id ?? '')).toLowerCase().includes(s))) {
    return { section_id: section.section_id, decision: 'skip', notes: 'auto-skip: non-content selector' };
  }
  if (autoApprove === false) {
    return { section_id: section.section_id, decision: 'review' };
  }
  return { section_id: section.section_id, decision: 'approve', reviewed_at: new Date().toISOString(), notes: `auto-approve: pattern=${pattern}` };
}

function buildSpec(
  section: SectionInfo,
  pattern: V3LayoutPattern,
  snapshots: ComputedStyleSnapshot[],
  tokens: DesignTokens | undefined,
  cssVars: Record<string, string> | undefined,
): SectionSpec {
  const sectionSnap = snapshots.find((s) => s.selector === section.selector);
  const children = snapshots.filter((s) => s.selector.startsWith(`${section.selector} >`));

  const v3Columns = mapToColumns(pattern, children, tokens, cssVars);
  const v3Section: V3Section = {
    pattern,
    columns: v3Columns,
    settings: sectionSnap ? buildResponsiveSettings({ desktop: sectionSnap.styles }) : {},
    animations: [],
  };

  const settings_provenance: SectionSpec['settings_provenance'] = {};
  if (sectionSnap) {
    for (const [prop, value] of Object.entries(sectionSnap.styles)) {
      const token = tokens && prop.includes('color') ? resolveColorToken(value, tokens, { cssVars }) : null;
      settings_provenance[prop] = token
        ? { source: 'design-token', value, token_name: token.token_name }
        : { source: 'computed-style', value };
    }
  }

  return {
    $schema: 'https://unified-elementor-converter.local/schemas/section-spec.v1.json',
    section_id: section.section_id,
    source: { url: '', selector: section.selector, y_range: section.y_range },
    pattern,
    v3_section: v3Section,
    settings_provenance,
    assets_required: [],
    animations_required: [],
    user_overrides: {},
  };
}

function mapToColumns(
  pattern: V3LayoutPattern,
  children: ComputedStyleSnapshot[],
  tokens: DesignTokens | undefined,
  cssVars: Record<string, string> | undefined,
): V3Column[] {
  switch (pattern) {
    case 'hero':
    case 'content':
    case 'sticky-header':
    case 'footer':
    case 'feature-list':
    case 'stat-row':
    case 'logo-grid':
      return [{ width: '100%', widgets: children.map((c) => mapChildToWidget(c, tokens, cssVars)) }];
    case 'image-text-sbs':
      return distributeSbs(children).map((group) => ({
        width: '50%',
        widgets: group.map((c) => mapChildToWidget(c, tokens, cssVars)),
      }));
    case 'card-grid': {
      const sectionSnap = children[0]?.styles ?? {};
      const cols = detectGridColumns(children.length, sectionSnap);
      const perCol = Math.ceil(children.length / cols);
      const out: V3Column[] = [];
      for (let i = 0; i < cols; i++) {
        out.push({
          width: `${Math.floor((100 / cols) * 100) / 100}%`,
          widgets: children.slice(i * perCol, (i + 1) * perCol).map((c) => mapChildToWidget(c, tokens, cssVars)),
        });
      }
      return out;
    }
    default:
      return [{ width: '100%', widgets: [] }];
  }
}

function mapChildToWidget(snap: ComputedStyleSnapshot, tokens: DesignTokens | undefined, cssVars: Record<string, string> | undefined): V3Widget {
  const widget = mapElementsToWidgets([{ tag: snap.tag, selector: snap.selector, styles: snap.styles }])[0];

  if (tokens && widget.settings) {
    for (const key of Object.keys(widget.settings)) {
      if (key.endsWith('_color') || key === 'background_color' || key === 'title_color' || key === 'text_color') {
        const v = widget.settings[key];
        if (typeof v === 'string') {
          const resolved = resolveColorToken(v, tokens, { cssVars });
          if (resolved) widget.settings[`__${key}_token`] = resolved.v3_id;
        }
      }
    }
    const ff = snap.styles['font-family'];
    if (ff) {
      const role = resolveFontRole(ff, tokens);
      if (role) widget.settings['__typography_role'] = role.v3_id;
    }
  }

  return { type: widget.type, source_selector: widget.source_selector, source_tag: widget.source_tag, content: widget.content, settings: widget.settings };
}

function distributeSbs(children: ComputedStyleSnapshot[]): ComputedStyleSnapshot[][] {
  const media = children.filter((c) => /img|picture|video|svg/.test(c.tag));
  const text = children.filter((c) => !/img|picture|video|svg/.test(c.tag));
  return [media, text];
}

function detectGridColumns(childCount: number, styles: Record<string, string>): number {
  const gridCols = styles['grid-template-columns'];
  if (gridCols) {
    const repeatMatch = gridCols.match(/repeat\(\s*(\d+)\s*,/);
    if (repeatMatch) return parseInt(repeatMatch[1], 10);
    return gridCols.trim().split(/\s+/).length || 1;
  }
  if (childCount >= 6) return 3;
  if (childCount >= 4) return 2;
  return 1;
}

/**
 * Print interactive Section-Picker table (used when --interactive).
 */
export function printPickerTable(sections: SectionInfo[]): void {
  console.log(`\n[section-picker] Detected ${sections.length} sections:\n`);
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const tag = `[${i + 1}]`.padEnd(5);
    const id = (s.section_id ?? 'unnamed').padEnd(20);
    const yRange = `${s.y_range[0]}-${s.y_range[1]}`.padEnd(15);
    const sel = s.selector.padEnd(40);
    console.log(`${tag}${id} ${yRange} ${sel}`);
  }
  console.log('\n[A] Approve all  [S] Skip all  [C] Custom toggle  [Q] Quit');
}
