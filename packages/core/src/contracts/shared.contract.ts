/**
 * shared.contract.ts — Typen, die paketübergreifend geteilt werden.
 *
 * Portiert aus site-clone-to-v3/src/contracts/shared.contract.ts.
 * Monorepo-Anpassung: `SectionInfo`/`ComputedStyleSnapshot` werden hier
 * KANONISCH definiert (statt aus dem Extractor importiert), weil @elconv/core
 * nicht aus @elconv/extractors importieren darf (das wäre ein Paket-Zyklus:
 * core → extractors → core). @elconv/extractors re-exportiert diese beiden
 * Typen aus @elconv/core (Single Source of Truth, Portierungs-Regel 4).
 * Bleibt additiv — bestehende Exporte bitte nicht entfernen.
 */

/** Eine beim Extrahieren gefundene DOM-Section (kanonische Shape). */
export interface SectionInfo {
  section_id: string;
  selector: string;
  y_range: [number, number];
  layout: string;
  child_count: number;
  tag?: string;
  id?: string;
  classes?: string;
}

/** Computed-Styles-Snapshot für einen Selector. */
export interface ComputedStyleSnapshot {
  selector: string;
  tag: string;
  styles: Record<string, string>;
}

/** Rectangle region in pixel coordinates (top-left origin). */
export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A single viewport screenshot on disk, tagged with its viewport name. */
export interface ViewportScreenshot {
  viewport: 'mobile' | 'tablet' | 'desktop' | 'wide';
  path: string;
}

/** A result with an associated confidence score (0-1). */
export interface ConfidentResult<T> {
  value: T;
  confidence: number;
}
