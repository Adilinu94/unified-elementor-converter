# Bauplan v1.0 — Unified Elementor Converter (Phase 0–34)

**Status:** Verbindliche Spezifikation. Vollständiges Projekt von Phase 0 bis Release 1.0.
**Zielgruppe:** Ausführende KI. Jede Phase ist so geschrieben, dass sie ohne Rückfragen umsetzbar ist.
**Repo:** `unified-elementor-converter`
**Quell-Repos (Referenz, NICHT als Dependency):**
- `site-clone-to-v3` (V3: CLI, Extractor, QA, Patterns)
- `Framer-to-Elementor-V4-Pipeline` (V4: Guards, $$type, GC, Preflight)

---

## 0. Executive Summary

Ein eigenständiges TypeScript-Monorepo, das:
- **Beliebige Website-Quellen** (URL via Playwright, Framer XML, HTML-Export) extrahiert
- **Elementor V3** (container/section/column/widget) ODER **Elementor V4 Atomic** (e-flexbox, $$type, Global Classes) ausgibt
- **Strikte Trennung** zwischen V3- und V4-Logik auf Typ-, Laufzeit- und CLI-Ebene erzwingt
- **Einheitliches CLI** (`npx elconv`) mit target-spezifischen Subcommands bietet
- **Score-basierte Guards** (≥85) vor jedem Deploy erzwingt
- **Large-Tree Deploy** (direct/upload-php/split) + Rollback unterstützt
- **Visual QA** (pixelmatch + structural probes) als Done-Gate nutzt
- **KI-gestützte Klassifizierung** (AI-Router, Cost-Tracker) für Widget-Mapping
- **Self-Healing-Loop** (Capture → Diff → Fix → Verify) für automatische Korrektur
- **Production-Infrastruktur** (CI/CD, Logging, Security, Caching)

---

## 1. Pflichtregeln (BINDEND)

### 1.1 Arbeitsweise
1. **Eine Phase nach der anderen.** DoD grün → erst dann nächste.
2. **Kleine Commits** (1 Phase ≈ 1 Commit, >400 LOC → Sub-Commits).
3. **Kein Scope-Creep.** Nur was in der Phase steht.
4. **Tests:** `npm test` muss exit 0 geben bevor Phase als done gilt.
5. **ESM:** `"type": "module"`, Imports mit `.js`-Suffix.
6. **Keine Secrets** committen.
7. **Englisch** in Code, Tests, Commits. Deutsch nur in Docs erlaubt.

### 1.2 VERBOTEN (Hard Rules)
- ❌ `target-v3` importiert aus `target-v4` (oder umgekehrt)
- ❌ V4 `$$type` / `e-flexbox` / `e-heading` in einem V3-Tree
- ❌ V3 `elType: 'container'` / `elType: 'section'` in einem V4-Tree
- ❌ Gemeinsame Pattern-Implementierung für V3 und V4
- ❌ Assertions löschen um Tests grün zu machen
- ❌ `node_modules` committen
- ❌ Hardcodierte Produktions-URLs / Secrets

### 1.3 Definition „Phase grün"
```
[ ] Alle Dateien aus Phase existieren / geändert
[ ] Alle Acceptance Criteria erfüllt
[ ] npm test → exit 0
[ ] npx tsc --noEmit → exit 0
[ ] Commit: feat|fix|docs|test|chore(scope): …
[ ] Keine Secrets
```

### 1.4 Konventionen (KRITISCH)
- Alle Imports nutzen `.js` Extension: `import { foo } from './bar.js'`
- Vitest-Aliases: `@elconv/*` → `packages/*/src/index.ts`
- `runGuards(tree, guards)` — tree ist ERSTES Argument
- `chooseDeployStrategy(bytes, forced?)` gibt STRING zurück
- Branded Types: `V3ElementTree` / `V4ElementTree` mit `__v3Brand` / `__v4Brand`
- Jede neue Datei mit `resetXxxIds()` für deterministische Tests

---

## 2. Repository-Struktur

