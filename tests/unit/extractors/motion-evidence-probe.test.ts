import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyMotionSeries,
  decomposeTransform,
  deriveViewportsFromBreakpoints,
  parsePackedSample,
  probeMotionEvidence,
  summariseMotionEvidence,
  MOTION_EPSILON,
  MAX_WIDTH_BAND_PROBE_WIDTH,
  DEFAULT_MOTION_STOPS,
  type MotionEvidence,
  type MotionKind,
} from '@elconv/extractors';

/**
 * The fixture is a frozen real sweep of the live Humeen Framer page
 * (`output/loud-alt-2026-08-26/animation-evidence.json`), reshaped into the
 * exact packed form `probeMotionEvidence` produces. 31 elements, 7 scroll
 * stops, one packed
 * `opacity|transform|position|clipPath|filter` string per element per stop.
 *
 * Testing classification against this instead of hand-written strings is the
 * point: the awkward values (`matrix(0.999915, ...)`, an image whose whole
 * scale range is 0.0021, a card row running 1900px → −1050px) are exactly the
 * ones invented test data would never contain.
 */
interface MotionFixture {
  stops: number[];
  breakpointsPayload: string;
  appearIdCount: number;
  appearIdTargets: Array<{ appearId: string; tag: string; framerName?: string; classes: string }>;
  sticky: Array<{ framerName?: string; top: string; heightPx: number }>;
  cssMotion: { keyframes: string[]; transitions: string[] };
  runningWaapiCount: number;
  series: Record<string, Array<string | null>>;
}

const fixture: MotionFixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/framer/motion-sweep-humeen.json'), 'utf8'),
);

function classifyFixture(): Map<string, ReturnType<typeof classifyMotionSeries>> {
  const out = new Map<string, ReturnType<typeof classifyMotionSeries>>();
  for (const [key, series] of Object.entries(fixture.series)) {
    out.set(key, classifyMotionSeries(series.map(parsePackedSample)));
  }
  return out;
}

describe('motion-evidence-probe / decomposeTransform', () => {
  it('treats none as the identity transform, not as unknown', () => {
    expect(decomposeTransform('none')).toEqual({
      scaleX: 1, scaleY: 1, translateX: 0, translateY: 0, rotateDeg: 0,
    });
  });

  it('decomposes a real measured uniform scale', () => {
    const parts = decomposeTransform('matrix(1.10008, 0, 0, 1.10008, 0, 0)');
    expect(parts).not.toBeNull();
    expect(parts!.scaleX).toBeCloseTo(1.10008, 5);
    expect(parts!.scaleY).toBeCloseTo(1.10008, 5);
    expect(parts!.rotateDeg).toBeCloseTo(0, 6);
  });

  it('decomposes the real measured -8 degree card rotation', () => {
    // Exact value read off the live page for framer-1yv66y7-container.
    const parts = decomposeTransform('matrix(0.990268, -0.139173, 0.139173, 0.990268, 0, 0)');
    expect(parts).not.toBeNull();
    expect(parts!.rotateDeg).toBeCloseTo(-8, 1);
    expect(parts!.scaleX).toBeCloseTo(1, 3);
  });

  it('decomposes the real measured horizontal card run', () => {
    const parts = decomposeTransform('matrix(1, 0, 0, 1, 1900, 0)');
    expect(parts!.translateX).toBe(1900);
    expect(parts!.translateY).toBe(0);
  });

  it('decomposes a matrix3d that is a plain 2D transform lifted to 4x4', () => {
    const parts = decomposeTransform('matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 12,34,0,1)');
    expect(parts).not.toBeNull();
    expect(parts!.translateX).toBe(12);
    expect(parts!.translateY).toBe(34);
  });

  it('reports a matrix3d with real depth as undecomposable instead of flattening it', () => {
    // Z translation of 200px. Flattening this to a 2D transform would silently
    // discard the depth and report the element as static.
    expect(decomposeTransform('matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,200,1)')).toBeNull();
  });

  it('returns null for a malformed matrix rather than guessing', () => {
    expect(decomposeTransform('matrix(1, 0, 0)')).toBeNull();
    expect(decomposeTransform('rotate(45deg)')).toBeNull();
    expect(decomposeTransform('matrix(1, 0, 0, nope, 0, 0)')).toBeNull();
  });
});

