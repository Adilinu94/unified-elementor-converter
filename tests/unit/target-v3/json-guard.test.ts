/**
 * Tests for the JSON-Guard additions (Phase 41, GAP-H) in @elconv/target-v3:
 * G4:breakpoint-coverage, G5:image-url-present, G7c:flex-row-child-width,
 * runV3Guards() wrapper + formatGuardReport().
 * Ported/adapted from site-clone-to-v3/tests/unit/json-guard.test.ts.
 *
 * Extended in P5 (BAUPLAN-v6.0 §11) with G4b:breakpoint-prefix-misuse and the
 * four substance guards. The scoring fixture is now deliberately substantive
 * (6 widgets, styles on every element) because an empty tree must no longer
 * score 100.
 */

import { describe, it, expect } from 'vitest';
import { runV3Guards, V3_GUARDS, type V3Element } from '@elconv/target-v3';
import { runGuards, formatGuardReport } from '@elconv/core';
import fragmentedFramerTree from './fixtures/framer-html-fragmented-tree.json';

/** A style setting that satisfies G_SUBSTANCE_STYLED. */
const STYLED = { padding: { unit: 'px', top: 10, right: 10, bottom: 10, left: 10, isLinked: true } };

function makeV3Widget(id: string, widgetType: string, settings: Record<string, unknown> = {}): V3Element {
  return { id, elType: 'widget', widgetType, settings };
}

function makeV3Column(id: string, widgets: V3Element[] = [], settings?: Record<string, unknown>): V3Element {
  return { id, elType: 'column', settings: settings ?? {}, elements: widgets };
}

function makeV3Section(id: string, columns: V3Element[] = [], settings?: Record<string, unknown>): V3Element {
  return { id, elType: 'section', settings: settings ?? {}, elements: columns };
}

const validV3Tree: V3Element[] = [
  makeV3Section(
    's1',
    [
      makeV3Column(
        'c1',
        [
          makeV3Widget('w1', 'heading', { title: 'Hello', title_color: '#111111' }),
          makeV3Widget('w2', 'image', { image: { url: 'https://example.com/img.jpg' }, ...STYLED }),
          makeV3Widget('w3', 'button', { text: 'Click', button_text_color: '#ffffff' }),
        ],
        STYLED,
      ),
    ],
    { background_color: '#ffffff', ...STYLED },
  ),
  makeV3Section(
    's2',
    [
      makeV3Column(
        'c2',
        [
          makeV3Widget('w4', 'text-editor', { editor: '<p>Content</p>', text_color: '#222222' }),
          makeV3Widget('w5', 'heading', { title: 'Second', title_color: '#111111' }),
          makeV3Widget('w6', 'text-editor', { editor: '<p>More</p>', text_color: '#222222' }),
        ],
        STYLED,
      ),
    ],
    { background_color: '#fafafa', ...STYLED },
  ),
];

describe('runV3Guards — scoring engine', () => {
  it('score starts at 100 when all guards pass', () => {
    const report = runV3Guards(validV3Tree);
    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
    expect(report.threshold).toBe(85);
  });

  it('critical failure deducts 20 points', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [makeV3Column('dup', [])]),
      makeV3Section('s2', [makeV3Column('dup', [])]),
    ];
    const report = runV3Guards(tree);
    const g1 = report.results.find((r) => r.name === 'G1:unique-ids')!;
    expect(g1.result.passed).toBe(false);
    expect(report.score).toBeLessThanOrEqual(80);
  });

  it('warning failure deducts 5 points', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [
        makeV3Column('c1', [makeV3Widget('w1', 'image', { image: { url: '' } })]),
      ]),
    ];
    const report = runV3Guards(tree);
    const g5 = report.results.find((r) => r.name === 'G5:image-url-present')!;
    expect(g5.result.passed).toBe(false);
    expect(g5.severity).toBe('warning');
    expect(report.score).toBeLessThanOrEqual(95);
  });

  it('custom threshold works', () => {
    const report = runV3Guards(validV3Tree, 50);
    expect(report.threshold).toBe(50);
    expect(report.passed).toBe(true);
  });

  it('report contains one result per guard', () => {
    const report = runV3Guards(validV3Tree);
    expect(report.results).toHaveLength(V3_GUARDS.length);
  });

  it('handles empty tree without throwing', () => {
    expect(() => runV3Guards([])).not.toThrow();
  });

  // P5 regression: this is the exact failure the v6.0 build plan documents —
  // a 496-byte tree that reached "Guards passed: 100/100".
  it('an empty tree no longer scores 100 (substance guards)', () => {
    const report = runV3Guards([]);
    expect(report.score).toBeLessThan(100);
    expect(report.passed).toBe(false);
  });
});

