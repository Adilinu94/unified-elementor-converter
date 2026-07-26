/**
 * Pixel-to-Element-Resolver.
 *
 * Mappt Pixel-Regionen aus issue-detector.ts auf Elementor-Element-IDs
 * (sectionId, widgetId) aus dem Build-Artefakt (page-v3.json).
 *
 * Aufbau:
 * - page-v3.json enthaelt ein `content[]`-Array mit sections.
 * - Jede section hat `id`, `settings._inline_size`, und child widgets mit `id`.
 * - Die Sections werden beim Build in Document-Reihenfolge geschrieben;
 *   ihre Y-Position akkumuliert sich aus den Section-Hoehen.
 *
 * Im Run-Boundary:
 *   resolver = await buildPixelElementResolver({ pageDataPath, viewportWidth: 1440 });
 *   target = resolver.resolve(issue); // { sectionId, widgetId }
 *
 * Wenn die Build-Artefakte fehlen (kein Target deployed), liefert
 * resolve() null und die Fixer markieren das Issue als "no element mapped".
 */

import { promises as fs } from 'node:fs';
import type { ElementResolver } from './real-fixers.js';
import type { Issue } from './issue-detector.js';

export interface V3ElementWidget {
  id?: string;
  widgetType?: string;
  elType?: string;
  settings?: Record<string, unknown>;
}

export interface V3ElementSection {
  id: string;
  elType: string;
  settings?: Record<string, unknown>;
  elements?: Array<V3ElementSection & { elements?: V3ElementWidget[] }>;
}

export interface V3PageData {
  title?: string;
  content?: V3ElementSection[];
}

export interface PixelElementResolverOptions {
  pageDataPath: string;
  /** Viewport-Breite fuer Section-Layout-Berechnung. Default: 1440. */
  viewportWidth?: number;
  /** Default-Section-Hoehe in px wenn keine settings-_min_height gesetzt. */
  defaultSectionHeightPx?: number;
}

/**
 * Section-Y-Span: berechnet aus dem Akkumulator ueber alle Sections im
 * Document. Wir nutzen die Reihenfolge aus pageData.content als Y-Order.
 */
interface SectionSpan {
  sectionId: string;
  yStart: number;
  yEnd: number;
  widgets: V3ElementWidget[];
}

/**
 * Konkreter ElementResolver mit gecachten Section-Spans.
 */
export class PixelElementResolver implements ElementResolver {
  private readonly spans: SectionSpan[];
  public readonly colorIdLookup?: (hex: string) => string | null;

  constructor(
    spans: SectionSpan[],
    _widgetById: Map<string, V3ElementWidget>,
    colorIdLookup?: (hex: string) => string | null,
  ) {
    this.spans = spans;
    this.colorIdLookup = colorIdLookup;
  }

  resolve(issue: Issue): { sectionId: string; widgetId: string | null } | null {
    const yCenter = issue.region.y + issue.region.height / 2;
    const span = this.spans.find((s) => yCenter >= s.yStart && yCenter < s.yEnd);
    if (!span) return null;
    const xCenter = issue.region.x + issue.region.width / 2;
    const widget = span.widgets.find((w) => {
      if (!w.id) return false;
      const ws = w.settings ?? {};
      const x = (ws._offset_x as number | undefined) ?? 0;
      return Math.abs(x - xCenter) < (issue.region.width || 100);
    });
    return { sectionId: span.sectionId, widgetId: widget?.id ?? null };
  }
}

/**
 * Liest page-v3.json und baut einen PixelElementResolver.
 * Wenn die Datei fehlt oder leer ist, gibt es einen leeren Resolver zurueck
 * (alle resolve()-Aufrufe liefern null).
 */
export async function buildPixelElementResolver(
  options: PixelElementResolverOptions,
): Promise<PixelElementResolver> {
  const defaultSectionHeight = options.defaultSectionHeightPx ?? 600;
  const pageData = await loadPageData(options.pageDataPath);
  if (!pageData?.content || pageData.content.length === 0) {
    return new PixelElementResolver([], new Map());
  }

  const spans: SectionSpan[] = [];
  const widgetById = new Map<string, V3ElementWidget>();
  let yCursor = 0;

  for (const section of pageData.content) {
    const heightPx = extractSectionHeight(section, defaultSectionHeight);
    const widgets = collectWidgets(section);
    for (const w of widgets) {
      if (w.id) widgetById.set(w.id, w);
    }
    spans.push({
      sectionId: section.id,
      yStart: yCursor,
      yEnd: yCursor + heightPx,
      widgets,
    });
    yCursor += heightPx;
  }

  return new PixelElementResolver(spans, widgetById);
}

async function loadPageData(filePath: string): Promise<V3PageData | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as V3PageData;
    return parsed;
  } catch {
    return null;
  }
}

function extractSectionHeight(section: V3ElementSection, defaultPx: number): number {
  const settings = section.settings ?? {};
  const minHeight = settings._min_height as { size?: number; unit?: string } | undefined;
  if (minHeight?.size) return minHeight.size;
  const height = settings.height as { size?: number; unit?: string } | undefined;
  if (height?.size) return height.size;
  return defaultPx;
}

function collectWidgets(section: V3ElementSection): V3ElementWidget[] {
  const out: V3ElementWidget[] = [];
  for (const col of section.elements ?? []) {
    if (col.elements) {
      for (const w of col.elements) {
        out.push(w);
      }
    }
  }
  return out;
}
