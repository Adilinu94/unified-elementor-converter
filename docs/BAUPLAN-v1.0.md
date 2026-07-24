# Bauplan v1.0 — Unified Elementor Converter (Phase 0–50)

**Status:** Verbindliche Spezifikation. Vollständiges Projekt von Phase 0 bis Release 2.0 (vollständige Feature-Parität mit beiden Quell-Repos).
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

## 43. Integrations-Strategie: Vollständige Portierung aller Quell-Repo-Features

**Ziel dieses Abschnitts (BINDEND):** Der unified-elementor-converter soll am Ende ALLE Funktionen beider Quell-Repos eigenständig enthalten — nicht nur das Gerüst. Dieser Abschnitt ist keine reine Analyse mehr, sondern eine **verbindliche Implementierungsstrategie**: Jede fehlende Komponente wird aus dem jeweiligen Quell-Repo **portiert und an die Monorepo-Architektur angepasst** (kopieren → Imports umbiegen → Tests mitnehmen). Es wird NICHTS neu erfunden, das bereits existiert.

**Referenz- und Quell-Repos (Portierungs-Quelle, NICHT Runtime-Dependency):**
- `site-clone-to-v3` (151 Source-Dateien): CLI-Tool, Extractor, Analyzer, Classifier, QA, Builder, AI-Engine, Orchestrator, Contracts, Design-System, Validator
- `Framer-to-Elementor-V4-Pipeline` (25 Source-Dateien): Framer-XML Bridge, V4-Tree-Builder, CLI-Commands, Preflight, Preview, Promote

**Ausgangslage Unified Converter:** 94 Source-Dateien in 7 Paketen (core, extractors, target-v3, target-v4, mcp, qa, cli).
**Zielzustand:** ~200 Source-Dateien, vollständige Feature-Parität, alle 16 GAP-Kategorien (A–P) integriert und getestet.

> **Wichtig:** Abschnitte 43.1 (Matrix) und 43.2 (Gap-Beschreibungen) beschreiben **WAS** fehlt. Abschnitte 43.3–43.7 beschreiben **WIE** es portiert wird (Phasen 35–50). Die Buchstaben A–P sind in 43.2 verbindlich definiert und werden in den Phasen exakt so referenziert.

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

### 43.3 Portierungs-Strategie (verbindliche Grundregeln)

Diese 10 Regeln gelten für JEDE Phase 35–50. Sie machen aus „Dokumentation“ echte Integration.

1. **Kopieren statt neu erfinden.** Jede fehlende Datei existiert bereits in einem Quell-Repo (Pfade siehe 43.2). Grundoperation pro Datei: *Quelldatei kopieren → Imports umbiegen → Test mitkopieren*. Bestehende Logik NICHT umschreiben.
2. **ESM/`.js` bleibt.** Beide Quell-Repos nutzen bereits `"type":"module"` + `.js`-Import-Extensions — identisch zur Monorepo-Konvention. Import-Syntax NICHT ändern.
3. **Import-Remapping (Cross-Package).** Quelle nutzt relative Pfade (`../../contracts/diff.contract.js`). Regel: Ziel im selben Paket → relativ lassen; Ziel in anderem Paket → auf `@elconv/<paket>` umbiegen. Mapping:
   - `contracts/*`, `analyzer/*`, `analysis/*`, `design-system/*`, `validator/*`, `ai-engine/*`, `orchestrator/*`, `lib/*` → **`@elconv/core`**
   - `qa/*`, `qa/diff/*` → **`@elconv/qa`**
   - `extractor/*`, `scraper/*`, `recon/*` → **`@elconv/extractors`**
   - `classifier/*`, `builder/*` (V3) → **`@elconv/target-v3`**
   - `converter/*`, V4-Tree-Builder → **`@elconv/target-v4`**
   - `mcp/*` → **`@elconv/mcp`**
   - `cli/*` → **`@elconv/cli`**
4. **Paket-Grenzen (VERBOTEN, vgl. 1.2).** `target-v3` darf NIE aus `target-v4` importieren (und umgekehrt). Alles was V3 UND V4 brauchen (Contracts, Tokens, OKLCH, color-distance) gehört in `@elconv/core`. Im Zweifel: nach core.
5. **Branded Types.** V3-Trees als `V3ElementTree`, V4 als `V4ElementTree` (aus `@elconv/core` branded-types). Wo die Quelle rohe Typen nutzt, an der Builder-Grenze branden/casten.
6. **Determinismus.** Jede portierte Datei mit ID-Zählern exportiert `resetXxxIds()` und ruft es in Tests im `beforeEach()`.
7. **Tests mitportieren.** Zu jeder `x.ts` die zugehörige `x.test.ts`/Spec aus dem Quell-Repo mitnehmen und Import-Pfade anpassen. Fehlt ein Test → mindestens 1 Happy-Path + 1 Edge-Case neu schreiben.
8. **npm-Deps ergänzen.** Fehlende Runtime-Deps (`pixelmatch`, `pngjs`, `sharp`, `ssim.js`, `chalk`, `commander` usw. — siehe 43.5) in die `package.json` des Ziel-Pakets aufnehmen, danach `npm install` an der Workspace-Root.
9. **Index-Re-Exports.** Jede neue Datei über `packages/<paket>/src/index.ts` öffentlich exportieren.
10. **Phase-DoD (bindend, vgl. 1.3).** `npm test` exit 0 · `npx tsc --noEmit` exit 0 · keine Contamination · 1 Commit pro Phase (`feat(<paket>): port GAP-X – <name>`).

