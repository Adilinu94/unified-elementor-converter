import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { diffMultiViewport, VIEWPORT_PRESETS } from '@elconv/qa';
import type { ViewportScreenshot } from '@elconv/core';

let tmpDir: string;

function solidPng(width: number, height: number, r: number, g: number, b: number): PNG {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  }
  return png;
}

async function writeShot(name: string, png: PNG): Promise<string> {
  const filePath = path.join(tmpDir, name);
  await fs.writeFile(filePath, PNG.sync.write(png));
  return filePath;
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-viewport-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('diffMultiViewport', () => {
  it('produces one score per matched viewport across all 4 presets', async () => {
    const viewports: Array<'mobile' | 'tablet' | 'desktop' | 'wide'> = ['mobile', 'tablet', 'desktop', 'wide'];
    const originalShots: ViewportScreenshot[] = [];
    const cloneShots: ViewportScreenshot[] = [];

    for (const vp of viewports) {
      const { width, height } = VIEWPORT_PRESETS[vp];
      // small stand-ins for the real preset dimensions, just tagged with the same viewport name
      const w = Math.min(width, 40);
      const h = Math.min(height, 40);
      const origPath = await writeShot(`${vp}-orig.png`, solidPng(w, h, 10, 20, 30));
      // mobile clone deliberately way off, everything else matches
      const clonePath = await writeShot(
        `${vp}-clone.png`,
        vp === 'mobile' ? solidPng(w, h, 250, 250, 250) : solidPng(w, h, 10, 20, 30),
      );
      originalShots.push({ viewport: vp, path: origPath });
      cloneShots.push({ viewport: vp, path: clonePath });
    }

    const report = await diffMultiViewport(originalShots, cloneShots, []);

    expect(Object.keys(report.perViewport).sort()).toEqual(['desktop', 'mobile', 'tablet', 'wide']);
    expect(report.perViewport.mobile.score).toBeLessThan(report.perViewport.desktop.score);
    expect(report.worstViewport).toBe('mobile');
    expect(report.aggregatedScore).toBeGreaterThan(0);
  });

  it('only reports viewports present in both original and clone screenshot sets', async () => {
    const origPath = await writeShot('desktop-only-orig.png', solidPng(20, 20, 1, 2, 3));
    const clonePath = await writeShot('desktop-only-clone.png', solidPng(20, 20, 1, 2, 3));
    const report = await diffMultiViewport(
      [{ viewport: 'desktop', path: origPath }],
      [{ viewport: 'desktop', path: clonePath }],
      [],
    );
    expect(Object.keys(report.perViewport)).toEqual(['desktop']);
  });

  it('returns a zero aggregated score with no worst/best viewport when nothing matches', async () => {
    const report = await diffMultiViewport([], [], []);
    expect(report.aggregatedScore).toBe(0);
    expect(report.worstViewport).toBeUndefined();
    expect(report.bestViewport).toBeUndefined();
  });
});
