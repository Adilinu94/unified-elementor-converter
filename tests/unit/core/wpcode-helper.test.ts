import { describe, it, expect } from 'vitest';
import {
  resolveLocation,
  validateSnippet,
  buildSafePayload,
  buildDualWriteCalls,
  buildCreateCalls,
  buildWpcodeCacheFlushCall,
  assertWpcodePayloadShape,
  verifyWpcodeWrite,
  WPCODE_FORBIDDEN_PAYLOAD_FIELDS,
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

  it('defaults to active:true, respects explicit active:false', () => {
    const active = buildSafePayload({ title: 'X', code: '.a{}', type: 'css', location: 'header' });
    expect(active.active).toBe(true);
    const inactive = buildSafePayload({ title: 'X', code: '.a{}', type: 'css', location: 'header', active: false });
    expect(inactive.active).toBe(false);
  });

  it('never sends `status` — it is an output-only field in the live schema', () => {
    // Verified against novamira-adrianv2/create-wpcode-snippet: the input
    // schema has no `status`. Sending it silently dropped the activation
    // request, so every snippet stayed a draft and never rendered.
    const payload = buildSafePayload({ title: 'X', code: '.a{}', type: 'css', location: 'header' });
    expect(payload).not.toHaveProperty('status');
  });

  it('sends auto_insert:true so `location` is honoured, respects autoInsert:false', () => {
    // Live schema: "`location` … only meaningful when `auto_insert=true`".
    // Without it WPCode treats the snippet as shortcode-only.
    const payload = buildSafePayload({ title: 'X', code: '.a{}', type: 'css', location: 'header' });
    expect(payload.auto_insert).toBe(true);
    const shortcode = buildSafePayload({
      title: 'X', code: '.a{}', type: 'css', location: 'header', autoInsert: false,
    });
    expect(shortcode.auto_insert).toBe(false);
  });

  it('omits cache_bust_token unless a token is given', () => {
    const without = buildSafePayload({ title: 'X', code: '.a{}', type: 'css', location: 'header' });
    expect(without).not.toHaveProperty('cache_bust_token');
    const withToken = buildSafePayload({
      title: 'X', code: '.a{}', type: 'css', location: 'header', cacheBustToken: 'build-42',
    });
    expect(withToken.cache_bust_token).toBe('build-42');
  });

  it('produces a payload that passes the forbidden-field shape assertion', () => {
    const payload = buildSafePayload({ title: 'X', code: '.a{}', type: 'css', location: 'header' });
    expect(() => assertWpcodePayloadShape(payload as unknown as Record<string, unknown>)).not.toThrow();
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
  it('returns a meta update plus a bypass_kses cache-purge update', () => {
    const payload = buildSafePayload({ title: 'X', code: '.a{}', type: 'css', location: 'header' });
    const calls = buildDualWriteCalls(99, payload);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.ability).toBe('novamira-adrianv2/update-wpcode-snippet');
    expect(calls[0]!.params.snippet_id).toBe(99);
    // Pass 1 must NOT set bypass_kses: that mode rejects every meta field.
    expect(calls[0]!.params.bypass_kses).toBeUndefined();
    expect(calls[0]!.params.code_type).toBe('css');
    expect(calls[0]!.params.auto_insert).toBe(true);

    expect(calls[1]!.ability).toBe('novamira-adrianv2/update-wpcode-snippet');
    expect(calls[1]!.params.bypass_kses).toBe(true);
    expect(calls[1]!.params.snippet_id).toBe(99);
  });

  it('sends ONLY snippet_id/title/code in the bypass_kses call', () => {
    // Live schema: in bypass_kses mode "meta fields such as code_type,
    // location, tags, priority, device_type, schedule, use_rules, rules,
    // custom_shortcode, compress_output, and active are rejected".
    const payload = buildSafePayload({ title: 'X', code: '.a{}', type: 'css', location: 'header' });
    const bypass = buildDualWriteCalls(99, payload)[1]!;
    expect(Object.keys(bypass.params).sort()).toEqual(['bypass_kses', 'code', 'snippet_id', 'title']);
  });

  it('no longer generates hand-rolled update_option PHP (injection surface removed)', () => {
    // The old implementation interpolated payload.title into PHP source with a
    // single replace(/'/g, "\\'") — unsafe for a title from a Framer project
    // name, and it had neither a caller nor a test.
    const payload = buildSafePayload({ title: "It's a test", code: '.a{}', type: 'css', location: 'header' });
    const calls = buildDualWriteCalls(1, payload);
    expect(calls.some((c) => c.ability.includes('execute-php'))).toBe(false);
    for (const call of calls) {
      expect(JSON.stringify(call.params)).not.toContain('update_option');
    }
    // The title still round-trips verbatim — no escaping needed on this path.
    expect(calls[1]!.params.title).toBe("It's a test");
  });
});