**Standard-Ablauf pro Datei (Checkliste):**
```
[ ] Quelldatei aus 43.2-Pfad kopieren
[ ] Cross-Package-Imports gemäß Regel 3 umbiegen
[ ] Branded Types / resetIds prüfen (Regel 5+6)
[ ] Test kopieren/schreiben (Regel 7)
[ ] index.ts Re-Export ergänzen (Regel 9)
[ ] npm test + tsc --noEmit grün
```

### 43.4 Implementierungsphasen 35–50 (abhängigkeitssortiert)

Die Phasen sind so sortiert, dass jede nur auf bereits fertige Phasen aufbaut. Buchstaben = GAP-Kategorien aus 43.2.

| Phase | GAP | Quelle (Repo/Ordner) | Ziel-Paket | Dateien | Dependencies | Prio |
|------:|:---:|----------------------|------------|:-------:|--------------|:----:|
| 35 | **F** Contracts | site-clone/contracts | core/contracts | 5 | keine | Kritisch |
| 36 | **A** Analyzer | site-clone/analyzer+analysis | core/analyzer | 13 | 35 | Kritisch |
| 37 | **G** Design-System | site-clone/design-system | core/design-system | 2 | 35, 36 | Kritisch |
| 38 | **B** AI-Tasks | site-clone/ai-engine/tasks | core/ai/tasks | 5 | 35 | Hoch |
| 39 | **D** QA Diff-Engine | site-clone/qa/diff | qa/diff | 8 | 35, 36 | Hoch |
| 40 | **E** QA Extras | site-clone/qa | qa | 9 | 39, 38 | Hoch |
| 41 | **H** Validator | site-clone/validator | core/validator | 2 | vorhandene Builder | Hoch |
| 42 | **I** Extractor Extras | site-clone/extractor | extractors | 9 | 35 | Hoch |
| 43 | **J** Scraper Extras | site-clone/scraper | extractors/assets | 3 | keine | Mittel |
| 44 | **M** Builder Extras | site-clone/builder | target-v3 | 3 | vorhandener V3-Builder | Mittel |
| 45 | **C** Classifier Extras | site-clone/classifier | target-v3/classifier | 9 | 36, 38 | Mittel |
| 46 | **L** Recon Extras | site-clone/recon | extractors/recon | 3 | keine | Mittel |
| 47 | **N** MCP Extras | site-clone/mcp | mcp | 6 | V3/V4-Builder | Mittel |
| 48 | **O** Orchestrator Extras | site-clone/orchestrator | core/orchestrator | 3 | 35–47 | Mittel |
| 49 | **K** CLI Extras | site-clone/cli + Framer/cli | cli | 17 | 35–48 | Niedrig |
| 50 | **P** Framer Types/Bridge | Framer/types+extractor+converter | target-v4 + extractors | 6 | vorhandener Framer-XML | Niedrig |

---

#### Phase 35 — GAP-F: Contracts portieren
**Ziel:** Typ-Verträge als gemeinsame Basis für AI-, Diff- und Token-Subsysteme. Muss zuerst kommen — alle folgenden Phasen importieren daraus.
**Quelle:** `site-clone-to-v3/src/contracts/` → `ai.contract.ts`, `diff.contract.ts`, `shared.contract.ts`, `tokens.contract.ts`, `index.ts`
**Ziel-Ort:** `packages/core/src/contracts/` (neu)
**Portierung:**
1. Alle 5 Dateien 1:1 nach `core/src/contracts/` kopieren (reine Typen, keine Cross-Imports → fast unverändert).
2. `core/src/index.ts`: `export * from './contracts/index.js'` ergänzen.
3. Sicherstellen dass `V3ElementTree`/`V4ElementTree`-Referenzen auf `branded-types.js` zeigen.
**Tests:** Typ-Kompilations-Test (`tsc --noEmit`) genügt; optional 1 Smoke-Test der die Typen importiert.
**DoD:** `@elconv/core` exportiert `AIRouter`, `VisionQAResult`, `BlockDiffResult`, `TokenConstraintSet`, `OklchColorToken` usw.; `tsc --noEmit` grün.

