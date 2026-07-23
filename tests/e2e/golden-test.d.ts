/**
 * Golden-File Regression Test Infrastructure.
 * Compares actual conversion output against stored golden files.
 * If golden file doesn't exist, creates it (update mode).
 */
export interface GoldenTestOptions {
    /** Update golden files instead of comparing */
    update?: boolean;
    /** Normalize output before comparison (sort keys, etc.) */
    normalize?: boolean;
    /** Tolerance for numeric values (floating point) */
    tolerance?: number;
}
export interface GoldenTestResult {
    passed: boolean;
    goldenPath: string;
    message: string;
    diff?: string;
}
/**
 * Normalize JSON for stable comparison.
 */
export declare function normalizeJson(obj: unknown): unknown;
/**
 * Compare two JSON structures with tolerance.
 */
export declare function jsonEquals(actual: unknown, expected: unknown, tolerance?: number, path?: string): {
    equal: boolean;
    diffs: string[];
};
/**
 * Run a golden-file test.
 */
export declare function runGoldenTest(name: string, actual: unknown, options?: GoldenTestOptions): GoldenTestResult;
/**
 * List all golden files.
 */
export declare function listGoldenFiles(): string[];
/**
 * Delete a golden file (for regeneration).
 */
export declare function deleteGoldenFile(name: string): boolean;
//# sourceMappingURL=golden-test.d.ts.map