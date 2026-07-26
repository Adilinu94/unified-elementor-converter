/**
 * Framer Component Extraction (Phase 51, A1).
 * Analyzes Framer HTML/XML or V4 tree for repeated container patterns
 * and extracts them as V4 Atomic Component Blueprints.
 * Ported from Framer-to-Elementor-V4-Pipeline/scripts/extract-framer-components.ts
 */

import { structuralHash } from '@elconv/core';

// ============================================================================
// Types
// ============================================================================

export interface V4TreeNode {
  id?: string | number;
  elements?: V4TreeNode[];
  children?: V4TreeNode[];
  settings?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PropertyField {
  type: 'text' | 'image' | 'link';
  default: string | number | { href: string; text: string };
  prop: string;
}

export interface ComponentBlueprint {
  name: string;
  hash?: string | null;
  occurrences: number;
  parent_ids?: (string | number | undefined)[];
  selectors?: string[];
  properties: Record<string, PropertyField>;
  content?: V4TreeNode[];
}

export interface RepeatingGroup {
  baseName: string;
  count: number;
  selectors: string[];
}

export interface ComponentsResult {
  meta: {
    generatedAt: string;
    source: string;
    totalComponents: number;
    minDuplicates: number;
  };
  components: ComponentBlueprint[];
  mcpRouting: {
    create_ability: string;
    assign_ability: string;
    note: string;
  };
}

export interface ExtractComponentsOptions {
  minDuplicates?: number;
}

// ============================================================================
// V4 Tree Extraction
// ============================================================================

/**
 * Extract component blueprints from a V4 widget tree by finding
 * structurally identical child groups (via structuralHash).
 */
export function extractComponentsFromV4Tree(
  tree: unknown,
  options: ExtractComponentsOptions = {},
): ComponentBlueprint[] {
  const minDups = options.minDuplicates ?? 2;
  const roots: V4TreeNode[] = Array.isArray(tree) ? tree as V4TreeNode[] : [tree as V4TreeNode];
  const containerGroups = new Map<string, { template: V4TreeNode[]; occurrences: (string | number)[] }>();

  function walk(node: V4TreeNode): void {
    const children = node.elements || node.children || [];
    if (children.length >= 2) {
      const hash = structuralHash(children, { includeTag: true });
      if (hash && !containerGroups.has(hash)) {
        containerGroups.set(hash, { template: children, occurrences: [] });
      }
      if (hash) containerGroups.get(hash)!.occurrences.push(node.id || 'unknown');
    }
    for (const child of children) walk(child);
  }

  for (const root of roots) walk(root);

  const components: ComponentBlueprint[] = [];
  let idx = 1;

  for (const [hash, group] of containerGroups) {
    if (group.occurrences.length < minDups) continue;

    const template = group.template;
    const props = extractProperties(template);

    components.push({
      name: props.name || `Component-${idx++}`,
      hash,
      occurrences: group.occurrences.length,
      parent_ids: group.occurrences,
      properties: props.fields,
      content: template,
    });
  }

  return components;
}

function extractProperties(template: V4TreeNode[]): { fields: Record<string, PropertyField>; name: string } {
  const fields: Record<string, PropertyField> = {};
  let suggestedName = '';

  for (const el of template) {
    const id = String(el.id || '');
    const settings = el.settings as Record<string, { value?: { content?: { value?: string }; src?: { value?: { id?: number } }; destination?: { value?: string } } }> | undefined;

    if (/heading|title/i.test(id)) {
      const text = String(settings?.title?.value?.content?.value || settings?.text?.value?.content?.value || '');
      fields[id] = { type: 'text', default: text, prop: 'title' };
      if (!suggestedName) suggestedName = text.replace(/[^a-zA-Z0-9]/g, '');
    }
    if (/paragraph|body|description/i.test(id)) {
      const text = String(settings?.paragraph?.value?.content?.value || '');
      fields[id] = { type: 'text', default: text, prop: 'paragraph' };
    }
    if (/image|img|icon/i.test(id)) {
      const imgSrc: number = settings?.image?.value?.src?.value?.id || 0;
      fields[id] = { type: 'image', default: imgSrc, prop: 'image' };
    }
    if (/button|cta|link/i.test(id)) {
      const href = String(settings?.link?.value?.destination?.value || '');
      const text = String(settings?.text?.value?.content?.value || '');
      fields[id] = { type: 'link', default: { href, text }, prop: 'link' };
    }

    // Recurse into children
    const children = el.elements || el.children || [];
    const childFields = extractProperties(children);
    Object.assign(fields, childFields.fields);
    if (!suggestedName && childFields.name) suggestedName = childFields.name;
  }

  return { fields, name: suggestedName };
}

// ============================================================================
// HTML/CSS Extraction
// ============================================================================

/**
 * Extract CSS blocks from HTML string.
 */
export function extractCssFromHtml(html: string): string {
  const blocks: string[] = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleRe.exec(html)) !== null) blocks.push(m[1]);
  return blocks.join('\n');
}

/**
 * Find repeating CSS selectors (data-framer-name patterns).
 */
export function findRepeatingSelectors(css: string, minDups = 2): RepeatingGroup[] {
  const ruleMap = new Map<string, { selector: string; body: string }[]>();
  const ruleRe = /([^{}]+)\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(css)) !== null) {
    const selector = m[1].trim();
    const body = m[2].trim();
    const nameMatch = selector.match(/\[data-framer-name=["']([^"']+)["']\]/);
    const baseName = nameMatch ? nameMatch[1].replace(/[\d-]+$/g, '') : selector;
    if (!ruleMap.has(baseName)) ruleMap.set(baseName, []);
    ruleMap.get(baseName)!.push({ selector, body });
  }

  const repeating: RepeatingGroup[] = [];
  for (const [baseName, rules] of ruleMap) {
    if (rules.length >= minDups) {
      repeating.push({ baseName, count: rules.length, selectors: rules.map((r) => r.selector) });
    }
  }
  return repeating;
}

/**
 * Build a component blueprint from a repeating CSS group.
 */
export function buildTemplateFromRepeat(repeatingGroup: RepeatingGroup): ComponentBlueprint {
  const name = repeatingGroup.baseName.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'Component';
  const firstSelector = repeatingGroup.selectors[0];
  const selectorMatch = firstSelector?.match(/\[data-framer-name=["']([^"']+)["']\]/);
  const displayName = selectorMatch ? selectorMatch[1] : name;

  return {
    name: displayName,
    occurrences: repeatingGroup.count,
    selectors: repeatingGroup.selectors,
    properties: {
      title: { type: 'text', default: displayName, prop: 'title' },
    },
  };
}

/**
 * Extract components from Framer HTML export.
 */
export function extractComponentsFromHtml(
  html: string,
  options: ExtractComponentsOptions = {},
): ComponentBlueprint[] {
  const minDups = options.minDuplicates ?? 2;
  const css = extractCssFromHtml(html);
  const repeating = findRepeatingSelectors(css, minDups);
  return repeating.map((group) => buildTemplateFromRepeat(group));
}

/**
 * Build the full components result with MCP routing info.
 */
export function buildComponentsResult(
  components: ComponentBlueprint[],
  source: string,
  minDuplicates = 2,
): ComponentsResult {
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      source,
      totalComponents: components.length,
      minDuplicates,
    },
    components,
    mcpRouting: {
      create_ability: 'novamira-adrianv2/create-component',
      assign_ability: 'novamira-adrianv2/insert-component',
      note: 'These abilities exist in the novamira-adrianv2 plugin. No new PHP needed.',
    },
  };
}
