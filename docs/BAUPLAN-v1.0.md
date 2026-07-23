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

## 43. Feature-Gap-Analyse: Fehlende Features aus den Quell-Repos

**Referenz-Repos:**
- `site-clone-to-v3` (151 Source-Dateien): CLI-Tool, Extractor, Analyzer, Classifier, QA, Builder, AI-Engine, Orchestrator, Contracts, Design-System, Validator
- `Framer-to-Elementor-V4-Pipeline` (25 Source-Dateien): Framer-XML Bridge, V4-Tree-Builder, CLI-Commands, Preflight, Preview, Promote

**Unified Converter:** 94 Source-Dateien in 7 Paketen (core, extractors, target-v3, target-v4, mcp, qa, cli)

### 43.1 Feature-Übersichtsmatrix

| Bereich | site-clone-to-v3 | Framer-V4 | unified | Abdeckung |
|---------|:---:|:---:|:---:|:---:|
| V3 Builder + Normalize + Guards | ✅ | — | ✅ | 100% |
| V4 Builder + Bridge + Guards | ✅ | ✅ | ✅ | 100% |
| MCP Transport (Adapter, Circuit-Breaker, Targets) | ✅ | ✅ | ✅ | 100% |
| Deploy (Transaction, Chunked, Preflight) | ✅ | ✅ | ✅ | 100% |
| Batch-Scheduler + Idempotency | ✅ | ✅ | ✅ | 100% |
| HTML-Parser + Framer-XML Extractor | ✅ | ✅ | ✅ | 100% |
| Design-Tokens (Basis) | ✅ | — | ✅ | 60% |
| Browser/Playwright Extraction | ✅ | — | ✅ | 50% |
| Asset-Pipeline (Rate-Limiter, Image/Font) | ✅ | — | ✅ | 60% |
| Recon (SPA-Detection, Recon-Runner) | ✅ | — | ✅ | 40% |
| Classifier (Widget-Mapper, Style-Classifier) | ✅ | — | ⚠️ | 25% |
| QA (Visual-Diff, Auto-Fix, Structural-Probes) | ✅ | — | ⚠️ | 30% |
| AI-Engine (Router, Cost-Tracker) | ✅ | — | ⚠️ | 20% |
| CLI (convert, deploy, doctor, qa, session) | ✅ | ✅ | ⚠️ | 50% |
| Orchestrator (Pipeline) | ✅ | — | ⚠️ | 30% |
| **Analyzer (Color, Font, Spacing, OKLCH)** | ✅ | — | ❌ | 0% |
| **AI Tasks (5 konkrete Tasks)** | ✅ | — | ❌ | 0% |
| **QA Diff-Engine (7 Module)** | ✅ | — | ❌ | 0% |
| **QA Extras (SSIM, HTML-Report, Acceptance)** | ✅ | — | ❌ | 0% |
| **Contracts (AI, Diff, Tokens, Shared)** | ✅ | — | ❌ | 0% |
| **Design-System (Adapter, Constraints)** | ✅ | — | ❌ | 0% |
| **Validator (JSON-Guard System)** | ✅ | — | ❌ | 0% |
| **Extractor Extras (Spec, Animation, Pseudo)** | ✅ | — | ❌ | 0% |
| **Scraper Extras (SVG, Favicon, Robots)** | ✅ | — | ❌ | 0% |
| **CLI Extras (Wizard, Pipeline, State)** | ✅ | ✅ | ❌ | 0% |
| **Recon Extras (Mutation, State, Animation)** | ✅ | — | ❌ | 0% |
| **Builder Extras (Animation, Multi-Column)** | ✅ | — | ❌ | 0% |
| **MCP Extras (V3→V4, WP-Push, Session)** | ✅ | — | ❌ | 0% |
| **Orchestrator Extras (Manager, Report)** | ✅ | — | ❌ | 0% |
| **Framer CLI (Preview, Promote, Serve)** | — | ✅ | ❌ | 0% |
| **Framer Types (Novamira, Common)** | — | ✅ | ❌ | 0% |

### 43.2 Detaillierte Gap-Beschreibungen nach Modul

#### GAP-A: Analyzer-Modul (8 Dateien, ~2000 LOC)
**Quelle:** `site-clone-to-v3/src/analyzer/` + `site-clone-to-v3/src/analysis/`
**Zielpaket:** `packages/core/src/analyzer/` oder `packages/extractors/src/analyzer/`

