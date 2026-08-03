import { chromium, type Browser, type BrowserContextOptions, type Page } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

export interface CaptureOptions {
  url: string;
  outputPath: string;
  viewport?: { width: number; height: number };
  fullPage?: boolean;
  waitForSelector?: string;
  waitMs?: number;
  /** Hard wall-clock budget for a complete capture attempt. */
  timeoutMs?: number;
  /** Maximum time spent waiting for fonts and image decoding per stabilization pass. */
  assetTimeoutMs?: number;
  /** Safety cap for pages that keep growing while lazy-loading or infinite-scrolling. */
  maxScrollSteps?: number;
  /** Safety cap for dynamically growing pages, in CSS pixels. */
  maxScrollHeight?: number;
  /** Optional authenticated browser state; never serialize this into reports. */
  storageState?: BrowserContextOptions['storageState'];
  /**
   * Browser backend.
   * 'local' — local Playwright Chromium (default).
   * 'browserbase' — Browserbase cloud CDP session.
   */
  extractor?: 'local' | 'browserbase';
  browserbaseApiKey?: string;
  browserbaseProjectId?: string;
}

export interface CaptureResult {
  url: string;
  outputPath: string;
  width: number;
  height: number;
  bytes: number;
  capturedAt: string;
}

export type CaptureStatus = 'captured' | 'not-scored' | 'capture-timeout' | 'capture-error';

export type CapturePhase =
  | 'goto'
  | 'selector'
  | 'initial-assets'
  | 'scroll'
  | 'final-assets'
  | 'dom-inspection'
  | 'screenshot'
  | 'png-parse'
  | 'write';

export interface CaptureDiagnostics {
  currentPhase?: CapturePhase;
  phaseDurationsMs: Partial<Record<CapturePhase, number>>;
  elapsedMs: number;
  scrollIterations: number;
  scrollHeightBefore: number;
  scrollHeightAfter: number;
  scrollCapped: boolean;
  assetWaitTimedOut: boolean;
  fontsWaitTimedOut: boolean;
  pendingImages: number;
  lazyImagesPromoted: number;
}

export interface CaptureManifest {
  url: string;
  finalUrl: string;
  httpStatus: number;
  redirectChain: string[];
  title: string;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  bodyLength: number;
  scrollHeight: number;
  contentMarkers: string[];
  errorMarkers: string[];
  fontsReady: boolean;
  images: { total: number; loaded: number; failed: number };
  /** Image counts used by the score gate; fold captures include visible images only. */
  scoredImages?: { total: number; loaded: number; failed: number };
  consoleErrors: string[];
  requestFailures: string[];
  /** Requests retained for diagnostics but classified as non-blocking for visual scoring. */
  nonBlockingRequestFailures?: string[];
  /** Request failures that remain score-blocking after resource relevance classification. */
  blockingRequestFailures?: string[];
  /** Console errors retained for diagnostics but classified as non-blocking for visual scoring. */
  nonBlockingConsoleErrors?: string[];
  /** Console errors that remain score-blocking after resource relevance classification. */
  blockingConsoleErrors?: string[];
  screenshotPath?: string;
  screenshot?: { width: number; height: number; bytes: number };
  diagnostics?: CaptureDiagnostics;
  captureIntegrity: {
    domScrollHeight: number;
    screenshotWidth?: number;
    screenshotHeight?: number;
    rawScreenshotWidth?: number;
    horizontalOverflowPx?: number;
    screenshotCropped?: boolean;
    viewportWidth: number;
    viewportHeight: number;
    heightDeltaPx?: number;
    widthMismatch: boolean;
    captureTimedOut: boolean;
  };
  status: CaptureStatus;
  captured: boolean;
  notScoredReason?: string;
}

export interface CaptureManifestResult {
  manifest: CaptureManifest;
  result?: CaptureResult;
}

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const DEFAULT_CAPTURE_TIMEOUT = 45_000;
const DEFAULT_ASSET_TIMEOUT = 5_000;
const DEFAULT_MAX_SCROLL_STEPS = 100;
const DEFAULT_MAX_SCROLL_HEIGHT = 100_000;

/**
 * Shared deterministic capture steps once a page exists. Existing callers
 * receive the historical CaptureResult; diagnostic callers use captureManifest.
 */
