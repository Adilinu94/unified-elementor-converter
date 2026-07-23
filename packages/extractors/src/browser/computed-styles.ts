/**
 * Computed-Style-Walk — Captures non-default CSS properties for V3 widget mapping.
 */
import type { Page } from 'playwright';
import type { ComputedStyleSnapshot } from './types.ts';

export const CURATED_PROPERTIES = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'box-sizing', 'overflow', 'overflow-x', 'overflow-y',
  'background-color', 'background-image', 'background-size', 'background-position',
  'background-repeat', 'background',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius', 'border',
  'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'text-transform',
  'text-decoration', 'color',
  'opacity', 'box-shadow', 'filter', 'backdrop-filter', 'transform',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap',
  'grid-template-columns', 'grid-template-rows',
  'transition',
] as const;

export const DEFAULT_VALUES: Partial<Record<string, string[]>> = {
  'display': ['block', 'inline'],
  'position': ['static'],
  'box-sizing': ['content-box'],
  'overflow': ['visible'],
  'background-color': ['rgba(0, 0, 0, 0)'],
  'background-image': ['none'],
  'background': ['none'],
  'border': ['none'],
  'font-style': ['normal'],
  'text-align': ['start'],
  'text-decoration': ['none'],
  'opacity': ['1'],
  'flex-direction': ['row'],
  'flex-wrap': ['nowrap'],
  'transition': ['all 0s ease 0s', 'none'],
};

export interface WalkOptions {
  rootSelector?: string;
  maxNodes?: number;
  customProperties?: string[];
}

export async function walkComputedStyles(
  page: Page,
  options: WalkOptions = {},
): Promise<ComputedStyleSnapshot[]> {
  const rootSelector = options.rootSelector ?? 'body';
  const maxNodes = options.maxNodes ?? 500;
  const props = [...CURATED_PROPERTIES, ...(options.customProperties ?? [])];
  const defaults = DEFAULT_VALUES;

  return await page.evaluate(
    ({ rootSelector, maxNodes, props, defaults }) => {
      const root = document.querySelector(rootSelector);
      if (!root) return [];
      const nodes = Array.from(root.querySelectorAll('*')).slice(0, maxNodes);
      const results: Array<{ selector: string; tag: string; styles: Record<string, string> }> = [];

      for (const node of nodes) {
        const cs = window.getComputedStyle(node);
        const styles: Record<string, string> = {};
        for (const prop of props) {
          const val = cs.getPropertyValue(prop).trim();
          if (!val) continue;
          const defArr = (defaults as Record<string, string[]>)[prop];
          if (defArr && defArr.includes(val)) continue;
          styles[prop] = val;
        }
        if (Object.keys(styles).length === 0) continue;

        const tag = node.tagName.toLowerCase();
        const id = node.id ? `#${node.id}` : '';
        const cls = node.className && typeof node.className === 'string'
          ? '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.')
          : '';
        results.push({ selector: `${tag}${id}${cls}`, tag, styles });
      }
      return results;
    },
    { rootSelector, maxNodes, props, defaults },
  );
}