describe('G4: breakpoint-coverage', () => {
  it('passes when no breakpoint overrides exist', () => {
    const g4 = runV3Guards(validV3Tree).results.find((r) => r.name === 'G4:breakpoint-coverage')!;
    expect(g4.result.passed).toBe(true);
  });

  it('passes when both tablet and mobile overrides exist', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [makeV3Column('c1', [])], {
        padding_tablet: '20px',
        padding_mobile: '10px',
      }),
    ];
    const g4 = runV3Guards(tree).results.find((r) => r.name === 'G4:breakpoint-coverage')!;
    expect(g4.result.passed).toBe(true);
  });

  it('fails when tablet override exists but mobile is missing', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [makeV3Column('c1', [])], {
        padding_tablet: '20px',
      }),
    ];
    const g4 = runV3Guards(tree).results.find((r) => r.name === 'G4:breakpoint-coverage')!;
    expect(g4.result.passed).toBe(false);
    expect(g4.result.message).toContain('1 section');
  });
});

describe('G4b: breakpoint-prefix-misuse', () => {
  const g4b = (tree: V3Element[]) =>
    runV3Guards(tree).results.find((r) => r.name === 'G4b:breakpoint-prefix-misuse')!;

  it('passes for a tree that uses the correct suffix form', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [makeV3Column('c1', [])], {
        padding_tablet: '20px',
        padding_mobile: '10px',
      }),
    ];
    expect(g4b(tree).result.passed).toBe(true);
  });

  it('fails and is critical when the tablet_ prefix is used', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [makeV3Column('c1', [])], { tablet_padding: '20px' }),
    ];
    const r = g4b(tree);
    expect(r.result.passed).toBe(false);
    expect(r.severity).toBe('critical');
    expect(r.result.message).toContain('silently ignored');
  });

  it('counts prefixed keys on nested elements too', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [
        makeV3Column('c1', [
          makeV3Widget('w1', 'heading', { title: 'Hi', mobile_typography_font_size: 12 }),
        ]),
      ]),
    ];
    const r = g4b(tree);
    expect(r.result.passed).toBe(false);
    expect(r.result.details).toContain('w1');
  });

  it('does not flag a control that merely contains the word tablet', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [makeV3Column('c1', [])], { hide_tablet: 'yes' }),
    ];
    expect(g4b(tree).result.passed).toBe(true);
  });
});

