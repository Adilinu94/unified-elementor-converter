import { describe, expect, it } from 'vitest';
import { buildV4Plan, type LegacyClassifiedSection } from '../../../packages/target-v4/src/legacy-plan.ts';

function section(widgets: LegacyClassifiedSection['v3_section']['columns'][number]['widgets']): LegacyClassifiedSection {
  return {
    section_id: 'hero',
    source: { url: 'https://example.com', selector: '#hero', y_range: [0, 400] },
    v3_section: {
      columns: [{ width: '100%', widgets }],
      settings: {},
    },
  };
}

describe('buildV4Plan legacy adapter', () => {
  it('maps nested classified widgets to nested V4 flexboxes and counts only real widgets', () => {
    const plan = buildV4Plan([
      section([
        {
          type: 'container',
          children: [
            { type: 'heading', content: 'Nested heading' },
            { type: 'unknown-pro-widget', content: '<span>Fallback</span>' },
          ],
        },
        { type: 'button', content: 'Continue' },
      ]),
    ], 'https://example.com');

    expect(plan.summary.sectionCount).toBe(1);
    expect(plan.summary.widgetCount).toBe(3);
    expect(plan.tree[0]!.elements![0]!.type).toBe('e-flexbox');
    expect(plan.tree[0]!.elements![0]!.elements).toHaveLength(2);
    expect(plan.tree[0]!.elements![0]!.elements![0]!.type).toBe('e-heading');
    expect(plan.tree[0]!.elements![0]!.elements![1]!.type).toBe('e-html');
    expect(plan.tree[0]!.elements![1]!.type).toBe('e-button');
  });

  it('keeps unknown widget fallback as the documented e-html output', () => {
    const plan = buildV4Plan([section([{ type: 'third-party-carousel', content: 'fallback' }])], 'https://example.com');
    expect(plan.tree[0]!.elements![0]!.type).toBe('e-html');
    expect(plan.summary.widgetCount).toBe(1);
  });
});
