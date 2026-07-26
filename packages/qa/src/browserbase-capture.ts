/**
 * Browserbase Cloud-Browser fallback for visual-capture.ts.
 *
 * Drop-in replacement for the local Playwright capture when the local
 * process cannot reach the target URL (e.g. Claude Web sandbox egress block).
 *
 * Mirrors src/extractor/browserbase-extractor.ts's connection pattern —
 * that file solves the same problem for source-page extraction, this one
 * solves it for the QA diff screenshot capture of the built page.
 *
 * Usage:
 *   BROWSERBASE_API_KEY=bb_live_xxx
 *   BROWSERBASE_PROJECT_ID=proj_xxx
 *   captureScreenshot({ url, outputPath, extractor: 'browserbase' })
 *
 * Cost: ~$0.09/min browser session (Hobby tier: 1000 min/month free).
 */
import { Browserbase } from '@browserbasehq/sdk';
import { chromium } from 'playwright-core';
import { runCapture, type CaptureOptions, type CaptureResult } from './visual-capture.js';

/**
 * Capture a screenshot via a Browserbase Cloud-Browser session.
 *
 * Connects to a remote Chrome instance via CDP, then runs the same
 * capture steps as the local path (goto, wait, screenshot, write file).
 *
 * @throws if BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID are missing.
 */
export async function captureViaCloud(options: CaptureOptions): Promise<CaptureResult> {
  const apiKey = options.browserbaseApiKey ?? process.env['BROWSERBASE_API_KEY'];
  const projectId = options.browserbaseProjectId ?? process.env['BROWSERBASE_PROJECT_ID'];

  if (!apiKey) {
    throw new Error(
      '[visual-capture] Missing API key. Set BROWSERBASE_API_KEY or pass browserbaseApiKey option.',
    );
  }
  if (!projectId) {
    throw new Error(
      '[visual-capture] Missing project ID. Set BROWSERBASE_PROJECT_ID or pass browserbaseProjectId option.',
    );
  }

  const bb = new Browserbase({ apiKey });
  const session = await bb.sessions.create({
    projectId,
    browserSettings: {
      viewport: options.viewport ?? { width: 1440, height: 900 },
    },
  });

  const browser = await chromium.connectOverCDP(session.connectUrl);
  try {
    const contexts = browser.contexts();
    const ctx = contexts[0] ?? (await browser.newContext());
    const pages = ctx.pages();
    // Use existing page if available, otherwise open a new one.
    const page = pages[0] ?? (await ctx.newPage());

    return await runCapture(page, options);
  } finally {
    // Closing the browser ends the Browserbase session automatically.
    await browser.close();
  }
}
