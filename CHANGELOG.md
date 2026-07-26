# Changelog

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