| Datei | Funktion | Beschreibung |
|-------|----------|-------------|
| `color-extractor.ts` | `extractColorFrequency()`, `clusterColors()`, `assignSemanticNames()` | Extrahiert alle CSS-Farben aus computed styles, clustert sie nach OKLCH-Distanz, weist semantische Namen zu (primary, accent, neutral). Basis für das gesamte Token-System. |
| `font-token-extractor.ts` | `extractFontTokens()`, `mostCommon()`, `resolveSource()` | Erkennt Font-Families, Weights, Sizes aus HTML-Tags (h1-h6, p, body, a). Gruppiert nach Häufigkeit. Liefert die Basis für Font-Kit-Integration. |
| `oklch-converter.ts` | `hexToRgb()`, `rgbToOklch()`, `formatOklchCss()` | OKLCH-Farbraum-Konvertierung. Wird von Color-Distance, Token-Constraints, und Design-System-Adapter verwendet. Löst das Hue-Wrap-Problem durch kartesische a/b-Koordinaten. |
| `spacing-extractor.ts` | `extractSpacingTokens()`, `detectSpacingScale()` | Erkennt Padding/Margin-Werte aus dem DOM und leitet eine konsistente Spacing-Scale ab (4px, 8px, 12px, 16px, 24px...). |
| `theme-detector.ts` | `detectTheme()` | Erkennt Dark/Light-Mode, Primary-Color-Palette, und Font-Pairing aus der extrahierten Seite. |
| `token-extractor.ts` | `extractTokens()` | Kombiniert Color + Font + Spacing Tokens in ein einheitliches `OklchColorToken`-Format mit hex, rgb, oklch, frequency, cssVar. |
| `token-resolver.ts` | `resolveToken()` | Löst CSS-Variable (`var(--primary)`) zu konkreten Werten auf. Verknüpft Design-Tokens mit den extrahierten Raw-Werten. |
| `design-token-extractor.ts` | `buildDesignTokens()` | Top-Level-Entry: Nimmt HTML + computed styles, liefert vollständige `DesignTokens` (colors[], fonts[], spacing[]). |
| `analysis/pipeline.ts` | `runPipeline()` | **7-Stage-Pipeline-Orchestrator**: Extract → Classify → Assets → Tokens → Build → Animations → QA. Verwaltet die gesamte Konvertierung. |
| `analysis/token-sync.ts` | `syncTokens()` | Synchronisiert Design-Tokens via MCP mit dem WordPress-Target (Customizer, Global-Colors, Font-Kit). |
| `analysis/token-mapping.ts` | `buildTokenMapping()` | Erstellt das Mapping zwischen extrahierten Tokens und V3/V4-Settings. |
| `analysis/font-kit-bridge.ts` | `syncFontsToKit()` | Push erkannte Fonts zum WordPress Font-Kit-Plugin via MCP. |

**Warum kritisch:** Ohne Analyzer gibt es kein Token-System. Der Builder muss dann alle Farben/Fonts/Spacing manuell setzen → Token-Drift, kein Re-Branding möglich, keine konsistente Design-Sprache.

---

#### GAP-B: AI-Tasks (5 Tasks, ~800 LOC)
**Quelle:** `site-clone-to-v3/src/ai-engine/tasks/`
**Zielpaket:** `packages/core/src/ai/tasks/`

| Datei | Funktion | Beschreibung |
|-------|----------|-------------|
| `component-detect.task.ts` | `runComponentDetectVision()` | Vision-basierte Komponentenerkennung. Nimmt Screenshot einer Section, klassifiziert sie als hero/features/pricing/etc. Delegiert an section-classify und reshaped das Ergebnis in `ComponentDetectionResult`. |
| `section-classify.task.ts` | `runSectionClassification()` | **Single Source of Truth** für Section-Klassifikation. Erstellt den Vision-Prompt, parst das JSON-Ergebnis, bewertet die Confidence. Wird von classifier/section-picker und classifier/detect-by-vision konsumiert. |
| `repair-block.task.ts` | `buildRepairBlockPrompt()`, `runRepairBlock()` | Sendet Original-Screenshot + Clone-Screenshot + Diff-Hotspot + Token-Constraints an die AI, damit sie einen konkreten Fix vorschlägt. Wichtig für die Healing-Loop. |
| `token-semantics.task.ts` | `runTokenSemantics()` | Bestimmt die semantische Rolle einer Farbe (primary/secondary/accent/neutral/background/text). Wichtig wenn CSS-Variablen keine aussagekräftigen Namen haben. |
| `vision-qa.task.ts` | `runVisionQA()`, `parseVisionQAResponse()`, `defaultClaudeVisionQaCall()` | **Kernstück des Vision-QA-Systems**. Vergleicht Original vs. CloneScreenshot, liefert Score 0-100, typisierte Issues, freier Kommentar. Enthält die einzige autorisierte Prompt-Formulierung und das einzige Response-Parsing — alle Call-Paths nutzen diese eine Implementierung. |

**Warum kritisch:** Der AIRouter existiert zwar, aber ohne konkrete Tasks kann er nichts tun. Die Tasks sind die Brücke zwischen generischem Router und domänenspezifischer AI-Nutzung.

---

#### GAP-C: Classifier-Extras (8 Dateien, ~1200 LOC)
**Quelle:** `site-clone-to-v3/src/classifier/`
**Zielpaket:** `packages/target-v3/src/classifier/`

Der unified converter hat bereits: `widget-mapper.ts`, `style-classifier.ts`, `types.ts`.
**Fehlend:**

