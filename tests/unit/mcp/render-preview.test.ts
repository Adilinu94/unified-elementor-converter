import { describe, it, expect } from 'vitest';
import { buildRenderPreviewCall, buildRenderPreviewWorkflow, parseRenderPreviewResponse } from '@elconv/mcp';

describe('buildRenderPreviewCall', () => {
  it('defaults viewportWidth to 1440', () => {
    const call = buildRenderPreviewCall({ elementJson: '[]' });
    expect(call.params.viewport_width).toBe(1440);
  });

  it('carries through an explicit viewportWidth and tempPostId', () => {
    const call = buildRenderPreviewCall({ elementJson: '[]', tempPostId: 5, viewportWidth: 375 });
    expect(call.params).toEqual({ element_json: '[]', temp_post_id: 5, viewport_width: 375 });
  });
});

describe('buildRenderPreviewWorkflow', () => {
  it('returns exactly 4 steps: create post, inject content, collect styles, cleanup', () => {
    const steps = buildRenderPreviewWorkflow({ elementJson: '[{"id":"a"}]' });
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.step)).toEqual([1, 2, 3, 4]);
  });

  it('step 2 injects the given elementJson as page content', () => {
    const steps = buildRenderPreviewWorkflow({ elementJson: '[{"id":"a"}]' });
    expect(steps[1]!.params.content).toBe('[{"id":"a"}]');
  });

  it('every step referencing the temp post uses the SAME placeholder token, so a single substitution pass covers all of them', () => {
    const steps = buildRenderPreviewWorkflow({ elementJson: '[]' });
    const asText = JSON.stringify(steps);
    // Steps 2 and 4 both need the real post ID substituted in by whatever
    // executes this workflow. If they used different placeholder spellings,
    // a single find/replace pass over the plan would silently miss one.
    expect((asText.match(/__TEMP_POST_ID__/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('parseRenderPreviewResponse', () => {
  it('parses a successful response into html/computedStyles/boundingBoxes', () => {
    const result = parseRenderPreviewResponse({
      html: '<div>x</div>',
      styles: { a: { color: 'red' } },
      boxes: { a: { x: 0, y: 0, width: 10, height: 10 } },
      renderTimeMs: 123,
    });
    expect(result.success).toBe(true);
    expect(result.html).toBe('<div>x</div>');
    expect(result.computedStyles).toEqual({ a: { color: 'red' } });
    expect(result.renderTimeMs).toBe(123);
  });

  it('treats a null/undefined response as a failure with a descriptive error, not a throw', () => {
    const result = parseRenderPreviewResponse(null);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.html).toBe('');
  });

  it('defaults missing fields on an otherwise-valid response rather than throwing', () => {
    const result = parseRenderPreviewResponse({});
    expect(result.success).toBe(true);
    expect(result.html).toBe('');
    expect(result.computedStyles).toEqual({});
    expect(result.renderTimeMs).toBe(0);
  });
});