#### Phase 36 — GAP-A: Analyzer + Token-Extraktion portieren
**Ziel:** Vollständiges Token-System (Farbe/Font/Spacing + OKLCH). Herzstück für konsistentes Design.
**Quelle:** `site-clone-to-v3/src/analyzer/` (9) + `site-clone-to-v3/src/analysis/` (4) → u.a. `color-extractor.ts`, `font-token-extractor.ts`, `oklch-converter.ts`, `spacing-extractor.ts`, `theme-detector.ts`, `token-extractor.ts`, `token-resolver.ts`, `design-token-extractor.ts`, `analysis/pipeline.ts`, `analysis/token-sync.ts`, `analysis/token-mapping.ts`, `analysis/font-kit-bridge.ts`
**Ziel-Ort:** `packages/core/src/analyzer/` (neu). Das vorhandene `extractors/src/design-tokens.ts` (Basis) wird auf den neuen Analyzer umgestellt bzw. re-exportiert.
**Portierung:**
1. Analyzer-Dateien nach `core/src/analyzer/` kopieren; Token-Typen aus `@elconv/core` contracts (Phase 35) beziehen.
2. Aus `analysis/` nur `token-mapping.ts` (nur analyzer-abhängig) nach `core/src/analysis/` übernehmen. **Verschoben:** `analysis/pipeline.ts` (7-Stage-Master-Orchestrator, hängt an classifier/builder/qa/ai/mcp/scraper) → Phase 48/49; `analysis/token-sync.ts` + `analysis/font-kit-bridge.ts` (brauchen `McpAdapter`) → Phase 47 (nach `@elconv/mcp`), um core→mcp-Zyklus zu vermeiden.
3. `oklch-converter.ts` ist Basis für Phase 37+39 — als saubere Pure-Function-Sammlung exportieren.
4. `extractors/design-tokens.ts` bleibt unverändert: es ist ein **CSS-String-Extractor** (`extractDesignTokens(css)` via Regex), ein anderes Eingabemodell als der Analyzer (`buildDesignTokens({styles: StyleNode[]})`) — kein Doppelcode, kein erzwungenes Delegieren. Eine spätere Konsolidierung auf gemeinsame core-Primitive ist eine optionale Cleanup-Phase.
**Tests:** Spezs für color-extractor (Clustering), oklch-converter (hex→oklch Round-Trip), spacing-scale, design-token-extractor mitportieren.
**DoD:** `buildDesignTokens(html, styles)` liefert `DesignTokens{colors,fonts,spacing}`; OKLCH-Round-Trip getestet; `tsc`+Tests grün.

