# Migration Guide

## From `site-clone-to-v3`

| Old path | New package / module |
|----------|----------------------|
| `src/extractor/*` | `@elconv/extractors` browser + HTML |
| `src/scraper/*` | `@elconv/extractors` assets |
| `src/classifier/*` | `@elconv/target-v3` classifier |
| `src/ai-engine/*` | `@elconv/core` ai |
| `src/qa/healing-loop.ts` | `@elconv/qa` healing-loop |
| `src/recon/*` | `@elconv/extractors` recon |
| `src/orchestrator/*` | `@elconv/core` orchestrator |
| `src/builder/v3-*` | `@elconv/target-v3` |

CLI entry moves from `clone-v3` to `elconv` commands (`convert`, `doctor`, `deploy`, `qa`).

## From `Framer-to-Elementor-V4-Pipeline`

| Old path | New package / module |
|----------|----------------------|
| `src/lib/batch-scheduler.ts` | `@elconv/mcp` batch-scheduler |
| `src/lib/idempotency.ts` | `@elconv/mcp` idempotency |
| `src/lib/circuit-breaker.ts` | `@elconv/mcp` circuit-breaker |
| `src/converter/v4-tree-builder.ts` | `@elconv/target-v4` builder |
| `src/cli/*` | `@elconv/cli` |

Framer XML extraction lives in `@elconv/extractors` (`extractFromFramerXml`).

## Config

Prefer `elconv.config.yaml` (see `@elconv/core` config) over scattered env flags. Credentials still load from `.env` via `loadCredentials()`.

## Version

Unified converter **1.0.0** replaces the separate 0.x pipelines for greenfield work. Existing JSON trees remain importable if they pass the package guards.
