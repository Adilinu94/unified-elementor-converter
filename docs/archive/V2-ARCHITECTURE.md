# V2 Architecture — site-clone-to-v3

> **Status:** v0.2.0 (2026-06-17) — V2-Plan komplett durchgearbeitet (Phasen 0-11)
> **Test-Coverage:** 910/910 grün, 0 TS-Errors
> **Commits seit v0.1.0:** 11
> **Working-Dir:** `C:\Users\adini\V3-PIXEL-PERFEKT\site-clone-to-v3`
> **Remote:** https://github.com/Adilinu94/site-clone-to-v3.git

---

## 1. Zweck

Standalone Node-Tool zum **pixel-perfekten Klonen beliebiger Live-URLs nach Elementor V3** auf beliebigem WordPress mit Novamira-Plugin. V4-Output als optionaler Fallback-Pfad (Plan §5).

**Scope-Trennung (kritisch):**
- `V3-PIXEL-PERFEKT/` (dieser Ordner) → Website-Clone → **Elementor V3**
- `C:\Users\adini\Umbau\` → Framer → **Elementor V4** (siehe dortige AGENTS.md)
- NIEMALS mischen — separate Working-Dirs, separate Remotes, separate Pläne.

---

## 2. V2-Module (12-Phasen-Pipeline)

### 2.1 Modul-Map

```
src/
├── scraper/          # Phase 1: Playwright-Crawler (SPA-Hydration, Lazy-Scroll)
│   ├── playwright-crawler.ts
│   ├── spa-detector.ts
│   ├── lazy-scroll-trigger.ts
│   └── index.ts
│
├── extractor/        # Phase 4: Computed-Style-Extract
│   ├── computed-styles.ts           # CURATED_PROPERTIES (80 props)
│   ├── pseudo-state-capture.ts      # :hover/:focus/:active
│   ├── custom-property-extractor.ts # :root/:host --* auto-detect
│   ├── animation-property-extractor.ts  # animation-*/transition-* granular
│   ├── background-image-parser.ts   # multi-layer mit parens-respektierend
│   ├── font-loading-state.ts        # document.fonts API
│   └── index.ts
│
├── recon/            # Phase 3: Multi-State-Capture (NEU in V2)
│   ├── types.ts                     # ReconEvent, StateSnapshot, ReconResult
│   ├── mock-types.ts                # Mock DOM-Types (rootDir-Konformität)
│   ├── mutation-observer.ts         # installMutationObserver
│   ├── animation-events.ts          # WAAPI + CSS-Animation/Transition-Listener
│   ├── state-capture.ts             # buildStateSnapshots (before/after + propertyDiff)
│   ├── recon-runner.ts              # buildReconScript (in-page IIFE) + Playwright-Bridge
│   └── index.ts
│
├── classifier/       # Phase 5: Widget-Mapping + Pro-Detection
│   ├── widget-mapper.ts             # 18 V3 + 14 Pro Widgets
│   ├── pro-detector.ts              # 6 Signal-Quellen, weighted Confidence
│   ├── widget-degradation.ts        # present|absent|unknown
│   ├── widget-validator.ts          # error|warning|info Severity
│   ├── spec-pipeline.ts
│   ├── section-merger.ts
│   └── index.ts
│
├── builder/          # Phase 7: V3-Output-Schema
│   ├── v3-section.ts                # 5 SectionStructureTypes
│   ├── v3-multi-column.ts           # 1-6 cols + ratios + gap
│   ├── v3-builder.ts                # Phase-7 Pipeline + V1-PRESERVED
│   └── index.ts
│
├── analyzer/         # Phase 6: Design-Token-Resolution
│   ├── oklch-converter.ts           # sRGB↔Linear↔Oklab↔Oklch (W3C/css-color-4)
│   ├── token-extractor.ts           # oklch + shadow + radius + type-scale
│   ├── token-resolver.ts            # override>css-variable>extracted>fallback
│   ├── theme-detector.ts            # data-attr>class>media-query>light-default
│   ├── color-extractor.ts           # V1
│   ├── font-token-extractor.ts      # V1
│   ├── spacing-extractor.ts         # V1
│   ├── design-token-extractor.ts    # V1 Orchestrator
│   └── index.ts
│
├── qa/               # Phase 8: Visual QA + Pixel-Diff
│   ├── phase8-issue-types.ts        # 20 neue (28 total) mit per-Type Hints
│   ├── phase8-batched-fix.ts        # max 4 types/round
│   ├── phase8-render-capture.ts     # 60s timeout + 2 retries + mock-fallback
│   ├── acceptance.ts                # V1
│   ├── auto-fix.ts                  # V1
│   ├── html-report.ts               # V1
│   ├── issue-detector.ts            # V1 (8 types)
│   ├── ssim.ts                      # V1
│   ├── strictness.ts                # V1
│   ├── visual-capture.ts            # V1
│   ├── visual-diff.ts               # V1
│   └── index.ts
│
├── orchestrator/     # Phase 9: Manager-Workflow
│   ├── manager-workflow.ts          # per-section Loop mit reconcileState (5 Kinds)
│   ├── phase-orchestrator.ts        # 6 PHASE_IDs mit retry-loop
│   ├── run-report.ts                # 24-Feld RunReport
│   └── index.ts
│
├── mcp/              # Phase 10: MCP-Adapter (Session + Indirection + Orchestrator)
│   ├── mcp-adapter.ts               # V1
│   ├── phase10-session.ts           # capability-exchange + reconnect
│   ├── phase10-indirection.ts       # 9 op-kinds + idempotency
│   ├── phase10-call-orchestrator.ts # circuit-breaker + batch-scheduler
│   └── index.ts
│
└── cli/              # Phase 11: CLI Integration + E2E
    ├── clone.ts                     # V1
    ├── clone-v3.ts                  # V1
    ├── dry-run.ts                   # V1
    ├── pipeline-runner.ts           # V1 (preserved)
    ├── wizard.ts                    # V1
    ├── phase11-cli-flags.ts         # 5 validation-rules
    ├── phase11-pipeline.ts          # 6 stages
    ├── phase11-e2e-mock.ts          # deterministic mock für CI/offline
    └── index.ts

