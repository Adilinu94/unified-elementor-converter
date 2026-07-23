import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// These tests require playwright chromium to be installed
// Skip when browser runtime is unavailable
async function hasBrowserRuntime(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const HAS_BROWSER = await hasBrowserRuntime();

describe.skipIf(!HAS_BROWSER)('Browser Extraction Integration', () => {
  it(
    'extracts from a real URL',
    async () => {
      const { extractFromUrl } = await import('@elconv/extractors');
      const outputDir = mkdtempSync(join(tmpdir(), 'elconv-browser-'));
      try {
        const result = await extractFromUrl({
          url: 'https://example.com',
          outputDir,
          screenshots: false,
          detectResponsiveStyles: false,
        });
        expect(result.hostname).toBe('example.com');
        expect(result.dom).toBeTruthy();
        expect(result.dom!.toLowerCase()).toContain('example');
        expect(result.sections.length).toBeGreaterThanOrEqual(0);
      } finally {
        rmSync(outputDir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