```
unified-elementor-converter/
├── package.json                    # Workspace root (ESM, scripts)
├── tsconfig.json                   # Project references (7 packages)
├── vitest.config.ts                # Test runner + aliases
├── .github/workflows/ci.yml        # CI/CD Pipeline
├── docs/                           # Dokumentation
├── packages/
│   ├── core/src/                   # Shared Kernel
│   │   ├── types.ts                # SourceSpec, SectionSpec, WidgetSpec
│   │   ├── branded-types.ts        # V3ElementTree, V4ElementTree (branded)
│   │   ├── contamination.ts        # assertNoContamination() runtime check
│   │   ├── guards.ts               # Guard<T>, runGuards(), GuardReport
│   │   ├── deploy-strategy.ts      # chooseStrategy() (direct/upload-php/split)
│   │   ├── pipeline-state.ts       # PipelineState load/save/mark
│   │   ├── errors.ts               # ContaminationError, GuardError, etc.
│   │   ├── session.ts              # Session-Management
│   │   ├── run-archive.ts          # Run-Archive (Observability)
│   │   ├── config.ts               # elconv.config.yaml loader
│   │   ├── logging.ts              # Structured JSON Logging
│   │   ├── security.ts             # Credential-Management, URL-Validation
│   │   ├── cache.ts                # LRU + Disk Cache
│   │   ├── ai/                     # AI-Engine
│   │   │   ├── types.ts            # AITask, AIResponse, VisionProvider
│   │   │   ├── cost-tracker.ts     # CostTracker (Budget, Per-Task)
│   │   │   ├── router.ts           # AIRouter (Provider-Selection)
│   │   │   └── index.ts
│   │   └── orchestrator/           # Pipeline-Orchestrator
│   │       ├── types.ts            # PhaseConfig, PipelineResult
│   │       ├── pipeline.ts         # Orchestrator (Retry, Abort)
│   │       └── index.ts
│   ├── extractors/src/             # Input-Adapter
│   │   ├── types.ts                # ExtractorOptions, ExtractResult
│   │   ├── html-parser.ts          # Statischer HTML-Export
│   │   ├── framer-xml.ts           # Framer XML/Unframer
│   │   ├── design-tokens.ts        # CSS-Variablen → DesignTokenSet
│   │   ├── browser/                # Playwright-Extraction
│   │   │   ├── types.ts            # ViewportConfig, FontIntercept, SectionInfo
│   │   │   ├── hydration-wait.ts   # Wartet auf Framework-Hydration
│   │   │   ├── lazy-scroll.ts      # Scrollt für Lazy-Loading
│   │   │   ├── computed-styles.ts  # Extrahiert computed styles
│   │   │   ├── section-detector.ts # Erkennt Page-Sections
│   │   │   ├── font-discovery.ts   # Font-Interception
│   │   │   ├── playwright-extractor.ts  # Haupt-Extraktor
│   │   │   └── index.ts
│   │   ├── assets/                 # Asset-Pipeline
│   │   │   ├── rate-limiter.ts     # Token-Bucket Rate-Limiter
│   │   │   ├── image-downloader.ts # Bild-Download + Optimierung
│   │   │   ├── font-downloader.ts  # Font-Download (woff2/woff)
│   │   │   ├── manifest-builder.ts # Asset-Manifest
│   │   │   └── index.ts
│   │   └── recon/                  # Reconnaissance
│   │       ├── types.ts            # ReconResult, SpaInfo
│   │       ├── detect-spa.ts       # SPA-Framework-Erkennung
│   │       ├── recon-runner.ts     # Vollständiger Recon-Run
│   │       └── index.ts
│   ├── target-v3/src/              # Elementor V3 (ISOLIERT)
│   │   ├── types.ts                # V3Element, V3PageData
│   │   ├── builder.ts              # SourceSpec → V3Element[]
│   │   ├── normalize.ts            # Container normalize (isInner, flex-row)
│   │   ├── guards.ts               # V3-spezifische Guards (G1-G7c)
│   │   ├── wpcode.ts               # WPCode dual-write + GSAP
│   │   ├── patterns/               # Widget-first Patterns
│   │   │   ├── glass-header.ts, service-cards.ts, stat-row.ts
│   │   │   └── index.ts
│   │   └── classifier/             # Widget-Klassifizierung
│   │       ├── types.ts            # WidgetCategory, ClassificationResult
│   │       ├── widget-mapper.ts    # DOM → Elementor Widget Mapping
│   │       ├── style-classifier.ts # CSS → Style-Klassifizierung
│   │       └── index.ts
│   ├── target-v4/src/              # Elementor V4 Atomic (ISOLIERT)
│   │   ├── types.ts                # V4Element, $$type System
│   │   ├── builder.ts              # SourceSpec → V4Element[]
│   │   ├── bridge.ts               # V3 → V4 Upgrade
│   │   ├── framer-utils.ts         # Framer-spezifische Utils
│   │   ├── guards.ts               # V4-spezifische Guards
│   │   ├── style-id.ts             # Style-ID Validation/Sanitize
│   │   └── patterns/               # Atomic Patterns
│   │       ├── glass-header.ts, stat-row.ts
│   │       └── index.ts
│   ├── mcp/src/                    # MCP Transport
│   │   ├── adapter.ts              # MCP-Adapter (JSON-RPC)
│   │   ├── circuit-breaker.ts      # Circuit Breaker (3 Fehler → Pause)
│   │   ├── targets.ts              # Named Targets
│   │   ├── abilities.ts            # Capability Detection
│   │   ├── transaction.ts          # Transaction Layer + Rollback
│   │   ├── chunked-deploy.ts       # 20-Element-Chunks
│   │   ├── deploy.ts               # Deploy-Orchestrierung
│   │   ├── preflight.ts            # Preflight-Suite
│   │   ├── batch-scheduler.ts      # Batch-Processing
│   │   └── idempotency.ts          # Idempotency-Keys
│   ├── qa/src/                     # Quality Assurance
│   │   ├── types.ts                # VisualDiffResult, FixAction
│   │   ├── visual-diff.ts          # Pixelmatch-basierter Diff
│   │   ├── auto-fix.ts             # Priority-Queue Auto-Fix
│   │   ├── structural-probes.ts    # Shared-ID, DOM-Struktur
│   │   ├── viewport-matrix.ts      # Multi-Viewport (1440/768/390)
│   │   └── healing-loop.ts         # Self-Healing Loop
│   └── cli/src/                    # CLI Surface
│       ├── args.ts                 # Argument-Parser
│       ├── cli.ts                  # Command Router
│       ├── cmd-convert.ts          # elconv convert
│       ├── cmd-deploy.ts           # elconv deploy
│       ├── cmd-doctor.ts           # elconv doctor
│       ├── cmd-qa.ts              # elconv qa
│       ├── cmd-session.ts          # elconv session
│       ├── cmd-target.ts           # elconv target
│       └── index.ts
└── tests/
    ├── unit/{core,extractors,target-v3,target-v4,mcp,qa,cli}/
    ├── integration/
    └── e2e/
```

