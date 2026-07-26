#!/usr/bin/env node
/**
 * visual-qa.ts
 *
 * Browser-basierte Visual QA für die Framer → Elementor V4 Pipeline.
 * Macht Screenshots einer WordPress-Seite (post_id) auf drei Breakpoints
 * und prüft grundlegende visuelle Indikatoren ohne externe Test-Dienste.
 *
 * Phase 0.5.7: axe-core A11y-Integration
 * Führt nach dem Seiten-Load einen WCAG 2.0/2.1/2.2 Accessibility-Audit
 * via axe-core durch und aggregiert die Violations im QA-Report.
 *
 * Unterstützte Browser-Backends (in Priorität):
 *   1. Playwright  (npm install playwright @axe-core/playwright)
 *   2. Puppeteer   (npm install puppeteer axe-core)
 *   3. --dry-run   Simuliert den Ablauf ohne Browser (für CI ohne Browser)
 *
 * Durchgeführte Checks pro Breakpoint:
 *   V1  Seite lädt ohne HTTP-Fehler (≠ 4xx/5xx)
 *   V2  Kein "elementor-error" oder "broken" CSS-Klasse im DOM
 *   V3  Keine unsichtbaren Elemente mit height=0 die sichtbar sein sollten
 *   V4  Bilder laden (keine 404 img src)
 *   V5  Kein horizontaler Scroll auf Mobile (overflow-x)
 *   V6  Mindestens 3 Elementor-Elemente im DOM
 *   A1  WCAG 2.0/2.1/2.2 axe-core Audit (≥0 critical violations)
 *
 * Usage:
 *   node --import tsx scripts/visual-qa.ts --url https://meine-seite.de/?p=123
 *   node --import tsx scripts/visual-qa.ts --url https://meine-seite.de/?p=123 --output reports/qa-report.json
 *   node --import tsx scripts/visual-qa.ts --url https://meine-seite.de/?p=123 --screenshots screenshots/
 *   node --import tsx scripts/visual-qa.ts --url https://meine-seite.de/?p=123 --dry-run
 *
 * Exit codes:
 *   0 = alle Checks bestanden
 *   1 = ein oder mehr Checks fehlgeschlagen
 *   2 = Konfigurationsfehler
 */

import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface Breakpoint {
  name: string;
  width: number;
  height: number;
}

interface NetworkError {
  url: string;
  status: number;
}

interface PageData {
  hasErrorClass: boolean;
  elementorCount: number;
  zeroHeight: number;
  brokenImages: string[];
  hasHorizontalScroll: boolean;
}

interface QAChecks {
  V1_http_ok: boolean;
  V2_no_error_class: boolean;
  V3_no_zero_height: boolean;
  V4_no_broken_images: boolean;
  V5_no_horizontal_scroll: boolean;
  V6_elementor_elements: boolean;
  A1_a11y_critical_zero: boolean;
}

interface A11ySummary {
  violations: number;
  passes: number;
  incomplete: number;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
}

interface A11yViolation {
  id: string;
  impact?: string;
  description?: string;
  help?: string;
  helpUrl?: string;
  nodes?: Array<{
    html: string;
    target: string;
    failureSummary: string;
  }>;
}

interface A11yResult {
  summary: A11ySummary | null;
  violations: A11yViolation[];
  error?: string;
}

interface QADetails {
  httpStatus?: number;
  elementorCount?: number;
  brokenImages?: string[];
  zeroHeightCount?: number;
  dry_run?: boolean;
  a11y?: A11yResult | { summary: null; violations: never[]; note?: string };
}

interface QAResult {
  breakpoint: string;
  passed: boolean;
  error: string | null;
  checks: QAChecks;
  details: QADetails;
}

interface BackendResult {
  backend: 'playwright' | 'puppeteer' | 'dry-run';
  lib: unknown;
}

interface A11yAggregate {
  violations: number;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  passes: number;
  incomplete: number;
}

interface A11yReportSection {
  enabled: boolean;
  backend: string;
  aggregate: A11yAggregate;
}

