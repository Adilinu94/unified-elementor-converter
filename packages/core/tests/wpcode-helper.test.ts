import { describe, it, expect } from 'vitest';
import {
  validateSnippet,
  buildSafePayload,
  resolveLocation,
  buildDualWriteCalls,
  cssSnippet,
  jsSnippet,
  fontLinkSnippet,
} from '../src/wpcode-helper.js';

describe('wpcode-helper', () => {
  describe('resolveLocation', () => {
    it('maps header → site_wide_header', () => {
      expect(resolveLocation('header')).toBe('site_wide_header');
    });
    it('maps footer → site_wide_footer', () => {
      expect(resolveLocation('footer')).toBe('site_wide_footer');
    });
    it('maps body → site_wide_body', () => {
      expect(resolveLocation('body')).toBe('site_wide_body');
    });
  });

  describe('validateSnippet', () => {
    it('passes valid css+header combo', () => {
      const result = validateSnippet({ title: 'Test', code: 'body{}', type: 'css', location: 'header' });
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('rejects js+header combo', () => {
      const result = validateSnippet({ title: 'Test', code: 'alert(1)', type: 'js', location: 'header' });
      expect(result.valid).toBe(false);
      expect(result.issues[0]?.field).toBe('location');
    });

    it('rejects php+any combo', () => {
      const result = validateSnippet({ title: 'Test', code: '<?php', type: 'php', location: 'footer' });
      expect(result.valid).toBe(false);
    });

    it('warns about inline script in js type', () => {
      const result = validateSnippet({
        title: 'Test',
        code: '<script>gsap.to()</script>',
        type: 'js',
        location: 'footer',
      });
      expect(result.issues.some((i) => i.field === 'type' && i.severity === 'warning')).toBe(true);
    });

    it('rejects empty title', () => {
      const result = validateSnippet({ title: '', code: 'body{}', type: 'css', location: 'header' });
      expect(result.valid).toBe(false);
    });
  });

  describe('buildSafePayload', () => {
    it('omits priority field', () => {
      const payload = buildSafePayload({ title: 'T', code: 'body{}', type: 'css', location: 'header' });
      expect(payload).not.toHaveProperty('priority');
    });

    it('converts js → html type', () => {
      const payload = buildSafePayload({ title: 'T', code: 'gsap.to("h1", {x:100})', type: 'js', location: 'footer' });
      expect(payload.code_type).toBe('html');
      expect(payload.code).toContain('<script>');
    });

    it('uses site_wide_footer for footer location', () => {
      const payload = buildSafePayload({ title: 'T', code: 'x', type: 'html', location: 'footer' });
      expect(payload.location).toBe('site_wide_footer');
    });

    it('applies page guard for CSS', () => {
      const payload = buildSafePayload({ title: 'T', code: '.hero{color:red}', type: 'css', location: 'header', pageId: 42 });
      expect(payload.code).toContain('page-id-42');
    });

    it('wraps bare JS in script tags', () => {
      const payload = buildSafePayload({ title: 'T', code: 'console.log("hi")', type: 'js', location: 'footer' });
      expect(payload.code).toContain('<script>');
      expect(payload.code).toContain('console.log');
    });
  });

  describe('buildDualWriteCalls', () => {
    it('generates update + option sync calls', () => {
      const payload = buildSafePayload({ title: 'T', code: 'body{}', type: 'css', location: 'header' });
      const calls = buildDualWriteCalls(123, payload);
      expect(calls).toHaveLength(2);
      expect(calls[0]?.ability).toContain('update-wpcode-snippet');
      expect(calls[1]?.ability).toContain('execute-php');
    });
  });

  describe('convenience builders', () => {
    it('cssSnippet creates header css', () => {
      const spec = cssSnippet('My CSS', '.hero{color:red}', 42);
      expect(spec.type).toBe('css');
      expect(spec.location).toBe('header');
      expect(spec.pageId).toBe(42);
    });

    it('jsSnippet creates footer js', () => {
      const spec = jsSnippet('My JS', 'gsap.to("h1", {x:100})', 42);
      expect(spec.type).toBe('js');
      expect(spec.location).toBe('footer');
    });

    it('fontLinkSnippet creates header html', () => {
      const spec = fontLinkSnippet(['https://fonts.googleapis.com/css2?family=Inter']);
      expect(spec.type).toBe('html');
      expect(spec.location).toBe('header');
      expect(spec.code).toContain('stylesheet');
    });
  });
});