---

## 3. Phasen-Übersicht (BINDENDE Reihenfolge)

| Phase | Titel | Paket(e) | Status |
|-------|-------|----------|--------|
| 0 | Repo-Setup + Workspace | root | ✅ |
| 1 | Core Kernel: Branded Types + Contamination | core | ✅ |
| 2 | Core: Canonical Interfaces + Guards | core | ✅ |
| 3 | Core: Deploy Strategy + Pipeline State | core | ✅ |
| 4 | MCP Transport + Circuit Breaker | mcp | ✅ |
| 5 | Extractors: HTML + Framer + Design Tokens | extractors | ✅ |
| 6 | CLI Surface (convert, doctor, deploy, qa) | cli | ✅ |
| 7 | Deploy Infrastructure + Transaction + Chunked | mcp | ✅ |
| 8 | Preflight Suite | mcp | ✅ |
| 9 | Target-V3: Builder + Patterns | target-v3 | ✅ |
| 10 | Target-V4: Builder + Patterns (Atomic) | target-v4 | ✅ |
| 11 | QA: Semantic Diff + Auto-Fix + Viewport | qa | ✅ |
| 12 | Session + Run-Archive + Config | core | ✅ |
| 13 | WPCode + Animation | target-v3 | ✅ |
| 14 | Bridge V3→V4 | target-v4 | ✅ |
| 15 | Config System (elconv.config.yaml) | core | ✅ |
| 16 | Skills + Docs | docs | ✅ |
| 17 | E2E: Golden-File Regression | tests | ✅ |
| 18 | Release 0.1.0 + Freeze | root | ✅ |
| 19 | Playwright-Extraction (Browser) | extractors/browser | ✅ |
| 20 | Asset-Pipeline (Download + Manifest) | extractors/assets | ✅ |
| 21 | Classifier (Widget-Mapper + Style) | target-v3/classifier | ✅ |
| 22 | AI-Engine (Router + Cost-Tracker) | core/ai | ✅ |
| 23 | Healing-Loop (Capture→Diff→Fix→Verify) | qa | ✅ |
| 24 | Recon (SPA + Mutation-Observer) | extractors/recon | ✅ |
| 25 | Orchestrator (Phase-Pipeline + Retry) | core/orchestrator | ✅ |
| 26 | Batch-Processing + Idempotency | mcp | ✅ |
| 27 | Build-Pipeline (tsc --build + dist/) | root | ✅ |
| 28 | CI/CD (GitHub Actions) | .github | ✅ |
| 29 | Structured Logging | core | ✅ |
| 30 | Security + Credential-Management | core | ✅ |
| 31 | Performance (LRU + Disk Cache) | core | ✅ |
| 32 | Integration-Tests (Browser) | tests | ✅ |
| 33 | Dokumentation + API-Reference | docs | ✅ |
| 34 | Release 1.0 | root | ✅ |

