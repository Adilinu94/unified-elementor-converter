# Critical Failure Points

Documented regressions and structural risks found during development or during the predecessor-repo audit (`BAUPLAN-v2.0-VOLLSTAENDIGE-INTEGRATION-2026-07.md`). Read before touching deploy, QA, or the AI layer.

## P0 — Deploy

**`batch-build-page` silently drops nested V3 elements.** It only saves top-level sections; nested containers vanish without an error. Always use `elementor-inject-calibrated-page` with the full `_elementor_data` array for V3. `batch-build-page` is correct for V4 only. Source: `site-clone-to-v3/src/mcp/wp-push.ts`. `mcp/src/deploy.ts` already selects correctly by target — do not change that dispatch without re-verifying this.

**MCP write success ≠ visible result.** Elementor caches the compiled tree (`_elementor_element_cache`). A successful save can still render stale content until the cache is cleared and the page hard-reloaded. Never declare a deploy "done" on API success alone — verify against the public URL.

**WPCode single-write leaves the live site stale.** A snippet update must write both `post_content` (the post) and the `wpcode_snippets` option (the compiled cache location entry). Writing only one leaves CSS/JS out of sync with what's displayed.

## P1 — QA / Healing Loop

**The healing/auto-fix loop is not implemented yet.** `qa/src/auto-fix.ts` currently contains type stubs only — `runAutoFix()` has no real engine behind it. Any phase that assumes automatic issue correction (post-build QA automation, Phase 58) has a hard dependency on this being finished first. Treat "self-healing" as aspirational until this is closed.

**Three parallel diff layers exist in `qa/`,** functionally overlapping (pixel diff, SSIM, and a third comparison path). Consolidate before adding new QA scripts on top — otherwise every new QA feature has to be wired into three places instead of one.

**`IssueType`/`IssueSeverity` are defined twice** (in `core` and in `qa`), independently. New issue types added to only one will silently fail to match against consumers expecting the other.

## P2 — AI Layer

**`AIRouter` is not currently instantiable.** The provider implementations it depends on (`ClaudeProvider`, `Gpt4VisionProvider`) don't exist yet. Any code path that calls into the AI router for classification or vision-based checks will fail at runtime, not at typecheck — `tsc` stays clean because the router itself compiles, only construction fails. Verify with a runtime smoke test, not just `tsc --noEmit`.

## P3 — Build / Install

**`sharp` can fail to install on a fresh machine** when npm is run with `--ignore-scripts` (its native binary isn't downloaded). If image processing breaks post-install with no obvious error, check this first.

**A workspace sub-tool that requires its own separate build step will silently break its own tests if that step is skipped.** Observed in the Framer-pipeline predecessor (`tools/framer-export` needed its own local install/build; one CI-passing test failed locally without it). If `packages/framer-export` is added as its own workspace package (Bauplan v2.0, Teil 5 Punkt 5), confirm `npm ci` alone is sufficient — don't reintroduce a silently-skippable manual step.

## P4 — Structural

**V3/V4 contamination.** If a file in `target-v3/` or `target-v4/` imports from the other target, or a "shared" utility starts encoding assumptions about a specific target's tree shape, both output paths degrade unpredictably rather than failing loudly. There is a dedicated contamination-check in `core/` — any new shared utility must pass it before being used by both targets. See the Playbook, rule #1.

**`columns` option is silently ignored in `target-v3/src/patterns/{service-cards,stat-row}.ts`.** Both accept a `columns` option with a default, but never apply it to the actual grid/layout — passing a custom value has no effect. Found via lint (`no-unused-vars` on the destructured option), not yet fixed — needs a decision on how `columns` should map to the container's flex/grid settings before it can be wired up correctly.

**Extractors have no `css-fallback` path.** The original base-phase plan (0–34) specified a `css-fallback/` extractor for automatic CSS fallback values; it was never actually built (`extractors/src/` has no such folder, confirmed absent). Anything relying on CSS-fallback extraction should not assume it exists.
