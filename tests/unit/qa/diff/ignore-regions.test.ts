import { describe, it, expect, vi } from 'vitest';
import { PNG } from 'pngjs';
import { applyIgnoreMask, detectDynamicRegions } from '@elconv/qa';

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

function pixelAt(png: PNG, x: number, y: number): [number, number, number, number] {
  const idx = (png.width * y + x) << 2;
  return [png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]];
}

describe('applyIgnoreMask', () => {
  it('paints the given regions neutral gray and leaves the rest untouched', () => {
    const png = makePng(20, 20, 0, 0, 0);
    const masked = applyIgnoreMask(png, [{ x: 5, y: 5, width: 4, height: 4, reason: 'carousel' }]);
    expect(pixelAt(masked, 6, 6)).toEqual([128, 128, 128, 255]);
    expect(pixelAt(masked, 0, 0)).toEqual([0, 0, 0, 255]);
  });

  it('clamps a region that extends past the image bounds instead of throwing', () => {
    const png = makePng(10, 10);
    expect(() => applyIgnoreMask(png, [{ x: 8, y: 8, width: 20, height: 20, reason: 'ad' }])).not.toThrow();
  });

  it('does not mutate the original PNG (returns a copy)', () => {
    const png = makePng(10, 10, 0, 0, 0);
    applyIgnoreMask(png, [{ x: 0, y: 0, width: 10, height: 10, reason: 'ad' }]);
    expect(pixelAt(png, 0, 0)).toEqual([0, 0, 0, 255]);
  });
});

describe('detectDynamicRegions', () => {
  it('returns bounding boxes with their detection reason from page.evaluate', async () => {
    const mockPage = {
      evaluate: vi.fn().mockResolvedValue([
        { x: 0, y: 100, width: 1440, height: 400, reason: 'carousel' },
        { x: 1300, y: 20, width: 100, height: 30, reason: 'timestamp' },
      ]),
    } as any;

    const regions = await detectDynamicRegions(mockPage);
    expect(regions).toHaveLength(2);
    expect(regions[0].reason).toBe('carousel');
    expect(regions[1].reason).toBe('timestamp');
  });

  it('returns an empty array when nothing dynamic is found', async () => {
    const mockPage = { evaluate: vi.fn().mockResolvedValue([]) } as any;
    const regions = await detectDynamicRegions(mockPage);
    expect(regions).toEqual([]);
  });
});