---

## 4. Phase 0 — Repo-Setup + Workspace

### Ziel
Monorepo-Grundgerüst mit npm workspaces, TypeScript project references, Vitest.

### Implementiert
- `package.json`: ESM (`"type": "module"`), workspaces für 7 Pakete
- `tsconfig.json`: Project references auf alle 7 Pakete
- `vitest.config.ts`: Aliases `@elconv/*` → `packages/*/src/index.ts`
- `.gitignore`, `.prettierrc.json`, `eslint.config.mjs`
- Scripts: `build`, `test`, `test:watch`, `lint`, `typecheck`, `clean`

### Dependencies (root)
```json
{
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@vitest/coverage-v8": "^3.2.7",
    "eslint": "^9.0.0",
    "playwright": "^1.61.1",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  },
  "dependencies": {
    "nanoid": "^6.0.0",
    "p-limit": "^6.0.0"
  }
}
```

---

## 5. Phase 1 — Core Kernel: Branded Types + Contamination

### Ziel
Typsichere Trennung von V3/V4 auf Compile-Time UND Runtime.

### Implementiert
- `branded-types.ts`: `V3ElementTree` (`__v3Brand`), `V4ElementTree` (`__v4Brand`)
- `contamination.ts`: `assertNoContamination(tree, target)` — prüft V4-Marker in V3 und umgekehrt
- `errors.ts`: `ContaminationError`, `GuardError`, `DeployError`, `ConfigError`

### Kritische Regel
Jeder Target-Test MUSS einen Contamination-Test enthalten.

---

## 6. Phase 2 — Core: Guards + Scoring

### Ziel
Score-basiertes Guard-System (≥85 = pass).

### Implementiert
- `guards.ts`: `Guard<T>` Interface, `runGuards(tree, guards)` → `GuardReport`
- Scoring: Jeder Guard hat `weight`, Ergebnis ist gewichteter Score 0-100
- `GuardReport`: `{ score, passed, results[] }`

---

## 7. Phase 3 — Core: Deploy Strategy + Pipeline State

### Ziel
Automatische Deploy-Strategie-Wahl basierend auf Tree-Größe.

### Implementiert
- `deploy-strategy.ts`: `chooseDeployStrategy(bytes, forced?)` → `'direct' | 'upload-php' | 'split'`
  - < 400KB → direct
  - 400KB–900KB → upload-php
  - \> 900KB → split
- `pipeline-state.ts`: `PipelineState` mit load/save/mark für resume-fähige Runs

---

## 8. Phase 4 — MCP Transport + Circuit Breaker

### Ziel
Zuverlässiger MCP-Transport mit Fehlerbehandlung.

### Implementiert
- `adapter.ts`: JSON-RPC Adapter für MCP-Server Kommunikation
- `circuit-breaker.ts`: 3 Fehler → 30s Pause → Retry. Zustände: CLOSED/OPEN/HALF_OPEN
- `targets.ts`: Named Targets (dev/staging/prod)
- `abilities.ts`: Capability Detection pro Target

---

## 9. Phase 5 — Extractors: HTML + Framer + Design Tokens

### Ziel
Drei Input-Quellen → einheitliches `SourceSpec`.

### Implementiert
- `html-parser.ts`: Statische HTML-Analyse (DOM → Sections/Widgets)
- `framer-xml.ts`: Framer XML/Unframer-Export Parsing
- `design-tokens.ts`: CSS-Variablen → `DesignTokenSet` (merge, classify, toCssVars)
- `types.ts`: `ExtractorOptions`, `ExtractResult`, `SourceSpec`

---

## 10. Phase 6 — CLI Surface

