import { describe, it, expect } from 'vitest';
import {
  generateKeyframes,
  generateAnimationCss,
  generateAnimationSnippet,
  generateScrollTriggerJs,
  generateScrollSnippet,
  generateCustomCssSnippet,
  formatForWpCodeImport,
  type AnimationConfig,
  type WpCodeSnippet,
} from '@elconv/target-v3';

function makeAnim(overrides: Partial<AnimationConfig> = {}): AnimationConfig {
  return {
    elementId: 'hero1',
    type: 'fade-in-up',
    duration: 600,
    delay: 0,
    easing: 'ease-out',
    trigger: 'load',
    ...overrides,
  };
}

describe('WPCode Snippet Generator', () => {
  it('generates keyframes for fade-in-up', () => {
    const kf = generateKeyframes(makeAnim());
    expect(kf).toContain('@keyframes elconv_fade_in_up_hero1');
    expect(kf).toContain('opacity: 0');
    expect(kf).toContain('translateY(20px)');
  });

  it('generates keyframes for slide-in-left', () => {
    const kf = generateKeyframes(makeAnim({ type: 'slide-in-left', elementId: 'nav' }));
    expect(kf).toContain('translateX(-100%)');
  });

  it('generates keyframes for zoom-in', () => {
    const kf = generateKeyframes(makeAnim({ type: 'zoom-in', elementId: 'card' }));
    expect(kf).toContain('scale(0.8)');
    expect(kf).toContain('opacity: 0');
  });

  it('generates animation CSS with trigger', () => {
    const css = generateAnimationCss(makeAnim());
    expect(css).toContain('#hero1');
    expect(css).toContain('animation:');
    expect(css).toContain('600ms');
    expect(css).toContain('ease-out');
  });

  it('generates hover trigger selector', () => {
    const css = generateAnimationCss(makeAnim({ trigger: 'hover' }));
    expect(css).toContain('#hero1:hover');
  });

  it('generates complete animation snippet', () => {
    const snippet = generateAnimationSnippet([makeAnim(), makeAnim({ elementId: 'cta', type: 'pulse' })]);
    expect(snippet.type).toBe('css');
    expect(snippet.location).toBe('header');
    expect(snippet.code).toContain('@keyframes');
    expect(snippet.tags).toContain('elconv');
  });

  it('generates scroll trigger JS', () => {
    const js = generateScrollTriggerJs([
      makeAnim({ trigger: 'scroll', elementId: 'sec1' }),
      makeAnim({ trigger: 'load', elementId: 'sec2' }),
    ]);
    expect(js).toContain('IntersectionObserver');
    expect(js).toContain('#sec1');
    expect(js).not.toContain('#sec2');
  });

  it('returns empty string for no scroll animations', () => {
    expect(generateScrollTriggerJs([makeAnim({ trigger: 'load' })])).toBe('');
  });

  it('generates scroll snippet or null', () => {
    const snippet = generateScrollSnippet([makeAnim({ trigger: 'scroll' })]);
    expect(snippet).not.toBeNull();
    expect(snippet!.type).toBe('js');
    expect(snippet!.location).toBe('footer');

    const noScroll = generateScrollSnippet([makeAnim({ trigger: 'load' })]);
    expect(noScroll).toBeNull();
  });

  it('generates custom CSS snippet', () => {
    const snippet = generateCustomCssSnippet({
      '.glass-card': '  backdrop-filter: blur(12px);\n  background: rgba(255,255,255,0.1);',
    });
    expect(snippet.code).toContain('.glass-card');
    expect(snippet.code).toContain('backdrop-filter');
    expect(snippet.priority).toBe(25);
  });

  it('formats for WPCode import', () => {
    const snippets: WpCodeSnippet[] = [
      { title: 'Test CSS', type: 'css', code: 'body{}', location: 'header', priority: 10, tags: ['test'] },
      { title: 'Test JS', type: 'js', code: 'console.log(1)', location: 'footer', priority: 20, tags: ['test'] },
    ];
    const json = formatForWpCodeImport(snippets);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe('add_css_snippet');
    expect(parsed[0].location).toBe('wp_head');
    expect(parsed[1].type).toBe('add_js_snippet');
    expect(parsed[1].location).toBe('wp_footer');
    expect(parsed[0].status).toBe('active');
  });
});
