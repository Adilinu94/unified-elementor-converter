# Elconv API Reference

## Packages

| Package | Import | Purpose |
|---------|--------|---------|
| `@elconv/core` | shared kernel | types, guards, AI, orchestrator, logging, security, cache |
| `@elconv/extractors` | input | HTML/Framer/browser extraction, assets, recon |
| `@elconv/target-v3` | V3 builder | patterns, classifier, WPCode |
| `@elconv/target-v4` | V4 atomic | bridge, patterns |
| `@elconv/mcp` | deploy transport | deploy, batch, idempotency, preflight |
| `@elconv/qa` | visual QA | diff, auto-fix, healing loop |
| `@elconv/cli` | CLI | convert, doctor, deploy, qa |

## Core

### AI Engine
- `CostTracker` — track AI API costs per task/provider
- `AIRouter` — select provider by task category, execute tasks
- `TASK_CATEGORY` — maps task names to `cheap` | `medium` | `expensive`

### Orchestrator
- `runStage(handler, input, context, options?)` — single stage with retries
- `runPipeline(stages, input, url, target, options?)` — multi-stage pipeline

### Logging / Security / Cache
- `createLogger({ level?, prefix? })` — structured JSON logger
- `loadCredentials(envPath?)` — load WP/MCP/AI credentials from `.env`
- `sanitizeUrl(input)` / `sanitizeHtml(input)` / `maskSecret(secret)`
- `ExtractionCache` — memory + file TTL cache for extractions

## Extractors

### Browser
- `extractFromUrl(options): Promise<BrowserExtractionResult>`
- `waitForHydration(page)`, `triggerLazyLoad(page)`
- `walkComputedStyles(page)`, `detectSections(page)`
- `FontUrlCollector`, `DEFAULT_VIEWPORTS`, `CURATED_PROPERTIES`

### Assets
- `RateLimiter` / `createDomainRateLimiter()`
- `downloadImages(images, options)`, `downloadFonts(fonts, options)`
- `normalizeImageUrl(url)`, `buildManifest(...)`, `writeManifest(...)`

### Recon
- `runRecon(page, options?): Promise<ReconResult>` — SPA + mutation detection

## Target V3 Classifier
- `mapElementToWidget(tag, selector, styles, content?, options?)`
- `classifySection(section, childSnapshots, options?)` → layout pattern

## MCP
- `BatchScheduler` — prioritized concurrent task queue
- `Idempotency` — dedupe identical calls within TTL

## QA
- `runHealingLoop(options): Promise<HealingLoopReport>` — capture → diff → fix → verify