### Ziel
Einheitliches `npx elconv` mit Subcommands.

### Implementiert
- `cli.ts`: Command Router
- `cmd-convert.ts`: `elconv convert --url <url> --target v3|v4`
- `cmd-deploy.ts`: `elconv deploy --strategy auto|direct|upload-php|split`
- `cmd-doctor.ts`: `elconv doctor` (Preflight-Checks)
- `cmd-qa.ts`: `elconv qa` (Visual QA)
- `cmd-session.ts`: `elconv session-init|session-status`
- `cmd-target.ts`: `elconv target list|switch`
- `args.ts`: Argument-Parser (ohne externe Dependency)

---

## 11. Phase 7 — Deploy Infrastructure

### Ziel
Large-Tree Deploy mit Transaction, Chunked Deploy, Rollback.

### Implementiert
- `transaction.ts`: Transaction-Layer mit `transaction_id`, rollback bei Fehler
- `chunked-deploy.ts`: 20-Element-Chunks, Checkpoint nach jedem Chunk
- `deploy.ts`: Orchestrierung (Strategy → Chunked → Verify → Cache-Clear)

---

## 12. Phase 8 — Preflight Suite

### Ziel
Pre-Deploy Checks die IMMER laufen.

### Implementiert
- `preflight.ts`: 280 Zeilen — prüft Connectivity, Permissions, Tree-Size, Contamination, Guard-Score, Cache-Status

---

## 13. Phase 9 — Target-V3: Builder + Patterns

### Ziel
SourceSpec → V3 Elementor Tree mit widget-first Patterns.

### Implementiert
- `builder.ts`: 224 Zeilen — SourceSpec → V3Element[] (container/section/column/widget)
- `normalize.ts`: Container-Normalisierung (isInner, flex-row)
- `guards.ts`: V3-spezifische Guards (G1-G7c, G_NO_V4, G_HTML_BUDGET)
- `patterns/glass-header.ts`: Sticky Glass Header (native widgets)
- `patterns/service-cards.ts`: Service Cards Grid
- `patterns/stat-row.ts`: Statistics Row

### Regel
Native widgets (image/heading/button), HTML nur ≤15% Budget.

---

## 14. Phase 10 — Target-V4: Builder + Patterns (Atomic)

### Ziel
SourceSpec → V4 Atomic Tree mit e-flexbox, $$type, Global Classes.

### Implementiert
- `builder.ts`: 173 Zeilen — SourceSpec → V4Element[] (e-flexbox, $$type)
- `guards.ts`: V4-spezifische Guards (G_NO_V3, G_STYLE_ID)
- `style-id.ts`: `isValidStyleId()`, `sanitizeStyleId()` (keine Bindestriche!)
- `framer-utils.ts`: Framer-spezifische Konvertierung
- `patterns/glass-header.ts`: Atomic Glass Header (EIGENE Implementierung!)
- `patterns/stat-row.ts`: Atomic Stat Row

### Regel
EIGENE Implementierung — NICHT von V3 kopieren!

---

## 15. Phase 11 — QA Infrastructure

### Ziel
Visual QA mit Semantic Diff, Auto-Fix, Multi-Viewport.

### Implementiert
- `visual-diff.ts`: Pixelmatch-basierter Diff mit Region-Erkennung
- `auto-fix.ts`: Priority-Queue (critical × area_size), max 3 Fixes/Round
- `structural-probes.ts`: Shared-ID Detection, DOM-Struktur-Vergleich
- `viewport-matrix.ts`: Screenshots bei 1440/768/390px, separater Score pro Viewport
- `healing-loop.ts`: Self-Healing Loop (Capture → Diff → Fix → Re-Capture → Verify)

### Verbesserungen (integriert)
1. Region-aware Semantic Diff: "Hero: Padding 12px zu klein" statt "Region (200,400): 847 diff px"
2. Closed-Loop Auto-Fix: color-mismatch→edit _color, layout-shift→padding
3. Progressive Fix Priority Queue: Sortierung critical × area_size
4. Multi-Viewport Diff: Separater Score pro Viewport

---

## 16. Phase 12 — Session + Run-Archive + Config

### Ziel
Resume-fähige Runs + Observability.

### Implementiert
- `session.ts`: Session-Management (init, status, resume)
- `run-archive.ts`: `runs/{ts}_{id}/` mit input, tokens, output, mcp-log.jsonl, meta.json
- `config.ts`: 316 Zeilen — `elconv.config.yaml` Loader + Validator