tests/
├── helpers/mock-window.ts           # 247 Zeilen Mock-Window + DOM
└── unit/
    ├── phase3-recon.test.ts         # 25 Tests
    ├── phase4-extractor.test.ts     # 32 Tests
    ├── phase5-classifier.test.ts    # 56 Tests
    ├── phase6-analyzer.test.ts      # 33 Tests
    ├── phase7-builder.test.ts       # 41 Tests
    ├── phase8-qa.test.ts            # 31 Tests
    ├── phase9-orchestrator.test.ts  # 33 Tests
    ├── phase10-mcp.test.ts          # 34 Tests
    └── phase11-cli.test.ts          # 26 Tests
```

### 2.2 Datenfluss (12 Phasen)

```
┌─────────────┐
│ Phase 0     │ CLI-Input (--url, --target, --output, --mode v3|v4)
│ Validation  │ → Phase 11 cli-flags validation (5 rules)
└──────┬──────┘
       ▼
┌─────────────┐
│ Phase 1     │ Playwright-Crawler → HTML, Screenshots, Computed-Styles, @keyframes
│ Scraping    │ src/scraper/
└──────┬──────┘
       ▼
┌─────────────┐
│ Phase 2     │ Extractor → 80 computed-style-props, custom-properties, animations, fonts
│ Extraction  │ src/extractor/
└──────┬──────┘
       ▼
┌─────────────┐
│ Phase 3     │ Recon → MutationObserver + WAAPI + CSS-Transition-Events
│ Recon       │ src/recon/ (in-page IIFE + Playwright-bridge)
└──────┬──────┘   captures hover/click/animation states
       ▼
┌─────────────┐
│ Phase 4     │ Analyzer → oklch-converter + token-extractor + resolver + theme-detector
│ Tokens      │ src/analyzer/
└──────┬──────┘   resolves tokens (override>css-variable>extracted>fallback)
       ▼
┌─────────────┐
│ Phase 5     │ Classifier → pro-detector + widget-mapper (18 V3 + 14 Pro)
│ Classification │ + widget-degradation + widget-validator
└──────┬──────┘   src/classifier/
       ▼
