import { describe, it, expect } from 'vitest';
import {
  collectSchemaKeys,
  formatSchemaGateReport,
  levenshtein,
  parseConditionKey,
  resolveControl,
  suggestControlId,
  validateSettingsAgainstSchema,
  CONTAINER_SCHEMA_KEY,
  schemaKeyForElement,
  type SchemaGateElement,
  type SchemaViolation,
  type WidgetControlMap,
  type WidgetSchemaMap,
} from '../../../packages/core/src/index.js';

/**
 * Work package P2 — the schema gate (docs/BAUPLAN-v6.0-FRAMER-FIDELITY-2026-08.md
 * §8.5). Every control schema below is copied verbatim from the committed
 * snapshot `schemas/elementor-v3-controls.snapshot.json`, captured live from
 * testseite.nick-webdesign.de (Elementor 4.2.1) — so a passing test says
 * something about the real server, not about an invented shape.
 */

// --- Live-verified control fixtures --------------------------------------

/** `__container__` controls, verbatim from the snapshot. */
const CONTAINER_CONTROLS: WidgetControlMap = {
  container_type: { t: 'select', opts: ['flex', 'grid'], def: 'flex' },
  flex_direction: {
    t: 'choose',
    opts: ['row', 'column', 'row-reverse', 'column-reverse'],
    if: { container_type: ['flex'] },
    r: 1,
  },
  flex_gap: {
    t: 'gaps',
    def: { column: '', row: '', isLinked: true, unit: 'px' },
    if: { container_type: ['flex'] },
    r: 1,
  },
  padding: {
    t: 'dimensions',
    def: { unit: 'px', top: '', right: '', bottom: '', left: '', isLinked: true },
    r: 1,
  },
  // No `def` — this is what makes the companion REQUIRED (see schema-gate.ts header).
  background_background: { t: 'choose', opts: ['classic', 'gradient', 'video', 'slideshow'] },
  background_color: { t: 'color', if: { background_background: ['classic', 'gradient', 'video'] } },
};

/** `heading` controls, verbatim from the snapshot. */
const HEADING_CONTROLS: WidgetControlMap = {
  title: { t: 'textarea' },
  title_color: { t: 'color' },
  typography_typography: { t: 'popover_toggle', rv: 'custom' },
  typography_font_size: {
    t: 'slider',
    def: { unit: 'px', size: '', sizes: [] },
    if: { 'typography_typography!': '' },
    r: 1,
  },
  size: { t: 'select', opts: ['default', 'small', 'medium', 'large', 'xl', 'xxl'], if: { 'size!': 'default' } },
  hide_tablet: { t: 'switcher', rv: 'hidden-tablet' },
};

/** `button` — background_background DOES default here, so no companion is required. */
const BUTTON_CONTROLS: WidgetControlMap = {
  text: { t: 'text' },
  background_background: { t: 'choose', opts: ['classic', 'gradient'], def: 'classic' },
  background_color: { t: 'color', if: { background_background: ['classic', 'gradient'] } },
  css_classes: { t: 'text' },
};

/** `accordion` — repeater with `_id`, not `id` (a reproduced production gotcha). */
const ACCORDION_CONTROLS: WidgetControlMap = {
  tabs: {
    t: 'repeater',
    fields: {
      _id: { t: 'text' },
      tab_title: { t: 'text' },
      tab_content: { t: 'wysiwyg' },
    },
  },
};

function schema(overrides: Partial<Record<string, { controls: WidgetControlMap; complete?: boolean }>> = {}): WidgetSchemaMap {
  const base: WidgetSchemaMap = {
    [CONTAINER_SCHEMA_KEY]: { widgetType: CONTAINER_SCHEMA_KEY, controls: CONTAINER_CONTROLS, complete: true },
    heading: { widgetType: 'heading', controls: HEADING_CONTROLS, complete: true },
    button: { widgetType: 'button', controls: BUTTON_CONTROLS, complete: true },
    accordion: { widgetType: 'accordion', controls: ACCORDION_CONTROLS, complete: true },
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    base[key] = { widgetType: key, controls: value.controls, complete: value.complete ?? true };
  }
  return base;
}