describe('motion-evidence-probe / parsePackedSample', () => {
  it('parses a real packed sample', () => {
    const sample = parsePackedSample('0|matrix(1, 0, 0, 1, 0, 50)|relative|none|none');
    expect(sample).not.toBeNull();
    expect(sample!.opacity).toBe(0);
    expect(sample!.transform!.translateY).toBe(50);
    expect(sample!.position).toBe('relative');
  });

  it('rejects null, empty and truncated input', () => {
    expect(parsePackedSample(null)).toBeNull();
    expect(parsePackedSample(undefined)).toBeNull();
    expect(parsePackedSample('')).toBeNull();
    expect(parsePackedSample('1|none|relative')).toBeNull();
  });

  it('rejects a non-numeric opacity instead of coercing it to NaN', () => {
    expect(parsePackedSample('x|none|relative|none|none')).toBeNull();
  });

  it('keeps the sample when the transform is undecomposable', () => {
    // The element still has a usable opacity; discarding the whole sample
    // would lose that.
    const sample = parsePackedSample('0.5|rotate3d(1,1,1,45deg)|relative|none|none');
    expect(sample).not.toBeNull();
    expect(sample!.opacity).toBe(0.5);
    expect(sample!.transform).toBeNull();
  });
});

describe('motion-evidence-probe / classifyMotionSeries against the frozen real sweep', () => {
  const classified = classifyFixture();

  it('has the 31 measured elements and 7 stops each', () => {
    expect(Object.keys(fixture.series)).toHaveLength(31);
    for (const series of Object.values(fixture.series)) {
      expect(series).toHaveLength(7);
    }
  });

  it('classifies at least 25 of the 31 measured effects (BAUPLAN v7.0 §4.5 acceptance)', () => {
    const resolved = [...classified.values()].filter((c) => c.kind !== 'indeterminate');
    expect(resolved.length).toBeGreaterThanOrEqual(25);
  });

  it('classifies the fade-up reveals as entrance', () => {
    // Measured: opacity 0 -> 1 with transform translateY 50px -> 0.
    for (const key of [
      '202:Top:framer-izxvjs',
      '225:Bottom:framer-1uglcty',
      '261:Heading:framer-1fmdehp',
      '310:Headng:framer-li4fo9',
      '371:Container:framer-zkfyki',
      '608:Stat:framer-v96fxj',
    ]) {
      const result = classified.get(key);
      expect(result, key).toBeDefined();
      expect(result!.kind, key).toBe<MotionKind>('entrance');
      expect(result!.effects.some((e) => e.kind === 'opacity'), key).toBe(true);
      expect(result!.effects.some((e) => e.kind === 'translateY'), key).toBe(true);
    }
  });

  it('classifies the staggered 40px reveals as entrance', () => {
    // Four siblings, measured opacity end states 0.9655 / 0.9515 / 0.9318 /
    // 0.9037 — the same reveal caught at four different progress points, which
    // is what a stagger looks like in a snapshot sweep.
    for (const key of [
      '732:div:framer-ubn138-container',
      '742:div:framer-itx1v3-container',
      '752:div:framer-1nra95d-container',
      '762:div:framer-hq472u-container',
    ]) {
      expect(classified.get(key)!.kind, key).toBe<MotionKind>('entrance');
    }
  });

  it('classifies the scale-in reveal as entrance, not as a scroll zoom', () => {
    // framer-1abc2qs: opacity 0 -> 1 AND scale 0.7 -> 1 together. Scale alone
    // would look like an image zoom; the opacity rise is what makes it a reveal.
    const result = classified.get('626:div:framer-1abc2qs-container')!;
    expect(result.kind).toBe<MotionKind>('entrance');
    expect(result.effects.some((e) => e.kind === 'scale')).toBe(true);
  });

  it('classifies the +-8 degree card rotations as scroll-linked', () => {
    for (const key of [
      '267:div:framer-1yv66y7-container',
      '275:div:framer-dj9ov7-container',
      '283:div:framer-nyrklf-container',
      '291:div:framer-7x88n3-container',
    ]) {
      const result = classified.get(key)!;
      expect(result.kind, key).toBe<MotionKind>('scroll-linked');
      const rotate = result.effects.find((e) => e.kind === 'rotate');
      expect(rotate, key).toBeDefined();
      expect(rotate!.range, key).toBeGreaterThan(9);
    }
  });

  it('classifies the horizontal card run as scroll-linked with its real 2950px range', () => {
    const result = classified.get('266:Cards:framer-1lv5kfo')!;
    expect(result.kind).toBe<MotionKind>('scroll-linked');
    const translateX = result.effects.find((e) => e.kind === 'translateX')!;
    expect(translateX.range).toBeCloseTo(2950, 0);
    expect(translateX.from).toBe(1900);
    expect(translateX.to).toBe(-1050);
    // Perfectly monotonic AND still a scrub — this is the case that proves
    // monotonicity cannot be used to separate entrance from scroll-linked.
    expect(translateX.monotonic).toBe(true);
  });

  it('classifies the card stack as scroll-linked', () => {
    for (const key of ['673:Content-box:framer-1k461xq', '700:Image:framer-1b0m1db']) {
      const result = classified.get(key)!;
      expect(result.kind, key).toBe<MotionKind>('scroll-linked');
      const translateY = result.effects.find((e) => e.kind === 'translateY')!;
      expect(Math.abs(translateY.range), key).toBeGreaterThan(360);
    }
  });

  it('classifies the image zooms as scroll-linked with constant opacity', () => {
    for (const key of [
      '132:Image:framer-1ctiva4',
      '133:Image:framer-nzo9q5',
      '135:Image:framer-1rr7vut',
      '136:Image:framer-1ruztq1',
      '137:Image:framer-g89ysd',
    ]) {
      const result = classified.get(key)!;
      expect(result.kind, key).toBe<MotionKind>('scroll-linked');
      expect(result.effects.some((e) => e.kind === 'opacity'), key).toBe(false);
      expect(result.effects.some((e) => e.kind === 'scale'), key).toBe(true);
    }
  });

  it('treats the sub-epsilon image as noise instead of reporting a phantom zoom', () => {
    // framer-tw203r oscillates between matrix(0.999262...) and none across the
    // whole sweep: a total scale range of 0.0021. Without MOTION_EPSILON this
    // is a false positive animation on a visually static image.
    const result = classified.get('131:Image:framer-tw203r')!;
    expect(result.kind).toBe<MotionKind>('indeterminate');
    expect(result.effects).toHaveLength(0);
    expect(result.reason).toContain('below threshold');
  });

  it('reports no duration for scroll-derived motion', () => {
    // The sweep samples settled end states at 7 positions. Any duration read
    // out of that would be invented, so no effect carries one.
    for (const result of classified.values()) {
      for (const effect of result.effects) {
        expect(effect).not.toHaveProperty('durationMs');
      }
    }
  });
});

