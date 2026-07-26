/**
 * V4 Animation Injection — GSAP, ScrollTrigger, and V4 Global Classes animation CSS.
 * KRITISCH: This module ONLY handles V4 Atomic animation patterns.
 * Uses $$type, e-flexbox selectors, and Global Classes — NEVER V3 widget types.
 *
 * Ported from Framer-to-Elementor-V4-Pipeline/scripts/inject-animation-code.ts
 */

import type { WpCodeSnippet, WpcodeSnippetSpec } from '@elconv/core';

// ============================================================================
// Types
// ============================================================================

export type V4AnimationType =
  | 'gsap-scroll'
  | 'gsap-timeline'
  | 'css-transition'
  | 'css-keyframe'
  | 'framer-appear'
  | 'hover-effect'
  | 'stagger-reveal';

export interface V4AnimationConfig {
  /** Target element selector (V4 Global Class or element ID) */
  selector: string;
  type: V4AnimationType;
  /** Duration in seconds (GSAP) or milliseconds (CSS) */
  duration: number;
  /** Delay in seconds (GSAP) or milliseconds (CSS) */
  delay: number;
  /** GSAP easing string (e.g. 'power2.out', 'elastic.out(1, 0.3)') */
  easing: string;
  /** Trigger type */
  trigger: 'load' | 'scroll' | 'hover' | 'click' | 'inview';
  /** For scroll triggers: start position (default: 'top 80%') */
  scrollStart?: string;
  /** For scroll triggers: end position (default: 'bottom 20%') */
  scrollEnd?: string;
  /** For stagger animations: delay between items in seconds */
  stagger?: number;
  /** GSAP plugins required */
  gsapPlugins?: string[];
  /** Custom CSS properties for CSS animations */
  cssProperties?: Record<string, { from: string; to: string }>;
}

export interface V4AnimationPlan {
  description: string;
  generatedAt: string;
  animations: V4AnimationConfig[];
  gsapVersion: string;
  totalSnippets: number;
}

export interface McpInjectionStep {
  step: number;
  ability: string;
  parameters: {
    title: string;
    type: string;
    code: string;
    on_conflict: string;
    location?: string;
    post_id?: number;
    gsap_version?: string;
    gsap_plugins?: string[];
  };
}

// ============================================================================
// GSAP Code Generation
// ============================================================================

const DEFAULT_GSAP_VERSION = '3.12.5';
const DEFAULT_SCROLL_START = 'top 80%';

/**
 * Generate GSAP ScrollTrigger animation code for a V4 element.
 */
export function generateGsapScrollCode(config: V4AnimationConfig): string {
  const { selector, duration, delay, easing, scrollStart, stagger } = config;
  const start = scrollStart ?? DEFAULT_SCROLL_START;

  if (stagger && stagger > 0) {
    return `gsap.from("${selector}", {
  scrollTrigger: { trigger: "${selector}", start: "${start}" },
  opacity: 0, y: 40, duration: ${duration}, delay: ${delay},
  ease: "${easing}", stagger: ${stagger}
});`;
  }

  return `gsap.from("${selector}", {
  scrollTrigger: { trigger: "${selector}", start: "${start}" },
  opacity: 0, y: 40, duration: ${duration}, delay: ${delay}, ease: "${easing}"
});`;
}

/**
 * Generate GSAP timeline animation code.
 */
export function generateGsapTimelineCode(
  configs: V4AnimationConfig[],
  timelineId: string,
): string {
  const lines = configs.map((c) => {
    const position = c.delay > 0 ? `"+=${c.delay}"` : '"<"';
    return `tl.from("${c.selector}", { opacity: 0, y: 30, duration: ${c.duration}, ease: "${c.easing}" }, ${position});`;
  });

  return `const ${timelineId} = gsap.timeline({
  scrollTrigger: { trigger: "${configs[0]?.selector ?? 'body'}", start: "${DEFAULT_SCROLL_START}" }
});
${lines.join('\n')}`;
}

/**
 * Generate CSS keyframe animation for V4 Global Classes.
 */
