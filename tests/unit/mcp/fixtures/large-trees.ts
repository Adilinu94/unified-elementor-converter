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

// ── Framer special-case fixtures (O-03 extension) ───────────────────────────
//
// Real Framer pages contain three constructs that stress the planned large-
// deploy contract beyond plain heading/text content:
//
//  1. Style references — V3: `css_classes` (must stay a STRING, never an
//     array — renders literal "Array"); V4: `settings.classes` ($$type
//     'classes') bound to style defs in `styles{}` (G11), external global
//     class refs (`gc-*` prefix, managed server-side) and global variable
//     props ($$type 'global-color-variable' / 'global-font-variable').
//  2. CMS collection instances — Framer nodes with `collectionId` /
//     `cmsCollectionSlug`; V3 target: `posts` widget / loop-grid; V4 target:
//     `e-grid` container with a loop/source contract.
//  3. Unknown widgets — anything not mappable falls back to raw HTML:
//     V3 `widgetType: 'html'`; V4 `e-html` with $$type 'html-content'.
//
// Every construct is deterministic, so tests can assert exact content and the
// planned call sequence over the same bytes on every run.

const CMS_COLLECTION_ID = 'coll_blog_posts';
const CMS_COLLECTION_SLUG = 'blog-posts';

function padLong(seed: number, min = 96): string {
  const base =
    'Framer Sonderfall — Wir bauen moderne, schnelle und barrierefreie Websites, die Ihre Marke professionell präsentieren, Besucher nachhaltig in Kunden verwandeln und dabei jeden Design-Token exakt referenzieren. ';
  const repeats = Math.max(1, Math.ceil(min / base.length));
  return base.repeat(repeats);
}

/**
 * A V3 widget with a style-reference: `css_classes` must be a string (never
 * an array), referencing an external CSS class (e.g. from Framer global CSS).
 */
function v3StyleRefHeading(seed: number): Record<string, unknown> {
  return {
    id: `v3-style-ref-${seed}`,
    elType: 'widget',
    widgetType: 'heading',
    settings: {
      title: `Style-Referenz ${seed}: ${padLong(seed, 72)}`,
      header_size: 'h2',
      typography_typography: 'custom',
      typography_font_size: { unit: 'px', size: 28 },
      title_color: '#1a1a2e',
      css_classes: 'framer-global-style reference-hero',
    },
  };
}

/** A V3 CMS collection instance: `posts` widget bound to a Framer collection. */
function v3CmsPostsWidget(seed: number): Record<string, unknown> {
  return {
    id: `v3-cms-${seed}`,
    elType: 'widget',
    widgetType: 'posts',
    settings: {
      source: 'cms-collection',
      collection_id: CMS_COLLECTION_ID,
      cms_collection_slug: CMS_COLLECTION_SLUG,
      posts_per_page: 6,
      post_type: 'post',
      columns: 3,
      loop_template_id: 'loop-tpl-blog',
      pagination: 'numbers',
      css_classes: 'loop-grid-blog-posts',
    },
  };
}

/** A V3 unknown-widget fallback: raw HTML block (fallback-html strategy). */
function v3UnknownHtmlWidget(seed: number): Record<string, unknown> {
  return {
    id: `v3-html-${seed}`,
    elType: 'widget',
    widgetType: 'html',
    settings: {
      html: `<div class="framer-unknown-widget" data-seed="${seed}"><span>${padLong(seed, 128)}</span></div>`,
      css_classes: 'framer-raw-html',
    },
  };
}

