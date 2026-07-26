import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { diffByBlocks } from '@elconv/qa';
import type { SectionInfo } from '@elconv/extractors';

const WIDTH = 100;
const SECTION_HEIGHT = 50;
const SECTIONS: SectionInfo[] = [0, 1, 2, 3].map((i) => ({
  section_id: `section-${i}`,
  selector: `#section-${i}`,
  y_range: [i * SECTION_HEIGHT, (i + 1) * SECTION_HEIGHT],
  layout: 'block',
  child_count: 1,
}));

function makeSolidPage(colorPerSection: [number, number, number][]): PNG {
  const height = colorPerSection.length * SECTION_HEIGHT;
  const png = new PNG({ width: WIDTH, height });
  for (let y = 0; y < height; y++) {
    const [r, g, b] = colorPerSection[Math.floor(y / SECTION_HEIGHT)];
    for (let x = 0; x < WIDTH; x++) {
      const idx = (WIDTH * y + x) << 2;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  return png;
}

describe('diffByBlocks', () => {
  it('returns one result per section, with individual scores', async () => {
    const original = makeSolidPage([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
    ]);
    const clone = makeSolidPage([
      [255, 0, 0], // matches
      [0, 255, 0], // matches
      [255, 255, 255], // completely different
      [255, 255, 0], // matches
    ]);

    const results = await diffByBlocks(original, clone, SECTIONS);

    expect(results).toHaveLength(4);
    expect(results.map((r) => r.sectionId)).toEqual(['section-0', 'section-1', 'section-2', 'section-3']);
    expect(results[0].score).toBeGreaterThan(99);
    expect(results[1].score).toBeGreaterThan(99);
    expect(results[2].score).toBeLessThan(50);
    expect(results[3].score).toBeGreaterThan(99);
  });

  it('reports hotspots for a section with a localized diff', async () => {
    const original = makeSolidPage([[0, 0, 0]]);
    const clone = new PNG({ width: WIDTH, height: SECTION_HEIGHT });
    PNG.bitblt(original, clone, 0, 0, WIDTH, SECTION_HEIGHT, 0, 0);
    // Punch a bright square into one corner of the clone only.
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const idx = (WIDTH * y + x) << 2;
        clone.data[idx] = 255;
        clone.data[idx + 1] = 255;
        clone.data[idx + 2] = 255;
        clone.data[idx + 3] = 255;
      }
    }

    const results = await diffByBlocks(original, clone, [SECTIONS[0]]);
    expect(results[0].diffPixels).toBeGreaterThan(0);
    expect(results[0].hotspots.length).toBeGreaterThan(0);
    // The hotspot should sit near the top-left corner where we punched the square.
    expect(results[0].hotspots[0].x).toBeLessThan(WIDTH / 2);
    expect(results[0].hotspots[0].y).toBeLessThan(SECTION_HEIGHT / 2);
  });

  it('resizes mismatched section crops instead of failing', async () => {
    const original = makeSolidPage([[10, 20, 30]]);
    const clone = new PNG({ width: 80, height: SECTION_HEIGHT }); // narrower clone
    for (let i = 0; i < clone.data.length; i += 4) {
      clone.data[i] = 10;
      clone.data[i + 1] = 20;
      clone.data[i + 2] = 30;
      clone.data[i + 3] = 255;
    }
    const results = await diffByBlocks(original, clone, [SECTIONS[0]]);
    expect(results[0].score).toBeGreaterThan(90);
  });
});
