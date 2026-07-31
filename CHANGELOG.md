# Changelog

## Unreleased — 2026-07-31

### Fixed
- Restored a clean workspace `tsc --build` across the package-reference graph.
- Resolved cross-package barrel/type collisions and V3/V4 adapter boundaries.
- Added regression coverage for SVG provenance, XML entities, dry-run isolation, and V4 legacy planning.
- Updated CLI, extractor, V3, V4, and documentation contracts to match the unified pipeline.

### Verification
- Clean TypeScript build passes.
- Serial full Vitest suite passes; see `docs/TODO-OFFEN-2026-07-31.md` for the exact release-gate status and remaining parallel-test caveat.
- Production lint passes with 0 errors and 0 warnings after replacing the six remaining `no-explicit-any` uses with narrow structural types.

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