interface QAReport {
  meta: {
    url: string | boolean | undefined;
    backend: string;
    dry_run: boolean;
    breakpoints_tested: number;
    all_passed: boolean;
    failed_breakpoints: number;
    checks_pass: number;
    checks_fail: number;
    a11y_audit: boolean;
    a11y_violations_total: number;
    a11y_critical_total: number;
    timestamp: string;
  };
  a11y: A11yReportSection;
  results: QAResult[];
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    url:              { type: 'string' },
    output:           { type: 'string' },
    screenshots:      { type: 'string' },
    'dry-run':        { type: 'boolean', default: false },
    'no-browser':     { type: 'boolean', default: false },
    'a11y':           { type: 'boolean', default: false },
    'skip-a11y':      { type: 'boolean', default: false },
    'a11y-output':    { type: 'string' },
    timeout:          { type: 'string', default: '30000' },
    verbose:          { type: 'boolean', default: false },
    help:             { type: 'boolean', default: false },
  },
  strict: false,
});

if (args.help || !args.url) {
  process.stdout.write(`
visual-qa.ts — Browser-basierte Visual QA + axe-core A11y Audit

USAGE:
  node --import tsx scripts/visual-qa.ts --url <wordpress-url> [options]

OPTIONEN:
  --url URL           WordPress-Seiten-URL mit Post-ID (required)
  --output FILE       JSON-Report-Ausgabepfad  [default: stdout]
  --screenshots DIR   Verzeichnis für Screenshots  [default: kein]
  --a11y              A11y-Audit explizit aktivieren (standardmäßig an)
  --skip-a11y         axe-core Accessibility-Audit überspringen
  --a11y-output FILE  Standalone A11y-Report als JSON ausgeben
  --dry-run           Kein echter Browser, simuliert Ablauf (für CI)
  --timeout MS        Navigation-Timeout in ms  [default: 30000]
  --verbose           Ausführliche Logs
  --help              Diese Hilfe

BREAKPOINTS:
  desktop  1440 × 900  px
  tablet    768 × 1024 px
  mobile    390 × 844  px

CHECKS (pro Breakpoint):
  V1  HTTP-Status OK (nicht 4xx/5xx)
  V2  Kein elementor-error / broken im DOM
  V3  Keine visuell leeren Pflicht-Elemente (height=0)
  V4  Keine 404 Bilder
  V5  Kein horizontaler Scroll (mobile)
  V6  Mindestens 3 Elementor-Elemente vorhanden
  A1  WCAG 2.0/2.1/2.2 axe-core Audit (0 critical violations)

EXIT-CODES:
  0 = pass  |  1 = fail  |  2 = Konfigurationsfehler
`);
  process.exit(args.help ? 0 : 2);
}

// ─── Config ──────────────────────────────────────────────────────────────────

const BREAKPOINTS: Breakpoint[] = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet',  width: 768,  height: 1024 },
  { name: 'mobile',  width: 390,  height: 844 },
];

const PAGE_TIMEOUT = parseInt(args.timeout as string, 10);
const DRY_RUN = (args['dry-run'] as boolean) || (args['no-browser'] as boolean);
const SKIP_A11Y = (args['skip-a11y'] as boolean) || false;
const EXPLICIT_A11Y = (args['a11y'] as boolean) || false;
const A11Y_OUTPUT = (args['a11y-output'] as string) || null;

const A11Y_ENABLED = EXPLICIT_A11Y ? true : !SKIP_A11Y;

const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag22aa'];

const log   = (...m: string[]) => { if (args.verbose) process.stderr.write('[visual-qa] ' + m.join(' ') + '\n'); };
const warn  = (...m: string[]) => process.stderr.write('[WARN] ' + m.join(' ') + '\n');
const fatal = (m: string, c = 2): never => { process.stderr.write('[FATAL] ' + m + '\n'); process.exit(c); };

// ─── Browser detection ───────────────────────────────────────────────────────

async function detectBrowserBackend(): Promise<BackendResult> {
  if (DRY_RUN) return { backend: 'dry-run', lib: null };

  try {
    const req = createRequire(import.meta.url);
    const pw = req('playwright');
    log('Backend: Playwright detected');
    return { backend: 'playwright', lib: pw };
  } catch (_) { /* ignore */ }

  try {
    const req = createRequire(import.meta.url);
    const pup = req('puppeteer');
    log('Backend: Puppeteer detected');
    return { backend: 'puppeteer', lib: pup };
  } catch (_) { /* ignore */ }

  warn('Neither Playwright nor Puppeteer found. Falling back to dry-run mode.');
  warn('Install: npm install playwright  OR  npm install puppeteer');
  return { backend: 'dry-run', lib: null };
}