/** One container with the given settings — the smallest tree the gate accepts. */
function container(settings: Record<string, unknown>, children: SchemaGateElement[] = []): SchemaGateElement[] {
  return [{ id: 'c1', elType: 'container', settings, elements: children }];
}

function widget(widgetType: string, settings: Record<string, unknown>, id = 'w1'): SchemaGateElement {
  return { id, elType: 'widget', widgetType, settings };
}

function find(violations: readonly SchemaViolation[], key: string): SchemaViolation | undefined {
  return violations.find((v) => v.key === key);
}

// --- collectSchemaKeys ---------------------------------------------------

describe('collectSchemaKeys', () => {
  it('collects the schema keys of a nested tree, sorted and deduplicated', () => {
    const tree = container({}, [
      widget('heading', {}, 'h1'),
      widget('heading', {}, 'h2'),
      { id: 'inner', elType: 'container', settings: {}, elements: [widget('button', {}, 'b1')] },
    ]);
    expect(collectSchemaKeys(tree)).toEqual([CONTAINER_SCHEMA_KEY, 'button', 'heading']);
  });

  it('omits element types Elementor exposes no schema for', () => {
    const tree: SchemaGateElement[] = [
      { id: 's', elType: 'section', settings: {}, elements: [{ id: 'col', elType: 'column', settings: {}, elements: [widget('heading', {})] }] },
    ];
    expect(collectSchemaKeys(tree)).toEqual(['heading']);
  });

  it('maps elType container onto the __container__ schema key', () => {
    expect(schemaKeyForElement('container')).toBe(CONTAINER_SCHEMA_KEY);
    expect(schemaKeyForElement('widget', 'heading')).toBe('heading');
    expect(schemaKeyForElement('widget')).toBeNull();
    expect(schemaKeyForElement('section')).toBeNull();
  });
});

// --- Check 1: unknown-key -----------------------------------------------