describe('motion-evidence-probe / classifyMotionSeries edge cases', () => {
  const pack = (opacity: number, transform: string) => `${opacity}|${transform}|relative|none|none`;

  it('needs two usable samples', () => {
    expect(classifyMotionSeries([]).kind).toBe<MotionKind>('indeterminate');
    expect(classifyMotionSeries([parsePackedSample(pack(1, 'none'))]).kind).toBe<MotionKind>('indeterminate');
    expect(classifyMotionSeries([null, null]).kind).toBe<MotionKind>('indeterminate');
  });

  it('does not call a fade-out an entrance', () => {
    const result = classifyMotionSeries(
      [pack(1, 'none'), pack(0.5, 'none'), pack(0, 'none')].map(parsePackedSample),
    );
    expect(result.kind).not.toBe<MotionKind>('entrance');
  });

  it('does not call a flicker an entrance', () => {
    // Rises then falls: not monotonic, so not a settled reveal.
    const result = classifyMotionSeries(
      [pack(0, 'none'), pack(1, 'none'), pack(0.2, 'none'), pack(1, 'none')].map(parsePackedSample),
    );
    expect(result.kind).toBe<MotionKind>('indeterminate');
  });

  it('does not call a partial fade an entrance when it never becomes visible', () => {
    const result = classifyMotionSeries(
      [pack(0, 'none'), pack(0.3, 'none'), pack(0.6, 'none')].map(parsePackedSample),
    );
    expect(result.kind).toBe<MotionKind>('indeterminate');
    expect(result.reason).toContain('without settling visible');
  });

  it('mentions undecomposable transforms in the reason instead of hiding them', () => {
    const result = classifyMotionSeries(
      ['1|matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,90,1)|relative|none|none',
        '1|matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,10,1)|relative|none|none'].map(parsePackedSample),
    );
    expect(result.kind).toBe<MotionKind>('indeterminate');
    expect(result.reason).toContain('undecomposable');
  });

  it('uses MOTION_EPSILON as the noise floor', () => {
    const belowFloor = MOTION_EPSILON / 2;
    const result = classifyMotionSeries(
      [pack(1, 'none'), pack(1 - belowFloor, 'none')].map(parsePackedSample),
    );
    expect(result.effects).toHaveLength(0);
  });
});