describe('Substance guards (P5.3)', () => {
  const find = (tree: V3Element[], name: string) =>
    runV3Guards(tree).results.find((r) => r.name === name)!;

  describe('G_SUBSTANCE_WIDGETS', () => {
    const NAME = 'G_SUBSTANCE_WIDGETS:section-has-widgets';

    it('rejects the documented failure case: 1 section, 0 widgets', () => {
      const tree: V3Element[] = [makeV3Section('s1', [], { background_color: '#fff' })];
      const r = find(tree, NAME);
      expect(r.result.passed).toBe(false);
      expect(r.severity).toBe('critical');
      expect(r.result.message).toContain('empty section');
    });

    it('rejects a tree with no top-level section at all', () => {
      const tree: V3Element[] = [makeV3Widget('w1', 'heading', { title: 'orphan' })];
      expect(find(tree, NAME).result.passed).toBe(false);
    });

    it('names only the empty sections when some carry widgets', () => {
      const tree: V3Element[] = [
        ...validV3Tree,
        makeV3Section('s3', [makeV3Column('c3', [])]),
      ];
      const r = find(tree, NAME);
      expect(r.result.passed).toBe(false);
      expect(r.result.details).toBe('s3');
    });

    it('passes for the substantive fixture', () => {
      expect(find(validV3Tree, NAME).result.passed).toBe(true);
    });
  });

  describe('G_SUBSTANCE_TEXT', () => {
    const NAME = 'G_SUBSTANCE_TEXT:text-content-present';

    it('fails when a heading has an empty title', () => {
      const tree: V3Element[] = [
        makeV3Section('s1', [makeV3Column('c1', [makeV3Widget('w1', 'heading', { title: '' })])]),
      ];
      const r = find(tree, NAME);
      expect(r.result.passed).toBe(false);
      expect(r.severity).toBe('critical');
    });

    it('treats markup-only content as empty', () => {
      const tree: V3Element[] = [
        makeV3Section('s1', [
          makeV3Column('c1', [makeV3Widget('w1', 'text-editor', { editor: '<p>&nbsp;</p>' })]),
        ]),
      ];
      expect(find(tree, NAME).result.passed).toBe(false);
    });

    it('fails when a button has no text', () => {
      const tree: V3Element[] = [
        makeV3Section('s1', [makeV3Column('c1', [makeV3Widget('w1', 'button', {})])]),
      ];
      expect(find(tree, NAME).result.passed).toBe(false);
    });

    it('passes when no text-bearing widgets exist', () => {
      const tree: V3Element[] = [
        makeV3Section('s1', [
          makeV3Column('c1', [makeV3Widget('w1', 'image', { image: { url: 'x' } })]),
        ]),
      ];
      expect(find(tree, NAME).result.passed).toBe(true);
    });

    it('passes for the substantive fixture', () => {
      expect(find(validV3Tree, NAME).result.passed).toBe(true);
    });
  });

  describe('G_SUBSTANCE_RATIO', () => {
    const NAME = 'G_SUBSTANCE_RATIO:widget-density';

    it('warns on under-extraction (1 widget across 2 sections)', () => {
      const tree: V3Element[] = [
        makeV3Section('s1', [makeV3Column('c1', [makeV3Widget('w1', 'heading', { title: 'a' })])]),
        makeV3Section('s2', [makeV3Column('c2', [])]),
      ];
      const r = find(tree, NAME);
      expect(r.result.passed).toBe(false);
      expect(r.severity).toBe('warning');
      expect(r.result.message).toContain('under-extraction');
    });

    it('passes at exactly 3 widgets per section', () => {
      expect(find(validV3Tree, NAME).result.passed).toBe(true);
    });
  });

  describe('G_SUBSTANCE_STYLED', () => {
    const NAME = 'G_SUBSTANCE_STYLED:visual-settings-present';

    it('warns when fewer than half the elements carry visual settings', () => {
      const tree: V3Element[] = [
        makeV3Section('s1', [
          makeV3Column('c1', [
            makeV3Widget('w1', 'heading', { title: 'a' }),
            makeV3Widget('w2', 'heading', { title: 'b' }),
            makeV3Widget('w3', 'heading', { title: 'c' }),
          ]),
        ]),
      ];
      const r = find(tree, NAME);
      expect(r.result.passed).toBe(false);
      expect(r.severity).toBe('warning');
      expect(r.result.message).toContain('styles may be lost');
    });

    it('counts *_color, typography_*, background_*, padding and margin as visual', () => {
      const tree: V3Element[] = [
        makeV3Section('s1', [
          makeV3Column('c1', [makeV3Widget('w1', 'heading', { title: 'a', title_color: '#000' })], {
            margin: { unit: 'px', top: 0, right: 0, bottom: 0, left: 0, isLinked: true },
          }),
        ], { background_color: '#fff' }),
      ];
      expect(find(tree, NAME).result.passed).toBe(true);
    });

    it('counts the container flex group and the underscore-prefixed widget forms', () => {
      // The guard used a hand-written prefix list and saw none of these. On a
      // real converted page that undercounted by 20 points: 39% reported
      // against 59% actual, while 81 flex_align_items, 80 flex_direction, 69
      // flex_gap and 48 border_radius settings were present and rendering.
      const tree: V3Element[] = [
        makeV3Section('s1', [
          makeV3Column('c1', [
            makeV3Widget('w1', 'heading', { title: 'a', _padding: { unit: 'px', top: 4, right: 4, bottom: 4, left: 4, isLinked: true } }),
            makeV3Widget('w2', 'heading', { title: 'b', _border_radius: { unit: 'px', top: 2, right: 2, bottom: 2, left: 2, isLinked: true } }),
            makeV3Widget('w3', 'spacer', { space: { size: 40, unit: 'px' } }),
          ], {
            flex_gap: { column: 24, row: 24, isLinked: true, unit: 'px' },
          }),
        ], { flex_align_items: 'center' }),
      ];
      const r = find(tree, NAME);
      expect(r.result.passed).toBe(true);
      expect(r.result.message).toContain('100%');
    });

    it('does not count content or structural metadata as visual', () => {
      // An element carrying only `_element_id` and its content is exactly what
      // the guard exists to find, so those keys must not satisfy it.
      const tree: V3Element[] = [
        makeV3Section('s1', [
          makeV3Column('c1', [
            makeV3Widget('w1', 'heading', { title: 'a', _element_id: 'x1', header_size: 'h2' }),
            makeV3Widget('w2', 'text-editor', { editor: '<p>b</p>', _element_id: 'x2' }),
            makeV3Widget('w3', 'html', { html: '<div/>', _element_id: 'x3' }),
          ]),
        ]),
      ];
      const r = find(tree, NAME);
      expect(r.result.passed).toBe(false);
      expect(r.result.message).toContain('styles may be lost');
    });

    it('fails an empty tree rather than dividing by zero', () => {
      const r = find([], NAME);
      expect(r.result.passed).toBe(false);
      expect(r.result.message).toContain('empty');
    });
  });
});

