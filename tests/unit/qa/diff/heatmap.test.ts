import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { PNG } from 'pngjs';
import { generateHeatmap } from '@elconv/qa';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heatmap-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('generateHeatmap', () => {
  it('writes a valid PNG file overlaying the diff onto the original', async () => {
    const originalPath = path.join(tmpDir, 'original.png');
    await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 10, g: 10, b: 10 } },
    })
      .png()
      .toFile(originalPath);

    // A diffMask:true-style diff image: transparent everywhere except one red patch.
    const diff = new PNG({ width: 20, height: 20 });
    for (let y = 5; y < 10; y++) {
      for (let x = 5; x < 10; x++) {
        const idx = (20 * y + x) << 2;
        diff.data[idx] = 255;
        diff.data[idx + 1] = 0;
        diff.data[idx + 2] = 0;
        diff.data[idx + 3] = 255;
      }
    }

    const outputPath = path.join(tmpDir, 'heatmap.png');
    await generateHeatmap(originalPath, diff, outputPath);

    const stat = await fs.stat(outputPath);
    expect(stat.size).toBeGreaterThan(0);

    const outMeta = await sharp(outputPath).metadata();
    expect(outMeta.format).toBe('png');
    expect(outMeta.width).toBe(20);
    expect(outMeta.height).toBe(20);
  });
});
