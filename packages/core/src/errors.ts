/**
 * Shared error types for the unified converter.
 */

export class GuardError extends Error {
  constructor(
    public readonly score: number,
    public readonly threshold: number,
    public readonly failures: string[],
  ) {
    super(
      `Guard check failed: score ${score}/${threshold}. ` +
      `Failures: ${failures.join(', ')}`,
    );
    this.name = 'GuardError';
  }
}

export class DeployError extends Error {
  constructor(
    public readonly strategy: string,
    public readonly reason: string,
    public readonly postId?: number,
  ) {
    super(`Deploy failed (${strategy}): ${reason}`);
    this.name = 'DeployError';
  }
}

export class ExtractionError extends Error {
  constructor(
    public readonly sourceType: string,
    public readonly reason: string,
    public readonly url?: string,
  ) {
    super(`Extraction failed (${sourceType}): ${reason}`);
    this.name = 'ExtractionError';
  }
}

export class PreflightError extends Error {
  constructor(
    public readonly checkId: string,
    public readonly reason: string,
  ) {
    super(`Preflight check "${checkId}" failed: ${reason}`);
    this.name = 'PreflightError';
  }
}

export class ConfigError extends Error {
  constructor(
    public readonly field: string,
    public readonly reason: string,
  ) {
    super(`Config error at "${field}": ${reason}`);
    this.name = 'ConfigError';
  }
}
