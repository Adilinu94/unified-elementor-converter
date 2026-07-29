/**
 * Framer Tree → V3 Element Tree Converter (Phase 65).
 *
 * Generic converter that transforms parsed Framer XML/JSON node trees
 * into valid Elementor V3 element trees using the authoritative setting-map.
 * Replaces ad-hoc per-build scripts.
 *
 * @module target-v3/framer-tree-to-v3
 */

import type { V3Element } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface FramerNode {
  id: string;
  type: 'frame' | 'text' | 'image' | 'stack' | 'component' | 'page' | 'code';
  name: string;
  props: Record<string, unknown>;
  children: FramerNode[];
  /** Resolved component structure (if type=component). */
  resolvedChildren?: FramerNode[];
}

export interface ConversionOptions {
  /** Page ID for scoping. */
  pageId?: number;
  /** Maximum depth to convert (default: unlimited). */
  maxDepth?: number;
  /** Skip nodes matching these name patterns. */
  skipPatterns?: string[];
  /** Map of component IDs to their resolved structures. */
  componentMap?: Map<string, FramerNode[]>;
}

export interface ConversionResult {
  elements: V3Element[];
  stats: {
    totalNodes: number;
    convertedNodes: number;
    skippedNodes: number;
    sections: number;
    widgets: number;
    containers: number;
  };
  warnings: string[];
}

// ============================================================================
// Node type → Elementor mapping
// ============================================================================

type ElementorWidgetType = 'heading' | 'text-editor' | 'image' | 'button' | 'html' | 'icon' | 'spacer';

/**
 * Name patterns that always mean "this is one leaf widget", regardless of
 * whether the Framer node happens to have internal sub-elements (e.g. a
 * button component with a nested icon+label). Deliberately narrower than
 * inferWidgetType()'s own name matching: 'icon'/'spacer'/'divider' are
 * excluded here because a node with that name MAY legitimately have real
 * children worth preserving as a container — forcing it into a childless
 * leaf widget would silently drop them. See CRITICAL-FAILURE-POINTS.md.
 */
function isNamedWidgetPattern(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes('button') || lower.includes('btn') || lower.includes('cta');
}

function inferWidgetType(node: FramerNode): ElementorWidgetType {
  const name = node.name.toLowerCase();
  const type = node.type;

  if (type === 'text') {
    const fontSize = (node.props['fontSize'] as number) ?? 16;
    return fontSize >= 24 ? 'heading' : 'text-editor';
  }
  if (type === 'image') return 'image';
  if (name.includes('button') || name.includes('btn') || name.includes('cta')) return 'button';
  if (name.includes('icon')) return 'icon';
  if (name.includes('spacer') || name.includes('divider')) return 'spacer';
  if (type === 'code') return 'html';
  return 'text-editor';
}

function isSectionNode(node: FramerNode, depth: number): boolean {
  if (depth !== 0) return false;
  const name = node.name.toLowerCase();
  return (
    node.type === 'frame' || node.type === 'stack'
  ) && (
    name.includes('section') ||
    name.includes('hero') ||
    name.includes('header') ||
    name.includes('footer') ||
    name.includes('nav') ||
    name.includes('stats') ||
    name.includes('service') ||
    name.includes('team') ||
    name.includes('contact') ||
    name.includes('about') ||
    name.includes('process') ||
    node.children.length > 2
  );
}

// ============================================================================
// Core converter
// ============================================================================

/**
 * Convert a Framer node tree to Elementor V3 elements.
 */
