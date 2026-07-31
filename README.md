# unified-elementor-converter

Unified pipeline converting any website — live URL, Framer export, or static HTML — to **Elementor V3** (containers/widgets) or **Elementor V4 Atomic** (`$$type`, e-flexbox, Global Classes).

Consolidates two predecessor repos into one strictly-separated codebase:

- [`site-clone-to-v3`](https://github.com/Adilinu94/site-clone-to-v3) — live-site cloning, V3 output
- [`Framer-to-Elementor-V4-Pipeline`](https://github.com/Adilinu94/Framer-to-Elementor-V4-Pipeline) — Framer export parsing, V4 Atomic output

## Hard rule: V3/V4 isolation

V3 code never imports from V4 code, and vice versa. Shared **mechanism** without target-format knowledge (WPCode snippet generation, preflight checks, diffing) may live in `core/`, `mcp/`, `qa/`, or `extractors/`. Anything that knows what a V3 or V4 element *is* stays strictly inside `target-v3/` or `target-v4/`. See `docs/AI-EXECUTOR-PLAYBOOK.md` for the full rule set.

## Packages

| Package | Purpose |
|---|---|
| `core` | Branded types, contracts, AI router, design-system tokens, orchestrator |
| `extractors` | Playwright scraper, Framer parsing, asset pipeline |
| `target-v3` | V3 builder, classifier, patterns, WPCode/animation |
| `target-v4` | V4 Atomic builder, patterns, guards, V3→V4 bridge |
| `mcp` | WordPress deploy via MCP — preflight, batching, circuit breaker |
| `qa` | Visual diff (SSIM/pixelmatch), healing loop, issue detection |
| `cli` | `elconv convert / doctor / deploy / qa` |

## Getting started

```bash
npm ci
npm run typecheck
npm test
```

## Docs

- `docs/ARCHITECTURE.md` — package dependency graph and data flow
- `docs/API.md` — public API reference
- `docs/MIGRATION.md` — migrating from either predecessor repo
- `docs/PROGRESS.md` — complete phase history and current verification status
- `docs/BAUPLAN-v5.0-KONVERGENZ-NOVAMIRA-WIZARDS-2026-07.md` — convergence plan and phases 100–115
- `docs/TODO-OFFEN-2026-07-31.md` — current handoff: remaining product work and release gates
- `docs/AI-EXECUTOR-PLAYBOOK.md` — hard rules and mission for anyone (human or AI) implementing a phase
- `docs/CRITICAL-FAILURE-POINTS.md` — known pitfalls that have caused real regressions

## Status

The unified converter is the canonical implementation. The numbered convergence and hardening phases 100–115 are implemented. The workspace now passes a clean `tsc --build`; the current handoff records the remaining legacy-path decisions, test-stability work, and release follow-ups. Use the serial full-suite command documented in `AGENTS.md` for deterministic local verification.

The predecessor repositories remain maintenance-mode references. New work belongs here.
