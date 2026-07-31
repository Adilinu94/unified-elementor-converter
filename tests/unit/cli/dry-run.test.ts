import { describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runDryRun } from '@elconv/cli';
import type { ExtractionResult } from '@elconv/extractors';
import type { SectionSpec } from '@elconv/target-v3';

function fixtureSection(): SectionSpec {
  return {
    $schema: 'https://unified-elementor-converter.local/schemas/section-spec.v1.json',
    section_id: 'hero',
    source: { url: 'https://example.com', selector: '#hero', y_range: [0, 600] },
    pattern: 'hero',
    v3_section: {
      pattern: 'hero',
      columns: [{
        width: '100%',
        widgets: [{
          type: 'heading',
          source_selector: '#hero h1',
          source_tag: 'h1',
          content: 'Hello',
          settings: { title: 'Hello' },
        }],
      }],
      settings: {},
      animations: [],
    },
    settings_provenance: {},
    assets_required: [],
    animations_required: [],
    user_overrides: {},
  };
}

function fixtureExtraction(): ExtractionResult {
  return {
    url: 'https://example.com',
    hostname: 'example.com',
    extracted_at: '2026-07-31T00:00:00.000Z',
    viewports: [],
    fontsIntercepted: [],
    cssVariables: {},
    sections: [{
      section_id: 'hero',
      selector: '#hero',
      y_range: [0, 600],
      layout: 'hero',
      child_count: 1,
    }],
    animations: {
      has_keyframes: false,
      keyframe_names: [],
      has_gsap: false,
      has_scrolltrigger: false,
      has_framer_motion: false,
      has_lenis: false,
    },
    images: [],
    svgs: [],
    favicons: [],
  };
}

describe('runDryRun', () => {
  it('writes both target plans and makes no external calls', async () => {
    const researchDir = path.join(tmpdir(), `elconv-dry-run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(researchDir, { recursive: true });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be used'));
    const classify = vi.fn(async () => ({
      specs: [fixtureSection()],
      selectedManifest: {
        url: 'https://example.com',
        extracted_at: '2026-07-31T00:00:00.000Z',
        decisions: [{ section_id: 'hero', decision: 'approve' }],
        approved_count: 1,
        skipped_count: 0,
      },
    }));

    try {
      await fs.writeFile(
        path.join(researchDir, 'extraction-result.json'),
        JSON.stringify(fixtureExtraction()),
        'utf8',
      );
      const report = await runDryRun({ researchDir, url: 'https://example.com' }, { classify });

      expect(classify).toHaveBeenCalledOnce();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(report.wouldBuild.v3Sections).toBe(1);
      expect(report.wouldBuild.v4Sections).toBe(1);
      expect(report.wouldBuild.v4Widgets).toBe(1);
      const v3 = JSON.parse(await fs.readFile(path.join(researchDir, 'dryrun-page-v3.json'), 'utf8')) as { content: Array<{ elType: string; elements?: unknown[] }> };
      const v4 = JSON.parse(await fs.readFile(path.join(researchDir, 'dryrun-page-v4.json'), 'utf8')) as { tree: Array<{ type: string; elements?: unknown[] }> };
      expect(v3.content[0]?.elType).toBe('section');
      expect(v4.tree[0]?.type).toBe('e-flexbox');
      expect(JSON.stringify(v3)).not.toContain('e-flexbox');
      expect(JSON.stringify(v4)).not.toContain('elType":"section"');
      await expect(fs.access(path.join(researchDir, 'dryrun-page-v3.json'))).resolves.toBeUndefined();
      await expect(fs.access(path.join(researchDir, 'dryrun-page-v4.json'))).resolves.toBeUndefined();
      await expect(fs.access(path.join(researchDir, 'dryrun-animations', 'animation-plan.json'))).resolves.toBeUndefined();
      await expect(fs.access(path.join(researchDir, 'dryrun-build-summary.json'))).resolves.toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
      await fs.rm(researchDir, { recursive: true, force: true });
    }
  });
});