| Datei | Funktion | Beschreibung |
|-------|----------|-------------|
| `component-detector.ts` | `detectComponentMultiLayer()` | **Multi-Layer-Komponentenerkennung**: Layer 1 = CSS-Klassen-Heuristiken (schnell, kostenlos), Layer 2 = Structural-Pattern-Matching (DOM-Struktur), Layer 3 = Vision-AI (teuer, nur bei niedriger Confidence). |
| `detect-by-structure.ts` | `detectByStructure()` | Erkennt Komponenten anhand der DOM-Struktur (z.B. `<ul>` mit `<li>` → logo-grid, `<div>` mit 3 gleichgroßen Kindern → features). |
| `detect-by-vision.ts` | `detectByVision()` | Delegiert Screenshot-Analyse an die AI (via AIRouter oder injizierbare VisionCallFn). Fallback wenn Struktur-Erkennung keine hohe Confidence hat. |
| `pro-detector.ts` | `detectElementorPro()` | Erkennt ob Elementor Pro auf dem Target verfügbar ist (Script-Marker, CSS-Klassen, Admin-Bar, Generator-Meta, REST-Endpoint). Wichtig für Widget-Degradation. |
| `responsive-settings.ts` | `buildResponsiveSettings()` | Erstellt V3-Settings mit `_tablet`/`_mobile`-Varianten aus Per-Viewport-Computed-Styles. Nur Properties die sich unterscheiden bekommen responsive Varianten (verhindert Verbose-Output). |
| `section-picker.ts` | `pickSections()`, `autoPick()`, `classifyAll()` | **Top-Level-Orchestrator für Section-Klassifikation**: Interaktive ASCII-Tabelle für User-Selection, Auto-Pick für CI-Mode (filtert Cookie-Banner, Modals, Chat-Widgets), und `classifyAll()` für Batch-Klassifikation mit Style-Classifier + Component-Detector + Widget-Mapper + Token-Resolver + Responsive-Settings. |
| `widget-degradation.ts` | `degradeProWidgets()` | Löst Pro-only Widgets durch Free-Fallbacks (text-editor/html) wenn kein Elementor Pro verfügbar. Record aller Degradationen für Transparenz. |
| `widget-validator.ts` | `validateWidgets()` | Pre-Build-Validierung: Fehlen Required-Settings? Unbekannte Widget-Typen? Pro-Widgets auf Non-Pro-Targets? Waisen-Asset-Referenzen? |
| `token-resolver.ts` | `resolveColorToken()`, `resolveFontRole()` | Löst einen extrahierten Farbwert zu einem semantischen Token-Namen auf (oder umgekehrt). Verknüpft Analyzer-Tokens mit Classifier-Output. |

**Warum kritisch:** Ohne diese Extras ist der Classifier nur ein einfacher Widget-Mapper. Die Multi-Layer-Erkennung, Pro-Detection, Responsive-Settings und Widget-Validierung sind essentiell für production-quality Output.

---

#### GAP-D: QA Diff-Engine (7 Dateien, ~600 LOC)
**Quelle:** `site-clone-to-v3/src/qa/diff/`
**Zielpaket:** `packages/qa/src/diff/`

| Datei | Funktion | Beschreibung |
|-------|----------|-------------|
| `block-diff.ts` | `diffByBlocks()` | **Section-aware pixelmatch**: Statt whole-page-Diff wird pro Section ein eigener pixelmatch durchgeführt. Verhindert dass ein schlechter Section-Score im Gesamt-Score verwässert wird. Erkennt Hotspot-Regionen mit 8x8-Grid. |
| `color-distance.ts` | `colorDistanceOklch()`, `colorsAreEqual()` | Perzeptuelle Farb-Distanz in OKLCH. Löst das Hue-Wrap-Problem (359°/0°) durch kartesische a/b-Koordinaten. Wird vom pixelmatch-Scoring und Token-Snapping verwendet. |
| `heatmap.ts` | `generateHeatmap()` | Überlagert ein pixelmatch-Diff-Bild halbtransparent über den Original-Screenshot → visuelles Debugging. Nutzt sharp für Compositing. |
| `ignore-regions.ts` | `applyIgnoreMask()` | Maskiert dynamische Inhalte (Karussells, Timestamps, Ads) vor dem Diffing. Verhindert False-Positives bei Screenshots die zu unterschiedlichen Zeitpunkten aufgenommen wurden. |
| `animated-disable.ts` | `disableAnimations()` | Injiziert CSS das alle Animationen/Transitions killt vor dem Screenshot. Verhindert dass ein Diff fehlschlägt weil Original und Clone zu unterschiedlichen Zeitpunkten mid-animation erwischt wurden. |
| `multi-viewport.ts` | `diffMultiViewport()` | Aggregiert Block-Diffs über alle Viewports (mobile, tablet, desktop, wide). Ein Clone der auf Desktop OK aussieht aber auf Mobile bricht, bekommt keinen Passing-Score. |
| `dimensions.ts` | `resizeToSameSize()`, `cropPngSafe()` | Bugfix: Resize unterschiedlich großer Screenshots auf ein gemeinsames Format via sharp (fit: 'fill'). Verhindert dass DPR/Zoom-Unterschiede den Score korrumpieren. |

