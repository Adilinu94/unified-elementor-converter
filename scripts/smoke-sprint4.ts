/**
 * Sprint 4 — Live-Smoke-Test gegen test4.nick-webdesign.de
 *
 * 1. Run the extractor (Sprint 2A-2C + 2.5)
 * 2. Run the asset-downloader (Sprint 4A-4D)
 * 3. Verify manifest.json
 */

import { mkdir, stat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { extractFromUrl } from '../src/extractor/index.js';
import {
  buildAndWriteManifest,
  summarizeManifest,
  downloadImages,
  downloadFonts,
  downloadSvgs,
  downloadFavicons,
  type ImageDownload,
  type SvgSource,
  type FaviconSource,
} from '../src/scraper/index.js';
import type { Page } from 'playwright';
import { chromium } from 'playwright';

const SOURCE_URL = 'https://test4.nick-webdesign.de';
const OUTPUT_ROOT = resolve(process.cwd(), 'pipeline-outputs/smoke-sprint4');

async function main(): Promise<void> {
  console.log(`[smoke-sprint4] Extracting from ${SOURCE_URL}...`);
  await mkdir(OUTPUT_ROOT, { recursive: true });

  // Step 1 — Extractor (Sprint 2)
  const extraction = await extractFromUrl({
    url: SOURCE_URL,
    outputDir: OUTPUT_ROOT,
    viewports: [{ label: 'desktop', width: 1440, height: 900 }],
    screenshots: false,
    detectAnimations: true,
    detectSections: true,
    detectResponsiveStyles: true,
  });

  // Step 2 — Asset-Discovery im Browser (via Page)
  console.log('[smoke-sprint4] Discovering assets via Playwright...');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (compatible; CloneV3/0.0.0; +https://github.com/Adilinu94/site-clone-to-v3)',
    });
    const page: Page = await context.newPage();
    await page.goto(SOURCE_URL, { waitUntil: 'networkidle' });

    // Discover images, videos, favicons, inline SVGs
    const discovered = await page.evaluate(() => {
      const imgUrls = new Set<string>();
      const bgUrls = new Set<string>();
      const svgMarkups: Array<{ markup: string; sourceElement: string; id?: string }> = [];
      const faviconLinks: Array<{ rel: string; href: string; sizes?: string; type?: string }> = [];
      const ogMetas: Array<{ property: string; content: string }> = [];
      const twitterMetas: Array<{ name: string; content: string }> = [];

      for (const img of document.querySelectorAll('img')) {
        const src = img.getAttribute('src');
        if (src) imgUrls.add(src);
        const dataSrc = img.getAttribute('data-src');
        if (dataSrc) imgUrls.add(dataSrc);
        const srcset = img.getAttribute('srcset');
        if (srcset) {
          for (const part of srcset.split(',')) {
            const u = part.trim().split(/\s+/)[0];
            if (u) imgUrls.add(u);
          }
        }
      }
      for (const el of document.querySelectorAll('*')) {
        const bg = getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none' && bg.startsWith('url(')) {
          const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
          if (match) bgUrls.add(match[1]);
        }
      }
      for (const svg of document.querySelectorAll('svg')) {
        const markup = new XMLSerializer().serializeToString(svg);
        const parent = svg.parentElement;
        const path =
          (parent?.tagName ?? '') +
          (parent?.id ? '#' + parent.id : '') +
          (parent?.className ? '.' + String(parent.className).split(' ').join('.') : '');
        svgMarkups.push({ markup, sourceElement: path, id: svg.getAttribute('id') ?? undefined });
      }
      for (const link of document.querySelectorAll('link[rel]')) {
        const rel = link.getAttribute('rel') ?? '';
        const href = link.getAttribute('href');
        if (!href) continue;
        if (rel.includes('icon')) {
          faviconLinks.push({
            rel,
            href,
            sizes: link.getAttribute('sizes') ?? undefined,
            type: link.getAttribute('type') ?? undefined,
          });
        }
      }
      for (const m of document.querySelectorAll('meta[property]')) {
        const p = m.getAttribute('property') ?? '';
        const c = m.getAttribute('content') ?? '';
        if (p.startsWith('og:image')) ogMetas.push({ property: p, content: c });
      }
      for (const m of document.querySelectorAll('meta[name]')) {
        const n = m.getAttribute('name') ?? '';
        const c = m.getAttribute('content') ?? '';
        if (n === 'twitter:image' || n === 'twitter:image:src')
          twitterMetas.push({ name: n, content: c });
      }

      return {
        images: [...imgUrls],
        backgrounds: [...bgUrls],
        svgs: svgMarkups,
        faviconLinks,
        ogImages: ogMetas,
        twitterImages: twitterMetas,
      };
    });

    // Build absolute URLs (page.evaluate returns relative URLs sometimes)
    const baseUrl = new URL(SOURCE_URL);
    const absolutize = (u: string): string => {
      try {
        return new URL(u, baseUrl).toString();
      } catch {
        return u;
      }
    };

    const imageDownloads: ImageDownload[] = [
      ...discovered.images.map((u) => ({ url: absolutize(u) })),
      ...discovered.backgrounds.map((u) => ({ url: absolutize(u) })),
    ];
    const svgSources: SvgSource[] = discovered.svgs.map((s) => ({
      kind: 'inline' as const,
      markup: s.markup,
      sourceElement: s.sourceElement,
      ...(s.id ? { existingId: s.id } : {}),
    }));
    const faviconSources: FaviconSource[] = [
      ...discovered.faviconLinks.map((l) => ({
        url: absolutize(l.href),
        kind: ((): FaviconSource['kind'] => {
          const r = l.rel.toLowerCase();
          if (r === 'apple-touch-icon' || r === 'apple-touch-icon-precomposed')
            return 'apple-touch-icon';
          if (r === 'shortcut icon') return 'shortcut-icon';
          if (r === 'icon') return 'icon';
          return 'favicon';
        })(),
        ...(l.sizes ? { sizes: l.sizes } : {}),
        ...(l.type ? { type: l.type } : {}),
      })),
      ...discovered.ogImages
        .filter((m) => m.content)
        .map((m) => ({
          url: absolutize(m.content),
          kind:
            m.property === 'og:image:secure_url' ? 'og-image-secure' : 'og-image',
        })),
      ...discovered.twitterImages
        .filter((m) => m.content)
        .map((m) => ({ url: absolutize(m.content), kind: 'twitter-image' as const })),
    ];

    console.log(
      `[smoke-sprint4] Discovered: ${imageDownloads.length} images, ${svgSources.length} SVGs, ${faviconSources.length} favicons/OG, ${extraction.fontsIntercepted.length} fonts`,
    );

    const assetsDir = join(OUTPUT_ROOT, 'assets');
    await mkdir(assetsDir, { recursive: true });

    // Step 3 — Download images
    console.log('[smoke-sprint4] Downloading images...');
    const imgResult = await downloadImages(imageDownloads, {
      hostname: baseUrl.hostname,
      subdir: 'images',
      outputRoot: assetsDir,
    });
    console.log(
      `  → ${Object.keys(imgResult.manifest).length}/${imageDownloads.length} succeeded (${imgResult.errors.length} errors)`,
    );

    // Step 4 — Download fonts (only the actual font files, not Google-Fonts CSS)
    console.log('[smoke-sprint4] Downloading fonts...');
    const fontResult = await downloadFonts(extraction.fontsIntercepted, {
      hostname: baseUrl.hostname,
      outputRoot: assetsDir,
    });
    console.log(
      `  → ${Object.keys(fontResult.manifest).length}/${extraction.fontsIntercepted.length} succeeded (${fontResult.errors.length} errors)`,
    );

    // Step 5 — Download SVGs
    console.log('[smoke-sprint4] Processing SVGs...');
    const svgResult = await downloadSvgs(svgSources, {
      hostname: baseUrl.hostname,
      outputRoot: assetsDir,
    });
    console.log(`  → ${Object.keys(svgResult.manifest).length} SVGs processed`);

    // Step 6 — Download favicons/OG
    console.log('[smoke-sprint4] Downloading favicons + OG images...');
    const favResult = await downloadFavicons(faviconSources, {
      hostname: baseUrl.hostname,
      outputRoot: assetsDir,
    });
    console.log(`  → ${Object.keys(favResult.manifest).length} favicons/OG processed`);

    // Step 7 — Build manifest
    console.log('[smoke-sprint4] Building manifest.json...');
    const { manifest, path: manifestPath } = await buildAndWriteManifest(
      {
        hostname: baseUrl.hostname,
        url: SOURCE_URL,
        images: imgResult,
        fonts: fontResult,
        svgs: svgResult,
        favicons: favResult,
      },
      assetsDir,
    );
    console.log(summarizeManifest(manifest));
    console.log(`[smoke-sprint4] Manifest written: ${manifestPath}`);

    // Sanity-check the output directories
    for (const sub of ['images', 'fonts', 'svgs', 'seo'] as const) {
      try {
        const files = await readdir(join(assetsDir, sub));
        console.log(`  → ${sub}/: ${files.length} file(s)`);
      } catch {
        // dir may not exist (e.g. no seo if no favicon) — that's OK
      }
    }
  } finally {
    await browser.close();
  }

  console.log('[smoke-sprint4] DONE');
}

main().catch((e) => {
  console.error('[smoke-sprint4] FAILED:', e);
  process.exit(1);
});