export function generateV4CssKeyframe(config: V4AnimationConfig): string {
  const name = `v4_${config.type.replace(/-/g, '_')}_${config.selector.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const props = config.cssProperties ?? { opacity: { from: '0', to: '1' }, transform: { from: 'translateY(20px)', to: 'translateY(0)' } };

  const fromProps = Object.entries(props).map(([k, v]) => `  ${k}: ${v.from};`).join('\n');
  const toProps = Object.entries(props).map(([k, v]) => `  ${k}: ${v.to};`).join('\n');

  return `@keyframes ${name} {
  from {
${fromProps}
  }
  to {
${toProps}
  }
}

${config.selector} {
  animation: ${name} ${config.duration}ms ${config.easing} ${config.delay}ms forwards;
}`;
}

/**
 * Generate hover effect CSS for V4 elements.
 */
export function generateV4HoverEffect(config: V4AnimationConfig): string {
  const props = config.cssProperties ?? { transform: { from: 'scale(1)', to: 'scale(1.05)' } };
  const hoverProps = Object.entries(props).map(([k, v]) => `  ${k}: ${v.to};`).join('\n');

  return `${config.selector} {
  transition: all ${config.duration}ms ${config.easing};
}

${config.selector}:hover {
${hoverProps}
}`;
}

// ============================================================================
// Snippet Generation
// ============================================================================

/**
 * Generate a complete WPCode snippet for V4 GSAP animations.
 */
export function generateV4GsapSnippet(
  animations: V4AnimationConfig[],
  options: { postId?: number; title?: string } = {},
): WpcodeSnippetSpec {
  const gsapAnims = animations.filter((a) => a.type.startsWith('gsap'));
  const codeLines = gsapAnims.map((a) => {
    if (a.type === 'gsap-timeline') {
      return generateGsapTimelineCode([a], `tl_${a.selector.replace(/[^a-zA-Z0-9]/g, '_')}`);
    }
    return generateGsapScrollCode(a);
  });

  const plugins = new Set<string>();
  for (const a of gsapAnims) {
    for (const p of a.gsapPlugins ?? ['ScrollTrigger']) plugins.add(p);
  }

  const pluginImports = [...plugins].map((p) => `gsap.registerPlugin(${p});`).join('\n');

  const code = `// V4 GSAP Animations — auto-generated by @elconv/target-v4
(function() {
${pluginImports}

gsap.defaults({ ease: "power2.out" });

${codeLines.join('\n\n')}
})();`;

  return {
    title: options.title ?? 'V4 GSAP Animations',
    code,
    type: 'html',
    location: 'footer',
    pageId: options.postId,
    active: true,
    tags: ['elconv', 'v4', 'gsap', 'animation'],
  };
}

/**
 * Generate a WPCode CSS snippet for V4 CSS animations.
 */
export function generateV4CssSnippet(
  animations: V4AnimationConfig[],
  title = 'V4 CSS Animations',
): WpCodeSnippet {
  const cssAnims = animations.filter((a) =>
    a.type === 'css-keyframe' || a.type === 'css-transition' || a.type === 'hover-effect',
  );

  const code = cssAnims
    .map((a) => {
      if (a.type === 'hover-effect') return generateV4HoverEffect(a);
      return generateV4CssKeyframe(a);
    })
    .join('\n\n');

  return {
    title,
    type: 'css',
    code,
    location: 'header',
    priority: 20,
    tags: ['elconv', 'v4', 'animation', 'global-classes'],
  };
}

/**
 * Build an MCP injection plan for all V4 animations.
 */
export function buildV4AnimationPlan(
  animations: V4AnimationConfig[],
  options: { postId?: number; gsapVersion?: string } = {},
): V4AnimationPlan {
  return {
    description: 'V4 Animation injection plan (GSAP + CSS)',
    generatedAt: new Date().toISOString(),
    animations,
    gsapVersion: options.gsapVersion ?? DEFAULT_GSAP_VERSION,
    totalSnippets: animations.length > 0 ? 2 : 0, // 1 GSAP + 1 CSS
  };
}

/**
 * Build MCP injection steps for the animation plan.
 */
export function buildMcpInjectionSteps(
  animations: V4AnimationConfig[],
  options: { postId?: number; gsapVersion?: string } = {},
): McpInjectionStep[] {
  const steps: McpInjectionStep[] = [];
  const gsapAnims = animations.filter((a) => a.type.startsWith('gsap'));
  const cssAnims = animations.filter((a) => !a.type.startsWith('gsap'));

  if (gsapAnims.length > 0) {
    const spec = generateV4GsapSnippet(gsapAnims, { postId: options.postId });
    steps.push({
      step: steps.length + 1,
      ability: 'novamira-adrianv2/adrians-code-injector',
      parameters: {
        title: spec.title,
        type: spec.type,
        code: spec.code,
        on_conflict: 'replace',
        location: 'site_wide_footer',
        post_id: options.postId,
        gsap_version: options.gsapVersion ?? DEFAULT_GSAP_VERSION,
        gsap_plugins: ['ScrollTrigger'],
      },
    });
  }

  if (cssAnims.length > 0) {
    const snippet = generateV4CssSnippet(cssAnims);
    steps.push({
      step: steps.length + 1,
      ability: 'novamira-adrianv2/adrians-code-injector',
      parameters: {
        title: snippet.title,
        type: snippet.type,
        code: snippet.code,
        on_conflict: 'replace',
        location: 'site_wide_header',
        post_id: options.postId,
      },
    });
  }

  return steps;
}
