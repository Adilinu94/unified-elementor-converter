# Critical Failure Points

Documented regressions and structural risks found during development or during the predecessor-repo audit (`BAUPLAN-v2.0-VOLLSTAENDIGE-INTEGRATION-2026-07.md`). Read before touching deploy, QA, or the AI layer.

## P0 — Deploy

**`batch-build-page` silently drops nested V3 elements.** It only saves top-level sections; nested containers vanish without an error. Always use `elementor-inject-calibrated-page` with the full `_elementor_data` array for V3. `batch-build-page` is correct for V4 only. Source: `site-clone-to-v3/src/mcp/wp-push.ts`. `mcp/src/deploy.ts` already selects correctly by target — do not change that dispatch without re-verifying this.

**MCP write success ≠ visible result.** Elementor caches the compiled tree (`_elementor_element_cache`). A successful save can still render stale content until the cache is cleared and the page hard-reloaded. Never declare a deploy "done" on API success alone — verify against the public URL.

**WPCode single-write leaves the live site stale.** A snippet update must write both `post_content` (the post) and the `wpcode_snippets` option (the compiled cache location entry). Writing only one leaves CSS/JS out of sync with what's displayed.

## P1 — QA / Healing Loop

**The healing/auto-fix loop is not implemented yet.** `qa/src/auto-fix.ts` currently contains type stubs only — `runAutoFix()` has no real engine behind it. Any phase that assumes automatic issue correction (post-build QA automation, Phase 58) has a hard dependency on this being finished first. Treat "self-healing" as aspirational until this is closed.

**Four diff/comparison entry points exist in `qa/`, two of them used by different callers for the same job.** `pixel-diff.ts` (`diffScreenshots`, raw pixelmatch) + `ssim.ts` is what `cli/src/v3v4-diff.ts` actually calls. `diff/index.ts` (`runComprehensiveDiff`, "V1.8" — resize-to-match → ignore-regions → block-diff → SSIM → multi-viewport → heatmap, 7 sub-modules) is what `cli/src/analysis/pipeline.ts`'s QA stage actually calls. Two different CLI/orchestration entry points, two different diff engines, for conceptually the same "compare before/after screenshots" task. Additionally `structure-diff.ts` (`runStructureDiff`, section-mapping-based) and `visual-diff-structured.ts` (`computeStructuredDiff`, DOM-snapshot-based) both do structural (non-pixel) comparison with overlapping purpose. Not consolidated — a real merge risks behavior changes in whichever path isn't touched by tests first, and neither `v3v4-diff.ts` nor `pipeline.ts`'s diff call has dedicated test coverage to catch a regression. Before merging: add coverage to both current call sites first, then migrate `v3v4-diff.ts` to `runComprehensiveDiff` (the more complete engine) and re-verify, rather than a big-bang rewrite.

**`IssueType`/`IssueSeverity` consolidated** (previously defined independently three times: `core/src/ai/tasks/vision-qa.task.ts`, `qa/src/issue-detector.ts`, `qa/src/strictness.ts` — all three were the exact same string unions). Canonical source is now `core/src/issue-types.ts`; the other two re-export from `@elconv/core`.

## P2 — AI Layer

**`runVisionQA` does not exist anywhere in the codebase**, even though `cli/src/analysis/pipeline.ts`'s QA stage was written to call it. `AIRouter`/`ClaudeProvider`/`Gpt4VisionProvider` themselves are real and verified working end-to-end (`tests/unit/core/ai-layer-smoke.test.ts` — construction, request shape, response parsing, provider selection, all with mocked `fetch`, no prior test ever exercised the actual `createAIRouter()` factory or either real provider). What's still missing is the higher-level "run vision QA on a screenshot pair and return a score" function that would sit on top of the router. `pipeline.ts` currently degrades to `enableVision: false` instead of calling it.

## P3 — Build / Install

**`sharp` can fail to install on a fresh machine** when npm is run with `--ignore-scripts` (its native binary isn't downloaded). If image processing breaks post-install with no obvious error, check this first.

**A workspace sub-tool that requires its own separate build step will silently break its own tests if that step is skipped.** Observed in the Framer-pipeline predecessor (`tools/framer-export` needed its own local install/build; one CI-passing test failed locally without it). If `packages/framer-export` is added as its own workspace package (Bauplan v2.0, Teil 5 Punkt 5), confirm `npm ci` alone is sufficient — don't reintroduce a silently-skippable manual step.

## P4 — Structural

**V3/V4 contamination.** If a file in `target-v3/` or `target-v4/` imports from the other target, or a "shared" utility starts encoding assumptions about a specific target's tree shape, both output paths degrade unpredictably rather than failing loudly. There is a dedicated contamination-check in `core/` — any new shared utility must pass it before being used by both targets. See the Playbook, rule #1.

**Extractors have no `css-fallback` path.** The original base-phase plan (0–34) specified a `css-fallback/` extractor for automatic CSS fallback values; it was never actually built (`extractors/src/` has no such folder, confirmed absent). Anything relying on CSS-fallback extraction should not assume it exists.
