import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { resizeToSameSize, cropPngSafe } from '@elconv/qa';

function makePng(width: number, height: number, r = 255, g = 255, b = 255): PNG {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  }
  return png;
}

describe('resizeToSameSize', () => {
  it('resizes a 1280x800 clone to match a 1440x900 original (Bugfix #1 acceptance case)', async () => {
    const original = makePng(1440, 900, 20, 40, 60);
    const clone = makePng(1280, 800, 20, 40, 60);
    const [a, b] = await resizeToSameSize(original, clone);
    expect(a.width).toBe(1440);
    expect(a.height).toBe(900);
    expect(b.width).toBe(1440);
    expect(b.height).toBe(900);
  });

  it('leaves equally-sized images untouched (returns same references)', async () => {
    const original = makePng(100, 100);
    const clone = makePng(100, 100);
    const [a, b] = await resizeToSameSize(original, clone);
    expect(a).toBe(original);
    expect(b).toBe(clone);
  });

  it('resizes to the larger dimension on each axis independently', async () => {
    const original = makePng(50, 200);
    const clone = makePng(200, 50);
    const [a, b] = await resizeToSameSize(original, clone);
    expect(a.width).toBe(200);
    expect(a.height).toBe(200);
    expect(b.width).toBe(200);
    expect(b.height).toBe(200);
  });
});

describe('cropPngSafe', () => {
  it('crops a sub-region of the requested size', () => {
    const src = makePng(100, 100, 10, 20, 30);
    const cropped = cropPngSafe(src, 10, 10, 30, 40);
    expect(cropped.width).toBe(30);
    expect(cropped.height).toBe(40);
    expect(cropped.data[0]).toBe(10);
    expect(cropped.data[1]).toBe(20);
    expect(cropped.data[2]).toBe(30);
  });

  it('clamps an out-of-bounds region instead of throwing', () => {
    const src = makePng(50, 50);
    expect(() => cropPngSafe(src, 40, 40, 100, 100)).not.toThrow();
    const cropped = cropPngSafe(src, 40, 40, 100, 100);
    expect(cropped.width).toBeLessThanOrEqual(50);
    expect(cropped.height).toBeLessThanOrEqual(50);
  });
});