describe('G5: image-url-present', () => {
  it('passes when all image widgets have URLs', () => {
    const g5 = runV3Guards(validV3Tree).results.find((r) => r.name === 'G5:image-url-present')!;
    expect(g5.result.passed).toBe(true);
  });

  it('fails when image widget has empty URL', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [
        makeV3Column('c1', [makeV3Widget('w1', 'image', { image: { url: '' } })]),
      ]),
    ];
    const g5 = runV3Guards(tree).results.find((r) => r.name === 'G5:image-url-present')!;
    expect(g5.result.passed).toBe(false);
  });

  it('fails when image widget has no image setting at all', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [
        makeV3Column('c1', [makeV3Widget('w1', 'image', {})]),
      ]),
    ];
    const g5 = runV3Guards(tree).results.find((r) => r.name === 'G5:image-url-present')!;
    expect(g5.result.passed).toBe(false);
  });

  it('passes when no image widgets exist in tree', () => {
    const tree: V3Element[] = [
      makeV3Section('s1', [
        makeV3Column('c1', [makeV3Widget('w1', 'heading', { title: 'Hi' })]),
      ]),
    ];
    const g5 = runV3Guards(tree).results.find((r) => r.name === 'G5:image-url-present')!;
    expect(g5.result.passed).toBe(true);
  });
});

describe('G7c: flex-row-child-width', () => {
  it('fails for flex-row container with unconstrained container children', () => {
    const tree: V3Element[] = [
      {
        id: 'row1',
        elType: 'container',
        settings: { flex_direction: 'row' },
        elements: [
          { id: 'a', elType: 'container', settings: {}, isInner: true },
          { id: 'b', elType: 'container', settings: {}, isInner: true },
        ],
      },
    ];
    const g7c = runV3Guards(tree).results.find((r) => r.name === 'G7c:flex-row-child-width')!;
    expect(g7c.result.passed).toBe(false);
    expect(g7c.result.message).toContain('risk stacking');
  });

  it('passes when flex-row children have _inline_size constraints', () => {
    const tree: V3Element[] = [
      {
        id: 'row1',
        elType: 'container',
        settings: { flex_direction: 'row' },
        elements: [
          { id: 'a', elType: 'container', settings: { _inline_size: 50 }, isInner: true },
          { id: 'b', elType: 'container', settings: { _inline_size: 50 }, isInner: true },
        ],
      },
    ];
    const g7c = runV3Guards(tree).results.find((r) => r.name === 'G7c:flex-row-child-width')!;
    expect(g7c.result.passed).toBe(true);
  });
});

