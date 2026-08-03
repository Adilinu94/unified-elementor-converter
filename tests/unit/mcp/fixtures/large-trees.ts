/**
 * O-03 offline fixtures — large V3/V4 trees for the `upload-php` and `split`
 * deploy-strategy preparation. Fully offline and deterministic (no network,
 * no clocks, no randomness): the same tree is produced on every call, so tests
 * can assert exact byte bands and chunk plans.
 *
 * Sizing targets (see STRATEGY_THRESHOLDS in packages/core/src/deploy-strategy.ts):
 *  - upload-php band: >= 400_000 bytes and < 1_200_000 bytes
 *  - split band:      >= 1_200_000 bytes
 *
 * The trees mirror the real V3 (`container`/`widget`) and V4 (`e-flexbox`/
 * atomic widgets with `styles`) output shapes so strategy selection and the
 * planned call sequence are exercised against realistic data.
 */

export interface V3FixtureOptions {
  /** Top-level containers (sections). */
  sections?: number;
  /** Widgets per container. */
  widgetsPerSection?: number;
}

export interface V4FixtureOptions {
  /** Top-level e-flexbox elements. */
  boxes?: number;
  /** Atomic widgets per box. */
  widgetsPerBox?: number;
}

function pad(seed: number, min = 32): string {
  // Deterministic filler that looks like realistic long-form content.
  const base = `Seite ${seed} — Wir bauen moderne, schnelle und barrierefreie Websites, die Ihre Marke professionell präsentieren und Besucher nachhaltig in Kunden verwandeln. `;
  const repeats = Math.max(1, Math.ceil(min / base.length));
  return base.repeat(repeats);
}

/** Build a realistic V3 tree (containers + heading/text widgets) deterministically. */
export function buildLargeV3Tree(options: V3FixtureOptions = {}): unknown[] {
  const sections = options.sections ?? 60;
  const widgetsPerSection = options.widgetsPerSection ?? 10;
  const tree: unknown[] = [];

  for (let s = 0; s < sections; s++) {
    const elements: unknown[] = [];
    for (let w = 0; w < widgetsPerSection; w++) {
      const isHeading = w % 2 === 0;
      elements.push({
        id: `w3-${s}-${w}`,
        elType: 'widget',
        widgetType: isHeading ? 'heading' : 'text-editor',
        settings: isHeading
          ? {
              title: `Abschnitt ${s + 1} Überschrift ${w + 1}: ${pad(s * 100 + w, 48)}`,
              header_size: 'h2',
              typography_typography: 'custom',
              typography_font_size: { unit: 'px', size: 36 },
              title_color: '#1a1a2e',
            }
          : {
              editor: `<p>${pad(s * 100 + w + 1, 96)}</p>`,
              text_color: '#333333',
            },
      });
    }
    tree.push({
      id: `c3-${s}`,
      elType: 'container',
      isInner: false,
      settings: {
        content_width: 'boxed',
        flex_direction: 'column',
        background_color: s % 2 === 0 ? '#ffffff' : '#f7f7fb',
        padding: { unit: 'px', top: 48, right: 24, bottom: 48, left: 24 },
      },
      elements,
    });
  }
  return tree;
}

/** Build a realistic V4 atomic tree (e-flexbox + atomic widgets) deterministically. */
export function buildLargeV4Tree(options: V4FixtureOptions = {}): unknown[] {
  const boxes = options.boxes ?? 120;
  const widgetsPerBox = options.widgetsPerBox ?? 12;
  const tree: unknown[] = [];

  for (let b = 0; b < boxes; b++) {
    const elements: unknown[] = [];
    for (let w = 0; w < widgetsPerBox; w++) {
      const isHeading = w % 3 === 0;
      const styleId = `gc-${b}-${w}`;
      elements.push({
        type: isHeading ? 'e-heading' : 'e-paragraph',
        elType: isHeading ? 'e-heading' : 'e-paragraph',
        widgetType: isHeading ? 'e-heading' : 'e-paragraph',
        id: `w4-${b}-${w}`,
        settings: isHeading
          ? { title: `Box ${b + 1} Titel ${w + 1}: ${pad(b * 100 + w, 56)}`, tag: 'h2' }
          : { content: pad(b * 100 + w + 1, 140) },
        styles: {
          [styleId]: {
            id: styleId,
            label: isHeading ? 'heading' : 'paragraph',
            type: 'class',
            variants: [
              {
                meta: { breakpoint: null, state: null },
                props: isHeading
                  ? { color: { type: 'color', value: '#1a1a2e' }, font_size: { type: 'size', value: 32, unit: 'px' } }
                  : { color: { type: 'color', value: '#444444' } },
                custom_css: null,
              },
            ],
          },
        },
      });
    }
    tree.push({
      type: 'e-flexbox',
      elType: 'e-flexbox',
      widgetType: 'e-flexbox',
      id: `box4-${b}`,
      settings: { flex_direction: b % 2 === 0 ? 'column' : 'row' },
      styles: {},
      elements,
    });
  }
  return tree;
}

/** Preset in the upload-php band (~500 KB): medium V3 tree. */
export function uploadPhpV3Fixture(): unknown[] {
  return buildLargeV3Tree({ sections: 100, widgetsPerSection: 13 });
}

/** Preset in the split band (~1.4 MB): large V4 tree. */
export function splitV4Fixture(): unknown[] {
  return buildLargeV4Tree({ boxes: 200, widgetsPerBox: 14 });
}
