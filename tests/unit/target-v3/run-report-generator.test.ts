import { describe, expect, it } from 'vitest';
import { generateRunReport } from '../../../packages/target-v3/src/run-report-generator.ts';
import type { V3Tree } from '../../../packages/target-v3/src/v3-tree-types.ts';
import type { GeometryProbeReport } from '@elconv/qa';

const tree: V3Tree = [
  {
    id: 'section-1',
    elType: 'section',
    settings: {},
    elements: [
      {
        id: 'widget-1',
        elType: 'widget',
        widgetType: 'heading',
        settings: { title: 'Hello' },
      },
    ],
  },
];

const probe: GeometryProbeReport = {
  url: 'https://clone.example/?p=42',
  timestamp: '2026-08-01T00:00:00.000Z',
  totalProbes: 2,
  passCount: 1,
  failCount: 1,
  score: 50,
  results: [
    {
      selector: '.hero',
      label: 'Hero color',
      expected: { color: '#fff' },
      actual: { color: '#000' },
      match: false,
      diffs: [{ property: 'color', expected: '#fff', actual: '#000', withinTolerance: false }],
      suggestedCSSFix: '.hero { color: #fff; }',
    },
    {
      selector: '.cta',
      label: 'CTA exists',
      expected: { display: 'block' },
      actual: { display: 'block' },
      match: true,
      diffs: [],
      suggestedCSSFix: null,
    },
  ],
};

describe('generateRunReport', () => {
  it('renders the real GeometryProbeReport and derives the scorecard from it', () => {
    const report = generateRunReport({
      projectName: 'Probe Regression',
      framerUrl: 'https://framer.example',
      elementorUrl: 'https://clone.example',
      postId: 42,
      tree,
      wpcodeSnippets: {},
      probeReports: [probe],
      timestamp: '2026-08-01T00:00:00.000Z',
    });

    expect(report).toContain('## Geometry Probe (post-deploy)');
    expect(report).toContain('### Probe 1 — 50% pass');
    expect(report).toContain('Hero color');
    expect(report).toContain('color: #000 (exp #fff)');
    expect(report).toContain('| Visual | 75 |');
    expect(report).toContain('| **Overall** | **88** |');
  });
});
