/**
 * Font-Discovery — Intercepts font file requests via page.route().
 */
import type { Page, Route } from 'playwright';
import type { FontIntercept } from './types.js';

const FONT_EXTENSIONS = /\.(woff2?|ttf|otf|eot)(\?|$)/i;
const GOOGLE_FONTS_CSS = /fonts\.googleapis\.com\/css/i;

export class FontUrlCollector {
  readonly intercepted: FontIntercept[] = [];

  classifyUrl(url: string): FontIntercept['type'] {
    if (GOOGLE_FONTS_CSS.test(url)) return 'google-fonts-css';
    if (/\.woff2(\?|$)/i.test(url)) return 'woff2';
    if (/\.woff(\?|$)/i.test(url)) return 'woff';
    if (/\.ttf(\?|$)/i.test(url)) return 'truetype';
    if (/\.otf(\?|$)/i.test(url)) return 'opentype';
    return 'unknown';
  }

  buildRouteHandler(): (route: Route) => Promise<void> {
    return async (route: Route) => {
      const url = route.request().url();
      if (FONT_EXTENSIONS.test(url) || GOOGLE_FONTS_CSS.test(url)) {
        this.intercepted.push({ url, type: this.classifyUrl(url) });
      }
      await route.continue();
    };
  }
}

export function buildFontRouteHandler(collector: FontUrlCollector): (route: Route) => Promise<void> {
  return collector.buildRouteHandler();
}