export function convertFramerTree(
  nodes: FramerNode[],
  options: ConversionOptions = {},
): ConversionResult {
  const warnings: string[] = [];
  let totalNodes = 0;
  let convertedNodes = 0;
  let skippedNodes = 0;
  let sections = 0;
  let widgets = 0;
  let containers = 0;

  const skipPatterns = options.skipPatterns ?? [];
  const maxDepth = options.maxDepth ?? 20;

  function shouldSkip(node: FramerNode): boolean {
    return skipPatterns.some((p) => node.name.toLowerCase().includes(p.toLowerCase()));
  }

  function mapSettings(node: FramerNode): Record<string, unknown> {
    const settings: Record<string, unknown> = {};
    const props = node.props;

    // Background color
    if (props['backgroundColor'] && props['backgroundColor'] !== 'transparent') {
      settings['background_color'] = props['backgroundColor'];
    }

    // Padding
    const pt = props['paddingTop'] as number | undefined;
    const pr = props['paddingRight'] as number | undefined;
    const pb = props['paddingBottom'] as number | undefined;
    const pl = props['paddingLeft'] as number | undefined;
    if (pt || pr || pb || pl) {
      settings['padding'] = {
        top: pt ?? 0, right: pr ?? 0, bottom: pb ?? 0, left: pl ?? 0,
        unit: 'px', isLinked: false,
      };
    }

    // Flex direction (stacks)
    if (node.type === 'stack' && props['stackDirection']) {
      settings['flex_direction'] = props['stackDirection'] === 'horizontal' ? 'row' : 'column';
    }

    // Gap
    if (props['gap'] && typeof props['gap'] === 'number') {
      settings['flex_gap'] = { column: String(props['gap']), row: String(props['gap']), isLinked: true };
    }

    // Border radius
    if (props['borderRadius'] && typeof props['borderRadius'] === 'number') {
      settings['border_radius'] = {
        top: String(props['borderRadius']), right: String(props['borderRadius']),
        bottom: String(props['borderRadius']), left: String(props['borderRadius']),
        unit: 'px', isLinked: true,
      };
    }

    // Typography (text nodes)
    if (node.type === 'text') {
      settings['typography_typography'] = 'custom';
      if (props['fontSize']) settings['typography_font_size'] = { size: props['fontSize'], unit: 'px' };
      if (props['fontFamily']) settings['typography_font_family'] = props['fontFamily'];
      if (props['fontWeight']) settings['typography_font_weight'] = String(props['fontWeight']);
      if (props['lineHeight']) settings['typography_line_height'] = { size: props['lineHeight'], unit: 'px' };
      if (props['color']) settings['title_color'] = props['color'];
      if (props['textAlign']) settings['align'] = props['textAlign'];
    }

    // Width/height
    if (props['width'] && typeof props['width'] === 'number' && props['width'] > 0) {
      settings['width'] = { size: props['width'], unit: 'px' };
    }
    if (props['height'] && typeof props['height'] === 'number' && props['height'] > 0) {
      settings['min_height'] = { size: props['height'], unit: 'px' };
    }

    // Element ID for CSS targeting
    settings['_element_id'] = `framer-${node.id}`;

    return settings;
  }

  function convert(node: FramerNode, depth: number): V3Element | null {
    totalNodes++;

    if (shouldSkip(node)) {
      skippedNodes++;
      return null;
    }

    if (depth > maxDepth) {
      skippedNodes++;
      warnings.push(`Node "${node.name}" skipped: exceeds max depth ${maxDepth}`);
      return null;
    }

    const id = `el_${node.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 7)}`;

    // Section-level node
    if (isSectionNode(node, depth)) {
      sections++;
      convertedNodes++;
      const children = (node.resolvedChildren ?? node.children)
        .map((child) => convert(child, depth + 1))
        .filter((el): el is V3Element => el !== null);

      return {
        id,
        elType: 'section',
        settings: {
          ...mapSettings(node),
          content_width: 'boxed',
          structure: '20',
        },
        elements: [{
          id: `${id}_col`,
          elType: 'column',
          settings: { _column_size: 100 },
          elements: children,
        }],
      };
    }

    // Leaf widget node
    if (node.type === 'text' || node.type === 'image' || node.type === 'code' ||
        isNamedWidgetPattern(node.name)) {
      widgets++;
      convertedNodes++;
      const widgetType = inferWidgetType(node);
      const settings = mapSettings(node);

      // Widget-specific settings
      if (widgetType === 'heading' || widgetType === 'text-editor') {
        settings[widgetType === 'heading' ? 'title' : 'editor'] =
          (node.props['text'] as string) ?? node.name;
      }
      if (widgetType === 'image') {
        settings['image'] = { url: (node.props['src'] as string) ?? '', id: '' };
      }
      if (widgetType === 'button') {
        settings['text'] = (node.props['text'] as string) ?? node.name;
        settings['link'] = { url: (node.props['href'] as string) ?? '#', is_external: '', nofollow: '' };
      }

      return { id, elType: 'widget', widgetType, settings };
    }

    // Container node (frame/stack with children)
    if (node.children.length > 0 || node.resolvedChildren) {
      containers++;
      convertedNodes++;
      const children = (node.resolvedChildren ?? node.children)
        .map((child) => convert(child, depth + 1))
        .filter((el): el is V3Element => el !== null);

      return {
        id,
        elType: 'container',
        settings: mapSettings(node),
        elements: children,
      };
    }

    // Empty frame → spacer
    widgets++;
    convertedNodes++;
    return {
      id,
      elType: 'widget',
      widgetType: 'spacer',
      settings: { space: { size: (node.props['height'] as number) ?? 20, unit: 'px' } },
    };
  }

  const elements = nodes
    .map((node) => convert(node, 0))
    .filter((el): el is V3Element => el !== null);

  return {
    elements,
    stats: { totalNodes, convertedNodes, skippedNodes, sections, widgets, containers },
    warnings,
  };
}
