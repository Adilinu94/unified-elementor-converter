import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_VIEWPORTS,
  FontUrlCollector,
  CURATED_PROPERTIES,
  DEFAULT_VALUES,
  extractFromUrl,
} from '@elconv/extractors';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe('Browser Extraction Types', () => {
  it('has 3 default viewports', () => {
    expect(DEFAULT_VIEWPORTS).toHaveLength(3);
    expect(DEFAULT_VIEWPORTS[0]).toEqual({ label: 'desktop', width: 1440, height: 900 });
  });

  it('FontUrlCollector classifies woff2', () => {
    const collector = new FontUrlCollector();
    expect(collector.classifyUrl('https://example.com/font.woff2')).toBe('woff2');
    expect(collector.classifyUrl('https://fonts.googleapis.com/css2?family=Inter')).toBe('google-fonts-css');
    expect(collector.classifyUrl('https://example.com/font.ttf?v=2')).toBe('truetype');
  });

  it('CURATED_PROPERTIES has 60+ entries', () => {
    expect(CURATED_PROPERTIES.length).toBeGreaterThanOrEqual(60);
  });

  it('DEFAULT_VALUES filters common defaults', () => {
    expect(DEFAULT_VALUES['display']).toContain('block');
    expect(DEFAULT_VALUES['opacity']).toContain('1');
  });

  it('exports extractFromUrl function', () => {
    expect(typeof extractFromUrl).toBe('function');
  });

  it('keeps provenance for small inline SVGs extracted from the DOM', async () => {
    const outputDir = join(tmpdir(), `elconv-browser-extraction-${Date.now()}`);
    temporaryDirectories.push(outputDir);
    const html = '<!doctype html><html><body><div id="icon-host"><svg><path/></svg></div></body></html>';
    const result = await extractFromUrl({
      url: `data:text/html,${encodeURIComponent(html)}`,
      outputDir,
      viewports: [{ label: 'desktop', width: 800, height: 600 }],
      screenshots: false,
      waitForHydration: false,
      scrollForLazyLoad: false,
      detectAnimations: false,
      detectSections: false,
    });

    expect(result.svgs).toHaveLength(1);
    expect(result.svgs[0]).toMatchObject({
      kind: 'inline',
      sourceElement: '#icon-host > svg',
    });
  });
});