/** Build a V3 tree that mixes Framer special cases into every section. */
export function buildSpecialCaseV3Tree(options: V3FixtureOptions = {}): unknown[] {
  const sections = options.sections ?? 90;
  const widgetsPerSection = options.widgetsPerSection ?? 8;
  const tree: unknown[] = [];

  for (let s = 0; s < sections; s++) {
    const elements: unknown[] = [];
    for (let w = 0; w < widgetsPerSection; w++) {
      if (w % 4 === 0) {
        elements.push(v3StyleRefHeading(s * 100 + w));
      } else if (w % 4 === 1) {
        elements.push(v3CmsPostsWidget(s * 100 + w));
      } else if (w % 4 === 3) {
        elements.push(v3UnknownHtmlWidget(s * 100 + w));
      } else {
        elements.push({
          id: `w3-${s}-${w}`,
          elType: 'widget',
          widgetType: 'text-editor',
          settings: {
            editor: `<p>${padLong(s * 100 + w, 160)}</p>`,
            text_color: '#333333',
          },
        });
      }
    }
    tree.push({
      id: `c3-special-${s}`,
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

/**
 * A V4 atomic widget with style references: local class bound in `styles{}`
 * (G11) plus an external global class (`gc-*`, managed server-side) and a
 * global-color-variable prop.
 */
function v4StyleRefHeading(seed: number): Record<string, unknown> {
  const localStyleId = `shared_heading_${seed % 10}`;
  return {
    type: 'e-heading',
    elType: 'e-heading',
    widgetType: 'e-heading',
    id: `v4-style-ref-${seed}`,
    settings: {
      title: `Style-Referenz ${seed}: ${padLong(seed, 72)}`,
      tag: 'h2',
      classes: { '$$type': 'classes', value: [localStyleId, 'gc-hero', 'gc-brand-surface'] },
    },
    styles: {
      [localStyleId]: {
        id: localStyleId,
        label: 'heading',
        type: 'class',
        variants: [
          {
            meta: { breakpoint: null, state: null },
            props: {
              color: { '$$type': 'global-color-variable', value: 'var--brand-primary' },
              font_size: { '$$type': 'size', value: { size: 26, unit: 'px' } },
            },
            custom_css: null,
          },
          {
            meta: { breakpoint: 'mobile', state: null },
            props: {
              color: { '$$type': 'global-color-variable', value: 'var--brand-primary' },
              font_size: { '$$type': 'size', value: { size: 22, unit: 'px' } },
            },
            custom_css: null,
          },
        ],
      },
    },
  };
}

/** A V4 CMS collection instance: `e-grid` container bound to a Framer collection. */
function v4CmsLoopGrid(seed: number): Record<string, unknown> {
  const styleId = `cms_grid_${seed % 10}`;
  const itemStyleId = `cms_item_${seed % 10}`;
  return {
    type: 'e-grid',
    elType: 'e-grid',
    widgetType: 'e-grid',
    id: `v4-cms-${seed}`,
    settings: {
      loop: {
        source: 'cms-collection',
        collectionId: CMS_COLLECTION_ID,
        cmsCollectionSlug: CMS_COLLECTION_SLUG,
        template_id: 'loop-tpl-blog',
        columns: 3,
      },
      classes: { '$$type': 'classes', value: [styleId] },
    },
    styles: {
      [styleId]: {
        id: styleId,
        label: 'grid',
        type: 'class',
        variants: [
          {
            meta: { breakpoint: null, state: null },
            props: { gap: { '$$type': 'size', value: { size: 24, unit: 'px' } } },
            custom_css: null,
          },
        ],
      },
    },
    elements: [
      {
        type: 'e-heading',
        elType: 'e-heading',
        widgetType: 'e-heading',
        id: `v4-cms-item-title-${seed}`,
        settings: {
          title: '{{fields.title}}',
          tag: 'h3',
          classes: { '$$type': 'classes', value: [itemStyleId] },
        },
        // G11 style-classes-binding is per-element: the item style lives on the
        // element that references it, not on the parent grid.
        styles: {
          [itemStyleId]: {
            id: itemStyleId,
            label: 'grid-item',
            type: 'class',
            variants: [
              {
                meta: { breakpoint: null, state: null },
                props: { padding: { '$$type': 'dimensions', value: { top: 16, right: 16, bottom: 16, left: 16, unit: 'px' } } },
                custom_css: null,
              },
            ],
          },
        },
      },
    ],
  };
}

/** A V4 unknown-widget fallback: `e-html` with a $$type 'html-content' value. */
function v4UnknownHtmlWidget(seed: number): Record<string, unknown> {
  return {
    type: 'e-html',
    elType: 'e-html',
    widgetType: 'e-html',
    id: `v4-html-${seed}`,
    settings: {
      html: { '$$type': 'html-content', value: `<div class="framer-unknown-widget" data-seed="${seed}">${padLong(seed, 128)}</div>` },
    },
    styles: {},
  };
}

/** Build a V4 tree that mixes Framer special cases into every box. */
export function buildSpecialCaseV4Tree(options: V4FixtureOptions = {}): unknown[] {
  const boxes = options.boxes ?? 180;
  const widgetsPerBox = options.widgetsPerBox ?? 9;
  const tree: unknown[] = [];

  for (let b = 0; b < boxes; b++) {
    const elements: unknown[] = [];
    for (let w = 0; w < widgetsPerBox; w++) {
      if (w % 4 === 0) {
        elements.push(v4StyleRefHeading(b * 100 + w));
      } else if (w % 4 === 1) {
        elements.push(v4CmsLoopGrid(b * 100 + w));
      } else if (w % 4 === 3) {
        elements.push(v4UnknownHtmlWidget(b * 100 + w));
      } else {
        elements.push({
          type: 'e-paragraph',
          elType: 'e-paragraph',
          widgetType: 'e-paragraph',
          id: `w4-special-${b}-${w}`,
          settings: { text: padLong(b * 100 + w, 200) },
          styles: {},
        });
      }
    }
    tree.push({
      type: 'e-flexbox',
      elType: 'e-flexbox',
      widgetType: 'e-flexbox',
      id: `box4-special-${b}`,
      settings: { flex_direction: b % 2 === 0 ? 'column' : 'row' },
      styles: {},
      elements,
    });
  }
  return tree;
}

/** Preset in the upload-php band: V3 tree with style refs, CMS and unknown widgets. */
export function specialCaseV3Fixture(): unknown[] {
  return buildSpecialCaseV3Tree({ sections: 135, widgetsPerSection: 8 });
}

/** Preset in the split band: V4 tree with style refs, CMS and unknown widgets. */
export function specialCaseV4Fixture(): unknown[] {
  return buildSpecialCaseV4Tree({ boxes: 205, widgetsPerBox: 9 });
}