describe('motion-evidence-probe / deriveViewportsFromBreakpoints', () => {
  it('derives the real 1200 / 810 widths from the frozen payload', () => {
    const { viewports, warnings } = deriveViewportsFromBreakpoints(fixture.breakpointsPayload);
    const widths = viewports.map((v) => v.width);
    expect(widths).toContain(1200);
    expect(widths).toContain(810);
    // 768 is DEFAULT_VIEWPORTS' tablet width and lands on the wrong side of
    // this project's 810px boundary.
    expect(widths).not.toContain(768);
    expect(widths).not.toContain(1440);
    // The max-width-only band has no declared width, so a convention is used —
    // and said so.
    expect(widths).toContain(MAX_WIDTH_BAND_PROBE_WIDTH);
    expect(warnings.join(' ')).toContain('max-width-only');
  });

  it('sorts widest first and labels conventionally', () => {
    const { viewports } = deriveViewportsFromBreakpoints(fixture.breakpointsPayload);
    expect(viewports.map((v) => v.width)).toEqual([...viewports.map((v) => v.width)].sort((a, b) => b - a));
    expect(viewports[0].label).toBe('desktop');
  });

  it('gives every derived viewport a positive height', () => {
    const { viewports } = deriveViewportsFromBreakpoints(fixture.breakpointsPayload);
    for (const viewport of viewports) {
      expect(viewport.height).toBeGreaterThan(0);
    }
  });

  it('deduplicates repeated bands', () => {
    // The real payload declares 6 entries for 3 distinct bands.
    const { viewports } = deriveViewportsFromBreakpoints(fixture.breakpointsPayload);
    expect(viewports).toHaveLength(3);
  });

  it('returns nothing and warns for a missing or unusable payload, never a default', () => {
    for (const input of [null, undefined, '', 'not json', '{"not":"an array"}', '[]', '[{"mediaQuery":"print"}]']) {
      const { viewports, warnings } = deriveViewportsFromBreakpoints(input);
      expect(viewports, String(input)).toEqual([]);
      expect(warnings.length, String(input)).toBeGreaterThan(0);
    }
  });
});