describe('schema gate — unknown-key', () => {
  it('flags container gap as unknown and suggests flex_gap (BAUPLAN §8.5)', () => {
    const report = validateSettingsAgainstSchema(container({ gap: { column: 10, row: 10 } }), schema());
    expect(report.ok).toBe(false);
    const v = find(report.violations, 'gap');
    expect(v?.kind).toBe('unknown-key');
    expect(v?.severity).toBe('error');
    expect(v?.suggestion).toBe('flex_gap');
  });

  it('flags heading text_color as unknown and suggests title_color (BAUPLAN §8.5)', () => {
    const report = validateSettingsAgainstSchema(
      container({}, [widget('heading', { title: 'Hi', text_color: '#111' })]),
      schema(),
    );
    expect(report.ok).toBe(false);
    const v = find(report.violations, 'text_color');
    expect(v?.kind).toBe('unknown-key');
    expect(v?.suggestion).toBe('title_color');
  });

  it('reports the tree path so duplicate ids stay distinguishable', () => {
    const report = validateSettingsAgainstSchema(
      container({}, [widget('heading', { bogus_key: 1 }, 'dup'), widget('heading', { bogus_key: 1 }, 'dup')]),
      schema(),
    );
    expect(report.violations.map((v) => v.path)).toEqual(['[0].elements[0]', '[0].elements[1]']);
  });

  it('never flags structural metadata keys', () => {
    const report = validateSettingsAgainstSchema(
      container({ _id: 'abc', __globals__: { background_color: 'globals/colors?id=primary' }, __dynamic__: {} }),
      schema(),
    );
    expect(report.ok).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it('downgrades an unrecognized key to a warning when the schema is incomplete', () => {
    const partial = schema({ heading: { controls: { title: { t: 'textarea' } }, complete: false } });
    const report = validateSettingsAgainstSchema(container({}, [widget('heading', { title_color: '#111' })]), partial);
    expect(report.ok).toBe(true);
    const v = find(report.violations, 'title_color');
    expect(v?.kind).toBe('unverified-key');
    expect(v?.severity).toBe('warning');
  });

  it('downgrades every unrecognized key when the caller marks the source degraded', () => {
    const report = validateSettingsAgainstSchema(
      container({ gap: 10 }),
      schema(),
      { degraded: true },
    );
    expect(report.ok).toBe(true);
    expect(find(report.violations, 'gap')?.kind).toBe('unverified-key');
  });
});

// --- Check 2: invalid-enum ----------------------------------------------

describe('schema gate — invalid-enum', () => {
  it('rejects flex_direction: vertical (BAUPLAN §8.5)', () => {
    const report = validateSettingsAgainstSchema(
      container({ container_type: 'flex', flex_direction: 'vertical' }),
      schema(),
    );
    expect(report.ok).toBe(false);
    const v = find(report.violations, 'flex_direction');
    expect(v?.kind).toBe('invalid-enum');
    expect(v?.detail).toContain('row-reverse');
  });

  it('accepts every declared option', () => {
    for (const value of ['row', 'column', 'row-reverse', 'column-reverse']) {
      const report = validateSettingsAgainstSchema(
        container({ container_type: 'flex', flex_direction: value }),
        schema(),
      );
      expect(report.ok, `flex_direction: ${value}`).toBe(true);
    }
  });

  it('tolerates the number/string ambiguity the server itself has', () => {
    const weighted = schema({
      heading: {
        controls: {
          ...HEADING_CONTROLS,
          typography_font_weight: { t: 'select', opts: [100, 400, 700, '', 'normal'] },
        },
      },
    });
    const report = validateSettingsAgainstSchema(
      container({}, [widget('heading', { typography_typography: 'custom', typography_font_weight: '700' })]),
      weighted,
    );
    expect(report.violations.filter((v) => v.kind === 'invalid-enum')).toHaveLength(0);
  });

  it('validates every member of an array value', () => {
    const multi = schema({
      heading: {
        controls: { ...HEADING_CONTROLS, sticky_on: { t: 'select2', opts: ['desktop', 'tablet', 'mobile'], arr: true } },
      },
    });
    const report = validateSettingsAgainstSchema(
      container({}, [widget('heading', { sticky_on: ['desktop', 'watch'] })]),
      multi,
    );
    expect(find(report.violations, 'sticky_on')?.kind).toBe('invalid-enum');
  });
});

// --- Check 3/4: companions and conditions -------------------------------

describe('schema gate — missing-companion / unsatisfied-condition', () => {
  it('flags container background_color without background_background (BAUPLAN §8.5)', () => {
    const report = validateSettingsAgainstSchema(container({ background_color: '#fff' }), schema());
    expect(report.ok).toBe(false);
    const v = find(report.violations, 'background_color');
    expect(v?.kind).toBe('missing-companion');
    expect(v?.suggestion).toBe('background_background');
    expect(v?.fix).toEqual({ key: 'background_background', value: 'classic' });
  });

  it('accepts container background_color once the companion is present', () => {
    const report = validateSettingsAgainstSchema(
      container({ background_background: 'classic', background_color: '#fff' }),
      schema(),
    );
    expect(report.ok).toBe(true);
  });

  it('does NOT require the companion where the schema default satisfies it (button)', () => {
    const report = validateSettingsAgainstSchema(
      container({ background_background: 'classic' }, [widget('button', { text: 'Go', background_color: '#fff' })]),
      schema(),
    );
    expect(report.ok).toBe(true);
    expect(find(report.violations, 'background_color')).toBeUndefined();
  });

  it('flags a companion that is set to a rejected value', () => {
    const report = validateSettingsAgainstSchema(
      container({ background_background: 'slideshow', background_color: '#fff' }),
      schema(),
    );
    const v = find(report.violations, 'background_color');
    expect(v?.kind).toBe('unsatisfied-condition');
    expect(v?.detail).toContain('slideshow');
  });

  it('flags typography_font_size without typography_typography: custom (AGENTS.md §6 gotcha)', () => {
    const report = validateSettingsAgainstSchema(
      container({}, [widget('heading', { typography_font_size: { unit: 'px', size: 48 } })]),
      schema(),
    );
    expect(report.ok).toBe(false);
    expect(find(report.violations, 'typography_font_size')?.kind).toBe('missing-companion');
  });

  it('accepts typography_font_size with the negated condition satisfied', () => {
    const report = validateSettingsAgainstSchema(
      container({}, [widget('heading', {
        typography_typography: 'custom',
        typography_font_size: { unit: 'px', size: 48 },
      })]),
      schema(),
    );
    expect(report.ok).toBe(true);
  });

  it('ignores a self-referential condition (heading.size has if: {"size!": "default"})', () => {
    const report = validateSettingsAgainstSchema(
      container({}, [widget('heading', { size: 'default' })]),
      schema(),
    );
    expect(report.ok).toBe(true);
    expect(find(report.violations, 'size')).toBeUndefined();
  });

  it('checks the breakpoint-suffixed companion before falling back to the base', () => {
    const report = validateSettingsAgainstSchema(
      container({}, [widget('heading', {
        typography_typography_tablet: 'custom',
        typography_font_size_tablet: { unit: 'px', size: 32 },
      })]),
      schema({
        heading: {
          controls: { ...HEADING_CONTROLS, typography_typography: { t: 'popover_toggle', rv: 'custom', r: 1 } },
        },
      }),
    );
    expect(find(report.violations, 'typography_font_size_tablet')).toBeUndefined();
  });

  it('skips a condition referencing a control the schema does not declare', () => {
    const dangling = schema({
      heading: { controls: { title: { t: 'textarea' }, weird: { t: 'color', if: { not_in_schema: ['x'] } } } },
    });
    const report = validateSettingsAgainstSchema(container({}, [widget('heading', { weird: '#111' })]), dangling);
    expect(report.violations.filter((v) => v.kind === 'missing-companion')).toHaveLength(0);
  });
});

// --- Check 5: non-responsive-suffix -------------------------------------

describe('schema gate — non-responsive-suffix', () => {
  it('flags title_color_tablet because title_color declares no r flag (BAUPLAN §8.5)', () => {
    const report = validateSettingsAgainstSchema(
      container({}, [widget('heading', { title_color_tablet: '#111' })]),
      schema(),
    );
    expect(report.ok).toBe(false);
    const v = find(report.violations, 'title_color_tablet');
    expect(v?.kind).toBe('non-responsive-suffix');
    expect(v?.suggestion).toBe('title_color');
  });

  it('accepts padding_tablet because padding is responsive', () => {
    const report = validateSettingsAgainstSchema(
      container({ padding_tablet: { unit: 'px', top: 10, right: 10, bottom: 10, left: 10, isLinked: true } }),
      schema(),
    );
    expect(report.ok).toBe(true);
  });

  it('never treats hide_tablet as a responsive override', () => {
    const report = validateSettingsAgainstSchema(
      container({}, [widget('heading', { hide_tablet: 'hidden-tablet' })]),
      schema(),
    );
    expect(report.ok).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it('resolves a registered breakpoint variant against itself, not its base', () => {
    const controls: WidgetControlMap = {
      _element_width: { t: 'select', opts: ['initial', 'auto'] },
      _element_width_tablet: { t: 'select', opts: ['initial', 'auto'], r: { max: 'tablet' } },
    };
    const resolved = resolveControl('_element_width_tablet', controls);
    expect(resolved?.baseKey).toBe('_element_width_tablet');
    expect(resolved?.breakpoint).toBeNull();
  });

  it('resolves an implicit suffix onto its responsive base', () => {
    const resolved = resolveControl('padding_tablet', CONTAINER_CONTROLS);
    expect(resolved?.baseKey).toBe('padding');
    expect(resolved?.breakpoint).toBe('tablet');
  });

  it('returns null for a key with no base control', () => {
    expect(resolveControl('nope_tablet', CONTAINER_CONTROLS)).toBeNull();
  });
});

// --- Check 6: wrong-shape -----------------------------------------------

describe('schema gate — wrong-shape', () => {
  it('flags padding: 20 (a number instead of a dimensions object) (BAUPLAN §8.5)', () => {
    const report = validateSettingsAgainstSchema(container({ padding: 20 }), schema());
    expect(report.ok).toBe(false);
    expect(find(report.violations, 'padding')?.kind).toBe('wrong-shape');
  });

  it('flags a dimensions object without unit', () => {
    const report = validateSettingsAgainstSchema(container({ padding: { top: 10, bottom: 10 } }), schema());
    expect(find(report.violations, 'padding')?.detail).toContain('unit');
  });

  it('flags a gaps object missing row', () => {
    const report = validateSettingsAgainstSchema(
      container({ container_type: 'flex', flex_gap: { column: 10, unit: 'px' } }),
      schema(),
    );
    expect(find(report.violations, 'flex_gap')?.kind).toBe('wrong-shape');
  });

  it('flags a slider without size or unit', () => {
    const report = validateSettingsAgainstSchema(
      container({}, [widget('heading', { typography_typography: 'custom', typography_font_size: { size: 48 } })]),
      schema(),
    );
    expect(find(report.violations, 'typography_font_size')?.detail).toContain('unit');
  });

  it('flags a boolean on a popover_toggle and names the rv value', () => {
    const report = validateSettingsAgainstSchema(
      container({}, [widget('heading', { typography_typography: true })]),
      schema(),
    );
    const v = find(report.violations, 'typography_typography');
    expect(v?.kind).toBe('wrong-shape');
    expect(v?.detail).toContain('custom');
  });

  it('flags css_classes as an array — the literal "Array" render bug (AGENTS.md §6)', () => {
    const report = validateSettingsAgainstSchema(
      container({ background_background: 'classic' }, [widget('button', { text: 'Go', css_classes: ['a', 'b'] })]),
      schema(),
    );
    const v = find(report.violations, 'css_classes');
    expect(v?.kind).toBe('wrong-shape');
    expect(v?.detail).toContain('needs a string');
  });

  it('accepts css_classes as a string', () => {
    const report = validateSettingsAgainstSchema(
      container({ background_background: 'classic' }, [widget('button', { text: 'Go', css_classes: 'a b' })]),
      schema(),
    );
    expect(report.ok).toBe(true);
  });

  it('flags a non-string color', () => {
    const report = validateSettingsAgainstSchema(
      container({ background_background: 'classic', background_color: { r: 255 } }),
      schema(),
    );
    expect(find(report.violations, 'background_color')?.kind).toBe('wrong-shape');
  });

  it('makes no shape assumption for an unknown control type', () => {
    const exotic = schema({ heading: { controls: { title: { t: 'textarea' }, mystery: { t: 'brand_new_control' } } } });
    const report = validateSettingsAgainstSchema(container({}, [widget('heading', { mystery: 42 })]), exotic);
    expect(report.ok).toBe(true);
  });
});

// --- Repeater rows ------------------------------------------------------

describe('schema gate — repeater rows', () => {
  it('flags a row key that is not a declared sub-field (id vs _id gotcha)', () => {
    const report = validateSettingsAgainstSchema(
      container({}, [widget('accordion', { tabs: [{ id: 'x', tab_title: 'T' }] })]),
      schema(),
    );
    expect(report.ok).toBe(false);
    const v = find(report.violations, 'tabs[0].id');
    expect(v?.kind).toBe('unknown-key');
    expect(v?.suggestion).toBe('_id');
  });

  it('accepts rows using only declared sub-fields', () => {
    const report = validateSettingsAgainstSchema(
      container({}, [widget('accordion', { tabs: [{ _id: 'x', tab_title: 'T', tab_content: '<p>c</p>' }] })]),
      schema(),
    );
    expect(report.ok).toBe(true);
  });

  it('flags a non-object repeater row', () => {
    const report = validateSettingsAgainstSchema(
      container({}, [widget('accordion', { tabs: ['not-an-object'] })]),
      schema(),
    );
    expect(find(report.violations, 'tabs[0]')?.kind).toBe('wrong-shape');
  });

  it('flags a repeater that is not an array at all', () => {
    const report = validateSettingsAgainstSchema(
      container({}, [widget('accordion', { tabs: { _id: 'x' } })]),
      schema(),
    );
    expect(find(report.violations, 'tabs')?.kind).toBe('wrong-shape');
  });
});

// --- schema-unavailable -------------------------------------------------

describe('schema gate — schema-unavailable', () => {
  it('emits exactly ONE warning for a legacy section, not one per key', () => {
    const tree: SchemaGateElement[] = [{
      id: 's1',
      elType: 'section',
      settings: { background_color: '#fff', padding: 20, gap: 'no', another: 1 },
      elements: [],
    }];
    const report = validateSettingsAgainstSchema(tree, schema());
    expect(report.ok).toBe(true);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].kind).toBe('schema-unavailable');
    expect(report.violations[0].severity).toBe('warning');
    expect(report.violations[0].detail).toContain('4 setting(s)');
  });

  it('keeps walking children of a schema-less element', () => {
    const tree: SchemaGateElement[] = [{
      id: 's1',
      elType: 'section',
      settings: {},
      elements: [{ id: 'col', elType: 'column', settings: {}, elements: [widget('heading', { gap: 1 })] }],
    }];
    const report = validateSettingsAgainstSchema(tree, schema());
    expect(report.ok).toBe(false);
    expect(find(report.violations, 'gap')?.kind).toBe('unknown-key');
  });

  it('warns about a widget element that carries no widgetType', () => {
    const report = validateSettingsAgainstSchema([{ id: 'w', elType: 'widget', settings: {} }], schema());
    expect(report.violations[0].kind).toBe('schema-unavailable');
    expect(report.violations[0].detail).toContain('no widgetType');
  });

  it('records a widget type the schema did not cover as missing, not as unknown keys', () => {
    const report = validateSettingsAgainstSchema(
      container({}, [widget('image-carousel', { anything: 1, more: 2 })]),
      schema(),
    );
    expect(report.ok).toBe(true);
    expect(report.missingWidgetTypes).toEqual(['image-carousel']);
    expect(report.violations.filter((v) => v.kind === 'unknown-key')).toHaveLength(0);
  });
});

// --- Counters and reporting --------------------------------------------

describe('schema gate — report shape', () => {
  it('counts elements and settings across the whole tree', () => {
    const report = validateSettingsAgainstSchema(
      container({ container_type: 'flex' }, [
        widget('heading', { title: 'A', title_color: '#111' }),
        widget('button', { text: 'B' }),
      ]),
      schema(),
    );
    expect(report.elementsChecked).toBe(3);
    expect(report.settingsChecked).toBe(4);
  });

  it('separates error and warning counts', () => {
    const report = validateSettingsAgainstSchema(
      [
        { id: 's', elType: 'section', settings: { x: 1 }, elements: [] },
        ...container({ gap: 1 }),
      ],
      schema(),
    );
    expect(report.errorCount).toBe(1);
    expect(report.warningCount).toBe(1);
    expect(report.ok).toBe(false);
  });

  it('scales to the real failure mode: many unknown keys, all reported at once', () => {
    const settings: Record<string, unknown> = {};
    for (let i = 0; i < 110; i++) settings[`made_up_key_${i}`] = 'x';
    const report = validateSettingsAgainstSchema(container(settings), schema());
    expect(report.ok).toBe(false);
    expect(report.errorCount).toBe(110);
  });

  it('formats errors before warnings and truncates with a count', () => {
    const settings: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) settings[`made_up_key_${i}`] = 'x';
    const report = validateSettingsAgainstSchema(container(settings), schema());
    const text = formatSchemaGateReport(report, { limit: 5 });
    expect(text).toContain('Schema gate: FAIL');
    expect(text).toContain('and 25 more');
  });

  it('lists missing widget types in the formatted report', () => {
    const report = validateSettingsAgainstSchema(container({}, [widget('nav-menu', {})]), schema());
    expect(formatSchemaGateReport(report)).toContain('Schema missing for: nav-menu');
  });

  it('renders the suggestion and fix hints', () => {
    const report = validateSettingsAgainstSchema(container({ gap: 1, background_color: '#fff' }), schema());
    const text = formatSchemaGateReport(report);
    expect(text).toContain('did you mean "flex_gap"?');
    expect(text).toContain('add background_background: "classic"');
  });

  it('reports PASS for a clean tree', () => {
    const report = validateSettingsAgainstSchema(container({ container_type: 'flex' }), schema());
    expect(formatSchemaGateReport(report)).toContain('Schema gate: PASS');
  });

  it('reports a structurally broken tree as findings instead of throwing', () => {
    const broken = [null, 'string', 42, { settings: null }] as unknown as SchemaGateElement[];
    const report = validateSettingsAgainstSchema(broken, schema());
    expect(report.ok).toBe(true);
    expect(report.violations).toHaveLength(4);
    expect(report.violations.every((v) => v.kind === 'schema-unavailable')).toBe(true);
    expect(report.violations[0].detail).toContain('null');
    expect(report.settingsChecked).toBe(0);
  });

  it('collectSchemaKeys survives the same broken tree', () => {
    const broken = [null, 'string', { elType: 'container', elements: 'not-an-array' }] as unknown as SchemaGateElement[];
    expect(collectSchemaKeys(broken)).toEqual([CONTAINER_SCHEMA_KEY]);
  });
});

// --- Condition-key parsing and suggestion helpers ----------------------

describe('parseConditionKey', () => {
  it.each([
    ['background_background', { controlId: 'background_background', negated: false }],
    ['typography_typography!', { controlId: 'typography_typography', negated: true }],
    ['image[url]!', { controlId: 'image', subField: 'url', negated: true }],
    ['grid_columns_grid[unit]', { controlId: 'grid_columns_grid', subField: 'unit', negated: false }],
  ])('parses %s', (raw, expected) => {
    expect(parseConditionKey(raw)).toMatchObject(expected);
  });
});

describe('suggestControlId', () => {
  it('finds a prefix-dropped candidate', () => {
    expect(suggestControlId('gap', ['flex_gap', 'padding'])).toBe('flex_gap');
  });

  it('ignores underscores and case', () => {
    expect(suggestControlId('titlecolor', ['title_color'])).toBe('title_color');
  });

  it('returns undefined when nothing is near enough', () => {
    expect(suggestControlId('zzzzzzzzzzzz', ['title_color', 'padding'])).toBeUndefined();
  });

  it('returns undefined for an empty candidate list', () => {
    expect(suggestControlId('gap', [])).toBeUndefined();
  });
});

describe('levenshtein', () => {
  it.each([
    ['', '', 0],
    ['a', '', 1],
    ['', 'abc', 3],
    ['kitten', 'sitting', 3],
    ['padding', 'padding', 0],
  ])('distance(%s, %s) = %i', (a, b, expected) => {
    expect(levenshtein(a, b)).toBe(expected);
  });
});
