/**
 * changelog-generator — Build a Markdown changelog from conventional commit history.
 *
 * Reads commits since the latest semver tag (or last N commits) and groups by
 * conventional-commit type. Output is appended to CHANGELOG.md.
 */

import { execFileSync } from 'node:child_process';

const TYPE_LABELS: Record<string, string> = {
  feat: 'Features',
  fix: 'Bug Fixes',
  perf: 'Performance',
  refactor: 'Refactors',
  docs: 'Documentation',
  test: 'Tests',
  build: 'Build System',
  ci: 'CI',
  chore: 'Chores',
  style: 'Styles',
};

export interface CommitEntry {
  hash: string;
  type: string;
  scope?: string;
  subject: string;
  body?: string;
  breaking: boolean;
}

export interface ChangelogSection {
  type: string;
  label: string;
  entries: CommitEntry[];
}

export interface Changelog {
  version: string;
  date: string;
  sections: ChangelogSection[];
  breaking: CommitEntry[];
}

export function parseCommit(message: string, hash: string): CommitEntry | null {
  // Matches: type(scope)?: subject
  // Optional "!" after type/scope for breaking change
  const m = message.match(/^([a-z]+)(?:\(([^)]+)\))?(!)?: (.+)/);
  if (!m) return null;
  const [, type, scope, breakingMarker, subject] = m;
  const lines = message.split('\n');
  const body = lines.slice(1).join('\n').trim() || undefined;
  return {
    hash: hash.slice(0, 7),
    type,
    scope,
    subject,
    body,
    breaking: !!breakingMarker,
  };
}

export function getCommitsSince(cwd: string, sinceTag?: string, count: number = 50): CommitEntry[] {
  const args = ['log', '--no-merges', '--pretty=format:%H%x00%s'];
  if (sinceTag) {
    args.push(`${sinceTag}..HEAD`);
  } else {
    args.push(`-n`, String(count));
  }
  let raw: string;
  try {
    raw = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return [];
  }
  const entries: CommitEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const sep = line.indexOf('\x00');
    if (sep < 0) continue;
    const hash = line.slice(0, sep);
    const subject = line.slice(sep + 1).trim();
    if (!hash || !subject) continue;
    const parsed = parseCommit(subject, hash);
    if (parsed) entries.push(parsed);
  }
  return entries;
}

export function groupByType(commits: CommitEntry[]): ChangelogSection[] {
  const groups = new Map<string, CommitEntry[]>();
  for (const c of commits) {
    if (!groups.has(c.type)) groups.set(c.type, []);
    groups.get(c.type)!.push(c);
  }
  const sections: ChangelogSection[] = [];
  for (const [type, entries] of groups) {
    sections.push({ type, label: TYPE_LABELS[type] ?? type, entries });
  }
  return sections.sort((a, b) => {
    const orderA = Object.keys(TYPE_LABELS).indexOf(a.type);
    const orderB = Object.keys(TYPE_LABELS).indexOf(b.type);
    return orderA - orderB;
  });
}

export function buildChangelog(commits: CommitEntry[], version: string, date: string = new Date().toISOString().slice(0, 10)): Changelog {
  return {
    version,
    date,
    sections: groupByType(commits),
    breaking: commits.filter((c) => c.breaking),
  };
}

export function renderChangelogMarkdown(changelog: Changelog): string {
  const lines: string[] = [];
  lines.push(`## [${changelog.version}] - ${changelog.date}`);
  lines.push('');

  if (changelog.breaking.length > 0) {
    lines.push('### ⚠ BREAKING CHANGES');
    for (const b of changelog.breaking) {
      lines.push(`- **${b.scope ?? 'core'}**: ${b.subject} (\`${b.hash}\`)`);
    }
    lines.push('');
  }

  for (const section of changelog.sections) {
    if (section.entries.length === 0) continue;
    lines.push(`### ${section.label}`);
    for (const e of section.entries) {
      const scope = e.scope ? `**${e.scope}**: ` : '';
      const breaking = e.breaking ? ' ⚠' : '';
      lines.push(`- ${scope}${e.subject}${breaking} (\`${e.hash}\`)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function getLatestSemverTag(cwd: string): string | undefined {
  try {
    const out = execFileSync('git', ['tag', '--sort=-v:refname', '--list', 'v*.*.*'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const first = out.split('\n').find((t) => t.trim());
    return first?.trim() || undefined;
  } catch {
    return undefined;
  }
}