**Warum kritisch:** Die bestehende `visual-diff.ts` im unified converter ist ein Mock. Ohne die echte Diff-Engine gibt es kein pixelgenaues QA.

---

#### GAP-E: QA Extras (8 Dateien, ~1000 LOC)
**Quelle:** `site-clone-to-v3/src/qa/`
**Zielpaket:** `packages/qa/src/`

| Datei | Funktion | Beschreibung |
|-------|----------|-------------|
| `ssim.ts` | `computeSsim()` | **Structural Similarity Index** (SSIM) via ssim.js + pngjs. Alternative zum pixelmatch-Diff — erkennt strukturelle Ähnlichkeit statt nur Pixel-Differenz. |
| `html-report.ts` | `generateHtmlReport()` | Generiert einen visuellen HTML-Report mit Original/Clone/Diff-Screenshots, Issue-Liste, Score, Strictness-Profil. Für menschliche QA-Review. |
| `acceptance.ts` | `runAcceptanceChecks()` | **Acceptance-Kriterien-Checker**: Prüft ob alle Sections deployed sind, ob Responsive-Settings stimmen, ob keine Pro-Widgets auf Free-Targets, ob Asset-Referenzen gültig. |
| `cross-validator.ts` | `crossValidate()` | Validiert V3-Output gegen V4-Output (oder umgekehrt). Stellt sicher dass beide Targets semantisch äquivalent sind. |
| `issue-detector.ts` | `detectIssues()` | Analysiert Diff-Regions und klassifiziert sie in Issue-Typen (color-mismatch, layout-shift, font-missing, size-mismatch, image-broken, animation-inactive, blank-region, size-different, missing-texture). |
| `strictness.ts` | `STRICTNESS_PROFILES` | Definiert Strictness-Profile: draft (70%, 1 Runde), balanced (85%, 2 Runden), pixel-perfect (95%, 3 Runden). Steuert wie aggressiv die Healing-Loop fixt. |
| `pixel-element-resolver.ts` | `buildPixelElementResolver()` | Mappt Pixel-Regionen aus dem Diff auf Elementor-Element-IDs (sectionId, widgetId) aus dem Build-Artefakt (page-v3.json). Notwendig damit Auto-Fix die richtigen MCP-Calls macht. |
| `real-fixers.ts` | `buildDefaultFixers()` | **Echte MCP-basierte Fixer**: color-mismatch → edit-element (_background_color), font-missing → execute-php (fonts register), layout-shift → edit-element (padding/margin), image-broken → upload_asset + edit-element. Mit DRY-RUN-Fallback. |
| `vision-qa.ts` | `runVisionQa()` | Vision-QA via Anthropic Claude Vision API. Vergleicht Original vs. Clone-Screenshots semantisch (nicht nur pixel). Delegiert an ai-engine/tasks/vision-qa.task.ts für Prompt + Parsing. |

**Warum kritisch:** Ohne QA-Extras gibt es kein automatisches Feedback. Die Healing-Loop braucht issue-detector, strictness, real-fixers und pixel-element-resolver um sinnvoll zu funktionieren.

---

#### GAP-F: Contracts (4 Dateien, ~400 LOC)
**Quelle:** `site-clone-to-v3/src/contracts/`
**Zielpaket:** `packages/core/src/contracts/`

| Datei | Funktion | Beschreibung |
|-------|----------|-------------|
| `ai.contract.ts` | `AIRouter`, `VisionProvider`, `VisionQAResult`, `RepairBlockInput`, `RepairResult`, `ComponentDetectionResult`, `RunVisionQAFn` | **Typ-Verträge für AI-Subsystem**. Definiert die Schnittstellen die AI-Tasks, Router und Consumer verwenden. Agent A's Verantwortlichkeit. |
| `diff.contract.ts` | `BlockDiffResult`, `IgnoreRegion`, `MultiViewportReport`, `BBox` | Typ-Verträge für das Diff-System. Wird von block-diff, ignore-regions, multi-viewport konsumiert. |
| `shared.contract.ts` | `BBox`, `ScreenshotInput`, `ViewportScreenshot` | Geteilte Typen die von mehreren Contracts verwendet werden. |
| `tokens.contract.ts` | `TokenConstraintSet`, `OklchColorToken`, `SpacingToken`, `FontToken`, `ColorMatch` | **Design-Token-Constraint-System**. Definiert wie Tokens strukturiert sind. Wird von Analyzer, Design-System-Adapter, AI-Tasks (repair-block), und Token-Constraints verwendet. |

**Warum kritisch:** Contracts sind die Schnittstellen-Definitionen die alle Module verbinden. Ohne sie gibt es keine Typ-Sicherheit zwischen den Subsystemen.

---

#### GAP-G: Design-System (2 Dateien, ~500 LOC)
**Quelle:** `site-clone-to-v3/src/design-system/`
**Zielpaket:** `packages/core/src/design-system/`

