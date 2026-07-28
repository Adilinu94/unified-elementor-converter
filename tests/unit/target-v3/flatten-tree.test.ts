import { describe, it, expect } from 'vitest';
import { flattenTree, auditNesting, type V3Element } from '@elconv/target-v3';

function container(id: string, elements: V3Element[] = [], settings: Record<string, unknown> = {}): V3Element {
  return { id, elType: 'container', settings, elements };
}
function widget(id: string, widgetType = 'heading'): V3Element {
  return { id, elType: 'widget', widgetType, settings: {} };
}

describe('flattenTree — Rule 1 (merge single-child, no visual settings)', () => {
  it('merges a single-child wrapper container into its child', () => {
    const tree = [container('wrapper', [widget('w1')])];
    const result = flattenTree(tree);
    expect(result.mergedNodes).toContain('wrapper');
    expect(result.tree[0]!.id).toBe('w1');
  });

  it('does NOT merge a single-child container that has visual settings', () => {
    const tree = [container('wrapper', [widget('w1')], { background_color: '#fff' })];
    const result = flattenTree(tree);
    expect(result.mergedNodes).not.toContain('wrapper');
    expect(result.tree[0]!.id).toBe('wrapper');
  });
});

describe('flattenTree — Rule 2 (remove non-visual container at excess depth)', () => {
  it('does NOT lose the removed container\'s children — they are promoted to the parent', () => {
    // depth 0: root -> depth 1: mid -> depth 2: mid2 -> depth 3 (>= maxDepth): deep (no visual settings, 2 children)
    const tree = [
      container('root', [
        container('mid', [
          container('mid2', [
            container('deep', [widget('a'), widget('b')]), // depth 3, non-visual -> Rule 2 removes it
          ]),
        ]),
      ]),
    ];
    const result = flattenTree(tree, { maxDepth: 3, mergeSingleChild: false });

    expect(result.removedNodes).toContain('deep');

    // The two widgets that were children of 'deep' must still exist SOMEWHERE
    // in the flattened tree — not silently dropped.
    const collectIds = (els: V3Element[]): string[] =>
      els.flatMap((e) => [e.id, ...(e.elements ? collectIds(e.elements) : [])]);
    const survivingIds = collectIds(result.tree);
    expect(survivingIds).toContain('a');
    expect(survivingIds).toContain('b');
  });

  it('promotes children even when the removed container is itself top-level', () => {
    const tree = [container('top', [widget('a'), widget('b')])];
    const result = flattenTree(tree, { maxDepth: 0, mergeSingleChild: false });
    const collectIds = (els: V3Element[]): string[] =>
      els.flatMap((e) => [e.id, ...(e.elements ? collectIds(e.elements) : [])]);
    expect(collectIds(result.tree)).toEqual(expect.arrayContaining(['a', 'b']));
  });
});

describe('auditNesting', () => {
  it('reports no violations for a shallow tree', () => {
    const tree = [container('a', [container('b', [widget('c')])])];
    const audit = auditNesting(tree, 3);
    expect(audit.passed).toBe(true);
    expect(audit.violations).toEqual([]);
  });

  it('reports a violation for a tree deeper than maxDepth', () => {
    const tree = [container('a', [container('b', [container('c', [container('d', [widget('e')])])])])];
    const audit = auditNesting(tree, 2);
    expect(audit.passed).toBe(false);
    expect(audit.violations.length).toBeGreaterThan(0);
  });

  it('counts containers correctly', () => {
    const tree = [container('a', [container('b', [widget('c')]), widget('d')])];
    const audit = auditNesting(tree, 5);
    expect(audit.totalContainers).toBe(2);
  });
});
