/**
 * Minimal argument parser (no external dependencies).
 * Supports --flag value, --flag=value, --boolean-flag, and positional args.
 */

export interface ParsedArgs {
  command: string;
  subcommand?: string;
  flags: Record<string, string | boolean>;
  positionals: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // skip node + script
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[arg.slice(2)] = args[i + 1];
        i++;
      } else {
        flags[arg.slice(2)] = true;
      }
    } else {
      positionals.push(arg);
    }
    i++;
  }

  return {
    command: positionals[0] ?? '',
    subcommand: positionals[1],
    flags,
    positionals: positionals.slice(2),
  };
}

export function requireFlag(flags: Record<string, string | boolean>, name: string): string {
  const val = flags[name];
  if (val === undefined || val === true) {
    process.stderr.write(`Error: --${name} is required\n`);
    process.exit(2);
  }
  return val as string;
}

export function optionalFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const val = flags[name];
  if (val === undefined || val === true) return undefined;
  return val as string;
}

export function boolFlag(flags: Record<string, string | boolean>, name: string): boolean {
  return flags[name] === true || flags[name] === 'true';
}