┌─────────────┐
│ Phase 6     │ Spec-Pipeline → SiteSpec (per-section WidgetSpec + tokens + responsive)
│ Spec        │ src/classifier/spec-pipeline.ts + section-merger.ts
└──────┬──────┘
       ▼
┌─────────────┐
│ Phase 7     │ Builder → V3-Sections (multi-column + inner-sections + responsive)
│ Build       │ src/builder/
└──────┬──────┘   output: _elementor_data post-meta
       ▼
┌─────────────┐
│ Phase 8     │ QA → 28 Issue-Types + Batched-Auto-Fix (max 4/round)
│ QA          │ src/qa/
└──────┬──────┘   + Render-Capture mit Timeout/Retry/Mock-Fallback
       ▼
┌─────────────┐
│ Phase 9     │ Orchestrator → runClonePipeline (6 stages)
│ Orchestration │ src/orchestrator/ + src/cli/phase11-pipeline.ts
└──────┬──────┘   retry-loop + run-report (24 fields)
       ▼
┌─────────────┐
│ Phase 10    │ MCP-Adapter → Session-Handshake + Indirection + Call-Orchestrator
│ MCP-Push    │ src/mcp/
└──────┬──────┘   capability-exchange + circuit-breaker + batch-scheduler
       ▼
┌─────────────┐
│ Phase 11    │ CLI → exit-Code (0=success, 1=fail, 2=qa-issues)
│ CLI-Exit    │ src/cli/
└─────────────┘
```

---

## 3. V3 vs V4 Schema (Plan §5)

### 3.1 V3 (primäres Target)

**Section-Struktur:** Multi-Column mit Inner-Sections
- `_elementor_data` post-meta (serialized JSON array)
- **Multi-Column** = Grid mit `display: grid` + 1-6 columns + gap
- **Inner-Sections** = nested V3-Sections für Sub-Layouts
- **Responsive** = per-breakpoint overrides (desktop/tablet/mobile)

**Beispiel-Section:**
```json
{
  "id": "abc123",
  "elType": "section",
  "settings": {
    "structure": "50-50",
    "gap": "default",
    "content_width": {"unit": "px", "size": 1200}
  },
  "elements": [
    {
      "id": "col1",
      "elType": "column",
      "settings": {"_column_size": 50, "_inline_size": null},
      "elements": [
        {"id": "w1", "elType": "widget", "widgetType": "heading", "settings": {...}}
      ]
    },
    {"id": "col2", "elType": "column", "settings": {"_column_size": 50}, "elements": [...]}
  ]
}
```

### 3.2 V4 (Fallback-Pfad)

**Section-Struktur:** Atomic-Tree mit Global-Classes + Variables
- `_elementor_data` post-meta (gleiches Serialisierungs-Format, aber andere elTypes)
- **Atomic** = `<e-div>`, `<e-heading>`, `<e-button>` etc. statt section/column/widget
- **Global-Classes** = `e-global-class` mit CSS-Variable-References
- **Variables** = `--e-global-color-primary` etc.

**Beispiel-Atomic:**
```json
{
  "id": "abc123",
  "elType": "e-div",
  "settings": {"class": "hero-container"},
  "elements": [
    {"id": "h1", "elType": "e-heading", "settings": {"class": "hero-title"}, "elements": []}
  ]
}
```

**Migration-Hinweis:** V4-Output ist NICHT das primäre Ziel — V3 wird bevorzugt weil Multi-Column-Struktur semantisch klarer und mit den meisten Themes/Plugins kompatibel ist. V4 wird nur generiert, wenn `--mode v4` explizit gesetzt oder V3-Output fehlerhaft ist (Fallback-Pattern in Phase 11).

---

## 4. Konfiguration (`~/.config/clone-v3/targets.json`)

```json
{
  "targets": {
    "yoursite-local": {
      "wpUrl": "http://localhost:8080",
      "mcpEndpoint": "/wp-json/novamira-mcp/v1",
      "mcpToken": "<encrypted-token>",
      "elementorVersion": "3.x",
      "proActive": false,
      "fontsPluginActive": true,
      "wpcodeActive": true
    }
  }
}
```

---

## 5. Performance-Charakteristiken (Plan §16)

| Phase | Operation | Avg. Dauer | Bottleneck |
|---|---|---|---|
| 1 (Scrape) | Playwright-Crawler | ~3-8s | SPA-Hydration, Lazy-Scroll |
| 2 (Extract) | 80 props × N sections | ~500ms | getComputedStyle-Calls |
| 3 (Recon) | MutationObserver + WAAPI | ~50-200ms | Event-Volumen bei Animationen |
| 4 (Tokens) | oklch-Convert × N tokens | ~100ms | Float-Math |
| 5 (Classify) | 14 widgets × 7 heuristics | ~200ms | Regex-Eval |
| 6 (Spec) | Section-Merge | ~50ms | pure JS |
| 7 (Build) | V3-Section-Tree-Build | ~100ms | JSON-Serialize |
| 8 (QA) | Pixel-Diff + SSIM | ~2-5s | Image-Decode/Compare |
| 9 (Orchestrate) | 6-Stage-Loop | ~50ms | pure JS |
| 10 (MCP) | Session + Batch | ~500ms-2s | HTTP-Latency zum WP |
| 11 (CLI) | Validation + Pipeline-Trace | ~10ms | pure JS |
| **Total** | **End-to-End** | **~8-15s** | **WP-MCP-Latency** |

---

## 6. Honesty-Discipline

**V2-Konventionen (alle Commits ab `9bd78ab`):**
- Nach jedem `write_file`/`git commit`: `git show --stat <hash>` checken
- Working-Dir-Status via `git status -sb` verifizieren
- Bei Reported-Commits: immer Hash + Commit-Message + Stats angeben
- Test-Counts mit `npx vitest run` ZÄHLEN, nicht extrapolieren
- TS-Errors mit `npx tsc --noEmit` verifizieren (cache clearen bei Verdacht)

**Working-Dir-Checkpoints:**
- Vor jedem Commit: `git status -sb` zeigt working-dir clean oder nur gewollte Files
- Bei `?? file` (untracked): entweder `git add` oder `Remove-Item` (für Artefakte)
- Bei `M file` (modified): entweder commit oder revert
- Bei `dist/`-Output: NICHT committen (durch `.gitignore` ausgeschlossen)

---

## 7. Lessons Learned (V1 → V2)

| Lesson | V1-Stand | V2-Fix | Commit |
|---|---|---|---|
| 250ms-Polling verpasst schnelle Transitions | `src/recon/polling.ts` (250ms) | MutationObserver + WAAPI | `45626e8` |
| Computed-Style nur 60 props | `src/extractor/computed-styles.ts` | 80 props + 5 Sub-Module | `14cd099` |
| Nur RGB-Tokens | `src/analyzer/color-extractor.ts` | oklch-Converter + Token-Resolver | `b62601f` |
| Kein Pro-Widget-Support | `src/classifier/widget-mapper.ts` (18 V3) | +14 Pro + Detection + Degradation | `2ca9f02` |
| Kein Multi-Column | `src/builder/v3-builder.ts` | v3-section + v3-multi-column | `5495992` |
| Nur 8 Issue-Types | `src/qa/issue-detector.ts` | +20 Types + Batched-Fix | `c107008` |
| Monolithischer Manager | `src/orchestrator/manager.ts` | 3 Module + 24-Feld-Report | `c616766` |
| MCP ohne Resilience | `src/mcp/mcp-adapter.ts` | +Session + Indirection + Circuit-Breaker | `c14f825` |
| Keine CLI-Validation | `src/cli/clone.ts` | +5 Validation-Rules + E2E-Mock | `e4c0f47` |

---

## 8. Nächste Schritte (Phase 12+)

- **Phase 12:** Live-E2E gegen test4.nick-webdesign.de (Elementor 4.1.0-beta1, Pro inaktiv → testet automatisch den V3-Pro-Fallback-Pfad via text-editor-Widget)
- **Performance-Tuning:** Page-Sections >50 → Memoization der Computed-Style-Calls (Phase-4-Hotpath)
- **npm publish v0.2.0:** Vorbedingung `npm run test:unit && npm run build` grün
- **MCP-Credential-Rotation:** Token-Encryption + Auto-Refresh (Phase 13)

---

**Stand:** 2026-06-17 — V2-Plan komplett durchgearbeitet. 910/910 Tests grün. Bereit für Push + Live-E2E.