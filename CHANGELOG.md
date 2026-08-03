# Changelog

## Unreleased — 2026-08-03

### Fixed
- Restored a clean workspace `tsc --build` across the package-reference graph.
- Resolved cross-package barrel/type collisions and V3/V4 adapter boundaries.
- Added regression coverage for SVG provenance, XML entities, dry-run isolation, and V4 legacy planning.
- Updated CLI, extractor, V3, V4, and documentation contracts to match the unified pipeline.

### Verification
- Clean TypeScript build passes.
- Serial full Vitest suite passes; see `docs/TODO-OFFEN-2026-07-31.md` for the exact release-gate status and remaining parallel-test caveat.
- Production lint passes with 0 errors and 0 warnings after replacing the six remaining `no-explicit-any` uses with narrow structural types.
- V3/V4 Golden Paths pass (68 combined gate tests including CLI/Visual gates); details are recorded in `docs/RELEASE-GATES-2026-07-31.md`.
- Fixed the unified CLI import side effect that launched the legacy clone entry point during imports; direct CLI smoke commands now return the documented exit codes.
- Implemented the retained clone-v3 repair flags with explicit ports, real healing re-capture/re-diff verification, diagnostic full-context AI reports, and honest `ok`/`unavailable`/`failed` status semantics.
- Added MCP session initialization/recovery, semantic Elementor read-back, canonical document-cache clearing, and regression coverage for wrapped responses and ability-specific timeouts.
- Synchronized repository status documentation and added `docs/REPOSITORY-MAP.md` as the canonical orientation guide for human and AI contributors.
- Marked the released commit/push step (O-01) and the stale commit checkbox as done in `docs/TODO-OFFEN-2026-07-31.md` and `docs/REPOSITORY-AUDIT-AND-CONVERGENCE-2026-08-01.md`; status docs now match the pushed git state.
- Prepared O-03 offline: `large-deploy-plan.ts` freezes the planned `upload-php`/`split` call contract (replace/append chunking, read-back + cache-clear per step) with a registry drift guard and `requiresSchemaVerification: true`; deterministic large-tree fixtures and 18 mock-adapter tests (band selection, contract, honest gate, retry/resume) were added. The productive gate in `executeDeploy` stays closed — no MCP write until the server-side upload/append schemas are verified against a real test target.
- Completed the O-04 wizard contract: `wizard-contract.ts` persists a machine-readable `wizard-contract.json` after every phase (exit codes 0/1/2, per-phase `ok`/`failed`/`skipped`/`unavailable` status, the full V3/V4/QA option-forwarding manifest, and per-phase artifact paths); wizard viewports now flow into the URL pipeline; the QA phase reports an honest machine-readable status instead of claiming success; remote pipeline-state stays `unavailable` until its MCP schema is verified. Covered by 15 unit tests.
- Extended the O-03 offline base with Framer special-case fixtures: realistic V3/V4 trees containing style references (V3 `css_classes` string gotcha; V4 `classes` bound to `styles{}` plus external `gc-*` refs and global-variable props), CMS collection instances (V3 `posts` widget, V4 `e-grid` loop), and unknown-widget fallbacks (V3 `html`, V4 `e-html` with `html-content`), sized into the `upload-php`/`split` bands; the V4 fixture passes the full V4 guard suite. New regression tests freeze the planned large-deploy contract over these fixtures while the productive gate in `executeDeploy` stays closed — now 34 offline tests in `large-deploy-offline.test.ts`.
- Wired the remaining wizard build options into the build adapters (O-04 parity preparation): the canonical `BuildOptions` contract lives in `@elconv/core` (`build-options.ts`) with a strictness→guard-threshold map (draft 70 / balanced 85 / pixel-perfect 95) and section-selector matching; `buildV3Tree`/`buildV4Tree` accept the options and consume the `sections` filter; the wizard's build phase forwards all four options (strictness/animations/fonts/sections), the validate phase runs guards against the strictness threshold, and the URL pipeline consumes them (sections scope the build + animation targets, `animations: none` skips the animation stage, `fonts: system` skips font downloads/Kit sync, strictness maps to the QA acceptance score). The machine-readable `wizard-contract.json` now records `optionsAppliedToBuild` for parity audits. Covered by 14 new core/builder tests plus a wizard end-to-end `--sections` regression and contract assertions.

## 1.0.0 — 2026-07-23

Production-ready release of the unified Elementor converter.

### Added
- Playwright browser extraction (hydration, lazy-scroll, computed styles, sections, fonts)
- Asset pipeline (images, fonts, rate limiter, manifest)
- V3 widget mapper + style classifier
- AI engine (provider router, cost tracker)
- Self-healing QA loop
- Recon (SPA / mutation / animation detection)
- Phase pipeline orchestrator with retries
- Batch scheduler + idempotency
- Structured logging, credential management, extraction cache
- CI workflow (typecheck, test, build)
- API, architecture, and migration docs

### Packages
- `@elconv/core`, `extractors`, `target-v3`, `target-v4`, `mcp`, `qa`, `cli`

## 0.1.0

Initial monorepo: branded types, extractors, V3/V4 builders, MCP deploy, QA, golden e2e.