// ============================================================================
// v7.0 fragmentation + animation guards
//
// Motivation is measured, not hypothetical: the `--html` conversion of
// loud-alternative-352151.framer.app scored 95/100 and PASSED while containing
// 140 single-word heading widgets and 63.6% duplicated body text.
// See docs/BAUPLAN-v7.0-FRAMER-GENERIC-2026-08-26.md §6.1.
// ============================================================================

const FRAGMENT_GUARD = 'G_SUBSTANCE_FRAGMENTS:text-not-tokenized';
const DUPE_GUARD = 'G_SUBSTANCE_DUPES:no-variant-duplication';
const SPLIT_GUARD = 'G_ANIMATION_CONTROL_SPLIT:underscore-variant-matches-eltype';
const COMPANION_GUARD = 'G_ANIMATION_COMPANION:gated-controls-have-companion';

/** Wrap widgets in the section/column scaffolding the other guards expect. */
function sectionWith(widgets: V3Element[]): V3Element[] {
  return [makeV3Section('s1', [makeV3Column('c1', widgets, STYLED)], { ...STYLED })];
}

function guard(tree: V3Element[], name: string) {
  return runV3Guards(tree).results.find((r) => r.name === name)!;
}

describe('G_SUBSTANCE_FRAGMENTS: text-not-tokenized', () => {
  it('passes on a tree with whole sentences', () => {
    expect(guard(validV3Tree, FRAGMENT_GUARD).result.passed).toBe(true);
  });

  it('fails on the measured Framer failure: a sentence split across sibling headings', () => {
    // Verbatim from the real run — Framer emits one <h3> per word in
    // stackWrap layouts, and the regex HTML parser turned each into a widget.
    const words = ['digital', 'studio', 'crafting', 'unforgettable', 'brands', 'and'];
    const tree = sectionWith(
      words.map((w, i) => makeV3Widget(`w${i}`, 'heading', { title: w, title_color: '#111' })),
    );
    const result = guard(tree, FRAGMENT_GUARD).result;
    expect(result.passed).toBe(false);
    expect(result.message).toContain('tokenized');
  });

  it('is critical, so a tokenized tree cannot reach the 85 threshold', () => {
    const words = ['we', 'are', 'a', 'digital', 'studio'];
    const tree = sectionWith(
      words.map((w, i) => makeV3Widget(`w${i}`, 'heading', { title: w, title_color: '#111' })),
    );
    const entry = guard(tree, FRAGMENT_GUARD);
    expect(entry.severity).toBe('critical');
    expect(entry.result.passed).toBe(false);
  });

  it('does NOT flag legitimate capitalised single-word headings', () => {
    // "Contact", "Services", "Awards" are real headings on the source page.
    const tree = sectionWith([
      makeV3Widget('w1', 'heading', { title: 'Contact', title_color: '#111' }),
      makeV3Widget('w2', 'heading', { title: 'Services', title_color: '#111' }),
      makeV3Widget('w3', 'heading', { title: 'Awards', title_color: '#111' }),
    ]);
    expect(guard(tree, FRAGMENT_GUARD).result.passed).toBe(true);
  });

  it('does not flag a run shorter than the 3-widget minimum', () => {
    const tree = sectionWith([
      makeV3Widget('w1', 'heading', { title: 'digital', title_color: '#111' }),
      makeV3Widget('w2', 'heading', { title: 'studio', title_color: '#111' }),
      makeV3Widget('w3', 'text-editor', { editor: '<p>A full sentence follows here.</p>' }),
    ]);
    expect(guard(tree, FRAGMENT_GUARD).result.passed).toBe(true);
  });

  it('needs at least one sentence-continuation token, not just short labels', () => {
    // Three capitalised nouns in a row are a nav/menu, not a broken sentence.
    const tree = sectionWith([
      makeV3Widget('w1', 'heading', { title: 'Work', title_color: '#111' }),
      makeV3Widget('w2', 'heading', { title: 'About', title_color: '#111' }),
      makeV3Widget('w3', 'heading', { title: 'Contact', title_color: '#111' }),
    ]);
    expect(guard(tree, FRAGMENT_GUARD).result.passed).toBe(true);
  });

  it('catches a trailing-punctuation token as a continuation', () => {
    const tree = sectionWith([
      makeV3Widget('w1', 'heading', { title: 'Precision', title_color: '#111' }),
      makeV3Widget('w2', 'heading', { title: 'Bold', title_color: '#111' }),
      makeV3Widget('w3', 'heading', { title: 'work.', title_color: '#111' }),
    ]);
    expect(guard(tree, FRAGMENT_GUARD).result.passed).toBe(false);
  });
});

