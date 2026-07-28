/**
 * elconv design-critic — Layer-1 Design Critic (computed-style rules, no reference needed).
 * Wires up @elconv/qa's design-critic module (Phase 67), which existed as a
 * library with no CLI entry point before this (point 4 of the 10-item follow-up).
 */
import { optionalFlag } from './args.js';
import { runDesignCritic, type ComputedStyleEntry, type OrchestratorOptions } from '@elconv/qa';

const L1_PROPERTIES = [
  'padding-top', 'padding-bottom', 'font-size', 'line-height',
  'color', 'background-color', 'font-weight', 'width', 'height',
];

export async function cmdDesignCritic(flags: Record<string, string | boolean>): Promise<number> {
  const url = optionalFlag(flags, 'url');
  const viewportWidth = Number(optionalFlag(flags, 'viewport-width') ?? '1440');

  if (!url) {
    process.stderr.write('Error: --url is required for design-critic\n');
    return 2;
  }

  process.stdout.write(`\n🎨 Design Critic (L1 — computed-style rules)\n`);
  process.stdout.write(`  URL:       ${url}\n`);
  process.stdout.write(`  Viewport:  ${viewportWidth}px\n\n`);

  let computedStyles: ComputedStyleEntry[];
  try {
    computedStyles = await captureComputedStyles(url, viewportWidth);
  } catch (err) {
    process.stderr.write(`Error: could not capture computed styles (Playwright unavailable or navigation failed): ${err instanceof Error ? err.message : err}\n`);
    return 1;
  }

  const options: OrchestratorOptions = { url, layers: ['L1-rules'], viewportWidth };
  const report = runDesignCritic(options, computedStyles);

  process.stdout.write(`  Findings (${report.totalFindings}): ${report.criticalCount} critical, ${report.majorCount} major, ${report.minorCount} minor\n`);
  for (const f of report.findings.slice(0, 20)) {
    process.stdout.write(`    [${f.severity}] ${f.selector}: ${f.expected} — actual: ${f.actual}\n`);
  }
  if (report.findings.length > 20) {
    process.stdout.write(`    ... and ${report.findings.length - 20} more\n`);
  }

  process.stdout.write(`\n  Score: ${report.score}/100\n`);
  process.stdout.write(`  Status: ${report.passed ? '✅ PASSED' : '❌ FAILED'} (threshold: score ≥ 85, 0 critical)\n\n`);

  return report.passed ? 0 : 1;
}

/**
 * Capture computed styles + bounding boxes for design-critic L1 rules.
 * Dynamic Playwright import to avoid a hard dependency at CLI startup
 * (matches the pattern already used in cmd-qa.ts).
 */
async function captureComputedStyles(url: string, viewportWidth: number): Promise<ComputedStyleEntry[]> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: viewportWidth, height: 900 } });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    return await page.evaluate((props: string[]) => {
      const nodes = Array.from(document.querySelectorAll('body *')).slice(0, 500);
      const results: Array<{
        selector: string;
        styles: Record<string, string>;
        boundingBox: { x: number; y: number; width: number; height: number };
        textContent?: string;
      }> = [];

      for (const el of nodes) {
        const cs = window.getComputedStyle(el);
        const styles: Record<string, string> = {};
        for (const prop of props) {
          const val = cs.getPropertyValue(prop).trim();
          if (val) styles[prop] = val;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        const tag = el.tagName.toLowerCase();
        const cls = (el as HTMLElement).className;
        const selector = typeof cls === 'string' && cls.trim() ? `${tag}.${cls.trim().split(/\s+/)[0]}` : tag;

        results.push({
          selector,
          styles,
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          textContent: (el.textContent ?? '').trim().slice(0, 100) || undefined,
        });
      }
      return results;
    }, L1_PROPERTIES);
  } finally {
    await browser.close();
  }
}
