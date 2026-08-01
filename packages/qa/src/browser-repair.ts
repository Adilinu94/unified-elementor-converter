/** Browser-backed ports for the retained CLI repair paths. */
import { chromium } from 'playwright';
import type { RepairBlockInput } from '@elconv/core';
import type { Issue } from './issue-detector.js';

export interface BrowserProbeCheck {
  selector: string;
  expectedStyles: Record<string, string>;
  label?: string;
}

export type BrowserProbeRunner = (
  url: string,
  checks: BrowserProbeCheck[],
  waitMs: number,
) => Promise<Array<{
  url: string;
  timestamp: string;
  totalProbes: number;
  passCount: number;
  failCount: number;
  score: number;
  results: Array<{
    selector: string;
    label: string;
    expected: Record<string, string>;
    actual: Record<string, string>;
    match: boolean;
    diffs: Array<{ property: string; expected: string; actual: string; withinTolerance: boolean }>;
    suggestedCSSFix: string | null;
  }>;
}> >;

export function createPlaywrightProbeRunner(): BrowserProbeRunner {
  return async (url, checks, waitMs) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
      if (waitMs > 0) await page.waitForTimeout(waitMs);
      const computed = await page.evaluate((selectors: string[]) => {
        const result: Record<string, Record<string, string>> = {};
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (!element) continue;
          const styles = window.getComputedStyle(element);
          result[selector] = Object.fromEntries(
            Array.from(styles).map((property) => [property, styles.getPropertyValue(property)]),
          );
        }
        return result;
      }, checks.map((check) => check.selector));
      const map = new Map(Object.entries(computed));
      return [runGeometryProbes(url, checks, map)];
    } finally {
      await browser.close();
    }
  };
}

export function createPlaywrightRepairContextProvider(
  cloneUrl: string,
): (issue: Issue, screenshots: { originalPath: string; clonePath: string }) => Promise<RepairBlockInput> {
  return async (issue, screenshots) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(cloneUrl, { waitUntil: 'networkidle', timeout: 60_000 });
      const point = { x: issue.region.x, y: Math.min(issue.region.y, 899) };
      const snapshot = await page.evaluate(({ x, y }) => {
        const element = document.elementsFromPoint(x, y)[0] ?? document.body;
        const style = window.getComputedStyle(element);
        return {
          html: element.outerHTML,
          computedCss: Object.fromEntries(
            Array.from(style).map((property) => [property, style.getPropertyValue(property)]),
          ),
          elementType: element.tagName.toLowerCase(),
          parentHtml: element.parentElement?.outerHTML,
          siblingHtml: Array.from(element.parentElement?.children ?? [])
            .filter((child) => child !== element)
            .slice(0, 5)
            .map((child) => child.outerHTML),
        };
      }, point);
      return {
        originalScreenshotPath: screenshots.originalPath,
        cloneScreenshotPath: screenshots.clonePath,
        html: snapshot.html,
        computedCss: snapshot.computedCss,
        elementType: snapshot.elementType,
        parentHtml: snapshot.parentHtml,
        siblingHtml: snapshot.siblingHtml,
      };
    } finally {
      await browser.close();
    }
  };
}

function runGeometryProbes(
  url: string,
  checks: BrowserProbeCheck[],
  computedStylesMap: Map<string, Record<string, string>>,
) {
  const results = checks.map((check) => {
    const styles = computedStylesMap.get(check.selector) ?? {};
    const diffs = Object.entries(check.expectedStyles)
      .filter(([property, expected]) => styles[property] !== expected)
      .map(([property, expected]) => ({
        property,
        expected,
        actual: styles[property] ?? 'NOT_FOUND',
        withinTolerance: false,
      }));
    return {
      selector: check.selector,
      label: check.label ?? check.selector,
      expected: check.expectedStyles,
      actual: styles,
      match: diffs.length === 0,
      diffs,
      suggestedCSSFix: null,
    };
  });
  const passCount = results.filter((result) => result.match).length;
  return {
    url,
    timestamp: new Date().toISOString(),
    totalProbes: results.length,
    passCount,
    failCount: results.length - passCount,
    results,
    score: results.length === 0 ? 100 : Math.round((passCount / results.length) * 100),
  };
}

