/**
 * Browser-Extraction Types.
 * Quelle: site-clone-to-v3/src/extractor/types.ts (adaptiert)
 *
 * SectionInfo + ComputedStyleSnapshot werden seit Phase 35 kanonisch in
 * @elconv/core (contracts/shared.contract.ts) definiert und hier nur
 * re-exportiert (Single Source of Truth, Portierungs-Regel 4).
 */
import type { SectionInfo, ComputedStyleSnapshot } from '@elconv/core';
export type { SectionInfo, ComputedStyleSnapshot };

export interface ViewportConfig {
  label: 'desktop' | 'tablet' | 'mobile' | string;
  width: number;
  height: number;
}

export const DEFAULT_VIEWPORTS: ViewportConfig[] = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'mobile', width: 390, height: 844 },
];

export interface FontIntercept {
  url: string;
  type: 'woff2' | 'woff' | 'truetype' | 'opentype' | 'google-fonts-css' | 'unknown';
  family?: string;
  weight?: number;
  style?: 'normal' | 'italic';
}

export interface AnimationInfo {
  has_keyframes: boolean;
  keyframe_names: string[];
  has_gsap: boolean;
  has_scrolltrigger: boolean;
  has_framer_motion: boolean;
  has_lenis: boolean;
}

export interface DiscoveredImage {
  url: string;
  alt?: string;
}

export interface DiscoveredSvg {
  kind: 'inline' | 'external';
  url?: string;
  markup?: string;
  existingId?: string;
}

export interface DiscoveredFavicon {
  url: string;
  kind: 'apple-touch-icon' | 'icon' | 'shortcut-icon' | 'og-image' | 'favicon';
  sizes?: string;
  type?: string;
}

export interface BrowserExtractionOptions {
  url: string;
  viewports?: ViewportConfig[];
  outputDir: string;
  screenshots?: boolean;
  scrollForLazyLoad?: boolean;
  waitForHydration?: boolean;
  detectAnimations?: boolean;
  detectSections?: boolean;
  detectResponsiveStyles?: boolean;
  maxStyles?: number;
  maxSections?: number;
  browser?: 'chromium' | 'firefox' | 'webkit';
}

export interface BrowserExtractionResult {
  url: string;
  hostname: string;
  extracted_at: string;
  viewports: Array<{ config: ViewportConfig; screenshotPath?: string }>;
  fontsIntercepted: FontIntercept[];
  cssVariables: Record<string, string>;
  sections: SectionInfo[];
  animations: AnimationInfo;
  dom?: string;
  computedStyles?: Record<string, ComputedStyleSnapshot[]>;
  images: DiscoveredImage[];
  svgs: DiscoveredSvg[];
  favicons: DiscoveredFavicon[];
}