| Datei | Funktion | Beschreibung |
|-------|----------|-------------|
| `design-tokens-adapter.ts` | `designTokensToConstraintSet()` | **Bridge** zwischen Analyzer-Output (DesignTokens) und Token-Constraint-System (TokenConstraintSet). Konvertiert Color-Tokens zu OklchColorTokens, baut FontToken-Array, leitet Spacing-Scale ab. |
| `token-constraint.ts` | `buildConstraintSet()`, `detectColorScale()`, `detectSpacingScale()`, `snapColorToScale()` | **Modul S1**: Constrains den Builder auf ein kuratiertes, dedupliziertes Token-Set. Verhindert Token-Drift (50 ähnliche Blautöne → 1 konsistentes Palette). Distance-Berechnung in OKLCH mit kartesischer Konvertierung. |

**Warum kritisch:** Ohne Token-Constraints produziert der Builder inkonsistente Designs. 50 ähnliche Blautöne werden zu 50 verschiedenen Hex-Werten im Elementor JSON.

---

#### GAP-H: Validator (2 Dateien, ~600 LOC)
**Quelle:** `site-clone-to-v3/src/validator/`
**Zielpaket:** `packages/core/src/validator/`

| Datei | Funktion | Beschreibung |
|-------|----------|-------------|
| `json-guard.ts` | `runV3Guards()`, `runV4Guards()`, `runGuards()`, `formatGuardReport()` | **Pre-Push-Validierung**: Score-basiertes Guard-System (critical = -20pts, warning = -5pts, pass ≥ 85/100). Prüft V3: Container-Normalize, Flex-Row-Stack-Risks, Nested-Containers. Prüft V4: $$type-Konsistenz, Atomic-Structure. |
| `index.ts` | Re-exports | Öffentliche API. |

**Warum kritisch:** Ohne Validator können fehlerhafte Element-Trees gepusht werden die im Frontend still scheitern.

---

#### GAP-I: Extractor Extras (9 Dateien, ~1000 LOC)
**Quelle:** `site-clone-to-v3/src/extractor/`
**Zielpaket:** `packages/extractors/src/`

| Datei | Funktion | Beschreibung |
|-------|----------|-------------|
| `extract-pipeline.ts` | `runExtractPipeline()` | **V2-Extraction-Pipeline**: robots.txt → Rate-Limit → Playwright → Asset-Download → Section-Merge → Spec-Build. Orchestriert die gesamte Extraktion. |
| `spec-builder.ts` | `buildPageSpec()` | Konvertiert DOM-Extraktion + Assets in ein `PageSpec` (Section-Kind-Klassifikation, Widget-Spec-Generierung). |
| `spec-md-writer.ts` | `writeSpecMarkdown()` | Schreibt die PageSpec als menschenlesbares Markdown-Dokument. Für Debugging und Review. |
| `responsive-matrix.ts` | `buildResponsiveMatrix()`, `writeResponsiveMatrix()` | Erstellt eine Property-Matrix die zeigt welche CSS-Properties sich über Viewports ändern. |
| `pseudo-state-capture.ts` | `capturePseudoStates()` | Captured :hover/:focus/:active Computed-Style-Diffs via `getComputedStyle(el, ':hover')`. Wichtig für Button-Hover, Link-Focus etc. |
| `animation-property-extractor.ts` | `extractAnimationProperties()` | Extrahiert granulare `animation-*` und `transition-*` Properties von jedem Element. Ergänzt keyframes-discovery. |
| `custom-property-extractor.ts` | `extractCustomProperties()` | Auto-Discovery aller `--*` Custom Properties auf `:root`/`:host`. Essential für Tailwind/CSS-Vars-Design-Systeme. |
| `keyframes-discovery.ts` | `discoverKeyframes()` | Entdeckt @keyframes + transition-Properties via document.styleSheets + Route-Intercept für Cross-Origin-CSS. |
| `browserbase-extractor.ts` | `extractFromBrowserbase()` | Drop-in Playwright-Ersatz für Cloud-Browser (Browserbase). Wenn lokaler Playwright die Ziel-URL nicht erreichen kann. |

**Warum kritisch:** Ohne diese Extras fehlt die gesamte V2-Pipeline, Animation-Erkennung, Pseudo-State-Capture, und Custom-Property-Discovery.

---

#### GAP-J: Scraper Extras (3 Dateien, ~400 LOC)
**Quelle:** `site-clone-to-v3/src/scraper/`
**Zielpaket:** `packages/extractors/src/assets/`

| Datei | Funktion | Beschreibung |
|-------|----------|-------------|
| `robots-check.ts` | `checkRobotsTxt()` | Pars robots.txt, prüfe ob URL erlaubt ist. Konservativ: 404 = erlaubt, explizit disallowed = blockiert. |
| `svg-downloader.ts` | `downloadSvgs()` | Inline-SVGs aus DOM als separate Dateien extrahieren + externe SVG-URLs herunterladen. Deduplizierung per sha256. |
| `favicon-og-downloader.ts` | `downloadFavicons()`, `downloadOgImages()` | Favicon + Open-Graph-Bilder herunterladen. Wichtig für vollständigen Asset-Clone. |

