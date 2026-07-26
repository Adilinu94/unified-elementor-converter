/**
 * Phase 11 — CLI Flag Validation
 *
 * Validates and parses user-supplied CLI flags for the clone pipeline.
 * Distinguishes between "error" (invalid input that prevents execution)
 * and "warning" (valid input with caveats the user should know about).
 *
 * Plan reference: §15.2 CLI Flag Validation
 */

export type CloneMode = "v3" | "v4";

export interface CloneCliFlagsInput {
  url: string;
  target: string;
  output: string;
  mode: string;
}

export interface CloneCliFlags {
  url: string;
  target: string;
  output: string;
  mode: CloneMode;
}

export type CloneCliFlagsParseResult =
  | { ok: true; value: CloneCliFlags }
  | { ok: false; errors: string[] };

const ALLOWED_MODES: ReadonlySet<string> = new Set(["v3", "v4"]);
const TARGET_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const HTTP_PATTERN = /^https?:\/\//;
const OUTPUT_PATTERN = /^(\.|\/|[A-Za-z]:\\|\.\/)/;

export function validateCloneCliFlags(input: CloneCliFlagsInput): string[] {
  const errors: string[] = [];

  if (!input.url || typeof input.url !== "string" || input.url.trim().length === 0) {
    errors.push("url is required");
  } else if (!HTTP_PATTERN.test(input.url)) {
    errors.push("url must use http or https scheme");
  } else if (input.url.includes("javascript:")) {
    errors.push("url scheme javascript: is not allowed");
  }

  if (!input.target || !TARGET_PATTERN.test(input.target)) {
    errors.push("target must be 1-64 chars, alphanumeric/-/_ only");
  }

  if (!input.output || !OUTPUT_PATTERN.test(input.output)) {
    errors.push("output must be an absolute or relative path");
  }

  if (!ALLOWED_MODES.has(input.mode)) {
    errors.push(`mode must be one of: ${[...ALLOWED_MODES].join(", ")}`);
  }

  return errors;
}

export function parseCloneCliFlags(input: CloneCliFlagsInput): CloneCliFlagsParseResult {
  const errors = validateCloneCliFlags(input);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      url: input.url.trim(),
      target: input.target.trim(),
      output: input.output.trim(),
      mode: input.mode as CloneMode,
    },
  };
}

export interface DryRunSummary {
  target: string;
  url: string;
  output: string;
  mode: CloneMode;
  estimatedStages: number;
  warnings: string[];
}

export function buildDryRunSummary(flags: CloneCliFlags): DryRunSummary {
  const warnings: string[] = [];
  if (flags.mode === "v4") {
    warnings.push("V4 mode uses Elementor Atomic Widgets — V3 fallback widgets will be downgraded");
  }
  if (flags.url.includes("localhost") || flags.url.includes("127.0.0.1")) {
    warnings.push("Localhost URL — network access may be restricted");
  }
  return {
    target: flags.target,
    url: flags.url,
    output: flags.output,
    mode: flags.mode,
    estimatedStages: 6,
    warnings,
  };
}