export async function runCapture(page: Page, options: CaptureOptions): Promise<CaptureResult> {
  const deadline = createDeadline(options.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT);
  await deadline.run(() => page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: Math.min(deadline.remaining(), 30_000) }));
  const stabilization = await deadline.run(() => stabilizePage(page, options));
  if (stabilization.assetWaitTimedOut) throw new Error(`Capture asset wait timed out with ${stabilization.pendingImages} pending image(s)`);
  if (stabilization.scrollCapped) throw new Error(`Capture scroll safety cap reached after ${stabilization.scrollIterations} iterations`);
  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  const buffer = await deadline.run(() => page.screenshot({ fullPage: options.fullPage ?? true }));
  await fs.writeFile(options.outputPath, buffer);
  return {
    url: options.url,
    outputPath: options.outputPath,
    width: options.viewport?.width ?? DEFAULT_VIEWPORT.width,
    height: options.viewport?.height ?? DEFAULT_VIEWPORT.height,
    bytes: buffer.length,
    capturedAt: new Date().toISOString(),
  };
}

/** Capture one page and persist a complete, score-gating diagnostic manifest. */
export async function captureManifest(options: CaptureOptions): Promise<CaptureManifestResult> {
  if (options.extractor === 'browserbase') {
    // Browserbase remains compatible with the legacy result API. Its remote
    // diagnostics can be added without changing this local manifest contract.
    const result = await captureScreenshot(options);
    const image = PNG.sync.read(await fs.readFile(result.outputPath));
    const viewport = options.viewport ?? DEFAULT_VIEWPORT;
    return {
      result,
      manifest: {
        url: options.url,
        finalUrl: options.url,
        httpStatus: 0,
        redirectChain: [],
        title: '',
        viewport: { width: viewport.width, height: viewport.height, deviceScaleFactor: 1 },
        bodyLength: 0,
        scrollHeight: image.height,
        contentMarkers: [],
        errorMarkers: [],
        fontsReady: false,
        images: { total: 0, loaded: 0, failed: 0 },
        scoredImages: { total: 0, loaded: 0, failed: 0 },
        consoleErrors: [],
        requestFailures: [],
        nonBlockingRequestFailures: [],
        blockingRequestFailures: [],
        nonBlockingConsoleErrors: [],
        blockingConsoleErrors: [],
        screenshotPath: result.outputPath,
        screenshot: { width: image.width, height: image.height, bytes: result.bytes },
        captureIntegrity: {
          domScrollHeight: image.height,
          screenshotWidth: image.width,
          screenshotHeight: image.height,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
          heightDeltaPx: 0,
          widthMismatch: image.width !== viewport.width,
          captureTimedOut: false,
        },
        status: 'not-scored',
        captured: false,
        notScoredReason: 'Browserbase manifest diagnostics are unavailable; use local capture or add remote diagnostics before scoring',
      },
    };
  }

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  const captureTimeoutMs = options.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT;
  const consoleErrors: string[] = [];
  const requestFailures: string[] = [];
  const failedResponseUrls: string[] = [];
  const redirectChain: string[] = [];
  const startedAt = Date.now();
  const diagnostics = createCaptureDiagnostics();
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    ...(options.storageState ? { storageState: options.storageState } : {}),
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error' && consoleErrors.length < 20) consoleErrors.push(message.text().slice(0, 300));
  });
  page.on('requestfailed', (request) => {
    if (requestFailures.length < 20) requestFailures.push(`${request.url().split('?')[0]}: ${request.failure()?.errorText ?? 'failed'}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && failedResponseUrls.length < 20) failedResponseUrls.push(`${response.url().split('?')[0]} [${response.status()}]`);
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && frame.url() !== options.url) redirectChain.push(frame.url());
  });

  const base: CaptureManifest = {
    url: options.url,
    finalUrl: options.url,
    httpStatus: 0,
    redirectChain,
    title: '',
    viewport: { width: viewport.width, height: viewport.height, deviceScaleFactor: 1 },
    bodyLength: 0,
    scrollHeight: 0,
    contentMarkers: [],
    errorMarkers: [],
    fontsReady: false,
    images: { total: 0, loaded: 0, failed: 0 },
    scoredImages: { total: 0, loaded: 0, failed: 0 },
    consoleErrors,
    requestFailures,
    nonBlockingRequestFailures: [],
    blockingRequestFailures: [],
    nonBlockingConsoleErrors: [],
    blockingConsoleErrors: [],
    diagnostics,
    captureIntegrity: {
      domScrollHeight: 0,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      widthMismatch: false,
      captureTimedOut: false,
    },
    status: 'capture-error',
    captured: false,
  };

  const deadline = createDeadline(captureTimeoutMs);
  let currentPhase: CapturePhase = 'goto';
  const runPhase = async <T>(phase: CapturePhase, operation: () => Promise<T>): Promise<T> => {
    currentPhase = phase;
    diagnostics.currentPhase = phase;
    const phaseStartedAt = Date.now();
    try {
      return await deadline.run(operation);
    } finally {
      diagnostics.phaseDurationsMs[phase] = (diagnostics.phaseDurationsMs[phase] ?? 0) + (Date.now() - phaseStartedAt);
    }
  };
  try {
    const response = await runPhase(
      'goto',
      () => page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: Math.min(deadline.remaining(), 30_000) }),
    );
    base.httpStatus = response?.status() ?? 0;
    await runPhase('selector', async () => {
      if (options.waitForSelector) await page.waitForSelector(options.waitForSelector, { timeout: Math.min(deadline.remaining(), 10_000) });
    });
    await runPhase('initial-assets', async () => {
      diagnostics.lazyImagesPromoted += await promoteLazyImages(page, !(options.fullPage ?? true));
      await waitForAssets(page, options.assetTimeoutMs ?? DEFAULT_ASSET_TIMEOUT, diagnostics, options.fullPage ?? true);
    });
    if (options.fullPage ?? true) await runPhase('scroll', () => scrollPage(page, options, diagnostics));
    await runPhase('final-assets', async () => {
      diagnostics.lazyImagesPromoted += await promoteLazyImages(page, !(options.fullPage ?? true));
      await waitForAssets(page, options.assetTimeoutMs ?? DEFAULT_ASSET_TIMEOUT, diagnostics, options.fullPage ?? true);
    });
    if (options.waitMs) await runPhase('final-assets', () => new Promise((resolve) => setTimeout(resolve, options.waitMs)));
    const data = await runPhase('dom-inspection', () => page.evaluate(() => {
      const images = Array.from(document.images);
      const contentMarkers = Array.from(document.querySelectorAll('main, article, section, [class*="elementor"], [data-framer-component-type]')).slice(0, 20).map((element) => element.tagName.toLowerCase());
      const errorMarkers = Array.from(document.querySelectorAll('.error-404, #error-page, .elementor-error, body.login, [class*="not-found"]')).map((element) => element.className?.toString() ?? element.tagName);
      return {
        title: document.title,
        bodyLength: document.body?.innerHTML.length ?? 0,
        scrollHeight: Math.max(document.body?.scrollHeight ?? 0, document.documentElement.scrollHeight),
        contentMarkers,
        errorMarkers,
        fontsReady: document.fonts?.status === 'loaded',
        images: { total: images.length, loaded: images.filter((image) => image.complete && image.naturalWidth > 0).length, failed: images.filter((image) => image.complete && image.naturalWidth === 0).length },
        visibleImages: (() => {
          const visible = images.filter((image) => {
            const rect = image.getBoundingClientRect();
            return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
          });
          return {
            total: visible.length,
            loaded: visible.filter((image) => image.complete && image.naturalWidth > 0).length,
            failed: visible.filter((image) => image.complete && image.naturalWidth === 0).length,
          };
        })(),
        featureMarkers: {
          blockquote: Array.from(document.querySelectorAll('.elementor-widget-blockquote, .elementor-blockquote')).some((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          }),
          megaMenu: Array.from(document.querySelectorAll('.e-n-menu, .elementor-widget-mega-menu')).some((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          }),
          navMenu: Array.from(document.querySelectorAll('.elementor-widget-nav-menu, .elementor-nav-menu, .elementor-menu-toggle')).some((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          }),
        },
      };
    }));
    const failureClassification = classifyResourceFailures({
      requestFailures,
      failedResponseUrls,
      consoleErrors,
      featureMarkers: data.featureMarkers,
    });
    Object.assign(base, data, {
      scoredImages: options.fullPage === false ? data.visibleImages : data.images,
      finalUrl: page.url(),
      nonBlockingRequestFailures: failureClassification.nonBlockingRequestFailures,
      blockingRequestFailures: failureClassification.blockingRequestFailures,
      nonBlockingConsoleErrors: failureClassification.nonBlockingConsoleErrors,
      blockingConsoleErrors: failureClassification.blockingConsoleErrors,
    });
    await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
    const buffer = await runPhase(
      'screenshot',
      () => page.screenshot({ path: options.outputPath, fullPage: options.fullPage ?? true }),
    );
    const image = await runPhase('png-parse', async () => PNG.sync.read(buffer));
    await runPhase('write', async () => {
      const artifact = await fs.stat(options.outputPath);
      if (!artifact.isFile() || artifact.size <= 0) throw new Error('Screenshot artifact was not written');
    });
    const result: CaptureResult = { url: options.url, outputPath: options.outputPath, width: image.width, height: image.height, bytes: buffer.length, capturedAt: new Date().toISOString() };
    base.screenshotPath = options.outputPath;
    base.screenshot = { width: image.width, height: image.height, bytes: buffer.length };
    const expectedScreenshotHeight = options.fullPage === false ? viewport.height : base.scrollHeight;
    diagnostics.elapsedMs = Date.now() - startedAt;
    diagnostics.currentPhase = undefined;
    base.captureIntegrity = { domScrollHeight: base.scrollHeight, screenshotWidth: image.width, screenshotHeight: image.height, rawScreenshotWidth: image.width, horizontalOverflowPx: Math.max(0, image.width - viewport.width), screenshotCropped: false, viewportWidth: viewport.width, viewportHeight: viewport.height, heightDeltaPx: image.height - expectedScreenshotHeight, widthMismatch: image.width !== viewport.width, captureTimedOut: false };
    const valid = base.httpStatus >= 200 && base.httpStatus < 400 && base.bodyLength > 3000 && base.contentMarkers.length > 0 && base.errorMarkers.length === 0 && base.fontsReady && (base.scoredImages ?? base.images).failed === 0 && (base.blockingConsoleErrors ?? base.consoleErrors).length === 0 && (base.blockingRequestFailures ?? base.requestFailures).length === 0 && !diagnostics.scrollCapped && !diagnostics.assetWaitTimedOut && !base.captureIntegrity.widthMismatch && Math.abs(base.captureIntegrity.heightDeltaPx ?? 0) <= 8;
    const reason = !valid ? (base.httpStatus < 200 || base.httpStatus >= 400 ? `HTTP ${base.httpStatus}` : diagnostics.scrollCapped ? `scroll safety cap reached after ${diagnostics.scrollIterations} iterations` : diagnostics.assetWaitTimedOut ? `asset wait timed out with ${diagnostics.pendingImages} pending image(s)` : base.errorMarkers.length ? 'error marker detected' : base.contentMarkers.length === 0 ? 'no content marker detected' : !base.fontsReady ? 'fonts not ready' : (base.scoredImages ?? base.images).failed > 0 ? `${(base.scoredImages ?? base.images).failed} scored image(s) failed` : (base.blockingConsoleErrors ?? base.consoleErrors).length > 0 ? `${(base.blockingConsoleErrors ?? base.consoleErrors).length} blocking console error(s)` : (base.blockingRequestFailures ?? base.requestFailures).length > 0 ? `${(base.blockingRequestFailures ?? base.requestFailures).length} blocking request failure(s)` : base.captureIntegrity.widthMismatch ? 'screenshot width mismatch' : Math.abs(base.captureIntegrity.heightDeltaPx ?? 0) > 8 ? 'screenshot/DOM height mismatch' : 'content validation failed') : undefined;
    base.status = valid ? 'captured' : 'not-scored';
    base.captured = valid;
    if (reason) base.notScoredReason = reason;
    return { manifest: base, result };
  } catch (error) {
    const timedOut = error instanceof Error && /timeout|timed out/i.test(error.message);
    diagnostics.currentPhase = currentPhase;
    diagnostics.elapsedMs = Date.now() - startedAt;
    base.status = timedOut ? 'capture-timeout' : 'capture-error';
    base.captured = false;
    const detail = error instanceof Error ? error.message.slice(0, 300) : String(error);
    base.notScoredReason = `${timedOut ? 'capture timeout' : 'capture error'} during ${currentPhase}: ${detail}`;
    base.captureIntegrity.captureTimedOut = timedOut;
    return { manifest: base };
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

interface ResourceFailureClassification {
  nonBlockingRequestFailures: string[];
  blockingRequestFailures: string[];
  nonBlockingConsoleErrors: string[];
  blockingConsoleErrors: string[];
}

function classifyResourceFailures(input: {
  requestFailures: string[];
  failedResponseUrls: string[];
  consoleErrors: string[];
  featureMarkers: { blockquote: boolean; megaMenu: boolean; navMenu: boolean };
}): ResourceFailureClassification {
  const optionalElementorStyles = [
    'widget-blockquote.min.css',
    'widget-mega-menu.min.css',
    'widget-nav-menu.min.css',
  ];
  const isOptionalElementorFailure = (value: string): boolean =>
    value.includes('/elementor-pro/') && optionalElementorStyles.some((name) => value.includes(name))
    && !((value.includes('widget-blockquote') && input.featureMarkers.blockquote)
      || (value.includes('widget-mega-menu') && input.featureMarkers.megaMenu)
      || (value.includes('widget-nav-menu') && input.featureMarkers.navMenu));
  const normalizeFailureKey = (value: string): string => value
    .replace(/\s+\[\d{3}\]$/, '')
    .replace(/: (?:net::|failed).*/, '');
  const uniqueFailures = (values: string[]): string[] => {
    const seen = new Set<string>();
    return values.filter((value) => {
      const key = normalizeFailureKey(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const allFailures = uniqueFailures([...input.requestFailures, ...input.failedResponseUrls]);
  const nonBlockingRequestFailures = allFailures.filter(isOptionalElementorFailure);
  const blockingRequestFailures = allFailures.filter((value) => !isOptionalElementorFailure(value));
  const nonBlockingConsoleErrors: string[] = [];
  const blockingConsoleErrors = [...input.consoleErrors];
  return { nonBlockingRequestFailures, blockingRequestFailures, nonBlockingConsoleErrors, blockingConsoleErrors };
}

async function stabilizePage(page: Page, options: CaptureOptions): Promise<CaptureDiagnostics> {
  const diagnostics = createCaptureDiagnostics();
  const fullPage = options.fullPage ?? true;
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}' }).catch(() => undefined);
  diagnostics.lazyImagesPromoted += await promoteLazyImages(page, !fullPage);
  await waitForAssets(page, options.assetTimeoutMs ?? DEFAULT_ASSET_TIMEOUT, diagnostics, fullPage);
  if (fullPage) await scrollPage(page, options, diagnostics);
  diagnostics.lazyImagesPromoted += await promoteLazyImages(page, !fullPage);
  await waitForAssets(page, options.assetTimeoutMs ?? DEFAULT_ASSET_TIMEOUT, diagnostics, fullPage);
  if (options.waitMs) await new Promise((resolve) => setTimeout(resolve, options.waitMs));
  return diagnostics;
}

function createCaptureDiagnostics(): CaptureDiagnostics {
  return {
    phaseDurationsMs: {},
    elapsedMs: 0,
    scrollIterations: 0,
    scrollHeightBefore: 0,
    scrollHeightAfter: 0,
    scrollCapped: false,
    assetWaitTimedOut: false,
    fontsWaitTimedOut: false,
    pendingImages: 0,
    lazyImagesPromoted: 0,
  };
}

async function scrollPage(page: Page, options: CaptureOptions, diagnostics: CaptureDiagnostics): Promise<void> {
  const scroll = await page.evaluate(({ maxSteps, maxHeight }) => {
    const before = Math.max(document.body?.scrollHeight ?? 0, document.documentElement.scrollHeight);
    let y = 0;
    let iterations = 0;
    let capped = false;
    return new Promise<{ before: number; after: number; iterations: number; capped: boolean }>((resolve) => {
      const step = () => {
        iterations += 1;
        y += Math.max(400, window.innerHeight);
        window.scrollTo(0, y);
        const height = Math.max(document.body?.scrollHeight ?? 0, document.documentElement.scrollHeight);
        if (y >= height || iterations >= maxSteps || height >= maxHeight) {
          capped = y < height;
          window.scrollTo(0, 0);
          window.setTimeout(() => resolve({ before, after: height, iterations, capped }), 100);
          return;
        }
        window.setTimeout(step, 50);
      };
      step();
    });
  }, {
    maxSteps: options.maxScrollSteps ?? DEFAULT_MAX_SCROLL_STEPS,
    maxHeight: options.maxScrollHeight ?? DEFAULT_MAX_SCROLL_HEIGHT,
  });
  diagnostics.scrollIterations = scroll.iterations;
  diagnostics.scrollHeightBefore = scroll.before;
  diagnostics.scrollHeightAfter = scroll.after;
  diagnostics.scrollCapped = scroll.capped;
}

async function promoteLazyImages(page: Page, visibleOnly = false): Promise<number> {
  return page.evaluate((onlyVisible) => {
    const lazyImages = Array.from(document.images).filter((image) => {
      if (image.loading !== 'lazy') return false;
      if (!onlyVisible) return true;
      const rect = image.getBoundingClientRect();
      return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
    });
    for (const image of lazyImages) image.loading = 'eager';
    return lazyImages.length;
  }, visibleOnly);
}

async function waitForAssets(page: Page, timeoutMs: number, diagnostics: CaptureDiagnostics, fullPage: boolean): Promise<void> {
  const result = await page.evaluate(async ({ assetTimeoutMs, waitForAllImages }) => {
    const allImages = Array.from(document.images);
    const images = waitForAllImages
      ? allImages
      : allImages.filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
      });
    const assets = (async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      await Promise.all(images.map((image) => image.decode?.().catch(() => undefined)));
      return 'ready' as const;
    })();
    const timeout = new Promise<'timeout'>((resolve) => window.setTimeout(() => resolve('timeout'), assetTimeoutMs));
    const state = await Promise.race([assets, timeout]);
    return {
      state,
      fontsReady: document.fonts?.status === 'loaded',
      pendingImages: images.filter((image) => !image.complete).length,
    };
  }, { assetTimeoutMs: timeoutMs, waitForAllImages: fullPage });
  diagnostics.assetWaitTimedOut ||= result.state === 'timeout';
  diagnostics.fontsWaitTimedOut ||= result.state === 'timeout' && !result.fontsReady;
  diagnostics.pendingImages = Math.max(diagnostics.pendingImages, result.pendingImages);
}

async function captureLocal(options: CaptureOptions): Promise<CaptureResult> {
  const browser: Browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const context = await browser.newContext({ viewport: options.viewport ?? DEFAULT_VIEWPORT, deviceScaleFactor: 1, ...(options.storageState ? { storageState: options.storageState } : {}) });
    const page = await context.newPage();
    return await runCapture(page, options);
  } finally {
    await browser.close();
  }
}

export async function captureScreenshot(options: CaptureOptions): Promise<CaptureResult> {
  if (options.extractor === 'browserbase') {
    const { captureViaCloud } = await import('./browserbase-capture.js');
    return await captureViaCloud(options);
  }
  return await captureLocal(options);
}

interface CaptureDeadline {
  remaining(): number;
  run<T>(operation: () => Promise<T>): Promise<T>;
}

function createDeadline(timeoutMs: number): CaptureDeadline {
  const startedAt = Date.now();
  return {
    remaining: () => Math.max(1, timeoutMs - (Date.now() - startedAt)),
    run: async <T>(operation: () => Promise<T>): Promise<T> => {
      const remaining = Math.max(1, timeoutMs - (Date.now() - startedAt));
      return withTimeout(operation, remaining);
    },
  };
}

async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Capture timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([operation(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function captureOriginalAndClone(originalUrl: string, cloneUrl: string, outputDir: string, extractor?: 'local' | 'browserbase'): Promise<{ original: CaptureResult; clone: CaptureResult }> {
  const original = await captureScreenshot({ url: originalUrl, outputPath: path.join(outputDir, 'original.png'), fullPage: true, extractor });
  const clone = await captureScreenshot({ url: cloneUrl, outputPath: path.join(outputDir, 'clone.png'), fullPage: true, extractor });
  return { original, clone };
}