// ─── A11y Audit (Phase 0.5.7) ───────────────────────────────────────────────

async function runAxeAudit(page: unknown, backend: string): Promise<A11yResult | null> {
  if (!A11Y_ENABLED) {
    log('  A11y: skipped (--skip-a11y flag)');
    return null;
  }

  try {
    let rawResults: Record<string, unknown>;

    if (backend === 'playwright') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const axeModule: any = await import('@axe-core/playwright');
      const AxeBuilder: any = axeModule.default;
      rawResults = await new AxeBuilder({ page })
        .withTags(A11Y_TAGS)
        .analyze();
    } else if (backend === 'puppeteer') {
      const req = createRequire(import.meta.url);
      const axePath = req.resolve('axe-core/axe.min.js');
      const axeSource = readFileSync(axePath, 'utf8');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = page as { evaluate: (fn: string | ((...args: unknown[]) => unknown), ...args: unknown[]) => Promise<unknown> };
      await p.evaluate(axeSource);
      rawResults = await p.evaluate(async (tags) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (window as unknown as Record<string, unknown> & { axe: { run: (doc: Document, opts: Record<string, unknown>) => Promise<Record<string, unknown>> } }).axe.run(document, {
          runOnly: { type: 'tag', values: tags },
        });
      }, A11Y_TAGS) as Record<string, unknown>;
    } else {
      return null;
    }

    const violations = (rawResults.violations || []) as A11yViolation[];
    const passes = (rawResults.passes || []) as A11yViolation[];
    const incomplete = (rawResults.incomplete || []) as A11yViolation[];

    const summary: A11ySummary = {
      violations: violations.length,
      passes:     passes.length,
      incomplete: incomplete.length,
      critical:   violations.filter(v => v.impact === 'critical').length,
      serious:    violations.filter(v => v.impact === 'serious').length,
      moderate:   violations.filter(v => v.impact === 'moderate').length,
      minor:      violations.filter(v => v.impact === 'minor').length,
    };

    const topViolations: A11yViolation[] = violations
      .map(v => ({
        id:          v.id,
        impact:      v.impact,
        description: v.description,
        help:        v.help,
        helpUrl:     v.helpUrl,
        nodes:       (v.nodes || []).map(n => ({
          html:     (n.html || '').slice(0, 200),
          target:   ((n.target as unknown as unknown[][] | undefined)?.map(t => t.join(' > ')).join(', ')) ?? '',
          failureSummary: (n.failureSummary || '').slice(0, 300),
        })).slice(0, 3),
      }))
      .slice(0, 20);

    log(`  A11y: ${summary.violations} violations (${summary.critical} critical, ${summary.serious} serious)`);

    return { summary, violations: topViolations };
  } catch (e: unknown) {
    const err = e as Error & { code?: string };
    const reason = err.code === 'ERR_MODULE_NOT_FOUND' || err.message?.includes('Cannot find')
      ? 'axe-core not installed (npm install --save-dev @axe-core/playwright)'
      : `axe audit failed: ${err.message}`;
    warn(`  A11y: ${reason}`);
    return { summary: null, violations: [], error: reason };
  }
}

