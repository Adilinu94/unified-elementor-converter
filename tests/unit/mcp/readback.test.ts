import { describe, expect, it } from 'vitest';
import type { McpAdapter } from '../../../packages/mcp/src/adapter.ts';
import {
  countElements,
  readElementorContent,
  verifyElementTree,
  unwrapMcpPayload,
} from '../../../packages/mcp/src/readback.ts';

function adapterReturning(response: unknown): McpAdapter {
  return {
    executeAbility: async () => response,
  } as unknown as McpAdapter;
}

describe('Elementor read-back verification', () => {
  it('reads the complete persisted tree with the expected ability parameters', async () => {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
    const adapter = {
      executeAbility: async (name: string, params: Record<string, unknown>) => {
        calls.push({ name, params });
        return { success: true, post_id: 42, content: [{ elType: 'section', elements: [] }], element_count: 1 };
      },
    } as unknown as McpAdapter;

    await expect(readElementorContent(adapter, 42)).resolves.toEqual({
      postId: 42,
      content: [{ elType: 'section', elements: [] }],
      elementCount: 1,
    });
    expect(calls).toEqual([{
      name: 'novamira/elementor-get-content',
      params: { post_id: 42, full_dump: true },
    }]);
  });

  it('supports a data wrapper while preserving the direct response contract', async () => {
    const adapter = {
      executeAbility: async (name: string) => name === 'novamira/elementor-get-content'
        ? { data: { content: [{ elType: 'section', elements: [] }], element_count: 1 } }
        : { data: { success: true } },
    } as unknown as McpAdapter;

    await expect(readElementorContent(adapter, 42)).resolves.toMatchObject({
      content: [{ elType: 'section', elements: [] }],
      elementCount: 1,
    });
    expect(unwrapMcpPayload({ data: { content: [] } }, 'content')).toEqual({ content: [] });
  });

  it('ignores generated IDs but detects semantic differences', () => {
    const expected = [{
      id: 'source-section',
      elType: 'section',
      settings: { title: 'Hero' },
      elements: [{ id: 'source-widget', elType: 'widget', widgetType: 'heading', settings: { title: 'Hello' } }],
    }];
    const persisted = [{
      id: 'wp-generated-section',
      elType: 'section',
      settings: { title: 'Hero' },
      elements: [{ id: 'wp-generated-widget', elType: 'widget', widgetType: 'heading', settings: { title: 'Hello' } }],
    }];

    expect(verifyElementTree(expected, persisted)).toMatchObject({
      verified: true,
      expectedElementCount: 2,
      actualElementCount: 2,
      issues: [],
    });

    const changed = verifyElementTree(expected, [{ ...persisted[0], settings: { title: 'Changed' } }]);
    expect(changed.verified).toBe(false);
    expect(changed.issues).toContain('semantic tree mismatch: element types, nesting, settings, or content differ');
  });

  it('rejects explicit wrapped failures instead of treating them as empty content', async () => {
    await expect(readElementorContent(adapterReturning({ data: { success: false, error: 'permission denied' } }), 7))
      .rejects.toThrow('permission denied');
  });

  it('counts only element nodes and reports empty or failed reads honestly', async () => {
    expect(countElements([{ elType: 'section', elements: [{ elType: 'widget' }] }])).toBe(2);
    await expect(readElementorContent(adapterReturning({ success: false, error: 'permission denied' }), 7))
      .rejects.toThrow('permission denied');
    await expect(readElementorContent(adapterReturning({ success: true, content: null }), 7))
      .rejects.toThrow('returned no element tree');
  });
});