**Warum kritisch:** SVGs und Favicons fehlen komplett im aktuellen Asset-Pipeline. Robots-Check ist für ethical scraping essentiell.

---

#### GAP-K: CLI Extras (10 Dateien, ~1500 LOC)
**Quelle:** `site-clone-to-v3/src/cli/` + `Framer-V4/src/cli/`
**Zielpaket:** `packages/cli/src/`

| Datei | Funktion | Beschreibung |
|-------|----------|-------------|
| `wizard.ts` | `runWizard()` | **Interaktiver Wizard**: Sammelt Konfiguration vom User (URL, Target, Viewports, Strictness) bevor die Pipeline startet. |
| `prompts.ts` | `promptUser()` | User-Prompts für interaktive Entscheidungen (Section-Auswahl, Token-Review, etc.). |
| `pipeline-runner.ts` | `runPipelineWithState()` | Wrapper um `runPipeline()` mit CloneState-Integration, Resume-Support, chalk-Progress-Reporting, Error-Recovery. |
| `state-manager.ts` | `saveState()`, `markCompleted()`, `markFailed()`, `isPhaseDone()` | Verwaltet den Pipeline-State (phase status, artifacts, errors). Ermöglicht Resume nach Fehlern. |
| `incremental.ts` | `runIncrementalBuild()` | **Incremental Build**: Bei Source-Änderungen nur geänderte Sections neu bauen. Nutzt Section-Content-Hashes. |
| `dry-run.ts` | `runDryRun()` | Generiert Build-Specs OHNE MCP-HTTP-Calls. Für CI/CD-Validierung "would this build run?". |
| `diff-only.ts` | `loadExtractionResult()`, `snapshotSections()` | Hilfsfunktionen für Diff-Berechnung zwischen Extraktionen. |
| `changelog-generator.ts` | `generateChangelog()` | Generiert Markdown-Changelog aus Conventional-Commit-History. |
| `update-checker.ts` | `checkForUpdates()` | Prüft ob eine neuere Version des Tools verfügbar ist (npm registry). Mit Cache. |
| `v3v4-diff.ts` | `diffV3V4()` | Vergleicht V3-Output mit V4-Output semantisch. |

**Framer-V4-spezifisch:**

| Datei | Funktion | Beschreibung |
|-------|----------|-------------|
| `cmd-preview.ts` | `cmdPreview()` | Erstellt eine lokale Vorschau des konvertierten Elements. |
| `cmd-promote.ts` | `cmdPromote()` | Befördert draft → publish nach erfolgreicher QA. |
| `cmd-serve.ts` | `cmdServe()` | Lokaler Dev-Server für Preview. |
| `cmd-batch.ts` | `cmdBatch()` | Batch-Verarbeitung mehrerer URLs. |
| `health.ts` | `checkHealth()` | System-Gesundheitscheck (WP erreichbar? MCP verfügbar? Elementor installiert?). |
| `replay.ts` | `replayRun()` | Replay einer früheren Konvertierung aus dem Run-Archive. |
| `build-report.ts` | `generateBuildReport()` | HTML-Build-Report mit Post-ID, Trace, Validation, QA-Ergebnissen. |

**Warum kritisch:** Ohne CLI-Extras gibt es keinen interaktiven Workflow, kein Resume, keinen Incremental-Build, keinen Dry-Run.

---

#### GAP-L: Recon Extras (3 Dateien, ~500 LOC)
**Quelle:** `site-clone-to-v3/src/recon/`
**Zielpaket:** `packages/extractors/src/recon/`

| Datei | Funktion | Beschreibung |
|-------|----------|-------------|
| `mutation-observer.ts` | `MutationObserver` (installierbar) | Event-driven DOM-Mutations-Capture (attributChanges, childList, subtree). Ersetzt V1's 250ms-Polling. |
| `state-capture.ts` | `buildStateSnapshot()` | Konvertiert MutationObserver + Animation-Event-Records in strukturierte StateSnapshots mit Before/After-Attributwerten und Computed-Style-Diffs. |
| `animation-events.ts` | `AnimationEventCapture` | Captured CSS-Animation-Events (animationstart, animationend, transitionrun) für die Recon-Pipeline. |

**Warum kritisch:** Ohne diese Extras kann der Converter keine interaktiven Zustände erfassen (z.B. was passiert nach einem Klick, welche Animationen laufen ab).

---

#### GAP-M: Builder Extras (3 Dateien, ~600 LOC)
**Quelle:** `site-clone-to-v3/src/builder/`
**Zielpaket:** `packages/target-v3/src/`

