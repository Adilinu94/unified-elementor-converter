import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  injectCalibratedPage,
  normalizeV3Tree,
  pushToWordPress,
  type McpAdapter,
} from '@elconv/mcp';
import { validateSettingsAgainstSchema, type WidgetSchemaMap } from '@elconv/core';
import type { TreeVerificationResult } from '../../../packages/mcp/src/readback.ts';

/**
 * The committed control snapshot, which is what makes these assertions facts
 * rather than opinions: it records the controls Elementor 4.2.1 actually declares
 * per widget, so "spacer has no `width`" is verifiable rather than asserted.
 */
const SNAPSHOT = JSON.parse(
  readFileSync(resolve(__dirname, '../../../schemas/elementor-v3-controls.snapshot.json'), 'utf8'),
) as { widgets: WidgetSchemaMap };

interface TestNode {
  id?: string;
  elType?: string;
  widgetType?: string;
  isInner?: boolean;
  settings?: Record<string, unknown>;
  elements?: TestNode[];
}

/** A flex-row container holding one child of each kind the emitter produces. */
function flexRowWithMixedChildren(): TestNode[] {
  return [{
    id: 'row',
    elType: 'container',
    settings: { flex_direction: 'row' },
    elements: [
      { id: 'w-spacer', elType: 'widget', widgetType: 'spacer', settings: { space: { unit: 'px', size: 80 } } },
      { id: 'w-heading', elType: 'widget', widgetType: 'heading', settings: { title: 'T' } },
      { id: 'c-inner', elType: 'container', isInner: true, settings: {}, elements: [] },
      { id: 'col', elType: 'column', settings: { _column_size: 100 }, elements: [] },
    ],
  }];
}

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

/**
 * The deploy-path normalizer runs AFTER the schema gate (see `executeDeploy`), so
 * anything it writes reaches `elementor-set-content` unchecked. It wrote
 * `settings.width = "33.33%"` onto every flex-row child regardless of kind —
 * measured on a real converted page as 230 gate errors where the pre-normalize
 * tree had 0.
 *
 * Latent until the emitter stopped forcing every layout node to
 * `flex_direction: 'column'`: with no row in the tree there was no child to "fix".
 */
describe('normalizeV3Tree flex-row widths', () => {
  it('puts a widget width on the Advanced-tab pair, not on a `width` control', () => {
    // `width` is not a control of `spacer` at all, and an unknown key makes
    // Elementor reject the WHOLE write — a page-scale loss from one setting.
    const { tree } = normalizeV3Tree(flexRowWithMixedChildren());
    const spacer = (tree[0] as TestNode).elements![0]!;
    expect(spacer.settings).not.toHaveProperty('width');
    expect(spacer.settings?._element_width).toBe('initial');
    expect(spacer.settings?._element_custom_width).toEqual({ unit: '%', size: 25, sizes: [] });
  });

  it('gives a container the slider shape plus the companion that renders it', () => {
    // On `__container__`, `width` is a slider gated on `content_width: 'full'`.
    // The string "33.33%" was a wrong-shape error, and without the companion
    // Elementor stored the value and ignored it.
    const { tree } = normalizeV3Tree(flexRowWithMixedChildren());
    const container = (tree[0] as TestNode).elements![2]!;
    expect(container.settings?.width).toEqual({ unit: '%', size: 25, sizes: [] });
    expect(container.settings?.content_width).toBe('full');
  });

  it('leaves a column alone, which sizes itself through _column_size', () => {
    const { tree } = normalizeV3Tree(flexRowWithMixedChildren());
    const column = (tree[0] as TestNode).elements![3]!;
    expect(column.settings).not.toHaveProperty('width');
    expect(column.settings).not.toHaveProperty('_element_custom_width');
    expect(column.settings?._column_size).toBe(100);
  });

  it('produces a tree the schema gate accepts, where the old shape produced errors', () => {
    // The end-to-end claim: every width this normalizer writes exists on the
    // element it lands on, in the shape that control declares.
    const { tree } = normalizeV3Tree(flexRowWithMixedChildren());
    const report = validateSettingsAgainstSchema(tree as never, SNAPSHOT.widgets);
    expect(report.errorCount).toBe(0);
  });

  it('does not overwrite a source-measured max-width', () => {
    // `boxed_width` comes from a measured `max-width`: the source already said
    // how wide this box may be, and an equal share would replace that.
    const tree: TestNode[] = [{
      id: 'row',
      elType: 'container',
      settings: { flex_direction: 'row' },
      elements: [
        { id: 'sized', elType: 'container', isInner: true, settings: { boxed_width: { unit: 'px', size: 320 } }, elements: [] },
        { id: 'unsized', elType: 'container', isInner: true, settings: {}, elements: [] },
      ],
    }];
    const result = normalizeV3Tree(tree);
    const sized = (result.tree[0] as TestNode).elements![0]!;
    expect(sized.settings).not.toHaveProperty('width');
    // Reported separately from the fixes, so a skip is visible rather than silent.
    expect(result.stats.flexRowWidthSkipped).toBe(1);
    expect(result.stats.flexRowWidthFixed).toBe(1);
  });

  it('still sets isInner on a nested section', () => {
    const tree: TestNode[] = [{
      id: 'outer',
      elType: 'section',
      elements: [{ id: 'inner', elType: 'section', settings: {}, elements: [] }],
    }];
    const result = normalizeV3Tree(tree);
    expect((result.tree[0] as TestNode).elements![0]!.isInner).toBe(true);
    expect(result.stats.nestedIsInnerFixed).toBe(1);
  });
});