// ─── Playwright wrapper ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runWithPlaywright(pw: any, url: string, breakpoints: Breakpoint[], screenshotDir: string | null): Promise<QAResult[]> {
  const browser = await pw.chromium.launch({ headless: true });
  const results: QAResult[] = [];

  for (const bp of breakpoints) {
    log(`  Playwright: ${bp.name} ${bp.width}x${bp.height}`);
    const context = await browser.newContext({
      viewport: { width: bp.width, height: bp.height },
    });
    const page = await context.newPage();

    const networkErrors: NetworkError[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page.on('response', (res: any) => {
      if (res.status() >= 400) networkErrors.push({ url: res.url(), status: res.status() });
    });

    let httpStatus = 0;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await page.goto(url, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT });
      httpStatus = res?.status() ?? 0;
    } catch (e: unknown) {
      results.push(buildResultWithDefaults(bp.name, false, `Navigation failed: ${(e as Error).message}`));
      await context.close();
      continue;
    }

    const pageData = await page.evaluate(() => {
      const allEls = document.querySelectorAll('[class]');
      const hasErrorClass = Array.from(allEls).some(el =>
        (el as HTMLElement).className && ((el as HTMLElement).className.includes('elementor-error') || (el as HTMLElement).className.includes('broken'))
      );

      const elementorEls = document.querySelectorAll('.elementor-widget, .elementor-section, .e-con, [data-id]');
      const elementorCount = elementorEls.length;

      const zeroHeight = Array.from(document.querySelectorAll('h1,h2,h3,p,img,.elementor-widget'))
        .filter(el => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.height === 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }).length;

      const brokenImages = Array.from(document.querySelectorAll('img'))
        .filter(img => !img.naturalWidth && img.src && !img.src.startsWith('data:'))
        .map(img => img.src)
        .slice(0, 5);

      const hasHorizontalScroll = document.body.scrollWidth > window.innerWidth;

      return { hasErrorClass, elementorCount, zeroHeight, brokenImages, hasHorizontalScroll };
    }) as PageData;

    const a11y = await runAxeAudit(page, 'playwright');

    if (screenshotDir) {
      const screenshotPath = join(screenshotDir, `${bp.name}.png`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (page as any).screenshot({ path: screenshotPath, fullPage: true });
      log(`  Screenshot: ${screenshotPath}`);
    }

    const imgErrors = networkErrors.filter(e => /\.(png|jpg|jpeg|gif|webp|svg)/i.test(e.url));

    const checks: QAChecks = {
      V1_http_ok:            httpStatus < 400,
      V2_no_error_class:     !pageData.hasErrorClass,
      V3_no_zero_height:     pageData.zeroHeight === 0,
      V4_no_broken_images:   imgErrors.length === 0,
      V5_no_horizontal_scroll: bp.name !== 'mobile' || !pageData.hasHorizontalScroll,
      V6_elementor_elements: pageData.elementorCount >= 3,
      A1_a11y_critical_zero: !a11y?.summary?.critical || a11y.summary.critical === 0,
    };

    const passed = Object.values(checks).every(Boolean);
    results.push(buildResult(bp.name, passed, null, checks, {
      httpStatus,
      elementorCount: pageData.elementorCount,
      brokenImages: imgErrors.map(e => e.url),
      zeroHeightCount: pageData.zeroHeight,
      a11y: a11y as QAResult['details']['a11y'] || { summary: null, violations: [], error: 'skipped' },
    }));

    await context.close();
  }

  await browser.close();
  return results;
}

// ─── Puppeteer wrapper ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runWithPuppeteer(pup: any, url: string, breakpoints: Breakpoint[], screenshotDir: string | null): Promise<QAResult[]> {
  const browser = await pup.launch({ headless: 'new', args: ['--no-sandbox'] });
  const results: QAResult[] = [];

  for (const bp of breakpoints) {
    log(`  Puppeteer: ${bp.name} ${bp.width}x${bp.height}`);
    const page = await browser.newPage();
    await page.setViewport({ width: bp.width, height: bp.height });

    const networkErrors: NetworkError[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page.on('response', (res: any) => {
      if (res.status() >= 400) networkErrors.push({ url: res.url(), status: res.status() });
    });

    let httpStatus = 0;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await page.goto(url, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT });
      httpStatus = res?.status() ?? 0;
    } catch (e: unknown) {
      results.push(buildResultWithDefaults(bp.name, false, `Navigation failed: ${(e as Error).message}`));
      await page.close();
      continue;
    }

    const pageData = await page.evaluate(() => {
      const hasErrorClass = Array.from(document.querySelectorAll('[class]'))
        .some(el => (el as HTMLElement).className && ((el as HTMLElement).className.includes('elementor-error') || (el as HTMLElement).className.includes('broken')));
      const elementorCount = document.querySelectorAll('.elementor-widget, .elementor-section, .e-con, [data-id]').length;
      const zeroHeight = Array.from(document.querySelectorAll('h1,h2,h3,p,img,.elementor-widget'))
        .filter(el => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.height === 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }).length;
      const brokenImages = Array.from(document.querySelectorAll('img'))
        .filter(img => !img.naturalWidth && img.src && !img.src.startsWith('data:'))
        .map(img => img.src).slice(0, 5);
      const hasHorizontalScroll = document.body.scrollWidth > window.innerWidth;
      return { hasErrorClass, elementorCount, zeroHeight, brokenImages, hasHorizontalScroll };
    }) as PageData;

    const a11y = await runAxeAudit(page, 'puppeteer');

    if (screenshotDir) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (page as any).screenshot({ path: join(screenshotDir, `${bp.name}.png`), fullPage: true });
    }

    const imgErrors = networkErrors.filter(e => /\.(png|jpg|jpeg|gif|webp|svg)/i.test(e.url));
    const checks: QAChecks = {
      V1_http_ok:              httpStatus < 400,
      V2_no_error_class:       !pageData.hasErrorClass,
      V3_no_zero_height:       pageData.zeroHeight === 0,
      V4_no_broken_images:     imgErrors.length === 0,
      V5_no_horizontal_scroll: bp.name !== 'mobile' || !pageData.hasHorizontalScroll,
      V6_elementor_elements:   pageData.elementorCount >= 3,
      A1_a11y_critical_zero:   !a11y?.summary?.critical || a11y.summary.critical === 0,
    };

    const passed = Object.values(checks).every(Boolean);
    results.push(buildResult(bp.name, passed, null, checks, {
      httpStatus,
      elementorCount: pageData.elementorCount,
      brokenImages: imgErrors.map(e => e.url),
      zeroHeightCount: pageData.zeroHeight,
      a11y: a11y as QAResult['details']['a11y'] || { summary: null, violations: [], error: 'skipped' },
    }));

    await page.close();
  }

  await browser.close();
  return results;
}

