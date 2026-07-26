import { describe, it, expect } from 'vitest';
import {
  assertNoContamination,
  findContamination,
  ContaminationError,
} from '../../../packages/core/src/contamination.ts';

describe('assertNoContamination', () => {
  it('passes clean V3 tree', () => {
    const v3Tree = [{ id: '1', elType: 'container', settings: {} }];
    expect(() => assertNoContamination(v3Tree, 'v3')).not.toThrow();
  });

  it('throws on V4 marker in V3 tree', () => {
    const badTree = [{ id: '1', type: 'e-flexbox', settings: { '$$type': 'size' } }];
    expect(() => assertNoContamination(badTree, 'v3')).toThrow(ContaminationError);
  });

  it('passes clean V4 tree', () => {
    const v4Tree = [{ id: '1', type: 'e-flexbox', elType: 'e-flexbox', settings: {} }];
    expect(() => assertNoContamination(v4Tree, 'v4')).not.toThrow();
  });

  it('throws on V3 marker in V4 tree', () => {
    const badTree = [{ id: '1', elType: 'container', isInner: true }];
    expect(() => assertNoContamination(badTree, 'v4')).toThrow(ContaminationError);
  });

  it('throws with correct target info', () => {
    const badTree = [{ '$$type': 'color' }];
    try {
      assertNoContamination(badTree, 'v3');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ContaminationError);
      expect((e as ContaminationError).target).toBe('v3');
      expect((e as ContaminationError).found).toBe('$$type');
    }
  });

  it('findContamination returns list of violations', () => {
    const badTree = [{ '$$type': 'color', 'e-flexbox': true }];
    const violations = findContamination(badTree, 'v3');
    expect(violations).toContain('$$type');
    expect(violations).toContain('e-flexbox');
  });

  it('findContamination returns empty for clean tree', () => {
    const cleanTree = [{ id: '1', elType: 'widget', widgetType: 'heading' }];
    expect(findContamination(cleanTree, 'v3')).toEqual([]);
  });

  it('detects all V4 markers in V3 tree', () => {
    const badTree = {
      type: 'e-flexbox',
      widget: 'e-heading',
      text: 'e-text',
      btn: 'e-button',
      img: 'e-image',
      block: 'e-div-block',
      grid: 'e-grid',
      html: 'e-html',
      gcv: 'global-color-variable',
      gfv: 'global-font-variable',
      dollar: '$$type',
    };
    const violations = findContamination(badTree, 'v3');
    expect(violations.length).toBeGreaterThanOrEqual(10);
  });
});
