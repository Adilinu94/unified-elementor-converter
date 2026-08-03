import { describe, expect, it } from 'vitest';
import {
  injectCalibratedPage,
  pushToWordPress,
  type McpAdapter,
} from '@elconv/mcp';
import type { TreeVerificationResult } from '../../../packages/mcp/src/readback.ts';

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
  it('uses the documented elements key for V4 batch builds', async () => {
    const { adapter, calls } = fakeAdapter();
    await pushToWordPress(adapter, [{ id: 'atomic-1' }], {
      postId: 42,
      title: 'Draft',
      status: 'draft',
      pageTemplate: 'elementor_canvas',
      target: 'v4',
    });

    const call = calls.find((entry) => entry.name === 'novamira-adrianv2/batch-build-page');
    expect(call?.params.elements).toEqual([{ id: 'atomic-1' }]);
    expect(call?.params.content).toBeUndefined();
  });

  it('throws when the inject ability does not confirm success', async () => {
    const adapter = {
      executeAbility: async (name: string) => name === 'novamira/execute-php'
        ? { success: true, data: { output: 'https://example.test/draft' } }
        : { success: false, error: 'validation failed' },
    } as unknown as McpAdapter;

    await expect(pushToWordPress(adapter, [{ id: 'section-1' }], {
      postId: 42,
      title: 'Draft',
      status: 'draft',
      pageTemplate: 'elementor_canvas',
      target: 'v3',
    })).rejects.toThrow('V3 push failed: validation failed');
  });
  it('passes _elementor_data as an array through injectCalibratedPage', async () => {
    const { adapter, calls } = fakeAdapter();
    const tree = [{ id: 'section-1', elType: 'section', elements: [] }];

    await injectCalibratedPage(adapter, { post_id: 42, _elementor_data: tree });

    const call = calls.find((entry) => entry.name === 'novamira-adrianv2/elementor-inject-calibrated-page');
    expect(call?.params._elementor_data).toBe(tree);
    expect(Array.isArray(call?.params._elementor_data)).toBe(true);
  });

  it('accepts the documented post_ids cache-clear payload', async () => {
    const { adapter, calls } = fakeAdapter();

    await pushToWordPress(adapter, [{ id: 'section-1', elType: 'section', elements: [] }], {
      postId: 42,
      title: 'Draft',
      status: 'draft',
      pageTemplate: 'elementor_canvas',
      target: 'v3',
      verify: false,
    });

    expect(calls.find((call) => call.name === 'novamira/elementor-clear-document-cache')?.params)
      .toEqual({ post_ids: [42] });
  });

  it('clears the Elementor cache when verification is explicitly skipped', async () => {
    const { adapter, calls } = fakeAdapter();

    await pushToWordPress(adapter, [{ id: 'section-1', elType: 'section', elements: [] }], {
      postId: 42,
      title: 'Draft',
      status: 'draft',
      pageTemplate: 'elementor_canvas',
      target: 'v3',
      verify: false,
    });

    expect(calls.map((call) => call.name)).toEqual([
      'novamira/execute-php',
      'novamira-adrianv2/elementor-inject-calibrated-page',
      'novamira/elementor-clear-document-cache',
    ]);
  });

  it('fails when cache invalidation is not confirmed', async () => {
    const adapter = {
      executeAbility: async (name: string) => {
        if (name === 'novamira/elementor-clear-document-cache') {
          return { data: { success: false, error: 'cache service unavailable' } };
        }
        if (name === 'novamira/execute-php') {
          return { success: true, data: { output: 'https://example.test/draft' } };
        }
        return { success: true };
      },
    } as unknown as McpAdapter;

    await expect(pushToWordPress(adapter, [{ id: 'section-1' }], {
      postId: 42,
      title: 'Draft',
      status: 'draft',
      pageTemplate: 'elementor_canvas',
      target: 'v3',
      verify: false,
    })).rejects.toThrow('cache service unavailable');
  });

  it('fails when verified read-back returns no persisted tree', async () => {
    const adapter = {
      executeAbility: async (name: string) => {
        if (name === 'novamira/elementor-get-content') {
          return { success: true, content: null };
        }
        return { success: true };
      },
    } as unknown as McpAdapter;

    await expect(pushToWordPress(adapter, [{ id: 'section-1' }], {
      postId: 42,
      title: 'Draft',
      status: 'draft',
      pageTemplate: 'elementor_canvas',
      target: 'v3',
      verify: true,
    })).rejects.toThrow('returned no element tree');
  });

  it('attaches structured verification details to a semantic mismatch', async () => {
    const adapter = {
      executeAbility: async (name: string) => name === 'novamira/elementor-get-content'
        ? { success: true, content: [{ elType: 'section', elements: [] }] }
        : { success: true },
    } as unknown as McpAdapter;

    try {
      await pushToWordPress(adapter, [{ elType: 'section', elements: [{ elType: 'widget' }] }], {
        postId: 42,
        title: 'Draft',
        status: 'draft',
        pageTemplate: 'elementor_canvas',
        target: 'v3',
        verify: true,
      });
      throw new Error('expected push verification to fail');
    } catch (error) {
      const typed = error as Error & { failureKind?: string; verification?: TreeVerificationResult };
      expect(typed.failureKind).toBe('verification-failed');
      expect(typed.verification?.issues).toContain('element count mismatch: expected 2, actual 1');
    }
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