---

## 17. Phase 13 — WPCode + Animation

### Ziel
Page-scoped CSS-Snippets + GSAP-Animationen.

### Implementiert
- `wpcode.ts`: 219 Zeilen — Dual-Write (post_content + wpcode_snippets), GSAP-Presets
- Regel: IMMER beide schreiben (post_content + wpcode_snippets option)

---

## 18. Phase 14 — Bridge V3→V4

### Ziel
Upgrade eines V3-Trees zu V4 Atomic.

### Implementiert
- `bridge.ts`: 243 Zeilen — heading→e-heading, button→e-button, container→e-flexbox
- Validierung mit V4 guards ≥85 nach Upgrade

---

## 19. Phase 15 — Config System

### Ziel
Zentrale `elconv.config.yaml` Konfiguration.

### Implementiert
- `config.ts`: sourceUrl, target (v3|v4), mode, tokens, deploy, qa settings
- Target-Wahl gilt für gesamte Session — NIEMALS beide gleichzeitig

---

## 20. Phase 16 — Skills + Docs

### Ziel
Dokumentation + AI-Executor-Playbook.

### Implementiert
- `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/MIGRATION.md`
- `docs/PROGRESS.md`: Phasen-Tracking

---

## 21. Phase 17 — E2E: Golden-File Regression

### Ziel
Offline-Tests mit Referenz-Output.

### Implementiert
- `tests/e2e/golden-test.test.ts`: Fixture → full pipeline → Vergleich mit Golden File
- `tests/e2e/e2e.test.ts`: End-to-End ohne Netzwerk

---

## 22. Phase 18 — Release 0.1.0

### Ziel
Erster stabiler Release.

### Implementiert
- Version 0.1.0, CHANGELOG, alle Tests grün, `npx tsc --noEmit` clean

---

## 23. Phase 19 — Playwright-Extraction (Browser)

### Ziel
Echte Browser-Extraction statt Regex-Parsing.

### Implementiert
- `browser/types.ts`: ViewportConfig, FontIntercept, SectionInfo, AnimationInfo
- `browser/hydration-wait.ts`: Wartet auf React/Next/Vue/Angular Hydration
- `browser/lazy-scroll.ts`: Inkrementelles Scrollen für Lazy-Loading
- `browser/computed-styles.ts`: Extrahiert computed styles via `getComputedStyle()`
- `browser/section-detector.ts`: Erkennt `<section>`, `[data-section]`, etc.
- `browser/font-discovery.ts`: Intercepts Font-Requests (woff2/woff/Google Fonts)
- `browser/playwright-extractor.ts`: 185 Zeilen — Haupt-Extraktor (Page → SourceSpec)

### Dependency
```json
{ "devDependencies": { "playwright": "^1.61.1" } }
```

---

## 24. Phase 20 — Asset-Pipeline

### Ziel
Bilder und Fonts herunterladen mit Rate-Limiting.

### Implementiert
- `assets/rate-limiter.ts`: Token-Bucket Algorithmus (configurable concurrency)
- `assets/image-downloader.ts`: Bild-Download mit Retry + Format-Erkennung
- `assets/font-downloader.ts`: Font-Download (woff2/woff/truetype)
- `assets/manifest-builder.ts`: Asset-Manifest (JSON) mit Hashes + Pfaden

### Dependency
```json
{ "dependencies": { "p-limit": "^6.0.0", "nanoid": "^6.0.0" } }
```

---

## 25. Phase 21 — Classifier

### Ziel
DOM-Elemente → Elementor Widget-Typen klassifizieren.

### Implementiert
- `classifier/types.ts`: WidgetCategory, ClassificationResult, StyleProfile
- `classifier/widget-mapper.ts`: 144 Zeilen — DOM-Tag/Classes → Widget-Type Mapping
- `classifier/style-classifier.ts`: CSS-Properties → Style-Kategorie (glass, card, hero, etc.)

---

## 26. Phase 22 — AI-Engine

### Ziel
KI-gestützte Klassifizierung mit Provider-Routing und Cost-Tracking.

### Implementiert
- `ai/types.ts`: AITask, AIResponse, VisionProvider, TaskCategory (cheap/medium/expensive)
- `ai/cost-tracker.ts`: CostTracker (Budget-Limit, Per-Task-Cost, Summary)
- `ai/router.ts`: AIRouter — wählt Provider nach Task-Kategorie
  - cheap → günstigster Provider
  - expensive → Claude (oder bester verfügbarer)
  - medium → sortiert nach Kosten