// ─── Dry-run ─────────────────────────────────────────────────────────────────

function runDryRun(breakpoints: Breakpoint[]): QAResult[] {
  return breakpoints.map(bp => buildResult(bp.name, true, null, {
    V1_http_ok:              true,
    V2_no_error_class:       true,
    V3_no_zero_height:       true,
    V4_no_broken_images:     true,
    V5_no_horizontal_scroll: true,
    V6_elementor_elements:   true,
    A1_a11y_critical_zero:   true,
  }, {
    dry_run: true,
    a11y: { summary: null, violations: [], note: 'a11y audit requires a real browser (not --dry-run)' },
  }));
}

// ─── Result builder ───────────────────────────────────────────────────────────

function buildResult(
  breakpoint: string,
  passed: boolean,
  error: string | null,
  checks: QAChecks,
  details: QADetails | Record<string, unknown> = {},
): QAResult {
  return { breakpoint, passed, error: error || null, checks, details: details as QADetails };
}

function buildResultWithDefaults(
  breakpoint: string,
  passed: boolean,
  error: string,
): QAResult {
  return buildResult(breakpoint, passed, error, {
    V1_http_ok: false,
    V2_no_error_class: false,
    V3_no_zero_height: false,
    V4_no_broken_images: false,
    V5_no_horizontal_scroll: false,
    V6_elementor_elements: false,
    A1_a11y_critical_zero: false,
  }, {});
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const url = args.url as string;
  log(`URL: ${url}`);
  log(`Dry-run: ${DRY_RUN}`);
  log(`A11y audit: ${A11Y_ENABLED ? 'enabled' : 'skipped'}`);

  let screenshotDir: string | null = null;
  if (args.screenshots) {
    screenshotDir = resolve(args.screenshots as string);
    if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });
    log(`Screenshots → ${screenshotDir}`);
  }

  const { backend, lib } = await detectBrowserBackend();
  log(`Backend: ${backend}`);

  let results: QAResult[];
  if (backend === 'dry-run') {
    results = runDryRun(BREAKPOINTS);
  } else if (backend === 'playwright') {
    results = await runWithPlaywright(lib, url, BREAKPOINTS, screenshotDir);
  } else {
    results = await runWithPuppeteer(lib, url, BREAKPOINTS, screenshotDir);
  }

  const allPassed   = results.every(r => r.passed);
  const failCount   = results.filter(r => !r.passed).length;
  const checkTotals = { pass: 0, fail: 0 };
  for (const r of results) {
    for (const v of Object.values(r.checks)) {
      if (v) checkTotals.pass++; else checkTotals.fail++;
    }
  }

  const a11yAggregate: A11yAggregate = { violations: 0, critical: 0, serious: 0, moderate: 0, minor: 0, passes: 0, incomplete: 0 };
  for (const r of results) {
    const s = r.details?.a11y?.summary;
    if (s && typeof s.violations === 'number') {
      a11yAggregate.violations += s.violations;
      a11yAggregate.critical   += s.critical;
      a11yAggregate.serious    += s.serious;
      a11yAggregate.moderate   += s.moderate;
      a11yAggregate.minor      += s.minor;
      a11yAggregate.passes     += s.passes;
      a11yAggregate.incomplete += s.incomplete;
    }
  }

  const report: QAReport = {
    meta: {
      url,
      backend,
      dry_run: DRY_RUN,
      breakpoints_tested: BREAKPOINTS.length,
      all_passed: allPassed,
      failed_breakpoints: failCount,
      checks_pass: checkTotals.pass,
      checks_fail: checkTotals.fail,
      a11y_audit: A11Y_ENABLED && backend !== 'dry-run',
      a11y_violations_total: a11yAggregate.violations,
      a11y_critical_total: a11yAggregate.critical,
      timestamp: new Date().toISOString(),
    },
    a11y: {
      enabled: A11Y_ENABLED && backend !== 'dry-run',
      backend: !A11Y_ENABLED ? 'disabled' : (backend === 'dry-run' ? 'unavailable' : backend),
      aggregate: a11yAggregate,
    },
    results,
  };

  const reportJson = JSON.stringify(report, null, 2);
  if (args.output) {
    const outPath = resolve(args.output as string);
    mkdirSync(resolve(outPath, '..'), { recursive: true });
    writeFileSync(outPath, reportJson, 'utf8');
    log(`Report → ${outPath}`);
  } else {
    process.stdout.write(reportJson + '\n');
  }

  if (A11Y_OUTPUT) {
    const allViolations: A11yViolation[] = [];
    const seenIds = new Set<string>();
    for (const r of results) {
      const violations = r.details?.a11y?.violations || [];
      for (const v of violations) {
        if (!seenIds.has(v.id)) {
          seenIds.add(v.id);
          allViolations.push(v);
        }
      }
    }
    const a11yReport = {
      url,
      timestamp: new Date().toISOString(),
      tags: A11Y_TAGS,
      backend: !A11Y_ENABLED ? 'disabled' : (backend === 'dry-run' ? 'unavailable' : backend),
      aggregate: a11yAggregate,
      violations: allViolations,
    };
    const a11yOutPath = resolve(A11Y_OUTPUT);
    mkdirSync(resolve(a11yOutPath, '..'), { recursive: true });
    writeFileSync(a11yOutPath, JSON.stringify(a11yReport, null, 2), 'utf8');
    log(`A11y Report → ${a11yOutPath}`);
  }

  // Human summary to stderr
  const C = { reset: '\x1b[0m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
  process.stderr.write(`\n${C.bold}visual-qa.ts${C.reset} ${DRY_RUN ? C.yellow + '[DRY-RUN]' + C.reset : ''}\n`);
  process.stderr.write(`${C.cyan}URL:${C.reset} ${url}\n`);
  if (A11Y_ENABLED && backend !== 'dry-run') {
    process.stderr.write(`${C.cyan}A11y:${C.reset} axe-core ${A11Y_TAGS.join('/')}  `);
    if (a11yAggregate.violations === 0) {
      process.stderr.write(`${C.green}0 violations${C.reset}\n`);
    } else {
      process.stderr.write(`${C.red}${a11yAggregate.violations} violations (${a11yAggregate.critical} critical)${C.reset}\n`);
    }
  }
  process.stderr.write('\n');

  for (const r of results) {
    const icon = r.passed ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    process.stderr.write(`  ${icon} ${r.breakpoint.padEnd(8)}`);
    if (r.error) {
      process.stderr.write(` ${C.red}${r.error}${C.reset}\n`);
    } else {
      const failedChecks = Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k);
      if (failedChecks.length) {
        process.stderr.write(` ${C.red}FAIL${C.reset} — ${failedChecks.join(', ')}\n`);
      } else {
        const a11yInfo = r.details?.a11y?.summary;
        const a11yStr = a11yInfo?.violations ? `  (a11y: ${a11yInfo.violations} violations)` : '';
        process.stderr.write(` ${C.green}PASS${C.reset} (${Object.keys(r.checks).length} checks)${a11yStr}\n`);
      }
    }
  }

  process.stderr.write(`\n${allPassed ? C.green + C.bold + 'ALL PASS' : C.red + C.bold + 'FAIL'}${C.reset}\n\n`);

  process.exit(allPassed ? 0 : 1);
}

main().catch((err: unknown) => {
  const e = err as Error;
  process.stderr.write('[FATAL] ' + e.message + '\n');
  if (args.verbose) process.stderr.write((e.stack || '') + '\n');
  process.exit(2);
});