**Status (umgesetzt):** analyzer/* (9) + analysis/token-mapping.ts nach `core/src/analyzer/` + `core/src/analysis/` portiert. Kollisionen im core-Barrel gelöst: `Rgb`/`Oklch`/`OklchColorToken` aus contracts importiert+re-exportiert (identisches Symbol); `DesignToken`/`DesignTokenSet`/`SemanticRole` aus `core/src/types.ts` (bereits kanonisch, kein Dup); analyzer-`FontToken` als `ExtractedFontToken` re-exportiert (contracts-`FontToken` bleibt kanonisch). `bucketizeBy` im Analyzer-Barrel ergänzt. 6 Tests portiert (96 Tests). `token-resolver.test.ts` testet `classifier/token-resolver` → Phase 41. `tsc --build`+`vitest run` grün (482 passed | 2 skipped).

#### Phase 37 — GAP-G: Design-System (Token-Constraints) portieren
**Ziel:** Builder auf ein kuratiertes, dedupliziertes Token-Set constrainen (verhindert Token-Drift).
**Quelle:** `site-clone-to-v3/src/design-system/` → `design-tokens-adapter.ts`, `token-constraint.ts`
**Ziel-Ort:** `packages/core/src/design-system/` (neu)
**Portierung:**
1. Beide Dateien nach `core/src/design-system/` kopieren.
2. `designTokensToConstraintSet()` an Analyzer-Output (Phase 36) und `TokenConstraintSet` (Phase 35) andocken.
3. `token-constraint.ts` (Modul S1) nutzt `oklch-converter` aus Phase 36 für Distanz/Snapping — Import auf `../analyzer/oklch-converter.js` setzen.
**Tests:** `buildConstraintSet()`, `snapColorToScale()` (50 Blautöne → 1 Palette), `detectSpacingScale()`.
**DoD:** DesignTokens → TokenConstraintSet Bridge getestet; Snapping deterministisch.

**Status (umgesetzt):** `token-constraint.ts` + `design-tokens-adapter.ts` verbatim nach `core/src/design-system/` portiert (relative Imports auf `../analyzer/*` + `../contracts/tokens.contract.js` lösen unverändert auf). Neuer `design-system/index.ts`-Barrel; in `core/index.ts` eingebunden. Barrel re-exportiert `TokenConstraintSet`/`SpacingToken`/`FontToken`/`ColorMatch` aus contracts (identisches Symbol → keine Kollision) plus `buildConstraintSet`/`enforceColor`/`enforceColorsInSettings`/`TokenDriftWarning`/`designTokensToConstraintSet`. 2 Tests portiert (19 Tests; `oklchHexToRgb as hexToRgb` aliasiert). `tsc --build`+`vitest run` grün (501 passed | 2 skipped).

#### Phase 38 — GAP-B: AI-Tasks portieren
**Ziel:** Konkrete Tasks, die den (bereits vorhandenen) AIRouter nutzbar machen.
**Quelle:** `site-clone-to-v3/src/ai-engine/tasks/` → `component-detect.task.ts`, `section-classify.task.ts`, `repair-block.task.ts`, `token-semantics.task.ts`, `vision-qa.task.ts`
**Ziel-Ort:** `packages/core/src/ai/tasks/` (neu; `core/src/ai/` existiert bereits: router, cost-tracker, types)
**Portierung:**
1. Alle 5 Task-Dateien nach `core/src/ai/tasks/` kopieren.
2. Imports auf vorhandene `../router.js`, `../types.js` + Contracts (Phase 35) umbiegen.
3. `vision-qa.task.ts` bleibt **Single Source of Truth** für Prompt+Parsing — nicht duplizieren; Phase 40 (qa/vision-qa.ts) delegiert hierher.
4. `section-classify.task.ts` als einzige Prompt-Quelle für Klassifikation — Phase 45 (Classifier) konsumiert sie.
**Tests:** `parseVisionQAResponse()` (JSON-Parsing/Confidence), Prompt-Bau, injizierbarer VisionCallFn-Mock.
**DoD:** `runVisionQA()`, `runSectionClassification()`, `runRepairBlock()` mit gemocktem Provider getestet.

**Status (umgesetzt):** 5 Task-Dateien verbatim nach `core/src/ai/tasks/` portiert. `AIRouter` (Interface) direkt aus `../../contracts/ai.contract.js` importiert (bewusst nicht im core-Barrel, da die gleichnamige Klasse den Namen belegt); `ConfidentResult` aus dem Barrel. `IssueType`/`IssueSeverity` sind jetzt in `vision-qa.task.ts` kanonisch definiert statt aus `@elconv/qa` importiert (verhindert core→qa-Zyklus; Phase 40 re-used sie). Neuer `ai/tasks/index.ts`-Barrel, in `ai/index.js` eingebunden. Test (14 Tests) portiert: nutzt echte `AIRouter`-Klasse + Mock-`VisionProvider` (Monorepo-Muster) statt Interface-Mock; `taskSpy` an `provider.execute`. `tsc --build`+`vitest run` grün (515 passed | 2 skipped).

#### Phase 39 — GAP-D: QA Diff-Engine portieren (ersetzt Mock)
**Ziel:** Echtes pixelgenaues, section-aware QA. Ersetzt die Mock-`visual-diff.ts`.
**Quelle:** `site-clone-to-v3/src/qa/diff/` (8) → `block-diff.ts`, `color-distance.ts`, `heatmap.ts`, `ignore-regions.ts`, `animated-disable.ts`, `multi-viewport.ts`, `dimensions.ts` (+ index)
**Ziel-Ort:** `packages/qa/src/diff/` (neu)
**Portierung:**
1. Alle Diff-Dateien nach `qa/src/diff/` kopieren.
2. Typen (`BlockDiffResult`, `IgnoreRegion`, `BBox`) aus `@elconv/core` (Phase 35) importieren; `SectionInfo` aus `@elconv/extractors`.
3. `color-distance.ts` nutzt OKLCH → auf `@elconv/core` analyzer/oklch (Phase 36) verweisen, KEIN Doppel-OKLCH.
4. **npm-Deps** in `qa/package.json` ergänzen: `pixelmatch`, `pngjs`, `sharp`.
5. Vorhandene `qa/src/visual-diff.ts` (Mock) intern auf `diffByBlocks()` umstellen oder als dünnen Wrapper behalten.
**Tests:** `colorDistanceOklch()` (Hue-Wrap 359°/0°), `diffByBlocks()` mit synthetischen PNGs, `resizeToSameSize()`.
**DoD:** Section-aware Diff liefert echte Scores + Hotspots; Mock entfernt/umgeleitet; Tests grün.

#### Phase 40 — GAP-E: QA-Extras portieren
**Ziel:** SSIM, HTML-Report, Acceptance-Checks, Issue-Detection, Strictness-Profile, echte Fixer — die Healing-Loop wird real.
**Quelle:** `site-clone-to-v3/src/qa/` → `ssim.ts`, `html-report.ts`, `acceptance.ts`, `cross-validator.ts`, `issue-detector.ts`, `strictness.ts`, `pixel-element-resolver.ts`, `real-fixers.ts`, `vision-qa.ts`
**Ziel-Ort:** `packages/qa/src/` (neben vorhandenen auto-fix/healing-loop/structural-probes)
**Portierung:**
1. Die 9 Dateien nach `qa/src/` kopieren (die im Unified bereits vorhandenen NICHT überschreiben).
2. `vision-qa.ts` delegiert an `@elconv/core` ai/tasks/vision-qa.task.ts (Phase 38).
3. `real-fixers.ts` nutzt `@elconv/mcp`-Operationen (edit-element, execute-php, upload_asset) — mit DRY-RUN-Fallback.
4. `pixel-element-resolver.ts` mappt Diff-Regionen (Phase 39) auf Element-IDs aus dem Build-Artefakt (page-v3.json).
5. Vorhandene `qa/src/healing-loop.ts` an `strictness.ts`-Profile + `issue-detector` + `real-fixers` andocken.
6. **npm-Deps** in `qa/package.json`: `ssim.js`.
**Tests:** `STRICTNESS_PROFILES`, `detectIssues()` Klassifikation, `runAcceptanceChecks()`, `computeSsim()`.
**DoD:** Healing-Loop nutzt echte Fixer + Strictness; HTML-Report generierbar; Tests grün.

#### Phase 41 — GAP-H: Validator (JSON-Guard) portieren
**Ziel:** Score-basiertes Pre-Push-Guard-System (critical=-20, warning=-5, pass ≥ 85).
**Quelle:** `site-clone-to-v3/src/validator/` → `json-guard.ts`, `index.ts`
**Ziel-Ort:** `packages/core/src/validator/` (neu)
**Portierung:**
1. Beide Dateien nach `core/src/validator/` kopieren.
2. `runV3Guards()` nutzt V3-Normalize-Wissen (Container/Flex-Row/Nested) — Typen aus `@elconv/core` branded-types.
3. `runV4Guards()` prüft `$$type`-Konsistenz + Atomic-Structure.
4. Mit vorhandenem `core/src/guards.ts` (runGuards-Signatur `tree` zuerst) konsistent halten.
**Tests:** V3-Guard (Flex-Row-Stack-Risk), V4-Guard ($$type fehlt), `formatGuardReport()`, Score-Schwelle 85.
**DoD:** `runGuards(tree, guards)` liefert Score+Report; invalide Trees werden vor Push abgelehnt; Tests grün.

#### Phase 42 — GAP-I: Extractor-Extras portieren
**Ziel:** Vollständige V2-Extraktion inkl. Animation-, Pseudo-State- und Custom-Property-Erfassung.
**Quelle:** `site-clone-to-v3/src/extractor/` → `extract-pipeline.ts`, `spec-builder.ts`, `spec-md-writer.ts`, `responsive-matrix.ts`, `pseudo-state-capture.ts`, `animation-property-extractor.ts`, `custom-property-extractor.ts`, `keyframes-discovery.ts`, `browserbase-extractor.ts`
**Ziel-Ort:** `packages/extractors/src/` (neben vorhandenen html-parser/framer-xml/browser/assets)
**Portierung:**
1. Die 9 Dateien nach `extractors/src/` kopieren.
2. Playwright-Nutzung an vorhandenes `extractors/src/browser/` andocken (kein zweiter Browser-Layer).
3. `spec-builder.ts` erzeugt `PageSpec` → Typ nach `@elconv/core` types falls von anderen Paketen gebraucht.
4. `extract-pipeline.ts` orchestriert robots→rate-limit→playwright→assets→spec (Rate-Limit/Robots aus Phase 43 nutzbar).
**Tests:** `capturePseudoStates()`, `extractCustomProperties()`, `discoverKeyframes()`, `buildResponsiveMatrix()`.
**DoD:** Pipeline liefert PageSpec inkl. Animationen/Pseudo-States/Custom-Props; Tests grün.

---

#### Phase 43 — GAP-J: Scraper-Extras portieren
**Ziel:** Vollständiger Asset-Clone (SVG, Favicon, OG) + ethisches Scraping (robots.txt).
**Quelle:** `site-clone-to-v3/src/scraper/` → `robots-check.ts`, `svg-downloader.ts`, `favicon-og-downloader.ts`
**Ziel-Ort:** `packages/extractors/src/assets/` (existiert — Rate-Limiter/Image/Font vorhanden)
**Portierung:**
1. Die 3 Dateien nach `extractors/src/assets/` kopieren; Dedup via sha256 aus vorhandener Asset-Pipeline nutzen.
2. `robots-check.ts` konservativ: 404 = erlaubt, explizit disallowed = blockiert; wird von Phase 42 `extract-pipeline` konsumiert.
**Tests:** `checkRobotsTxt()` (allow/deny/404), `downloadSvgs()` Inline+extern, Favicon-Download.
**DoD:** SVGs/Favicons landen im Asset-Verzeichnis; robots-Gate greift; Tests grün.

#### Phase 44 — GAP-M: Builder-Extras portieren
**Ziel:** Animation-Injektion, Multi-Column-Rekonstruktion, Container-Normalisierung.
**Quelle:** `site-clone-to-v3/src/builder/` → `animation-injector.ts`, `v3-multi-column.ts`, `v3-container-normalize.ts`
**Ziel-Ort:** `packages/target-v3/src/` (Achtung: `target-v3/src/normalize.ts` existiert bereits)
**Portierung:**
1. `animation-injector.ts` + `v3-multi-column.ts` nach `target-v3/src/` kopieren.
2. `v3-container-normalize.ts` mit vorhandenem `normalize.ts` **zusammenführen** (nicht duplizieren) — Flex-Row-Stack-Risk- und `isInner`-Logik ergänzen; wird von Validator (Phase 41) + WP-Push (Phase 47) genutzt.
3. `animation-injector.ts` erzeugt WPCode-Snippet-Plan → an vorhandenes `target-v3/src/wpcode.ts` andocken.
**Tests:** `normalizeV3ContainerTree()` (nested → isInner), `buildMultiColumnLayout()` (Grid→Columns), Animation-Plan.
**DoD:** V3-Tree normalisiert + valide; Multi-Column + Animationen im Output; Tests grün.

#### Phase 45 — GAP-C: Classifier-Extras portieren
**Ziel:** Multi-Layer-Komponentenerkennung, Pro-Detection, Responsive-Settings, Widget-Validierung.
**Quelle:** `site-clone-to-v3/src/classifier/` → `component-detector.ts`, `detect-by-structure.ts`, `detect-by-vision.ts`, `pro-detector.ts`, `responsive-settings.ts`, `section-picker.ts`, `widget-degradation.ts`, `widget-validator.ts`, `token-resolver.ts`
**Ziel-Ort:** `packages/target-v3/src/classifier/` (existiert: widget-mapper, style-classifier, types)
**Portierung:**
1. Die 9 Dateien nach `target-v3/src/classifier/` kopieren.
2. `detect-by-vision.ts` + `section-picker.ts` nutzen AI-Tasks aus `@elconv/core` (Phase 38, `section-classify.task`); Vision nur bei niedriger Confidence (Layer 3).
3. `token-resolver.ts` (classifier) an Analyzer-Tokens `@elconv/core` (Phase 36) andocken.
4. `responsive-settings.ts` erzeugt `_tablet`/`_mobile`-Varianten nur für differierende Properties.
**Tests:** `detectComponentMultiLayer()` (Layer-1-Heuristik), `detectByStructure()`, `buildResponsiveSettings()`, `validateWidgets()`.
**DoD:** Multi-Layer-Klassifikation + Pro-Degradation + Widget-Validierung aktiv; Tests grün.

#### Phase 46 — GAP-L: Recon-Extras portieren
**Ziel:** Event-driven Interaktions-/Zustands-Erfassung (statt Polling).
**Quelle:** `site-clone-to-v3/src/recon/` → `mutation-observer.ts`, `state-capture.ts`, `animation-events.ts`
**Ziel-Ort:** `packages/extractors/src/recon/` (existiert: detect-spa, recon-runner, types)
**Portierung:**
1. Die 3 Dateien nach `extractors/src/recon/` kopieren.
2. In vorhandenen `recon-runner.ts` integrieren (MutationObserver + Animation-Events → StateSnapshots).
**Tests:** `buildStateSnapshot()` (before/after-Attribute), Animation-Event-Aufzeichnung.
**DoD:** Recon erfasst DOM-Mutationen + Animation-Events als strukturierte Snapshots; Tests grün.

#### Phase 47 — GAP-N: MCP-Extras portieren
**Ziel:** WP-Push, V3→V4-Konvertierung, Session-Handling — der Weg ins echte WordPress.
**Quelle:** `site-clone-to-v3/src/mcp/` → `wp-push.ts`, `convert-page-v3-to-v4.ts`, `upgrade-v4.ts`, `phase10-call-orchestrator.ts`, `phase10-indirection.ts`, `phase10-session.ts`
**Ziel-Ort:** `packages/mcp/src/` (Transport/Circuit-Breaker/Targets vorhanden)
**Portierung:**
1. Die 6 Dateien nach `mcp/src/` kopieren; auf vorhandene Transport-/Circuit-Breaker-Schicht aufsetzen.
2. `wp-push.ts` KRITISCH: für V3 immer `elementor-inject-calibrated-page`, NIE `batch-build-page` (ignoriert nested elements).
3. `convert-page-v3-to-v4.ts` nutzt V4-Bridge (Phase 14, vorhanden).
4. `phase10-indirection.ts` berechnet deterministische Idempotency-Keys (vorhandene Idempotency-Lib nutzen).
**Tests:** Idempotency-Key-Bestimmung, Route-Table-Mapping, Session-Handshake (gemockt), wp-push DRY-RUN.
**DoD:** V3-Tree pushbar (DRY-RUN getestet); V3→V4-Konvertierung + Session-Reconnect vorhanden; Tests grün.

#### Phase 48 — GAP-O: Orchestrator-Extras portieren
**Ziel:** Top-Level-Pipeline mit Retry, Drift-Detection, Run-Reports über alle Subsysteme.
**Quelle:** `site-clone-to-v3/src/orchestrator/` → `phase-orchestrator.ts`, `manager-workflow.ts`, `run-report.ts`
**Ziel-Ort:** `packages/core/src/orchestrator/` (existiert: types, pipeline)
**Portierung:**
1. Die 3 Dateien nach `core/src/orchestrator/` kopieren; auf vorhandene `pipeline.ts` (Retry/Backoff) aufsetzen.
2. `phase-orchestrator.ts` verdrahtet Phase 0 (Pre-Flight) → 1+2 (Manager) → 3 (Assembly) → 4 (Builder) → 5 (QA) mit allen ab Phase 36 portierten Modulen.
3. `manager-workflow.ts` Per-Section (max 4 Iterationen, Drift-Detection).
**Tests:** Orchestrator-Retry (max 3), Manager-Drift-Detection, `generateRunReport()`.
**DoD:** End-to-End-Pipeline läuft über alle Subsysteme mit Retry + Report; Tests grün.

#### Phase 49 — GAP-K: CLI-Extras portieren
**Ziel:** Interaktiver Workflow — Wizard, State/Resume, Incremental-Build, Dry-Run, Framer-Commands, Reports.
**Quelle:** `site-clone-to-v3/src/cli/` (10) + `Framer-to-Elementor-V4-Pipeline/src/cli/` (7) → `wizard.ts`, `prompts.ts`, `pipeline-runner.ts`, `state-manager.ts`, `incremental.ts`, `dry-run.ts`, `diff-only.ts`, `changelog-generator.ts`, `update-checker.ts`, `v3v4-diff.ts` + Framer: `cmd-preview.ts`, `cmd-promote.ts`, `cmd-serve.ts`, `cmd-batch.ts`, `health.ts`, `replay.ts`, `build-report.ts`
**Ziel-Ort:** `packages/cli/src/` (bestehende `elconv`-CLI-Surface erweitern)
**Portierung:**
1. Die 17 Dateien nach `cli/src/` kopieren; Subcommands in die vorhandene `commander`-Surface einhängen.
2. `pipeline-runner.ts` + `state-manager.ts` nutzen vorhandenen `@elconv/core` pipeline-state; Resume via CloneState.
3. `dry-run.ts` erzeugt Build-Specs OHNE MCP-HTTP-Calls (CI-tauglich).
4. **npm-Deps** in `cli/package.json`: `commander`, `chalk`, `prompts` (falls nicht vorhanden).
**Tests:** `runDryRun()` (keine MCP-Calls), `state-manager` Resume, `runIncrementalBuild()` (Hash-Diff).
**DoD:** `npx elconv` bietet wizard/dry-run/resume/incremental + Framer-Commands; Tests grün.

#### Phase 50 — GAP-P: Framer-Typen + Unframer-Bridge portieren
**Ziel:** Vollständige Framer-Verarbeitung via Unframer-MCP.
**Quelle:** `Framer-to-Elementor-V4-Pipeline/src/` → `types/framer.ts`, `types/novamira.ts`, `types/common.ts`, `extractor/unframer-bridge.ts`, `converter/framer-utils.ts`, `converter/v4-tree-builder.ts`
**Ziel-Ort:** `types/*` + `extractor/unframer-bridge.ts` → `packages/extractors/src/`; `converter/*` → `packages/target-v4/src/` (teils vorhanden: framer-utils, builder)
**Portierung:**
1. Framer-Typen nach `extractors/src/` (oder `@elconv/core` falls von V4 gebraucht) übernehmen.
2. `unframer-bridge.ts` nach `extractors/src/` — Circuit-Breaker/Idempotency/Batch-Scheduler aus `@elconv/core` bzw. vorhandener Lib nutzen.
3. `framer-utils.ts`/`v4-tree-builder.ts` mit vorhandenen `target-v4/src/framer-utils.ts` + `builder.ts` **abgleichen und mergen** (kein Doppelcode).
**Tests:** `structuralHash()` Dedup, `normalizeHex()`, `getNodeXml(section)` (gemockt), `buildAtomicContainer()`.
**DoD:** Framer-Projekt → V4-Atomic-Tree end-to-end (gemockter Unframer); Tests grün.

---

### 43.5 Neue npm-Dependencies (gesamt)

Während der Portierung nötige Runtime-Deps. Nach Hinzufügen jeweils `npm install` an der Workspace-Root.

| Dependency | Ziel-Paket | Ab Phase | Zweck |
|-----------|-----------|:-------:|-------|
| `pixelmatch` | qa | 39 | Pixel-Diff (Block-Diff) |
| `pngjs` | qa | 39 | PNG-Decode/Encode für Diffs |
| `sharp` | qa | 39 | Resize/Crop/Composite (Heatmap, dimensions) |
| `ssim.js` | qa | 40 | Structural-Similarity-Index |
| `commander` | cli | 49 | Subcommand-Parsing (falls nicht vorhanden) |
| `chalk` | cli | 49 | Farbige CLI-Ausgabe |
| `prompts` | cli | 49 | Interaktiver Wizard |

> Playwright ist über das vorhandene `extractors/src/browser/` bereits verfügbar. AI-Provider-SDKs (Anthropic) werden nur für echte Vision-Calls benötigt — Tests nutzen injizierbare Mocks (VisionCallFn), daher optional.

### 43.6 Geschätzter Umfang

| Metrik | Aktuell | Nach allen Phasen 35–50 | Delta |
|--------|---------|------------------------|-------|
| Source-Dateien | 94 | ~200 | +106 |
| Zeilen Code | ~9.000 | ~22.000 | +13.000 |
| Tests (geschätzt) | 386 | ~700 | +314 |
| Pakete | 7 | 7 (keine neuen) | 0 |
| npm-Deps (neu) | — | 7 | +7 |

### 43.7 Definition of Done — Gesamt-Integration (Feature-Parität)

Die Integration gilt als abgeschlossen, wenn ALLE folgenden Punkte erfüllt sind. Jeder früher fehlende Punkt ist jetzt einer konkreten Phase zugeordnet („wird implementiert“ statt „fehlt“):

| # | Früher fehlend | Wird implementiert in | Nachweis (DoD) |
|---|----------------|:---------------------:|----------------|
| 1 | Token-System (Farbe/Font/Spacing/OKLCH/Constraints) | Phase 36, 37 | `buildDesignTokens()` + `buildConstraintSet()` getestet |
| 2 | AI-Tasks (Router war leer) | Phase 38 | 5 Tasks mit gemocktem Provider grün |
| 3 | Pixelgenaues QA (visual-diff war Mock) | Phase 39, 40 | Section-aware Diff + SSIM + HTML-Report |
| 4 | Interaktiver Workflow (Wizard/Resume/Incremental/Dry-Run) | Phase 49 | `npx elconv` Subcommands funktionieren |
| 5 | WP-Push (nur Transport vorhanden) | Phase 47 | `wpPush()` DRY-RUN getestet |
| 6 | Animation-/Pseudo-State-Erkennung | Phase 42, 44, 46 | Keyframes/Pseudo-States erfasst + injiziert |
| 7 | Validator (Pre-Push-Guards) | Phase 41 | `runGuards()` Score ≥ 85 Gate aktiv |
| 8 | Framer-Bridge (Unframer-Integration) | Phase 50 | Framer → V4-Tree end-to-end (gemockt) |
| 9 | Design-System (Token-Constraints/Adapter) | Phase 37 | `designTokensToConstraintSet()` getestet |
| 10 | Contracts (Typ-Verträge) | Phase 35 | core exportiert alle Contract-Typen |

**Gesamt-Akzeptanzkriterien:**
```
[ ] Alle 16 GAP-Kategorien A–P portiert (Phasen 35–50 grün)
[ ] npm test → exit 0 (~700 Tests)
[ ] npx tsc --noEmit → exit 0 (alle 7 Pakete)
[ ] Keine V3/V4-Contamination (assertNoContamination grün)
[ ] visual-diff ist KEIN Mock mehr (echte Diff-Engine)
[ ] AIRouter hat konkrete Tasks
[ ] npx elconv end-to-end: extract → classify → tokens → build → validate → QA → (dry-run) push
[ ] CI/CD grün (Node 20+22)
```

**Ergebnis:** Ein eigenständiges Repo mit vollständiger Feature-Parität — das Beste aus `site-clone-to-v3` (V3, Extraktion, QA, Token-System) UND `Framer-to-Elementor-V4-Pipeline` (V4-Atomic, Unframer-Bridge) in einer sauberen Monorepo-Architektur.

---

## 44. Progress-Tabelle (aktuell)

| Phase | Status | Tests | Notes |
|-------|--------|-------|-------|
| 0–18 | ✅ done | 386 grün | Basis-Implementierung komplett |
| 19–34 | ✅ done | 386 grün | Production-Features komplett |
| Q1–Q5 | 🔧 offen | — | Qualitätsverbesserungen |

**Integrations-Phasen 35–50 (Portierung Quell-Repos → Feature-Parität):**

| Phase | GAP | Modul | Status | Notes |
|------:|:---:|-------|--------|-------|
| 35 | F | Contracts | ❌ offen | Basis — zuerst |
| 36 | A | Analyzer + Tokens | ❌ offen | Token-System |
| 37 | G | Design-System | ❌ offen | Token-Constraints |
| 38 | B | AI-Tasks | ❌ offen | Router nutzbar machen |
| 39 | D | QA Diff-Engine | ❌ offen | ersetzt Mock |
| 40 | E | QA-Extras | ❌ offen | SSIM/Report/Fixer |
| 41 | H | Validator | ❌ offen | Pre-Push-Guards |
| 42 | I | Extractor-Extras | ❌ offen | Animation/Pseudo/Custom-Props |
| 43 | J | Scraper-Extras | ❌ offen | SVG/Favicon/robots |
| 44 | M | Builder-Extras | ❌ offen | Animation/Multi-Column/Normalize |
| 45 | C | Classifier-Extras | ❌ offen | Multi-Layer/Pro/Responsive |
| 46 | L | Recon-Extras | ❌ offen | Mutation/State/Animation-Events |
| 47 | N | MCP-Extras | ❌ offen | WP-Push/V3→V4/Session |
| 48 | O | Orchestrator-Extras | ❌ offen | Phase-Orchestrator/Report |
| 49 | K | CLI-Extras | ❌ offen | Wizard/Resume/Dry-Run/Framer-Cmds |
| 50 | P | Framer-Typen/Bridge | ❌ offen | Unframer-Integration |

**Version:** 1.0.0 (Basis) → 2.0.0 (nach vollständiger Portierung, Phase 50 grün)
**Tests:** 30 Dateien, 386 Tests, 2 skipped
**TypeScript:** compiliert sauber (tsc --noEmit)
**CI/CD:** GitHub Actions aktiv (Node 20+22)