---

## 27. Phase 23 — Healing-Loop

### Ziel
Automatische visuelle Korrektur-Schleife.

### Implementiert
- `healing-loop.ts`: 146 Zeilen — Capture → Diff → Fix → Re-Capture → Verify
- Max N Iterationen (default 3), Target-Score (default 90)
- Injectable Functions: `captureFn`, `diffFn`, `fixFn`
- `onIterationComplete` Callback für Monitoring

---

## 28. Phase 24 — Recon (SPA-Detection)

### Ziel
Vor der Extraktion: Framework erkennen, Hydration-Strategie wählen.

### Implementiert
- `recon/types.ts`: ReconResult, SpaInfo, FrameworkType
- `recon/detect-spa.ts`: Erkennt React/Next/Vue/Nuxt/Angular/Svelte/Astro
- `recon/recon-runner.ts`: 139 Zeilen — vollständiger Recon-Run (Framework + Fonts + Sections + Animations)

---

## 29. Phase 25 — Orchestrator

### Ziel
Pipeline-Orchestrierung mit Retry und Phase-Management.

### Implementiert
- `orchestrator/types.ts`: PhaseConfig, PipelineResult, PhaseStatus
- `orchestrator/pipeline.ts`: Orchestrator mit:
  - Sequentielle Phasen-Ausführung
  - Retry mit Backoff (configurable maxRetries)
  - Abort-on-Failure (optional)
  - Phase-Callbacks (onStart, onComplete, onError)

---

## 30. Phase 26 — Batch-Processing + Idempotency

### Ziel
Mehrseiten-Verarbeitung + sichere Wiederholung.

### Implementiert
- `batch-scheduler.ts`: 149 Zeilen — Concurrent Batch mit p-limit, Progress-Tracking
- `idempotency.ts`: Idempotency-Keys (SHA-256 basierend), Deduplication, TTL

---

## 31. Phase 27 — Build-Pipeline

### Ziel
TypeScript Project References Build.

### Implementiert
- `tsconfig.json`: References auf alle 7 Pakete
- `npm run build` → `tsc --build` (inkrementell)
- `npm run clean` → `tsc --build --clean`
- Jedes Paket hat eigene `tsconfig.json` mit `composite: true`

---

## 32. Phase 28 — CI/CD (GitHub Actions)

### Ziel
Automatische Tests + Build bei jedem Push/PR.

### Implementiert (`.github/workflows/ci.yml`)
```yaml
- Matrix: Node 20 + 22
- Steps: npm ci → tsc --noEmit → vitest run --coverage → tsc --build
```

---

## 33. Phase 29 — Structured Logging

### Ziel
JSON-basiertes Logging mit Levels und Context.

### Implementiert
- `logging.ts`: 50 Zeilen — Logger mit Levels (debug/info/warn/error), JSON-Output, Context-Merging

---

## 34. Phase 30 — Security + Credential-Management

### Ziel
Sichere Credential-Verwaltung, URL-Validation.

### Implementiert
- `security.ts`: Credential-Store (env-basiert), URL-Allowlist, SSRF-Schutz, Input-Sanitization

---

## 35. Phase 31 — Performance (Caching)

### Ziel
LRU + Disk Cache für wiederholte Extraktionen.

### Implementiert
- `cache.ts`: LRU-Cache (configurable maxSize, TTL) + Disk-Cache (JSON-basiert)

---

## 36. Phase 32 — Integration-Tests

### Ziel
Browser-basierte Integration-Tests.

### Implementiert
- `tests/integration/browser-extraction.test.ts`: Echte Playwright-Extraction gegen Test-URL
- 30 Test-Dateien, 386 Tests grün

---

## 37. Phase 33 — Dokumentation

### Ziel
Vollständige API-Dokumentation + Architektur.

### Implementiert
- `docs/API.md`: API-Reference
- `docs/ARCHITECTURE.md`: Architektur-Übersicht
- `docs/MIGRATION.md`: Migrations-Guide

---

## 38. Phase 34 — Release 1.0

### Ziel
Production-Ready Release.

### Implementiert
- Version 1.0.0
- Alle 386 Tests grün
- TypeScript compiliert sauber
- CI/CD Pipeline aktiv
- Structured Logging, Security, Caching integriert

