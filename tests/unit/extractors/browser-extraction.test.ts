import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VIEWPORTS,
  FontUrlCollector,
  CURATED_PROPERTIES,
  DEFAULT_VALUES,
  extractFromUrl,
} from '@elconv/extractors';

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
});