| Datei | Funktion | Beschreibung |
|-------|----------|-------------|
| `animation-injector.ts` | `buildAnimationPlan()`, `writeAnimationPlan()` | Erstellt einen WPCode-Snippet-Plan für CSS-Animationen und Keyframes. Generiert die CSS-Regeln die auf dem WordPress-Target injiziert werden müssen. |
| `v3-multi-column.ts` | `buildMultiColumnLayout()` | Erkennt und rekonstruiert Multi-Column-Layouts aus der extrahierten DOM-Struktur. Mappt CSS-Grid/Flexbox auf V3-Column-Struktur. |
| `v3-container-normalize.ts` | `normalizeV3ContainerTree()` | **Kritisch**: Normalisiert den V3-Container-Tree (section → column → widget). Findet Flex-Row-Stack-Risks und Nested-Containers die `isInner` brauchen. Wird vom Validator und WP-Push verwendet. |

**Warum kritisch:** Ohne Animation-Injector fehlen alle CSS-Animationen im Output. Ohne Container-Normalize ist der V3-Tree invalide.

---

#### GAP-N: MCP Extras (6 Dateien, ~800 LOC)
**Quelle:** `site-clone-to-v3/src/mcp/`
**Zielpaket:** `packages/mcp/src/`

| Datei | Funktion | Beschreibung |
|-------|----------|-------------|
| `wp-push.ts` | `wpPush()` | **WordPress Push**: Injiziert den kompletten V3-Element-Tree via MCP (elementor-inject-calibrated-page). Kritisch: NIEMALS batch-build-page für V3 verwenden (ignoriert nested elements). |
| `convert-page-v3-to-v4.ts` | `convertPageV3ToV4()` | Konvertiert einen bereits gepushten V3-Tree zu V4-Atomic-Widgets via MCP-Ability. |
| `upgrade-v4.ts` | `upgradeV4()` | V4-Upgrade-Stage: Konvertiert V3 → V4 nach erfolgreichem Push + QA. |
| `phase10-call-orchestrator.ts` | `orchestrateCalls()` | MCP-Call-Orchestrator mit Circuit-Breaker, Batch-Scheduling, Failure-Classification (transient vs permanent). |
| `phase10-indirection.ts` | `routeOperation()` | Ability-Indirection-Layer: Mappt Builder-Operationen auf MCP-Ability-Namen via Route-Table. Berechnet deterministische Idempotency-Keys. |
| `phase10-session.ts` | `mcpSessionHandshake()` | MCP-Session-Handshake + Capability-Exchange + Auto-Reconnect (exponential backoff). |

**Warum kritisch:** Ohne MCP-Extras gibt es keinen WP-Push, keine V3→V4-Konvertierung, keine Session-Verwaltung.

---

#### GAP-O: Orchestrator Extras (3 Dateien, ~600 LOC)
**Quelle:** `site-clone-to-v3/src/orchestrator/`
**Zielpaket:** `packages/core/src/orchestrator/`

| Datei | Funktion | Beschreibung |
|-------|----------|-------------|
| `phase-orchestrator.ts` | `runPhaseOrchestrator()` | **Top-Level-Orchestrator**: Phase 0 (Pre-Flight) → Phase 1+2 (Per-Section via Manager) → Phase 3 (Assembly) → Phase 4 (Builder) → Phase 5 (QA). Mit Retry-Loop (max 3) und Graceful-Degradation. |
| `manager-workflow.ts` | `runManagerWorkflow()` | Per-Section-Pipeline: State-Snapshot → Section-Verarbeitung → State-Reconciliation. Max 4 Iterationen, Drift-Detection. |
| `run-report.ts` | `generateRunReport()` | Generiert einen strukturierten Report nach einem Pipeline-Run (Dauer, Fehler, Artefakte, Score). |

**Warum kritisch:** Der bestehende Orchestrator ist eine Basis. Für die vollständige Pipeline mit Retry, Drift-Detection und Run-Reports braucht es diese Extras.

---

#### GAP-P: Framer-V4-spezifische Typen und Bridge (3 Dateien, ~400 LOC)
**Quelle:** `Framer-to-Elementor-V4-Pipeline/src/`
**Zielpaket:** `packages/target-v4/src/` und `packages/extractors/src/`

| Datei | Funktion | Beschreibung |
|-------|----------|-------------|
| `types/framer.ts` | `ParsedFontPrefix`, `UnframerBridgeOptions`, `FramerExport` | Framer-spezifische Typen: Font-Parsing, Unframer-Bridge-Optionen, Export/Component-Typen. |
| `types/novamira.ts` | `McpConfigResult`, `McpBridgeOptions`, `WpRestTypes` | Novamira-MCP-Server-Typen: Config, Bridge-Optionen, WordPress-REST-API-Typen. |
| `types/common.ts` | `TokenMapping`, `StructuralHashOptions` | Geteilte Typen zwischen Framer und Elementor. |
| `extractor/unframer-bridge.ts` | `UnframerBridge` | Brücke zum Unframer MCP-Server: getProjectXml, getNodeXml(section). Mit Circuit-Breaker, Idempotency, Batch-Scheduler-Integration. |
| `converter/framer-utils.ts` | `normalizeHex()`, `WEIGHT_MAP`, `structuralHash()` | Farb-Utilities (normalize, distance), Font-Weight-Mapping, Structural-Hash für Deduplizierung. (Teilweise schon in target-v4/framer-utils.ts) |
| `converter/v4-tree-builder.ts` | `buildAtomicContainer()`, `buildAtomicWidget()`, `buildStyleClass()` | **V4-Atomic-Tree-Konstruktion**: 3 Pure-Functions für Container, Widget, und Style-Class-Building. (Teilweise schon in target-v4/builder.ts) |