describe('motion-evidence-probe / probeMotionEvidence', () => {
  let page: {
    evaluate: ReturnType<typeof vi.fn>;
    waitForTimeout: ReturnType<typeof vi.fn>;
    url: ReturnType<typeof vi.fn>;
  };

  const DOC_HEIGHT = 16612;

  /**
   * Drive the probe with the frozen sweep. `page.evaluate` is called in a fixed
   * order, so the mock replays that order: height, appear payload, then per
   * stop (scrollTo, sample), then meta, sticky positions, and the three static
   * walks.
   */
  function stubPage(options: { series?: Record<string, Array<string | null>>; stopCount?: number } = {}) {
    const series = options.series ?? fixture.series;
    const stopCount = options.stopCount ?? DEFAULT_MOTION_STOPS.length;
    const keys = Object.keys(series);

    const metaFor = (key: string) => {
      const [, name, cls] = key.split(':');
      const framerName = /^[a-z]+$/.test(name) ? undefined : name;
      return {
        tag: framerName ? 'div' : name,
        framerName,
        selector: framerName ? `div[data-framer-name="${framerName}"]` : `${name}.${cls}`,
        ordinalInSection: 0,
        depthInSection: 1,
      };
    };

    // The real `collectNodeMeta` walks EVERY candidate, not only the ones that
    // moved — a sticky element does not change style across the sweep, so it
    // appears in meta but never in `series`. The stub has to mirror that or the
    // sticky join has nothing to resolve against.
    const stickyKeys = fixture.sticky.map(
      (entry, index) => `${900 + index}:${entry.framerName ?? 'div'}:framer-sticky${index}`,
    );
    const meta = Object.fromEntries(
      [...keys, ...stickyKeys].map((key) => [key, metaFor(key)]),
    );
    const stickyPositions = Object.fromEntries(
      fixture.sticky.map((entry, index) => [
        stickyKeys[index],
        // A top-sticky element computes `bottom: auto`; the probe needs both to
        // tell a top-sticky element from a bottom-sticky one.
        { top: entry.top, bottom: 'auto', heightPx: entry.heightPx },
      ]),
    );

    const queue: unknown[] = [DOC_HEIGHT, {
      appearAnimations: '{"ymcpgr":{}}',
      breakpoints: fixture.breakpointsPayload,
      targets: fixture.appearIdTargets,
    }];
    for (let stop = 0; stop < stopCount; stop++) {
      queue.push(undefined); // window.scrollTo
      queue.push(Object.fromEntries(keys.map((key) => [key, series[key][stop] ?? ''])));
    }
    queue.push(meta);
    queue.push(stickyPositions);
    queue.push({ localKeyframes: [], transitions: [], hasGSAP: false, hasScrollTrigger: false }); // discoverAnimations
    queue.push({ elements: [], referencedKeyframes: [], distinctTransitionProperties: [] }); // animation props
    queue.push([]); // pseudo states

    let index = 0;
    page = {
      evaluate: vi.fn(async () => queue[index++]),
      waitForTimeout: vi.fn(async () => undefined),
      url: vi.fn(() => 'https://loud-alternative-352151.framer.app/'),
    };
  }

  beforeEach(() => stubPage());

  async function run(): Promise<MotionEvidence> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return probeMotionEvidence(page as any, { settleMs: 0 });
  }

  it('reproduces the measured counts end to end', async () => {
    const evidence = await run();
    expect(evidence.documentHeightPx).toBe(DOC_HEIGHT);
    expect(evidence.stops).toEqual([...DEFAULT_MOTION_STOPS]);
    expect(evidence.observations).toHaveLength(31);

    const summary = summariseMotionEvidence(evidence);
    expect(summary.entrance + summary.scrollLinked).toBeGreaterThanOrEqual(25);
    expect(summary.sticky).toBe(2);
  });

  it('derives viewports from the page payload, not from DEFAULT_VIEWPORTS', async () => {
    const evidence = await run();
    const widths = evidence.viewports.map((v) => v.width);
    expect(widths).toContain(1200);
    expect(widths).toContain(810);
    expect(widths).not.toContain(768);
  });

  it('keeps the real sticky inventory with its offsets', async () => {
    const evidence = await run();
    expect(evidence.sticky.map((s) => s.top).sort()).toEqual(['0px', '50px']);
  });

  it('scopes each sticky element to its section so a target can address it', async () => {
    const evidence = await run();
    // Measured on the real page: both sticky elements are named, and `Container`
    // is a name Framer reuses across the document. Without the section scope and
    // the ordinal, a merge cannot tell which `Container` the offset belongs to —
    // and Elementor's `sticky` control has to land on one specific element.
    expect(evidence.sticky).toHaveLength(2);
    for (const entry of evidence.sticky) {
      expect(entry.selector).toContain('data-framer-name');
      expect(entry.ordinalInSection).toBeGreaterThanOrEqual(0);
      // `bottom` distinguishes a top-sticky element from a bottom-sticky one;
      // reading only `top` would map every sticky element to `sticky: 'top'`.
      expect(entry.bottom).toBe('auto');
    }
  });

  it('warns that the appear payload covers no content node', async () => {
    const evidence = await run();
    // Measured: only 2 appear ids on the whole page, both the Framer badge.
    expect(evidence.appear.targets).toHaveLength(2);
    expect(evidence.appear.raw).toBeDefined();
  });

  it('warns instead of reporting silence when nothing changed', async () => {
    stubPage({ series: { '0:Hero:framer-a': Array(7).fill('1|none|relative|none|none') } });
    const evidence = await run();
    expect(evidence.observations).toHaveLength(0);
    expect(evidence.warnings.join(' ')).toContain('no style deltas');
  });

  it('warns per unclassified element rather than dropping it', async () => {
    stubPage({
      series: {
        '0:Mystery:framer-x': [
          '1|matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,90,1)|relative|none|none',
          '1|matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,10,1)|relative|none|none',
          ...Array(5).fill(null),
        ],
      },
    });
    const evidence = await run();
    expect(evidence.observations).toHaveLength(1);
    expect(evidence.observations[0].kind).toBe<MotionKind>('indeterminate');
    expect(evidence.warnings.some((w) => w.includes('unclassified motion'))).toBe(true);
  });

  it('samples exactly the stops it was asked for', async () => {
    stubPage({ stopCount: 2 });
    const evidence = await probeMotionEvidence(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      page as any,
      { settleMs: 0, stops: [0, 0.5] },
    );
    expect(evidence.stops).toEqual([0, 0.5]);
    // One scrollTo + one sample per stop, on top of the fixed calls.
    const scrollCalls = page.evaluate.mock.calls.filter(
      (call) => typeof call[0] === 'function' && call.length > 1 && typeof call[1] === 'number',
    );
    expect(scrollCalls).toHaveLength(2);
  });

  it('prefers the stable Framer name over the hashed class in selectors', async () => {
    const evidence = await run();
    const named = evidence.observations.filter((o) => o.framerName !== undefined);
    expect(named.length).toBeGreaterThan(0);
    for (const observation of named) {
      expect(observation.selector).toContain('data-framer-name');
      // A republish changes framer-xxxxx hashes; a selector built on them rots.
      expect(observation.selector).not.toMatch(/\.framer-[a-z0-9]+/);
    }
  });

  it('can skip the three static style walks', async () => {
    stubPage();
    const evidence = await probeMotionEvidence(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      page as any,
      { settleMs: 0, skipStaticStyleWalks: true },
    );
    expect(evidence.cssAnimations.keyframes).toEqual([]);
    expect(evidence.animationProperties.elements).toEqual([]);
    expect(evidence.pseudoStates).toEqual([]);
  });
});

