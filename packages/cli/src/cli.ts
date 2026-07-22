#!/usr/bin/env node
/**
 * elconv CLI entry point.
 */
import { main } from './index.ts';

main().then((code) => {
  process.exitCode = code;
}).catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exitCode = 1;
});