describe('G_SUBSTANCE_DUPES: no-variant-duplication', () => {
  const LONG_A = 'Crafting identities that go beyond visuals, rooted in meaning.';
  const LONG_B = 'Interfaces that are not just easy to use, they feel right.';

  it('passes on a tree without repeated long text', () => {
    expect(guard(validV3Tree, DUPE_GUARD).result.passed).toBe(true);
  });

  it('fails when responsive variants repeat the same long body text', () => {
    // The measured cause: sectionRegex matched the desktop, tablet AND phone
    // variant of the same Framer export, so every text appeared 2-3 times.
    const widgets: V3Element[] = [];
    for (let variant = 0; variant < 3; variant++) {
      widgets.push(makeV3Widget(`a${variant}`, 'text-editor', { editor: LONG_A }));
      widgets.push(makeV3Widget(`b${variant}`, 'text-editor', { editor: LONG_B }));
      widgets.push(makeV3Widget(`h${variant}`, 'heading', { title: 'Section heading that is long enough to count' }));
    }
    const result = guard(sectionWith(widgets), DUPE_GUARD).result;
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not deduplicated');
  });

  it('ignores short repeated labels — "Contact" legitimately appears many times', () => {
    const widgets = Array.from({ length: 8 }, (_, i) =>
      makeV3Widget(`w${i}`, 'text-editor', { editor: 'Contact' }),
    );
    expect(guard(sectionWith(widgets), DUPE_GUARD).result.passed).toBe(true);
  });

  it('does not fail on a couple of duplicates below the absolute floor', () => {
    const widgets: V3Element[] = [];
    // One repeated pair among many unique long texts stays under both bounds.
    for (let i = 0; i < 12; i++) {
      widgets.push(makeV3Widget(`u${i}`, 'text-editor', { editor: `${LONG_A} Unique variant number ${i}.` }));
    }
    widgets.push(makeV3Widget('d1', 'text-editor', { editor: LONG_B }));
    widgets.push(makeV3Widget('d2', 'text-editor', { editor: LONG_B }));
    expect(guard(sectionWith(widgets), DUPE_GUARD).result.passed).toBe(true);
  });

  it('treats the same text in different widget types as distinct', () => {
    const widgets = [
      makeV3Widget('w1', 'heading', { title: LONG_A }),
      makeV3Widget('w2', 'text-editor', { editor: LONG_A }),
    ];
    expect(guard(sectionWith(widgets), DUPE_GUARD).result.passed).toBe(true);
  });
});

