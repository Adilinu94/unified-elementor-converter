import { describe, expect, it } from 'vitest';
import {
  injectCalibratedPage,
  pushToWordPress,
  type McpAdapter,
} from '@elconv/mcp';

function fakeAdapter() {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const adapter = {
    executeAbility: async (name: string, params: Record<string, unknown> = {}) => {
      calls.push({ name, params });
      if (name === 'novamira/execute-php') {
        return { success: true, data: { output: 'https://example.test/draft' } };
      }
      return { success: true, post_id: 42, permalink: 'https://example.test/draft' };
    },
  } as unknown as McpAdapter;
  return { adapter, calls };
}

describe('V3 injection payloads', () => {
  it('passes _elementor_data as an array through injectCalibratedPage', async () => {
    const { adapter, calls } = fakeAdapter();
    const tree = [{ id: 'section-1', elType: 'section', elements: [] }];

    await injectCalibratedPage(adapter, { post_id: 42, _elementor_data: tree });

    const call = calls.find((entry) => entry.name === 'novamira-adrianv2/elementor-inject-calibrated-page');
    expect(call?.params._elementor_data).toBe(tree);
    expect(Array.isArray(call?.params._elementor_data)).toBe(true);
  });

  it('passes the normalized V3 tree as an array through pushToWordPress', async () => {
    const { adapter, calls } = fakeAdapter();
    const tree = [{ id: 'section-1', elType: 'section', elements: [] }];

    await pushToWordPress(adapter, tree, {
      postId: 42,
      title: 'Draft',
      status: 'draft',
      pageTemplate: 'elementor_canvas',
      target: 'v3',
    });

    const call = calls.find((entry) => entry.name === 'novamira-adrianv2/elementor-inject-calibrated-page');
    expect(call?.params._elementor_data).toEqual(tree);
    expect(Array.isArray(call?.params._elementor_data)).toBe(true);
    expect(typeof call?.params._elementor_data).not.toBe('string');
  });
});
