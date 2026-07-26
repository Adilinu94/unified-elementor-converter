/**
 * Package version, kept in sync with package.json.
 * Importing from package.json directly would require resolveJsonModule
 * at runtime (works in TS, fails in compiled JS+ESM with strict bundlers).
 */
export const PACKAGE_VERSION = '0.2.0';