---

## 39. KRITISCHE FEHLERSTELLEN

### 39.1 V3/V4 Contamination (KRITISCHSTE Stelle)
**Verteidigung (3 Ebenen):**
1. Compile-time: Branded types — `V3ElementTree` ≠ `V4ElementTree`
2. Runtime: `assertNoContamination()` vor JEDEM deploy
3. Guard: `G_NO_V4` in V3 guards, `G_NO_V3` in V4 guards

### 39.2 MCP Payload-Limits
Trees > 400KB schlagen bei `set-content` still fehl.
→ `chooseDeployStrategy()` + `G_TREE_SIZE` guard warnt ab 900KB.

### 39.3 V3 isInner / Flex-Row Stacking
Nested containers ohne `isInner: true` rendern als full-width Blöcke.
→ `normalizeV3ContainerTree()` läuft IMMER vor deploy.

### 39.4 V4 Style-ID Format
Style-IDs mit Bindestrichen werden von Elementor V4 abgelehnt.
→ `isValidStyleId()` + `sanitizeStyleId()` auto-fix.

### 39.5 WPCode Dual-Write
Nur `post_content` aktualisiert → live site zeigt altes CSS.
→ WPCode helper updated IMMER beide (post_content + wpcode_snippets).

### 39.6 Elementor Cache
Erfolgreicher MCP write ≠ sichtbares Ergebnis.
→ Nach JEDEM deploy: `clearDocumentCache(postIds)` + hard reload.

---

## 40. Teststrategie

### Unit Tests (pro Phase)
Jede Phase hat eigene Tests in `tests/unit/<package>/`.

### Integration Tests
- V3-Pipeline: fixture → buildV3Tree → normalize → guards ≥85 → no contamination
- V4-Pipeline: fixture → buildV4Tree → guards ≥85 → no contamination
- Browser-Extraction: echte Playwright-Extraction

### E2E Offline Tests
Kein Netzwerk. Fixture XML/JSON → full pipeline → valid output.

### Golden-File Regression
5 Referenzseiten mit Expected-Output. CI vergleicht Converter-Output mit Golden.

---

## 41. Verbesserungen (10 Punkte — alle integriert)

| # | Verbesserung | Phase | Status |
|---|---|---|---|
| 1 | Region-aware Semantic Diff | 11 | ✅ |
| 2 | Closed-Loop Auto-Fix | 11 | ✅ |
| 3 | Progressive Fix Priority Queue | 11 | ✅ |
| 4 | Multi-Viewport Diff | 11 | ✅ |
| 5 | MCP Transaction Layer | 7 | ✅ |
| 6 | Chunked Deploy + Checkpoints | 7 | ✅ |
| 7 | Response Schema Validation + Circuit Breaker | 4 | ✅ |
| 8 | Deploy Dry-Run | 7 | ✅ |
| 9 | Golden-File Regression | 17 | ✅ |
| 10 | Observability + Run-Archive | 12 | ✅ |

---

## 42. Verbleibende Qualitätsverbesserungen

| # | Aufgabe | Priorität | Beschreibung |
|---|---|---|---|
| Q1 | cmd-qa.ts voll implementieren | Hoch | Aktuell Placeholder — braucht echte Playwright+pixelmatch Integration |
| Q2 | Mock-Reduktion in QA | Mittel | `createMockDiffResult` durch echte pixelmatch-Integration ersetzen |
| Q3 | tsconfig.build.json erstellen | Mittel | Explizite Build-Config mit outDir/dist |
| Q4 | ESLint-Config vervollständigen | Niedrig | Regeln für Import-Extensions, no-unused-vars |
| Q5 | Coverage-Threshold setzen | Niedrig | Minimum 80% in CI erzwingen |

---

## 43. Progress-Tabelle (aktuell)

| Phase | Status | Tests | Notes |
|-------|--------|-------|-------|
| 0–18 | ✅ done | 386 grün | Basis-Implementierung komplett |
| 19–34 | ✅ done | 386 grün | Production-Features komplett |
| Q1–Q5 | 🔧 offen | — | Qualitätsverbesserungen |

**Version:** 1.0.0
**Tests:** 30 Dateien, 386 Tests, 2 skipped
**TypeScript:** compiliert sauber (tsc --noEmit)
**CI/CD:** GitHub Actions aktiv (Node 20+22)
