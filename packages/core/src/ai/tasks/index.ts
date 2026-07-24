// @elconv/core — AI-Tasks (Modul B): konkrete Tasks für den AIRouter.
// Prompt + Parsing sind hier die Single Source of Truth (vision-qa,
// section-classify) — qa/classifier delegieren in späteren Phasen hierher.
export * from './vision-qa.task.js';
export * from './section-classify.task.js';
export * from './component-detect.task.js';
export * from './token-semantics.task.js';
export * from './repair-block.task.js';