describe('buildWpcodeCacheFlushCall', () => {
  it('uses the canonical execute-php ability name, not the adrianv2 alias', () => {
    // `novamira-adrianv2/execute-php` is not exposed live; the registry alias
    // rewrote it silently, which is exactly the drift the registry prevents.
    expect(buildWpcodeCacheFlushCall().ability).toBe('novamira/execute-php');
  });
});

describe('assertWpcodePayloadShape', () => {
  it('lists status and priority as forbidden', () => {
    expect(WPCODE_FORBIDDEN_PAYLOAD_FIELDS).toContain('status');
    expect(WPCODE_FORBIDDEN_PAYLOAD_FIELDS).toContain('priority');
  });

  it('throws when the output-only `status` field is present', () => {
    expect(() => assertWpcodePayloadShape({ title: 'X', status: 'active' })).toThrow(/status/);
  });

  it('throws when `priority` is present (private-property crash)', () => {
    expect(() => assertWpcodePayloadShape({ title: 'X', priority: 10 })).toThrow(/priority/);
  });

  it('accepts a payload using the real schema fields', () => {
    expect(() =>
      assertWpcodePayloadShape({ title: 'X', code: '.a{}', active: true, auto_insert: true }),
    ).not.toThrow();
  });
});

describe('verifyWpcodeWrite', () => {
  const payload = buildSafePayload({ title: 'X', code: '.a{}', type: 'css', location: 'header' });

  it('accepts a write that landed as requested', () => {
    const result = verifyWpcodeWrite(payload, {
      snippet_id: 12, active: true, status: 'publish', auto_insert: true, last_error: null,
    });
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.snippetId).toBe(12);
  });

  it('detects WPCode auto-demotion to draft', () => {
    // WPCode runs activation checks on save and demotes silently on failure —
    // a raw MCP success is not proof the snippet is live.
    const result = verifyWpcodeWrite(payload, { snippet_id: 12, active: false, status: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/auto-demoted/);
  });

  it('detects a non-publish status even when active is true', () => {
    const result = verifyWpcodeWrite(payload, { snippet_id: 12, active: true, status: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/publish/);
  });

  it('detects a snippet that was stored as shortcode-only', () => {
    const result = verifyWpcodeWrite(payload, {
      snippet_id: 12, active: true, status: 'publish', auto_insert: false,
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/never be emitted/);
  });

  it('surfaces last_error verbatim', () => {
    const result = verifyWpcodeWrite(payload, {
      snippet_id: 12, active: true, status: 'publish', auto_insert: true,
      last_error: { message: 'PHP parse error' },
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('PHP parse error');
  });

  it('does not flag an inactive snippet that was requested inactive', () => {
    const inactive = buildSafePayload({
      title: 'X', code: '.a{}', type: 'css', location: 'header', active: false,
    });
    const result = verifyWpcodeWrite(inactive, { snippet_id: 12, active: false, status: 'draft' });
    expect(result.ok).toBe(true);
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
