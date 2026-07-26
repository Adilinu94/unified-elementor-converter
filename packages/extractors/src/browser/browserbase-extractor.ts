/**
 * Browserbase Cloud-Browser extractor.
 *
 * Drop-in replacement for playwright-extractor when the local Playwright
 * process cannot reach the target URL (e.g. Claude Web sandbox egress block).
 *
 * The extraction logic (computed styles, font discovery, section detection,
 * asset collection) is identical — only the browser connection differs.
 *
 * Usage:
 *   BROWSERBASE_API_KEY=bb_live_xxx
 *   BROWSERBASE_PROJECT_ID=proj_xxx
 *   node dist/cli/clone-v3.js clone --url https://example.com --extractor browserbase
 *
 * Cost: ~$0.09/min browser session (Hobby tier: 1000 min/month free).
 */
import { Browserbase } from '@browserbasehq/sdk';
import { chromium } from 'playwright-core';
import {
  extractFromPage,
  type ExtractionOptions,
  type ExtractionResult,
} from './playwright-extractor.js';

export interface BrowserbaseExtractorOptions extends ExtractionOptions {
  /** Browserbase API key. Falls back to BROWSERBASE_API_KEY env var. */
  browserbaseApiKey?: string;
  /** Browserbase project ID. Falls back to BROWSERBASE_PROJECT_ID env var. */
  browserbaseProjectId?: string;
}

/**
 * Extract a URL via a Browserbase Cloud-Browser session.
 *
 * Connects to a remote Chrome instance via CDP, then runs the same
 * extraction pipeline as extractFromUrl (computed styles, fonts, sections,
 * assets, design tokens). Returns the same ExtractionResult shape.
 *
 * @throws if BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID are missing.
 */
export async function extractViaCloud(
  url: string,
  options: BrowserbaseExtractorOptions,
): Promise<ExtractionResult> {
  const apiKey = options.browserbaseApiKey ?? process.env['BROWSERBASE_API_KEY'];
  const projectId = options.browserbaseProjectId ?? process.env['BROWSERBASE_PROJECT_ID'];

  if (!apiKey) {
    throw new Error(
      '[browserbase-extractor] Missing API key. Set BROWSERBASE_API_KEY or pass browserbaseApiKey option.',
    );
  }
  if (!projectId) {
    throw new Error(
      '[browserbase-extractor] Missing project ID. Set BROWSERBASE_PROJECT_ID or pass browserbaseProjectId option.',
    );
  }

  const bb = new Browserbase({ apiKey });
  const session = await bb.sessions.create({
    projectId,
    browserSettings: {
      viewport: { width: 1440, height: 900 },
    },
  });

  const browser = await chromium.connectOverCDP(session.connectUrl);
  try {
    const contexts = browser.contexts();
    const ctx = contexts[0] ?? (await browser.newContext());
    const pages = ctx.pages();
    // Use existing page if available, otherwise open a new one.
    const page = pages[0] ?? (await ctx.newPage());

    return await extractFromPage(page, { ...options, url });
  } finally {
    // Closing the browser ends the Browserbase session automatically.
    await browser.close();
  }
}
