import { input, select, checkbox, confirm, number } from '@inquirer/prompts';
import { hostnameFromUrl } from '@elconv/core';

export type StrictnessLevel = 'draft' | 'balanced' | 'pixel-perfect';
export type AnimationStrategy = 'none' | 'css' | 'gsap' | 'auto';
export type FontStrategy = 'auto' | 'system' | 'all';

export const DEFAULT_VIEWPORTS: number[] = [1440, 768, 390];

export const STRICTNESS_DESCRIPTIONS: Record<StrictnessLevel, string> = {
  draft: '≥70% match — quick draft, accept most issues',
  balanced: '≥85% match — production-grade default',
  'pixel-perfect': '≥95% match — strict QA, more fix rounds',
};

export const ANIMATION_DESCRIPTIONS: Record<AnimationStrategy, string> = {
  none: 'No animations in output',
  css: 'CSS keyframes only (WPCode injection)',
  gsap: 'GSAP via WPCode (more complex animations)',
  auto: 'Auto-detect: CSS for simple, GSAP for complex',
};

export const FONT_DESCRIPTIONS: Record<FontStrategy, string> = {
  auto: 'Use detected strategy from source',
  system: 'Map to system fonts only',
  all: 'Upload all custom fonts via Fonts Plugin',
};

const URL_PATTERN = /^https?:\/\/[a-z0-9.-]+(?::\d+)?(?:\/.*)?$/i;

export function isValidUrl(value: string): boolean {
  if (!URL_PATTERN.test(value)) return false;
  try {
    const u = new URL(value);
    return !!u.hostname && u.hostname.includes('.');
  } catch {
    return false;
  }
}

export async function promptUrl(initial?: string): Promise<string> {
  return input({
    message: 'Source URL to clone:',
    default: initial,
    validate: (v) => (isValidUrl(v) ? true : 'Must be a valid http(s) URL (e.g. https://example.com)'),
  });
}

export interface TargetOption {
  name: string;
  description: string;
}

export async function promptTarget(targets: TargetOption[]): Promise<string> {
  if (targets.length === 0) {
    return input({
      message: 'WP target name (e.g. yoursite-local):',
      validate: (v) => (v.trim().length > 0 ? true : 'Target name required'),
    });
  }
  return select({
    message: 'WordPress target:',
    choices: targets.map((t) => ({ name: t.name, value: t.name, description: t.description })),
  });
}

export async function promptViewports(initial?: number[]): Promise<number[]> {
  const raw = await input({
    message: 'Comma-separated viewport widths:',
    default: (initial ?? DEFAULT_VIEWPORTS).join(','),
    validate: (v) => {
      const parsed = v.split(',').map((s) => parseInt(s.trim(), 10));
      if (parsed.some((n) => !Number.isFinite(n) || n < 320 || n > 3840)) {
        return 'Each viewport must be between 320 and 3840';
      }
      return true;
    },
  });
  return raw.split(',').map((s) => parseInt(s.trim(), 10));
}

export async function promptAnimation(initial?: AnimationStrategy): Promise<AnimationStrategy> {
  const choices: Array<{ name: string; value: AnimationStrategy; description: string }> = (
    ['none', 'css', 'gsap', 'auto'] as const
  ).map((v) => ({ name: v, value: v, description: ANIMATION_DESCRIPTIONS[v] }));
  return select({
    message: 'Animation strategy:',
    default: initial ?? 'auto',
    choices,
  });
}

export async function promptFonts(initial?: FontStrategy): Promise<FontStrategy> {
  const choices: Array<{ name: string; value: FontStrategy; description: string }> = (
    ['auto', 'system', 'all'] as const
  ).map((v) => ({ name: v, value: v, description: FONT_DESCRIPTIONS[v] }));
  return select({
    message: 'Font strategy:',
    default: initial ?? 'auto',
    choices,
  });
}

export async function promptStrictness(initial?: StrictnessLevel): Promise<StrictnessLevel> {
  const choices: Array<{ name: string; value: StrictnessLevel; description: string }> = (
    ['draft', 'balanced', 'pixel-perfect'] as const
  ).map((v) => ({ name: v, value: v, description: STRICTNESS_DESCRIPTIONS[v] }));
  return select({
    message: 'Pixel-match strictness:',
    default: initial ?? 'balanced',
    choices,
  });
}

export interface SectionChoice {
  id: string;
  label: string;
  preview?: string;
}

export async function promptSections(sections: SectionChoice[]): Promise<string[]> {
  if (sections.length === 0) return [];
  const selected = await checkbox({
    message: 'Sections to clone (space=toggle, enter=confirm):',
    choices: sections.map((s) => ({ name: s.label, value: s.id, description: s.preview })),
    pageSize: 15,
  });
  return selected;
}

export async function promptAutoPick(): Promise<boolean> {
  return confirm({
    message: 'Auto-pick ALL detected sections?',
    default: false,
  });
}

export async function promptResume(currentHostname: string): Promise<boolean> {
  return confirm({
    message: `Resume previous run for ${currentHostname}?`,
    default: true,
  });
}

export async function promptPostId(): Promise<number> {
  const result = await number({
    message: 'Existing WP post ID to compare/update:',
    validate: (v) => (v !== undefined && v > 0 ? true : 'Post ID must be > 0'),
  });
  if (result === undefined) throw new Error('Post ID is required');
  return result;
}

export function summaryFor(url: string, opts: {
  target?: string;
  viewports: number[];
  animations: AnimationStrategy;
  fonts: FontStrategy;
  strictness: StrictnessLevel;
  sections: string[];
}): string {
  const lines: string[] = [];
  lines.push(`URL:        ${url}`);
  lines.push(`Hostname:   ${hostnameFromUrl(url)}`);
  if (opts.target) lines.push(`Target:     ${opts.target}`);
  lines.push(`Viewports:  ${opts.viewports.join(', ')}`);
  lines.push(`Animations: ${opts.animations} — ${ANIMATION_DESCRIPTIONS[opts.animations]}`);
  lines.push(`Fonts:      ${opts.fonts} — ${FONT_DESCRIPTIONS[opts.fonts]}`);
  lines.push(`Strictness: ${opts.strictness} — ${STRICTNESS_DESCRIPTIONS[opts.strictness]}`);
  lines.push(`Sections:   ${opts.sections.length === 0 ? '(none yet)' : opts.sections.join(', ')}`);
  return lines.join('\n');
}