describe('G_ANIMATION_CONTROL_SPLIT: underscore-variant-matches-eltype', () => {
  // Verified against schemas/elementor-v3-controls.snapshot.json:
  //   __container__ → animation / animation_delay / css_classes
  //   every widget  → _animation / _animation_delay / _css_classes
  it('passes when a container uses the un-prefixed entrance control', () => {
    const tree: V3Element[] = [
      { id: 'c1', elType: 'container', settings: { animation: 'fadeInUp', animation_delay: 100, ...STYLED } },
    ];
    expect(guard(tree, SPLIT_GUARD).result.passed).toBe(true);
  });

  it('passes when a widget uses the underscore-prefixed entrance control', () => {
    const tree = sectionWith([
      makeV3Widget('w1', 'heading', { title: 'Hello', _animation: 'fadeInUp', _animation_delay: 100 }),
    ]);
    expect(guard(tree, SPLIT_GUARD).result.passed).toBe(true);
  });

  it('fails when a container uses the widget variant `_animation`', () => {
    const tree: V3Element[] = [
      { id: 'c1', elType: 'container', settings: { _animation: 'fadeInUp', ...STYLED } },
    ];
    const result = guard(tree, SPLIT_GUARD).result;
    expect(result.passed).toBe(false);
    expect(result.details).toContain('_animation');
  });

  it('fails when a widget uses the container variant `animation`', () => {
    const tree = sectionWith([
      makeV3Widget('w1', 'heading', { title: 'Hello', animation: 'fadeInUp' }),
    ]);
    expect(guard(tree, SPLIT_GUARD).result.passed).toBe(false);
  });

  it('applies the same split to css_classes', () => {
    const containerWrong: V3Element[] = [
      { id: 'c1', elType: 'container', settings: { _css_classes: 'hero', ...STYLED } },
    ];
    expect(guard(containerWrong, SPLIT_GUARD).result.passed).toBe(false);
    const widgetWrong = sectionWith([makeV3Widget('w1', 'heading', { title: 'H', css_classes: 'hero' })]);
    expect(guard(widgetWrong, SPLIT_GUARD).result.passed).toBe(false);
  });
});

describe('G_ANIMATION_COMPANION: gated-controls-have-companion', () => {
  it('passes when the tree sets no gated controls at all', () => {
    expect(guard(validV3Tree, COMPANION_GUARD).result.passed).toBe(true);
  });

  it('fails on _animation_delay without _animation (schema: if _animation!="")', () => {
    const tree = sectionWith([makeV3Widget('w1', 'heading', { title: 'H', _animation_delay: 200 })]);
    const result = guard(tree, COMPANION_GUARD).result;
    expect(result.passed).toBe(false);
    expect(result.details).toContain('_animation');
  });

  it('fails on animation_delay without animation on a container', () => {
    const tree: V3Element[] = [
      { id: 'c1', elType: 'container', settings: { animation_delay: 200, ...STYLED } },
    ];
    expect(guard(tree, COMPANION_GUARD).result.passed).toBe(false);
  });

  it('resolves animation_duration against the kind-specific entrance control', () => {
    // animation_duration has NO underscore on either kind, but its `if` clause
    // points at `_animation` on widgets and `animation` on containers.
    const widgetOk = sectionWith([
      makeV3Widget('w1', 'heading', { title: 'H', _animation: 'fadeInUp', animation_duration: 'fast' }),
    ]);
    expect(guard(widgetOk, COMPANION_GUARD).result.passed).toBe(true);

    const widgetBad = sectionWith([
      makeV3Widget('w1', 'heading', { title: 'H', animation_duration: 'fast' }),
    ]);
    expect(guard(widgetBad, COMPANION_GUARD).result.passed).toBe(false);
  });

  it('fails on sticky_offset without sticky', () => {
    const tree: V3Element[] = [
      { id: 'c1', elType: 'container', settings: { sticky_offset: 50, ...STYLED } },
    ];
    expect(guard(tree, COMPANION_GUARD).result.passed).toBe(false);
  });

  it('passes on sticky:top + sticky_offset', () => {
    const tree: V3Element[] = [
      { id: 'c1', elType: 'container', settings: { sticky: 'top', sticky_offset: 50, ...STYLED } },
    ];
    expect(guard(tree, COMPANION_GUARD).result.passed).toBe(true);
  });

  it('fails on a scroll motion effect without the master switcher', () => {
    const tree: V3Element[] = [
      {
        id: 'c1',
        elType: 'container',
        settings: { motion_fx_rotateZ_effect: 'yes', motion_fx_rotateZ_speed: { unit: 'px', size: 1 }, ...STYLED },
      },
    ];
    const result = guard(tree, COMPANION_GUARD).result;
    expect(result.passed).toBe(false);
    expect(result.details).toContain('motion_fx_motion_fx_scrolling');
  });

  it('passes when the scroll master switcher is set to yes', () => {
    const tree: V3Element[] = [
      {
        id: 'c1',
        elType: 'container',
        settings: {
          motion_fx_motion_fx_scrolling: 'yes',
          motion_fx_rotateZ_effect: 'yes',
          motion_fx_rotateZ_speed: { unit: 'px', size: 1 },
          ...STYLED,
        },
      },
    ];
    expect(guard(tree, COMPANION_GUARD).result.passed).toBe(true);
  });

  it('routes mouse effects to the mouse master, not the scroll master', () => {
    const tree: V3Element[] = [
      {
        id: 'c1',
        elType: 'container',
        settings: { motion_fx_motion_fx_mouse: 'yes', motion_fx_tilt_effect: 'yes', ...STYLED },
      },
    ];
    expect(guard(tree, COMPANION_GUARD).result.passed).toBe(true);
  });

  it('does not gate the ungated motion_fx_transform_* controls', () => {
    const tree: V3Element[] = [
      { id: 'c1', elType: 'container', settings: { motion_fx_transform_origin_x: 'center', ...STYLED } },
    ];
    expect(guard(tree, COMPANION_GUARD).result.passed).toBe(true);
  });
});

