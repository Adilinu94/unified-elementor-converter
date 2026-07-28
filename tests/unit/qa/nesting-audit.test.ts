import { describe, it, expect } from 'vitest';
import { runNestingAudit, toNestingNodes, type QaNestingNode } from '@elconv/qa';

function node(id: string, elType: string, children: QaNestingNode[] = [], hasVisualSettings = false): QaNestingNode {
  return { id, elType, children, hasVisualSettings };
}

describe('runNestingAudit', () => {
  it('gives a perfect score to a shallow, non-bloated tree', () => {
    const tree = [node('a', 'container', [node('w', 'widget')], true)];
    const report = runNestingAudit(tree);
    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
    expect(report.depthViolations).toEqual([]);
  });

  it('flags a depth violation as "warning" at maxDepth+1 and "error" beyond that', () => {
    // depth: 0=a,1=b,2=c,3=d(=maxDepth, ok),4=e(warning),5=f(error)
    const tree = [
      node('a', 'container', [
        node('b', 'container', [
          node('c', 'container', [
            node('d', 'container', [
              node('e', 'container', [
                node('f', 'widget'),
              ], true),
            ], true),
          ], true),
        ], true),
      ], true),
    ];
    const report = runNestingAudit(tree, 3);
    const eViolation = report.depthViolations.find((v) => v.nodeId === 'e');
    const fViolation = report.depthViolations.find((v) => v.nodeId === 'f');
    expect(eViolation?.severity).toBe('warning'); // depth 4 = maxDepth+1
    expect(fViolation?.severity).toBe('error'); // depth 5 > maxDepth+1
    expect(report.passed).toBe(false); // has an error-level violation
  });

  it('counts single-child containers and flags non-visual ones as flatten candidates', () => {
    const tree = [
      node('wrapper', 'container', [node('w', 'widget')], false), // single-child, non-visual
    ];
    const report = runNestingAudit(tree);
    expect(report.singleChildContainers).toBe(1);
    expect(report.flattenCandidates).toContainEqual(
      expect.objectContaining({ nodeId: 'wrapper', reason: 'single-child' }),
    );
  });

  it('does NOT flag a single-child container with visual settings as a flatten candidate', () => {
    const tree = [node('wrapper', 'container', [node('w', 'widget')], true)];
    const report = runNestingAudit(tree);
    expect(report.singleChildContainers).toBe(1);
    expect(report.flattenCandidates).toEqual([]);
  });

  it('flags a multi-child non-visual container as a flatten candidate', () => {
    const tree = [
      node('wrapper', 'container', [node('a', 'widget'), node('b', 'widget')], false),
    ];
    const report = runNestingAudit(tree);
    expect(report.nonVisualContainers).toBe(1);
    expect(report.flattenCandidates).toContainEqual(
      expect.objectContaining({ nodeId: 'wrapper', reason: 'non-visual' }),
    );
  });

  it('applies a bloat penalty once container count exceeds the threshold (40)', () => {
    // 45 sibling containers, each with two visual widget children -> no
    // wrapper/depth penalty, isolates the bloat penalty.
    const many: QaNestingNode[] = Array.from({ length: 45 }, (_, i) =>
      node(`c${i}`, 'container', [node(`w${i}a`, 'widget'), node(`w${i}b`, 'widget')], true),
    );
    const report = runNestingAudit(many);
    expect(report.containerCount).toBe(45);
    expect(report.score).toBe(100 - (45 - 40) * 2); // 90
  });

  it('counts widgets and total nodes correctly', () => {
    const tree = [node('a', 'container', [node('w1', 'widget'), node('w2', 'widget')], true)];
    const report = runNestingAudit(tree);
    expect(report.widgetCount).toBe(2);
    expect(report.totalNodes).toBe(3);
  });
});

describe('toNestingNodes', () => {
  it('converts a V3-shaped element tree, detecting visual settings from the known property list', () => {
    const elements = [
      {
        id: 'a',
        elType: 'container',
        settings: { background_color: '#fff' },
        elements: [{ id: 'w', elType: 'widget', widgetType: 'heading', settings: {} }],
      },
    ];
    const nodes = toNestingNodes(elements);
    expect(nodes[0]!.hasVisualSettings).toBe(true);
    expect(nodes[0]!.children[0]!.id).toBe('w');
    expect(nodes[0]!.children[0]!.hasVisualSettings).toBe(false);
  });

  it('treats an empty-string or undefined visual setting as not visual', () => {
    const elements = [{ id: 'a', elType: 'container', settings: { padding: '' }, elements: [] }];
    expect(toNestingNodes(elements)[0]!.hasVisualSettings).toBe(false);
  });

  it('round-trips through runNestingAudit', () => {
    const elements = [
      { id: 'a', elType: 'container', settings: {}, elements: [{ id: 'w', elType: 'widget', settings: {} }] },
    ];
    const report = runNestingAudit(toNestingNodes(elements));
    expect(report.totalNodes).toBe(2);
  });
});
