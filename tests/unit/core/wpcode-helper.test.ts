import { describe, it, expect } from 'vitest';
import {
  resolveLocation,
  validateSnippet,
  buildSafePayload,
  buildDualWriteCalls,
  buildCreateCalls,
  cssSnippet,
  jsSnippet,
  fontLinkSnippet,
} from '@elconv/core';
import type { WpcodeSnippetSpec } from '@elconv/core';

describe('resolveLocation', () => {
  it('maps friendly locations to the site_wide_* taxonomy slugs', () => {
    expect(resolveLocation('header')).toBe('site_wide_header');
    expect(resolveLocation('footer')).toBe('site_wide_footer');
    expect(resolveLocation('body')).toBe('site_wide_body');
  });
});

describe('validateSnippet', () => {
  it('passes a safe css/header snippet with title and code', () => {
    const result = validateSnippet({ title: 'X', code: '.a{color:red}', type: 'css', location: 'header' });
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags js/header as an unsafe combination (error)', () => {
    const result = validateSnippet({ title: 'X', code: 'x', type: 'js', location: 'header' });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'location' && i.severity === 'error')).toBe(true);
  });

  it('flags php/anywhere as unsafe (error)', () => {
    const result = validateSnippet({ title: 'X', code: 'x', type: 'php', location: 'footer' });
    expect(result.valid).toBe(false);
  });

  it('warns (not errors) when js type contains an inline <script> tag', () => {
    const result = validateSnippet({ title: 'X', code: '<script>x</script>', type: 'js', location: 'footer' });
    const warning = result.issues.find((i) => i.field === 'type');
    expect(warning?.severity).toBe('warning');
    expect(result.valid).toBe(true); // warning alone doesn't make it invalid
  });

  it('warns when html/header contains an inline <script> (kses risk)', () => {
    const result = validateSnippet({ title: 'X', code: '<script>x</script>', type: 'html', location: 'header' });
    expect(result.issues.some((i) => i.severity === 'warning' && i.field === 'location')).toBe(true);
  });

  it('requires a non-empty title', () => {
    const result = validateSnippet({ title: '  ', code: 'x', type: 'css', location: 'header' });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'title')).toBe(true);
  });

  it('requires non-empty code', () => {
    const result = validateSnippet({ title: 'X', code: '', type: 'css', location: 'header' });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'code')).toBe(true);
  });
});

