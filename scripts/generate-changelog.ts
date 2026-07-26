#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { getCommitsSince, getLatestSemverTag, buildChangelog, renderChangelogMarkdown } from '../src/cli/changelog-generator.js';

const cwd = process.cwd();
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

const tag = getLatestSemverTag(cwd);
const commits = getCommitsSince(cwd, tag, 100);
const cl = buildChangelog(commits, pkg.version, new Date().toISOString().slice(0, 10));
const header = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`;

writeFileSync('CHANGELOG.md', header + renderChangelogMarkdown(cl));
console.log(`Wrote CHANGELOG.md (v${pkg.version}, ${commits.length} commits since ${tag ?? 'beginning'})`);
