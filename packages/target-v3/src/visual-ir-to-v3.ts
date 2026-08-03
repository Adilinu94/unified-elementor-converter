/**
 * VisualPageIR -> Elementor V3 emitter.
 *
 * This is the generic target path. The legacy Framer XML mapper remains
 * available for compatibility, but new source adapters should emit VisualPageIR
 * and cross this target-neutral boundary before building a V3 tree.
 */

import type {
  FidelityDecisionRecord,
  VisualNodeIR,
  VisualPageIR,
  VisualSectionIR,
} from '@elconv/core';
import { canContinueWithFidelityDecisions, validateVisualPageIR } from '@elconv/core';
import type { V3Element } from './types.js';

export interface VisualIrToV3Options {
  assetUrlMap?: Record<string, string>;
  maxContainerDepth?: number;
}

export interface VisualIrToV3Result {
  tree: V3Element[];
  decisions: FidelityDecisionRecord[];
  warnings: string[];
  sourceSectionIds: string[];
  blocked: boolean;
  canContinue: boolean;
}

const DEFAULT_MAX_CONTAINER_DEPTH = 3;
const RESPONSIVE_BREAKPOINTS = new Set(['tablet', 'mobile']);

/** Emit a validated VisualPageIR as classic Elementor V3 sections/widgets. */
export function emitVisualIrToV3(
  ir: VisualPageIR,
  options: VisualIrToV3Options = {},
): VisualIrToV3Result {
  const validation = validateVisualPageIR(ir);
  if (!validation.valid) {
    throw new Error(`VisualPageIR validation failed: ${validation.errors.join('; ')}`);
  }

  const decisions: FidelityDecisionRecord[] = [];
  const warnings = [...validation.warnings];
  const usedIds = new Set<string>();
  const maxContainerDepth = Math.max(0, Math.floor(options.maxContainerDepth ?? DEFAULT_MAX_CONTAINER_DEPTH));
  const assetUrls = new Map(
    ir.assets
      .map((asset) => [asset.id, options.assetUrlMap?.[asset.id] ?? asset.localPath ?? asset.sourceUrl] as const)
      .filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string' && entry[1].length > 0),
  );

  function allocateId(sourceId: string, suffix = ''): string {
    const base = `ir_${safeCssId(sourceId)}${suffix}`;
    let id = base;
    let index = 2;
    while (usedIds.has(id)) id = `${base}_${index++}`;
    usedIds.add(id);
    return id;
  }

  function addDecision(
    node: VisualNodeIR | VisualSectionIR,
    decision: FidelityDecisionRecord['decision'],
    capability: string,
    severity: FidelityDecisionRecord['severity'] = 'info',
    blocking = false,
    lostBehavior?: string[],
  ): void {
    decisions.push({
      sourceId: node.sourceId,
      code: `${decision.toUpperCase().replace(/-/g, '_')}_${capability.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
      scope: 'nodes' in node ? 'section' : 'node',
      decision,
      capability,
      evidenceIds: node.evidence.sourceIds,
      confidence: node.evidence.confidence,
      severity,
      ...(lostBehavior ? { lostBehavior } : {}),
      approval: blocking ? 'pending' : 'not-required',
      blocking,
      qaChecks: ['v3-guards', 'section-visual-diff'],
    });
  }

  function normalizeSettingValue(key: string, value: unknown): unknown {
    if (typeof value !== 'string') return value;
    if (['padding', 'margin', 'border_radius'].includes(key)) return toBox(value);
    if (['typography_font_size', 'typography_line_height', 'width', 'min_height'].includes(key)) return toDimension(value);
    return value;
  }

  function responsiveSettings(node: VisualNodeIR | VisualSectionIR): Record<string, unknown> {
    const settings: Record<string, unknown> = {};
    for (const [breakpoint, overrides] of Object.entries(node.responsiveOverrides ?? {})) {
      if (!RESPONSIVE_BREAKPOINTS.has(breakpoint)) {
        warnings.push(`${node.sourceId}: unsupported responsive breakpoint ${breakpoint}`);
        continue;
      }
      for (const [rawKey, value] of Object.entries(overrides)) {
        const key = toV3SettingKey(rawKey, node);
        if (!key) {
          warnings.push(`${node.sourceId}: unsupported responsive property ${rawKey}`);
          continue;
        }
        settings[`${breakpoint}_${key}`] = normalizeSettingValue(key, value);
      }
    }
    return settings;
  }

  function styleSettings(node: VisualNodeIR | VisualSectionIR): Record<string, unknown> {
    const styles = node.styles ?? {};
    const settings: Record<string, unknown> = { ...responsiveSettings(node) };
    for (const [rawKey, value] of Object.entries(styles)) {
      const key = toV3SettingKey(rawKey, node);
      if (!key) {
        warnings.push(`${node.sourceId}: unsupported style property ${rawKey}`);
        continue;
      }
      settings[key] = normalizeSettingValue(key, value);
      if (key.startsWith('typography_') && key !== 'typography_font_family') {
        settings.typography_typography = 'custom';
      }
    }
    return settings;
  }

  function emitNode(node: VisualNodeIR, depth: number): V3Element[] {
    const id = allocateId(node.sourceId);
    const settings = { ...styleSettings(node), _element_id: `visual-ir-${safeCssId(id)}` };

    if (node.role === 'heading') {
      addDecision(node, 'native', 'heading');
      return [{
        id,
        elType: 'widget',
        widgetType: 'heading',
        settings: { ...settings, title: node.text ?? '', header_size: headingTag(node.tag) },
      }];
    }
    if (node.role === 'text') {
      addDecision(node, 'native', 'text');
      return [{ id, elType: 'widget', widgetType: 'text-editor', settings: { ...settings, editor: node.text ?? '' } }];
    }
    if (node.role === 'button') {
      addDecision(node, 'native', 'button');
      return [{
        id,
        elType: 'widget',
        widgetType: 'button',
        settings: {
          ...settings,
          text: node.text ?? '',
          link: { url: node.href ?? '#', is_external: '', nofollow: '' },
        },
      }];
    }
    if (node.role === 'image') {
      const url = node.assetId ? assetUrls.get(node.assetId) : undefined;
      if (!url) {
        addDecision(node, 'unsupported', 'image-asset', 'critical', true, ['visible image asset']);
        warnings.push(`${node.sourceId}: image asset could not be resolved`);
      } else {
        addDecision(node, 'native', 'image');
      }
      return [{
        id,
        elType: 'widget',
        widgetType: 'image',
        settings: { ...settings, image: { url: url ?? '', id: '' }, image_alt: node.text ?? '' },
      }];
    }
    if (node.role === 'icon') {
      addDecision(node, 'native', 'icon');
      return [{
        id,
        elType: 'widget',
        widgetType: 'icon',
        settings: { ...settings, selected_icon: { value: node.text ?? 'fas fa-star', library: 'fa-solid' } },
      }];
    }

    if (node.children.length > 0) {
      if (depth >= maxContainerDepth) {
        addDecision(node, 'static-approximation', 'nested-layout', 'warning', false, ['original wrapper semantics']);
        warnings.push(`${node.sourceId}: container depth ${maxContainerDepth} reached; wrapper flattened and descendants preserved`);
        return node.children.flatMap((child) => emitNode(child, depth + 1));
      }
      addDecision(node, 'native', 'layout-container');
      return [{
        id,
        elType: 'container',
        isInner: depth > 0,
        settings: { ...settings, flex_direction: node.role === 'layout' ? 'column' : undefined },
        elements: node.children.flatMap((child) => emitNode(child, depth + 1)),
      }];
    }

    addDecision(node, 'static-approximation', 'unknown-node', 'warning', false, ['unknown runtime semantics']);
    return [{ id, elType: 'widget', widgetType: 'html', settings: { ...settings, html: node.text ?? '' } }];
  }

  function emitSection(section: VisualSectionIR): V3Element {
    const sectionId = allocateId(section.sourceId, '-section');
    addDecision(section, 'native', 'section');
    const backgroundSettings: Record<string, unknown> = {};
    if (section.background?.color) backgroundSettings.background_color = section.background.color;
    if (section.background?.assetId) {
      const backgroundUrl = assetUrls.get(section.background.assetId);
      if (backgroundUrl) {
        backgroundSettings.background_image = { url: backgroundUrl, id: '' };
        backgroundSettings.background_position = 'center center';
        addDecision(section, 'native', 'background-image');
      } else {
        addDecision(section, 'unsupported', 'background-image-asset', 'critical', true, ['section background image']);
        warnings.push(`${section.sourceId}: background asset could not be resolved`);
      }
    }
    return {
      id: sectionId,
      elType: 'section',
      settings: {
        ...styleSettings(section),
        ...backgroundSettings,
        content_width: 'boxed',
        _element_id: `visual-ir-${safeCssId(sectionId)}`,
      },
      elements: [{
        id: allocateId(section.sourceId, '-column'),
        elType: 'column',
        settings: { _column_size: 100 },
        elements: section.nodes.flatMap((node) => emitNode(node, 0)),
      }],
    };
  }

  const tree = ir.sections.map(emitSection);
  for (const animation of ir.animations) {
    addDecision({ sourceId: animation.id, role: 'unknown', children: [], evidence: animation.evidence }, 'static-approximation', 'animation', 'warning', false, [animation.intent]);
  }

  const canContinue = canContinueWithFidelityDecisions(decisions);
  return {
    tree,
    decisions,
    warnings,
    sourceSectionIds: ir.sections.map((section) => section.sourceId),
    blocked: !canContinue,
    canContinue,
  };
}

function toV3SettingKey(rawKey: string, node: VisualNodeIR | VisualSectionIR): string | undefined {
  const key = rawKey.trim();
  const cssMap: Record<string, string> = {
    'background-color': 'background_color',
    'font-family': 'typography_font_family',
    'font-size': 'typography_font_size',
    'font-weight': 'typography_font_weight',
    'line-height': 'typography_line_height',
    'letter-spacing': 'typography_letter_spacing',
    'text-align': 'align',
    'border-radius': 'border_radius',
    'min-height': 'min_height',
  };
  if (cssMap[key]) return cssMap[key];
  if (['padding', 'margin', 'border_radius', 'width', 'min_height', 'typography_font_size', 'typography_line_height', 'typography_font_family', 'typography_font_weight', 'typography_letter_spacing', 'align', 'background_color'].includes(key)) return key;
  if (key === 'color') {
    if ('role' in node && node.role === 'button') return 'button_text_color';
    if ('role' in node && node.role === 'text') return 'text_color';
    return 'title_color';
  }
  return undefined;
}

function safeCssId(sourceId: string): string {
  return sourceId.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'node';
}

function headingTag(tag: string | undefined): 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' {
  return /^h[1-6]$/i.test(tag ?? '') ? (tag!.toLowerCase() as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') : 'h2';
}

function toDimension(value: string): { size: number; unit: string } | string {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(px|%|em|rem|vw|vh)?$/i);
  if (!match) return value;
  return { size: Number(match[1]), unit: match[2]?.toLowerCase() ?? 'px' };
}

function toBox(value: string): Record<string, unknown> | string {
  const parts = value.trim().split(/\s+/);
  if (!parts.every((part) => /^-?\d+(?:\.\d+)?(?:px|%|em|rem|vw|vh)?$/i.test(part))) return value;
  const dimensions = parts.map(toDimension);
  if (dimensions.some((dimension) => typeof dimension === 'string')) return value;
  const values = dimensions as Array<{ size: number; unit: string }>;
  const pick = (index: number): { size: number; unit: string } => values[index] ?? values[0]!;
  if (values.length === 1) return { top: pick(0).size, right: pick(0).size, bottom: pick(0).size, left: pick(0).size, unit: pick(0).unit };
  if (values.length === 2) return { top: pick(0).size, right: pick(1).size, bottom: pick(0).size, left: pick(1).size, unit: pick(0).unit };
  return { top: pick(0).size, right: pick(1).size, bottom: pick(2).size, left: pick(3).size, unit: pick(0).unit };
}