describe('motion-evidence-probe / summariseMotionEvidence', () => {
  it('counts each observation exactly once and tallies effects', () => {
    const summary = summariseMotionEvidence({
      url: 'https://example.com/',
      probedAt: '2026-08-27T00:00:00.000Z',
      documentHeightPx: 1000,
      stops: [0, 1],
      viewports: [],
      observations: [
        { key: 'a', tag: 'div', selector: 'div', kind: 'entrance', reason: 'r', effects: [
          { kind: 'opacity', from: 0, to: 1, range: 1, monotonic: true },
          { kind: 'translateY', from: 50, to: 0, range: 50, monotonic: true },
        ] },
        { key: 'b', tag: 'div', selector: 'div', kind: 'scroll-linked', reason: 'r', effects: [
          { kind: 'rotate', from: -8, to: 0, range: 8, monotonic: true },
        ] },
        { key: 'c', tag: 'div', selector: 'div', kind: 'indeterminate', reason: 'r', effects: [] },
      ],
      sticky: [{ selector: 'div', top: '0px', bottom: 'auto', heightPx: 10, ordinalInSection: 0 }],
      appear: { targets: [] },
      cssAnimations: { keyframes: [], same_origin_count: 0, cross_origin_count: 0, transitions: [], gsap: { hasGSAP: false, hasScrollTrigger: false } },
      animationProperties: { elements: [], referencedKeyframes: [], distinctTransitionProperties: [] },
      pseudoStates: [],
      warnings: [],
    });
    expect(summary).toEqual({
      entrance: 1,
      scrollLinked: 1,
      indeterminate: 1,
      sticky: 1,
      byEffect: { opacity: 1, translateX: 0, translateY: 1, scale: 0, rotate: 1 },
    });
  });
});
