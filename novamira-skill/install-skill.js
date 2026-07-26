#!/usr/bin/env node
/**
 * install-skill.js
 *
 * Installiert alle site-clone-to-v3 Skills in eine Novamira-Instanz.
 * Liest die YAML-Frontmatter aus jedem Skill-File und ruft novamira/skill-write.
 *
 * Usage:
 *   node novamira-skill/install-skill.js
 *
 * Erfordert: NOVAMIRA_MCP_URL und NOVAMIRA_APP_PASSWORD in .env
 */

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseSkillFile(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const fmMatch = raw.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1];
  const content = fmMatch[2].trim();

  const slugMatch  = frontmatter.match(/^slug:\s*(.+)$/m);
  const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
  const descMatch  = frontmatter.match(/^description:\s*(.+)$/m);

  return {
    slug:        slugMatch?.[1]?.trim()  ?? 'unknown',
    title:       titleMatch?.[1]?.trim() ?? 'Unknown Skill',
    description: descMatch?.[1]?.trim()  ?? '',
    content,
  };
}

// Alle .md Dateien im selben Verzeichnis
const skillFiles = readdirSync(__dirname)
  .filter(f => extname(f) === '.md')
  .map(f => join(__dirname, f));

console.log(`Gefunden: ${skillFiles.length} Skill-Dateien`);
console.log('');
console.log('Agent-Anweisung: Fuer jeden der folgenden Skills:');
console.log('');

for (const filePath of skillFiles) {
  const skill = parseSkillFile(filePath);
  if (!skill) {
    console.log(`SKIP: ${filePath} (kein Frontmatter)`);
    continue;
  }

  console.log(`MCP-Aufruf fuer: ${skill.slug}`);
  console.log(JSON.stringify({
    ability: 'novamira/skill-write',
    parameters: {
      slug:        skill.slug,
      title:       skill.title,
      description: skill.description,
      content:     skill.content,
      on_conflict: 'replace',
    },
  }, null, 2));
  console.log('---');
}
