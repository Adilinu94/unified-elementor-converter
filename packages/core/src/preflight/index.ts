/**
 * @elconv/core preflight — Phase 115 (BAUPLAN v4.0 "Verbesserung 7").
 *
 * Plugin/environment compatibility pre-flight: a static requirement matrix, a
 * PHP-backed detector (executor injected), and a pure report builder that the
 * `elconv preflight` command and the pipeline entry points consume.
 */

export * from './plugin-matrix.js';
export * from './preflight-check.js';
export * from './plugin-detector.js';
