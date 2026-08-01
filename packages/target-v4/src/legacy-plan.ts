/**
 * Legacy CLI plan adapter.
 *
 * The unified V4 builder consumes core SourceSpec, while the retained
 * clone-v3 CLI hands it classified section specs. This adapter translates
 * that structural shape without importing target-v3 (V3/V4 isolation).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SourceSpec, SectionSpec, WidgetSpec, WidgetType } from '@elconv/core';
import type { V4TreeNode } from './types.js';
import { buildV4Tree } from './builder.js';

export interface LegacyClassifiedWidget {
  type: string;
  source_selector?: string;
  source_tag?: string;
  content?: string;
  settings?: Record<string, unknown>;
  children?: LegacyClassifiedWidget[];
}

export interface LegacyClassifiedSection {
  section_id: string;
  source: { url: string; selector: string; y_range: [number, number] };
  v3_section: {
    columns: Array<{ width: string; widgets: LegacyClassifiedWidget[] }>;
    settings: Record<string, unknown>;
  };
}

export interface V4Plan {
  tree: V4TreeNode[];
  summary: {
    sectionCount: number;
    widgetCount: number;
    classes: string[];
  };
  sourceUrl: string;
  generatedAt: string;
}

const CORE_WIDGET_TYPES = new Set<WidgetType>([
  'heading', 'text', 'image', 'button', 'icon', 'video', 'divider',
  'spacer', 'html', 'form', 'accordion', 'container',
]);

/** Unknown legacy widgets deliberately degrade to V4 HTML so content remains editable
 * and the V3/V4 bridge never emits an unsupported atomic type. */
function toWidgetType(type: string): WidgetType {
  if (type === 'text-editor') return 'text';
  return CORE_WIDGET_TYPES.has(type as WidgetType) ? type as WidgetType : 'html';
}

function toWidgetSpec(widget: LegacyClassifiedWidget, id: string): WidgetSpec {
  return {
    id,
    type: toWidgetType(widget.type),
    text: widget.content,
    styles: Object.fromEntries(
      Object.entries(widget.settings ?? {}).filter(([, value]) => typeof value === 'string').map(([key, value]) => [key, value as string]),
    ),
    ...(widget.children?.length
      ? { children: widget.children.map((child, index) => toWidgetSpec(child, `${id}_child_${index + 1}`)) }
      : {}),
  };
}

function toSourceSpec(sections: LegacyClassifiedSection[], sourceUrl: string): SourceSpec {
  const mapped: SectionSpec[] = sections.map((section) => {
    const widgets = section.v3_section.columns.flatMap((column) => column.widgets).map((widget, index) =>
      toWidgetSpec(widget, `${section.section_id}_widget_${index + 1}`),
    );
    const columns = section.v3_section.columns.length;
    return {
      id: section.section_id,
      semanticRole: section.section_id,
      layout: columns > 1 ? 'multi-column' : 'single-column',
      columns: columns > 1 ? columns : undefined,
      widgets,
      styles: Object.fromEntries(
        Object.entries(section.v3_section.settings).filter(([, value]) => typeof value === 'string').map(([key, value]) => [key, value as string]),
      ),
    };
  });

  return {
    source: { type: 'url', url: sourceUrl },
    tokens: { colors: [], fonts: [], sizes: [] },
    sections: mapped,
    cssVars: {},
    warnings: [],
  };
}

function countWidgets(tree: V4TreeNode[]): number {
  return tree.reduce((count, node) => count + (node.type === 'e-flexbox' ? 0 : 1) + (node.elements ? countWidgets(node.elements) : 0), 0);
}

function collectClasses(tree: V4TreeNode[]): string[] {
  const classes = new Set<string>();
  const walk = (nodes: V4TreeNode[]): void => {
    for (const node of nodes) {
      for (const id of Object.keys(node.styles)) classes.add(id);
      if (node.elements) walk(node.elements);
    }
  };
  walk(tree);
  return [...classes];
}

/** Build the plan expected by the retained CLI pipeline. Extra arguments are accepted for source compatibility. */
export function buildV4Plan(
  sections: LegacyClassifiedSection[],
  sourceUrl: string,
  _title?: string,
  _postId?: number,
  _options?: Record<string, unknown>,
): V4Plan {
  const tree = buildV4Tree(toSourceSpec(sections, sourceUrl));
  return {
    tree,
    summary: {
      sectionCount: sections.length,
      widgetCount: countWidgets(tree),
      classes: collectClasses(tree),
    },
    sourceUrl,
    generatedAt: new Date().toISOString(),
  };
}

export async function writeV4Plan(plan: V4Plan, outputPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(plan, null, 2), 'utf8');
}
