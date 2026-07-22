/**
 * elconv session-init — Initialize a conversion session with pipeline state.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireFlag, optionalFlag } from './args.ts';

export interface SessionConfig {
  target: 'v3' | 'v4';
  sourceUrl?: string;
  postId?: number;
  createdAt: string;
  phases: Record<string, { status: string; timestamp?: string }>;
}

export async function cmdSessionInit(flags: Record<string, string | boolean>): Promise<number> {
  const target = requireFlag(flags, 'target') as 'v3' | 'v4';
  if (target !== 'v3' && target !== 'v4') {
    process.stderr.write(`Error: --target must be "v3" or "v4"\n`);
    return 2;
  }

  const sourceUrl = optionalFlag(flags, 'source-url');
  const postIdStr = optionalFlag(flags, 'post-id');
  const postId = postIdStr ? parseInt(postIdStr, 10) : undefined;

  const session: SessionConfig = {
    target,
    sourceUrl,
    postId,
    createdAt: new Date().toISOString(),
    phases: {
      extract: { status: 'pending' },
      build: { status: 'pending' },
      guards: { status: 'pending' },
      deploy: { status: 'pending' },
      qa: { status: 'pending' },
    },
  };

  const stateDir = resolve('.elconv');
  mkdirSync(stateDir, { recursive: true });
  const statePath = resolve(stateDir, `state.${target}.json`);
  writeFileSync(statePath, JSON.stringify(session, null, 2), 'utf-8');

  process.stdout.write(`\n✓ Session initialized\n`);
  process.stdout.write(`  Target:  ${target.toUpperCase()}\n`);
  if (sourceUrl) process.stdout.write(`  Source:  ${sourceUrl}\n`);
  if (postId) process.stdout.write(`  Post ID: ${postId}\n`);
  process.stdout.write(`  State:   ${statePath}\n\n`);

  return 0;
}
