/**
 * WPCode Snippet Generator — Generates WPCode-compatible PHP/CSS/JS snippets.
 * For custom styles and animations that can't be expressed in Elementor native settings.
 */

export interface WpCodeSnippet {
  title: string;
  type: 'php' | 'css' | 'js';
  code: string;
  location: 'header' | 'footer' | 'functions';
  priority: number;
  tags: string[];
}

export interface AnimationConfig {
  elementId: string;
  type: AnimationType;
  duration: number;
  delay: number;
  easing: string;
  trigger: 'load' | 'scroll' | 'hover' | 'click';
}

export type AnimationType =
  | 'fade-in'
  | 'fade-in-up'
  | 'fade-in-down'
  | 'slide-in-left'
  | 'slide-in-right'
  | 'zoom-in'
  | 'bounce'
  | 'pulse'
  | 'custom';

const ANIMATION_CSS: Record<AnimationType, string> = {
  'fade-in': 'opacity: 0 → 1',
  'fade-in-up': 'opacity: 0 → 1; transform: translateY(20px) → 0',
  'fade-in-down': 'opacity: 0 → 1; transform: translateY(-20px) → 0',
  'slide-in-left': 'transform: translateX(-100%) → 0',
  'slide-in-right': 'transform: translateX(100%) → 0',
  'zoom-in': 'transform: scale(0.8) → 1; opacity: 0 → 1',
  'bounce': 'transform: translateY(0 → -10px → 0)',
  'pulse': 'transform: scale(1 → 1.05 → 1)',
  'custom': '',
};

let snippetCounter = 0;

export function resetSnippetIds(): void {
  snippetCounter = 0;
}

/**
 * Generate CSS keyframes for an animation.
 */
export function generateKeyframes(config: AnimationConfig): string {
  const name = `elconv_${config.type.replace(/-/g, '_')}_${config.elementId}`;
  const desc = ANIMATION_CSS[config.type];

  if (config.type === 'custom' || !desc) {
    return `/* Custom animation for ${config.elementId} */\n@keyframes ${name} {\n  /* Define custom keyframes */\n}`;
  }

  const fromProps: string[] = [];
  const toProps: string[] = [];

  if (desc.includes('opacity: 0')) {
    fromProps.push('opacity: 0');
    toProps.push('opacity: 1');
  }
  if (desc.includes('translateY(20px)')) {
    fromProps.push('transform: translateY(20px)');
    toProps.push('transform: translateY(0)');
  }
  if (desc.includes('translateY(-20px)')) {
    fromProps.push('transform: translateY(-20px)');
    toProps.push('transform: translateY(0)');
  }
  if (desc.includes('translateX(-100%)')) {
    fromProps.push('transform: translateX(-100%)');
    toProps.push('transform: translateX(0)');
  }
  if (desc.includes('translateX(100%)')) {
    fromProps.push('transform: translateX(100%)');
    toProps.push('transform: translateX(0)');
  }
  if (desc.includes('scale(0.8)')) {
    fromProps.push('transform: scale(0.8)');
    toProps.push('transform: scale(1)');
  }

  return `@keyframes ${name} {\n  from { ${fromProps.join('; ')}; }\n  to { ${toProps.join('; ')}; }\n}`;
}

/**
 * Generate CSS animation class for an element.
 */
export function generateAnimationCss(config: AnimationConfig): string {
  const name = `elconv_${config.type.replace(/-/g, '_')}_${config.elementId}`;
  const triggerSelector = config.trigger === 'hover' ? `#${config.elementId}:hover` : `#${config.elementId}`;

  return `${triggerSelector} {\n  animation: ${name} ${config.duration}ms ${config.easing} ${config.delay}ms forwards;\n}`;
}

/**
 * Generate a complete WPCode CSS snippet for animations.
 */
export function generateAnimationSnippet(
  animations: AnimationConfig[],
  title = 'Elconv Animations',
): WpCodeSnippet {
  const css = animations
    .map((a) => `${generateKeyframes(a)}\n${generateAnimationCss(a)}`)
    .join('\n\n');

  return {
    title,
    type: 'css',
    code: css,
    location: 'header',
    priority: 20,
    tags: ['elconv', 'animation', 'elementor'],
  };
}

/**
 * Generate scroll-trigger JS for animations.
 */
export function generateScrollTriggerJs(animations: AnimationConfig[]): string {
  const scrollAnims = animations.filter((a) => a.trigger === 'scroll');
  if (scrollAnims.length === 0) return '';

  const observers = scrollAnims
    .map((a) => {
      const name = `elconv_${a.type.replace(/-/g, '_')}_${a.elementId}`;
      return `  observe('#${a.elementId}', '${name}', ${a.duration}, ${a.delay});`;
    })
    .join('\n');

  return `(function() {
  function observe(selector, animName, duration, delay) {
    var el = document.querySelector(selector);
    if (!el) return;
    el.style.opacity = '0';
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          setTimeout(function() {
            el.style.animation = animName + ' ' + duration + 'ms ease ' + delay + 'ms forwards';
          }, 0);
          observer.unobserve(el);
        }
      });
    }, { threshold: 0.1 });
    observer.observe(el);
  }
${observers}
})();`;
}

/**
 * Generate WPCode snippet for scroll-triggered animations.
 */
export function generateScrollSnippet(
  animations: AnimationConfig[],
  title = 'Elconv Scroll Triggers',
): WpCodeSnippet | null {
  const js = generateScrollTriggerJs(animations);
  if (!js) return null;

  return {
    title,
    type: 'js',
    code: js,
    location: 'footer',
    priority: 30,
    tags: ['elconv', 'scroll', 'animation', 'elementor'],
  };
}

/**
 * Generate custom CSS snippet for design tokens not supported by Elementor.
 */
export function generateCustomCssSnippet(
  cssRules: Record<string, string>,
  title = 'Elconv Custom Styles',
): WpCodeSnippet {
  const code = Object.entries(cssRules)
    .map(([selector, props]) => `${selector} {\n${props}\n}`)
    .join('\n\n');

  return {
    title,
    type: 'css',
    code,
    location: 'header',
    priority: 25,
    tags: ['elconv', 'custom-css', 'elementor'],
  };
}

/**
 * Format snippet for WPCode plugin import (JSON).
 */
export function formatForWpCodeImport(snippets: WpCodeSnippet[]): string {
  return JSON.stringify(
    snippets.map((s) => ({
      title: s.title,
      code: s.code,
      type: s.type === 'css' ? 'add_css_snippet' : s.type === 'js' ? 'add_js_snippet' : 'add_php_snippet',
      location: s.location === 'header' ? 'wp_head' : s.location === 'footer' ? 'wp_footer' : 'functions_file',
      priority: s.priority,
      tags: s.tags,
      status: 'active',
    })),
    null,
    2,
  );
}