describe('regression: the real Framer --html tree that used to pass at 95/100', () => {
  // Fixture = the first two root containers of the tree produced by
  // `elconv convert --target v3 --html index.html` against
  // loud-alternative-352151.framer.app on 2026-08-26. Frozen verbatim.
  //
  // That run reported "Guards: 95/100 PASSED" while containing 140 single-word
  // heading widgets and 63.6% duplicated body text. Without a fragmentation
  // guard this output could have been deployed to production.
  const tree = fragmentedFramerTree as V3Element[];

  it('is rejected: score below the 85 threshold', () => {
    const report = runV3Guards(tree);
    expect(report.passed).toBe(false);
    expect(report.score).toBeLessThan(85);
  });

  it('the old substance guards still all pass — they cannot see this failure', () => {
    const report = runV3Guards(tree);
    for (const name of [
      'G_SUBSTANCE_WIDGETS:section-has-widgets',
      'G_SUBSTANCE_TEXT:text-content-present',
      'G_SUBSTANCE_RATIO:widget-density',
    ]) {
      expect(report.results.find((r) => r.name === name)!.result.passed).toBe(true);
    }
  });

  it('G_SUBSTANCE_FRAGMENTS catches the tokenized headings', () => {
    expect(guard(tree, FRAGMENT_GUARD).result.passed).toBe(false);
  });

  it('G_SUBSTANCE_DUPES catches the responsive-variant duplication', () => {
    expect(guard(tree, DUPE_GUARD).result.passed).toBe(false);
  });

  it('sets no animation settings at all — the measured 0% animation coverage', () => {
    // Confirms the v7.0 §4.2 B-3 finding: no emitter writes a native
    // animation setting, so both animation guards pass vacuously.
    expect(guard(tree, SPLIT_GUARD).result.passed).toBe(true);
    expect(guard(tree, COMPANION_GUARD).result.passed).toBe(true);
  });
});

describe('formatGuardReport', () => {
  it('includes score and PASSED/FAILED status', () => {
    const report = runV3Guards(validV3Tree);
    const text = formatGuardReport(report);
    expect(text).toContain('100/100');
    expect(text).toContain('PASSED');
  });

  it('shows FAILED when score is below threshold', () => {
    const tree: V3Element[] = [
      makeV3Section('same', []),
      makeV3Section('same', []),
    ];
    const text = formatGuardReport(runV3Guards(tree));
    expect(text).toContain('FAILED');
  });

  it('shows guard name in each line', () => {
    const text = formatGuardReport(runV3Guards(validV3Tree));
    expect(text).toContain('G1:unique-ids');
    expect(text).toContain('G5:image-url-present');
  });
});

describe('runGuards edge cases', () => {
  it('score never goes below 0 even with many failures', () => {
    const fails = Array.from({ length: 10 }, (_, i) => ({
      name: `fail-${i}`,
      severity: 'critical' as const,
      check: () => ({ passed: false, message: `fail ${i}` }),
    }));
    const report = runGuards<V3Element[]>([], fails, 85);
    expect(report.score).toBe(0);
    expect(report.passed).toBe(false);
  });
});