describe('buildSafePayload', () => {
  it('never includes a priority field (private-property crash workaround)', () => {
    const payload = buildSafePayload({ title: 'X', code: '.a{}', type: 'css', location: 'header' });
    expect(payload).not.toHaveProperty('priority');
  });

  it('maps location to the real taxonomy slug', () => {
    const payload = buildSafePayload({ title: 'X', code: '.a{}', type: 'css', location: 'footer' });
    expect(payload.location).toBe('site_wide_footer');
  });

  it('converts js type to html, wrapping raw JS in a <script> tag', () => {
    const payload = buildSafePayload({ title: 'X', code: 'console.log(1)', type: 'js', location: 'footer' });
    expect(payload.code_type).toBe('html');
    expect(payload.code).toContain('<script>');
    expect(payload.code).toContain('console.log(1)');
  });

  it('does not double-wrap JS code that already contains a <script> tag', () => {
    const payload = buildSafePayload({ title: 'X', code: '<script>console.log(1)</script>', type: 'js', location: 'footer' });
    expect(payload.code.match(/<script>/g)?.length).toBe(1);
  });

  it('defaults status to active, respects explicit active:false', () => {
    const active = buildSafePayload({ title: 'X', code: '.a{}', type: 'css', location: 'header' });
    expect(active.status).toBe('active');
    const inactive = buildSafePayload({ title: 'X', code: '.a{}', type: 'css', location: 'header', active: false });
    expect(inactive.status).toBe('inactive');
  });

  it('defaults tags to ["elconv"] when not provided', () => {
    const payload = buildSafePayload({ title: 'X', code: '.a{}', type: 'css', location: 'header' });
    expect(payload.tags).toEqual(['elconv']);
  });

  describe('page guard (pageId)', () => {
    it('CSS: actually scopes the code under body.page-id-N (not just an unused empty sibling block)', () => {
      const payload = buildSafePayload({
        title: 'X', code: '.hero{color:red}', type: 'css', location: 'header', pageId: 42,
      });
      expect(payload.code).toContain('body.page-id-42');
      // The bug this guards against: `body.page-id-42 {\n  /* comment */\n}\n.hero{...}`
      // — an EMPTY scope block followed by the rule completely unscoped.
      // Between the scope's opening brace and the actual rule there must be
      // NO closing brace (which would mean the scope already ended).
      const scopeBraceOpen = payload.code.indexOf('{', payload.code.indexOf('body.page-id-42'));
      const ruleIndex = payload.code.indexOf('.hero{color:red}');
      const between = payload.code.slice(scopeBraceOpen + 1, ruleIndex);
      expect(between).not.toContain('}');
    });

    it('JS-as-HTML: injects an early-throw guard inside the <script> tag', () => {
      const payload = buildSafePayload({
        title: 'X', code: 'doThing()', type: 'js', location: 'footer', pageId: 7,
      });
      expect(payload.code).toContain("page-id-7");
      expect(payload.code).toContain('doThing()');
    });

    it('plain HTML with pageId: prefixes an early-return guard', () => {
      const payload = buildSafePayload({
        title: 'X', code: '<div>hi</div>', type: 'html', location: 'footer', pageId: 3,
      });
      expect(payload.code.startsWith('if(')).toBe(true);
      expect(payload.code).toContain('page-id-3');
    });
  });
});

describe('buildDualWriteCalls', () => {
  it('returns exactly 2 MCP calls: update snippet + sync the wpcode_snippets option', () => {
    const payload = buildSafePayload({ title: 'X', code: '.a{}', type: 'css', location: 'header' });
    const calls = buildDualWriteCalls(99, payload);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.ability).toBe('novamira-adrianv2/update-wpcode-snippet');
    expect(calls[0]!.params.snippet_id).toBe(99);
    expect(calls[1]!.ability).toBe('novamira-adrianv2/execute-php');
    expect(calls[1]!.params.code).toContain('99');
  });

  it('escapes single quotes in the title for the generated PHP', () => {
    const payload = buildSafePayload({ title: "It's a test", code: '.a{}', type: 'css', location: 'header' });
    const calls = buildDualWriteCalls(1, payload);
    expect(calls[1]!.params.code as string).toContain("It\\'s a test");
  });
});

describe('buildCreateCalls', () => {
  it('returns exactly 1 MCP call for creation', () => {
    const payload = buildSafePayload({ title: 'X', code: '.a{}', type: 'css', location: 'header' });
    expect(buildCreateCalls(payload)).toHaveLength(1);
  });
});

describe('convenience builders', () => {
  it('cssSnippet: css/header, active, tagged', () => {
    const spec: WpcodeSnippetSpec = cssSnippet('T', '.a{}', 5);
    expect(spec).toMatchObject({ type: 'css', location: 'header', pageId: 5, active: true });
  });

  it('jsSnippet: js/footer (the only safe js location)', () => {
    const spec = jsSnippet('T', 'x()');
    expect(spec.type).toBe('js');
    expect(spec.location).toBe('footer');
  });

  it('fontLinkSnippet: html/header, includes a preconnect + stylesheet link per font', () => {
    const spec = fontLinkSnippet(['https://fonts.googleapis.com/css2?family=Inter']);
    expect(spec.type).toBe('html');
    expect(spec.location).toBe('header');
    expect(spec.code).toContain('preconnect');
    expect(spec.code).toContain('Inter');
  });
});
