/**
 * Phase 4 (UMBAUPLAN §7.3.2): Pseudo-State-Capture.
 *
 * Captures computed-style diffs for :hover / :focus / :active states.
 * The browser can emulate pseudo-state styles via the second argument of
 * `getComputedStyle(el, ':hover')`. Browsers return whatever the cascade
 * would resolve for that pseudo-class — even without a real pointer event.
 *
 * Output is a per-element, per-state map of `Record<state, Record<prop, value>>`
 * suitable for downstream V3-style decisions (button hover, link focus, etc.).
 */

import type { Page } from 'playwright';
import type { ComputedStyleSnapshot } from './types.js';

/** Pseudo-states to capture. Order matters: more-specific first. */
export const PSEUDO_STATES = ['hover', 'focus', 'active'] as const;
export type PseudoState = (typeof PSEUDO_STATES)[number];

/** Snapshot of all pseudo-states for a single element. */
export interface PseudoStateSnapshot {
  selector: string;
  tag: string;
  states: Record<PseudoState, Record<string, string>>;
}

/** Options for capturePseudoStates(). */
export interface CapturePseudoStatesOptions {
  /** Root element selector (default: 'body'). */
  rootSelector?: string;
  /** Restrict to these pseudo-states (default: all of PSEUDO_STATES). */
  states?: readonly PseudoState[];
  /** Properties to capture (default: a curated visual subset). */
  properties?: readonly string[];
  /** Max nodes to walk (default: 200 — pseudo-state capture is more expensive). */
  maxNodes?: number;
  /** Depth limit (default: 4). */
  maxDepth?: number;
}

/** Default visual property subset used for pseudo-state diffing. */
export const DEFAULT_PSEUDO_PROPERTIES = [
  'color',
  'background-color',
  'background-image',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'opacity',
  'transform',
  'box-shadow',
  'text-decoration-color',
  'cursor',
  'filter',
] as const;

function buildPseudoCaptureScript(
  rootSel: string,
  states: readonly PseudoState[],
  properties: readonly string[],
  maxNodes: number,
  maxDepth: number,
): string {
  const rootSelJson = JSON.stringify(rootSel);
  const statesJson = JSON.stringify(states);
  const propsJson = JSON.stringify(properties);
  const statesArgsList = states.map((s) => `":${s}"`).join(', ');
  return `(function(){
    const root = document.querySelector(${rootSelJson});
    if (!root) return [];
    const states = ${statesJson};
    const props = ${propsJson};
    const maxN = ${maxNodes};
    const maxD = ${maxDepth};
    const out = [];

    const buildSelector = (el, ancestors) => {
      const parts = [];
      const chain = ancestors.slice(-2).concat([el]);
      for (const node of chain) {
        const tag = node.tagName.toLowerCase();
        if (node.id) { parts.push('#' + node.id); continue; }
        const cls = (node.className && typeof node.className === 'string')
          ? node.className.split(/\\s+/).filter(Boolean)[0]
          : '';
        parts.push(cls ? tag + '.' + cls : tag);
      }
      return parts.join(' > ');
    };

    const captureFor = (el, stateArg) => {
      const cs = window.getComputedStyle(el, stateArg);
      const m = {};
      for (const p of props) {
        const v = cs.getPropertyValue(p);
        if (v && v !== '') m[p] = v;
      }
      return m;
    };

    const walk = (el, depth, ancestors) => {
      if (out.length >= maxN) return;
      if (depth > maxD) return;
      const statesMap = {};
      for (const s of states) {
        statesMap[s] = captureFor(el, ":" + s);
      }
      out.push({
        selector: buildSelector(el, ancestors),
        tag: el.tagName.toLowerCase(),
        states: statesMap,
      });
      for (const child of Array.from(el.children)) {
        walk(child, depth + 1, ancestors.concat([el]));
      }
    };
    walk(root, 0, []);
    // Reference unused list to keep the JIT honest about the parameter set
    void [${statesArgsList}];
    return out;
  })()`;
}

/**
 * Capture pseudo-state computed styles for the DOM subtree rooted at
 * `rootSelector`. Returns an array of snapshots, one per visited element.
 *
 * NOTE: Browsers (Chromium especially) only return values for properties
 * that the cascade defines for that pseudo-state. If the source site has
 * no `:hover` rule for an element, the resulting map will be empty — that
 * is correct behaviour, not a bug.
 */
export async function capturePseudoStates(
  page: Page,
  options: CapturePseudoStatesOptions = {},
): Promise<PseudoStateSnapshot[]> {
  const rootSelector = options.rootSelector ?? 'body';
  const states = options.states ?? PSEUDO_STATES;
  const properties = options.properties ?? DEFAULT_PSEUDO_PROPERTIES;
  const maxNodes = options.maxNodes ?? 200;
  const maxDepth = options.maxDepth ?? 4;

  const script = buildPseudoCaptureScript(rootSelector, states, properties, maxNodes, maxDepth);
  const raw = ((await page.evaluate(script).catch(() => [])) ?? []) as Array<{
    selector: string;
    tag: string;
    states: Record<string, Record<string, string>>;
  }>;

  return raw.map((row) => {
    const stateMap: Record<PseudoState, Record<string, string>> = {
      hover: {}, focus: {}, active: {},
    };
    for (const s of PSEUDO_STATES) {
      stateMap[s] = row.states[s] ?? {};
    }
    return { selector: row.selector, tag: row.tag, states: stateMap };
  });
}

/**
 * Flatten pseudo-state snapshots into a per-state list of plain
 * { selector, tag, styles } rows. Useful for spec.json-style consumers
 * that don't care about the 2-level nesting.
 */
export function flattenPseudoStates(
  snapshots: PseudoStateSnapshot[],
  state: PseudoState,
): ComputedStyleSnapshot[] {
  return snapshots
    .filter((s) => Object.keys(s.states[state]).length > 0)
    .map((s) => ({
      selector: s.selector,
      tag: s.tag,
      styles: s.states[state],
    }));
}