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

## Feature matrix (Phase 107 — unified ⊇ V4-Pipeline ∪ site-clone)

| Feature | site-clone-to-v3 | V4-Pipeline | unified |
|---|---|---|---|
| V3 tree build + deploy | ✅ | ❌ | ✅ `elconv convert/deploy --target v3` |
| V4 Atomic tree build | ❌ | ✅ | ✅ `elconv convert --target v4` |
| Interaktiver Wizard | ✅ (framer-build) | ✅ (readline) | ✅ `elconv wizard` (ohne Flags interaktiv) |
| Preflight/Doctor | ✅ | ✅ | ✅ `elconv doctor` (+ `--sync-abilities` Drift-Check) |
| Visual QA (pixelmatch/SSIM) | ✅ | ✅ | ✅ `elconv qa` (echter Blend-Score) |
| Multi-Page Batch | ❌ | ✅ (`batch`) | ✅ `elconv batch --manifest <json>` |
| HTTP-API (Port 7123) | ❌ | ✅ (`serve`) | ✅ `elconv serve [--port]` |
| Server-Convert V3→V4 | ✅ (`upgrade-v4.ts`) | ❌ | ✅ `@elconv/mcp` `upgradePageToV4`/`convertPageV3ToV4` + `elconv deploy --server-convert` |
| Ability-Registry (263 live, Alias-Map, Drift-Gate) | ❌ | ❌ | ✅ `@elconv/mcp` ability-registry |

Damit gilt: Feature-Matrix unified ⊇ (V4-Pipeline ∪ site-clone). Beide Vorgänger-Repos sind im Maintenance-Mode (README/AGENTS.md-Banner).

## Config

Prefer `elconv.config.yaml` (see `@elconv/core` config) over scattered env flags. Credentials still load from `.env` via `loadCredentials()`.

## Version

Unified converter **1.0.0** replaces the separate 0.x pipelines for greenfield work. Existing JSON trees remain importable if they pass the package guards.