**Warum kritisch:** Framer-spezifische Typen und die Unframer-Bridge fehlen komplett. Ohne sie kann der Converter keine Framer-Projekte verarbeiten.

---

### 43.3 Implementierungs-Priorisierung

Die Gaps sind nach Abhängigkeiten sortiert. Jede Phase baut auf der vorherigen auf.

| Phase | Gap | Dateien | Dependencies | Priorität |
|-------|-----|---------|-------------|----------|
| **35** | C: Contracts | 4 | Keine — rein typisch | **Kritisch** (alle anderen Module dependieren darauf) |
| **36** | A: Analyzer | 12 | Contracts (C) | **Kritisch** (Token-System-Basis) |
| **37** | G: Design-System | 2 | Analyzer (A), Contracts (C) | **Kritisch** (Token-Constraints) |
| **38** | B: AI-Tasks | 5 | Contracts (C), AI-Router (existiert) | **Hoch** |
| **39** | D: QA Diff-Engine | 7 | Contracts (C), Analyzer (A) | **Hoch** |
| **40** | E: QA Extras | 9 | Diff-Engine (D), AI-Tasks (B) | **Hoch** |
| **41** | H: Validator | 2 | V3-Builder (existiert), V4-Builder (existiert) | **Hoch** |
| **42** | I: Extractor Extras | 9 | Contracts (C) | **Hoch** |
| **43** | J: Scraper Extras | 3 | Keine | **Mittel** |
| **44** | M: Builder Extras | 3 | V3-Builder (existiert) | **Mittel** |
| **45** | F: Classifier Extras | 8 | AI-Tasks (B), Analyzer (A), Pro-Detector | **Mittel** |
| **46** | L: Recon Extras | 3 | Keine | **Mittel** |
| **47** | N: MCP Extras | 6 | V3-Builder, V4-Builder | **Mittel** |
| **48** | O: Orchestrator Extras | 3 | Pipeline (existiert), alle vorherigen | **Mittel** |
| **49** | K: CLI Extras | 17 | Pipeline, State, alle vorherigen | **Niedrig** |
| **50** | P: Framer Types/Bridge | 6 | Framer-XML (existiert) | **Niedrig** |

### 43.4 Geschätzter Umfang

| Metrik | Aktuell | Nach allen Gaps | Delta |
|--------|---------|----------------|-------|
| Source-Dateien | 94 | ~200 | +106 |
| Zeilen Code | ~9.000 | ~22.000 | +13.000 |
| Tests (geschätzt) | 386 | ~700 | +314 |
| Pakete | 7 | 7 (keine neuen) | 0 |

### 43.5 Zusammenfassung: Was die unified-converter NICHT hat

1. **Kein Token-System** — keine Farb-/Font-/Spacing-Extraktion, kein OKLCH, keine Constraints
2. **Keine AI-Tasks** — Router existiert aber kann nichts tun
3. **Kein pixelgenaues QA** — visual-diff ist Mock, keine Diff-Engine, kein SSIM, kein HTML-Report
4. **Kein interaktiver Workflow** — kein Wizard, kein Resume, kein Incremental-Build, kein Dry-Run
5. **Kein WP-Push** — MCP-Transport existiert aber keine WP-spezifischen Operations
6. **Keine Animation-Erkennung** — keine Keyframes, keine Transitions, keine Pseudo-States
7. **Kein Validator** — kein Pre-Push-Guard-System
8. **Keine Framer-Bridge** — keine Unframer-Integration, keine Framer-Typen
9. **Kein Design-System** — keine Token-Constraints, keinen Adapter
10. **Keine Contracts** — keine Typ-Verträge zwischen Subsystemen

---

## 44. Progress-Tabelle (aktuell)

| Phase | Status | Tests | Notes |
|-------|--------|-------|-------|
| 0–18 | ✅ done | 386 grün | Basis-Implementierung komplett |
| 19–34 | ✅ done | 386 grün | Production-Features komplett |
| 35–50 | ❌ offen | — | Feature-Gaps aus Quell-Repos |
| Q1–Q5 | 🔧 offen | — | Qualitätsverbesserungen |

**Version:** 1.0.0 (Basis) → 2.0.0 (nach Gap-Schließung)
**Tests:** 30 Dateien, 386 Tests, 2 skipped
**TypeScript:** compiliert sauber (tsc --noEmit)
**CI/CD:** GitHub Actions aktiv (Node 20+22)
