# Roadmap — framer-v4-pipeline-v2

> **Erstellt:** 2026-06-13 | **Quelle:** V4_DESIGN_IMPROVEMENTS_RESEARCH.md (v2)
> **Start:** Sprint 1 | **Ziel:** Design-Score 25% → 90%+
> **Status:** ✅ Alle 17 Sprints abgeschlossen (198 Tests, 30 Requirements)

---

## Phase 1–7: Sprints 1–7 — Foundation ✅ Complete

Details in PLAN-1.md bis PLAN-7.md. Zusammenfassung:
- **Sprint 1:** C2 Grid, C4 Semantic GC, C5 Breakpoint, C6 GV-Sub, D3 Grid/Flex
- **Sprint 2:** A1 Components, A2 Interactions, C1 Preservation, C3 Easing
- **Sprint 3:** A3 Forms, B4 create-atomic-form, D2 Native Coverage
- **Sprint 4:** C3 Native Routing, structuralHash Dedup, A2 v4-tree Mode
- **Sprint 5:** FIX-7 p-limit, ENH-10 dark-mode, ENH-11 JSDoc
- **Sprint 6:** preflight-check.js, wizard batch, Wizard modular
- **Sprint 7:** FIX-10/11/12, 100 Tests (33 Suiten)

---

## Phase 8: Sprint 8 — Live Integration ✅ Complete

**Geschätzte Dauer:** ~4h | **Tatsächlich:** ~4h

| Task | Typ | Aufwand | Datei(en) |
|------|-----|---------|-----------|
| **ENH-12** Wizard --non-interactive | Enhancement | ~2h | `wizard.js`, `shared.js` |
| **ENH-13** measure-quality-metrics.js | Neues Script | ~1h | Neu |
| **FIX-13** Integration --live | Fix | ~0.5h | `integration.test.js` |
| **FIX-14** CI test-all | Fix | ~0.5h | `ci.yml`, `package.json` |

### Akzeptanzkriterien
- [x] `wizard.js --non-interactive --url <url> --post-id new` läuft ohne Prompts
- [x] 6 Qualitäts-Metriken (DOM, GC, GV, Grid, Components)
- [x] Live MCP-Tests gegen yoursite.local
- [x] CI `test-all` Job (127 Tests)
- [x] `npm test` → 105/105 (+5 Tests)
- [x] `npm run test:e2e` → 15/15

---

## Phase 9: Sprint 9 — Pipeline Hardening & Plugin Fixes ✅ Complete

**Geschätzte Dauer:** ~10h | **Tatsächlich:** ~12h
**Erwarteter Impact:** FramerExport CLI integriert, Schema-Sync funktionsfähig, Windows-Crash behoben, WCAG-Fixes, PHPUnit-Infrastruktur

| Task | Typ | Aufwand | Datei(en) |
|------|-----|---------|-----------|
| **ENH-16** FramerExport CLI | Feature | ~3h | `shared.js`, `wizard.js` |
| **Schema-Sync** REST Endpoint | Feature | ~2h | `sync-schema.js`, `bootstrap.php`, `class-v4-props.php` |
| **UV_HANDLE_CLOSING** | Fix | ~2h | `mcp-client.js`, `sync-schema.js` |
| **WCAG Threshold** 0.03928→0.04045 | Fix | ~0.5h | `class-v4-color-contrast.php` |
| **Contrast Ratio Test** #959595 | Fix | ~0.5h | `V4ColorContrast22Test.php` |
| **Extraction Exit Codes** | Fix | ~1h | 4 extraction scripts |
| **PHPUnit Setup** | Chore | ~2h | `composer.json`, `mock-functions.php` |
| **V4PropsSchemaTest** 31 Tests | Testing | ~1h | `V4PropsSchemaTest.php` |
| **Docs + PR** | Documentation | ~0.5h | `STATE.md`, `ROADMAP.md`, PR #1 |

### Akzeptanzkriterien
- [x] FramerExport CLI (v4.3.8) integriert — realer E2E-Durchlauf funktioniert
- [x] `spawnWithRetry` 3-step escalation (.cmd → bare → `shell:true`)
- [x] `GET /novamira/v1/prop-schema` → HTTP 200 mit Schema (12 types, 13 props)
- [x] Schema-Sync läuft ohne UV_HANDLE_CLOSING-Crash (Windows)
- [x] `process.exitCode` statt `process.exit()` — Node exitet natürlich
- [x] undici global dispatcher wird in `McpClient.close()` destroyed
- [x] Beide Contrast-Klassen nutzen WCAG-Threshold `0.04045`
- [x] Alle 4 Extraction-Scripte exit 0 für non-critical Results
- [x] Full Wizard Pipeline: 7/7 Extraction-Phasen SUCCESS
- [x] PHPUnit: 52 Tests, 145 Assertions, 0 Failures
- [x] `npm test` → 114/114 ✅
- [x] `npm run test:e2e` → 18/18 ✅
- [x] PR #1 offen: sprint-9-fixes → master

---

## Phase 10: Sprint 10 — CI/CD, Refactoring & Tooling ✅ Complete

**Geschätzte Dauer:** ~6h | **Tatsächlich:** ~4h
**Impact:** PHPUnit in CI, Contrast-Merge, Deploy-Script, 2 PRs

| Task | Typ | Aufwand | Datei(en) |
|------|-----|---------|-----------|
| **CI: PHPUnit Hardening** | CI/CD | ~0.5h | `novamira-adrianv2-ci.yml` |
| **CI: PHPUnit in Pipeline** | CI/CD | ~1h | `ci.yml` (8. Job) |
| **Plugin Deployment Script** | Tooling | ~1h | `deploy-plugin.sh` (neu) |
| **Contrast-Klassen mergen** | Refactoring | ~1.5h | `class-v4-color-contrast.php`, `class-v4-color-contrast-22.php` |

### Akzeptanzkriterien
- [x] PHPUnit Job in `novamira-adrianv2-ci.yml` ist mandatory gate (keine soft-fails)
- [x] PHPUnit Job in Pipeline `ci.yml` — 8. Job, `test-all` hängt davon ab
- [x] Plugin-Deployment per Script — `--dry-run`, `--force`, incremental modes
- [x] `V4_Color_Contrast_22` merged into `V4_Color_Contrast` (0 duplizierter Code)
- [x] PR #2: sprint-10 → master (4 commits)
- [x] Alle 52 PHPUnit-Tests passen
- [x] Plugin deployed nach yoursite.local (77 files)

---

## Phase 11: Sprint 11 — Archive Cleanup & CI Consolidation ✅ Complete

**Geschätzte Dauer:** ~2h | **Tatsächlich:** ~1h
**Impact:** 7 archived files deleted, 3 CI jobs consolidated into 1 workflow (11 jobs)

| Task | Typ | Aufwand | Datei(en) |
|------|-----|---------|-----------|
| **Archive Cleanup** | Maintenance | ~0.5h | `_archived/`, `_archived-novamira-ability-code-injector/` |
| **CI Consolidation** | CI/CD | ~1h | `ci.yml` (+phpcs, +psalm), `novamira-adrianv2-ci.yml` (deleted) |

### Akzeptanzkriterien
- [x] Alle _archived/ Verzeichnisse gelöscht (7 files)
- [x] `phpcs` + `psalm` Jobs in pipeline `ci.yml` (11 jobs total)
- [x] `.github/workflows/novamira-adrianv2-ci.yml` gelöscht
- [x] `test-all` gate includiert `phpcs` + `psalm`
- [x] PR #3: sprint-11 → master
- [x] Alle 184 Tests passen

---

## Phase 13: Sprint 13 — REST Endpoints ✅ Complete

**Geschätzte Dauer:** ~1h | **Tatsächlich:** ~1h
**Impact:** /health, /status, /version endpoints, 16 tests

| Task | Typ | Aufwand | Datei(en) |
|------|-----|---------|-----------|
| **REST Endpoints** | Feature | ~1h | `bootstrap.php`, `RestEndpointsTest.php` |

### Akzeptanzkriterien
- [x] `/health` endpoint (status, php, wp)
- [x] `/status` endpoint (plugin info, schema info, test counts)
- [x] `/version` endpoint (plugin/php/wp versions)
- [x] 16 tests, all passing

---

## Phase 14: Sprint 14 — Pipeline Performance ✅ Complete

**Geschätzte Dauer:** ~2h | **Tatsächlich:** ~1h
**Impact:** Concurrency 3→5, MCP_CONCURRENCY_PROFILE presets, FramerExport caching

| Task | Typ | Aufwand | Datei(en) |
|------|-----|---------|-----------|
| **Concurrency Tuning** | Enhancement | ~0.5h | `mcp-bridge.js` |
| **FramerExport Caching** | Feature | ~1h | `shared.js` |
| **Tests Suite 25** | Testing | ~0.5h | `pipeline.test.js` |

### Akzeptanzkriterien
- [x] Default concurrency 3→5 (modern machines)
- [x] `MCP_CONCURRENCY_PROFILE` presets (low=2/medium=5/high=10)
- [x] FramerExport caching: 1h TTL, atomic writes
- [x] `--no-cache` / `forceRefresh` bypass
- [x] 8 tests in Suite 25, all passing
- [x] PR #5: sprint-14 → master

---

## Phase 15: Sprint 15 — Code Review Remediation ✅ Complete

**Geschätzte Dauer:** ~1h | **Tatsächlich:** ~0.5h
**Impact:** Crashing auf corrupt cache, dead fallback, 9 more tests

| Task | Typ | Aufwand | Datei(en) |
|------|-----|---------|-----------|
| **Corrupt JSON Resilience** | Fix | ~0.25h | `shared.js` |
| **Dead Fallback Fix** | Fix | ~0.1h | `mcp-bridge.js` |
| **Caching Unit Tests** | Testing | ~0.65h | `pipeline.test.js` |

### Akzeptanzkriterien
- [x] `checkFramerExportCache` returns `{cached:false}` on corrupt JSON (no crash)
- [x] `callParallel` fallback `?? 3 → ?? 5`
- [x] 9 tests in Suite 37 (cache hit/miss, forceRefresh, missing dir, corrupt JSON, write no-op, atomic roundtrip, .tmp cleanup, fallback source check)
- [x] PR #6: sprint-15 → master

---

## Phase 16: Sprint 16 — --no-cache CLI Flag (Non-Interactive) ✅ Complete

**Geschätzte Dauer:** ~1h | **Tatsächlich:** ~0.5h
**Impact:** --no-cache flag in non-interactive mode, cache hit/miss logic

| Task | Typ | Aufwand | Datei(en) |
|------|-----|---------|-----------|
| **--no-cache Flag** | Feature | ~0.5h | `wizard.js` |
| **showHelp Update** | Documentation | ~0.1h | `wizard.js` |

### Akzeptanzkriterien
- [x] `--no-cache` flag parsed from argv in non-interactive mode
- [x] `checkFramerExportCache(framerUrl, noCache)` called before export
- [x] Cache hit skips FramerExport, reuses cached exportDir
- [x] `writeFramerExportCache()` called after successful fresh export
- [x] PR #7: sprint-16 → master
- [x] All 128 pipeline tests pass

---

## Phase 17: Sprint 17 — Interactive Mode Caching ✅ Complete

**Geschätzte Dauer:** ~1h | **Tatsächlich:** ~0.5h
**Impact:** FramerExport caching in interactive wizard mode, --no-cache unified

| Task | Typ | Aufwand | Datei(en) |
|------|-----|---------|-----------|
| **Interactive Caching** | Feature | ~0.5h | `wizard.js` |
| **--no-cache Unified** | Enhancement | ~0.25h | `wizard.js` |
| **showHelp Update** | Documentation | ~0.1h | `wizard.js` |

### Akzeptanzkriterien
- [x] Cache check before interactive FramerExport recovery block
- [x] Cache write inside recovery block after successful export
- [x] `--no-cache` works in both interactive and non-interactive modes
- [x] showHelp describes "(interaktiv + non-interactive)"
- [x] PR #8: sprint-17 → master
- [x] All 128 pipeline tests pass

---

## Phase 12: Sprint 12 — Plugin README ✅ Complete

**Geschätzte Dauer:** ~1h | **Tatsächlich:** ~0.5h
**Impact:** REST endpoints, test infrastructure, and deployment documented

| Task | Typ | Aufwand | Datei(en) |
|------|-----|---------|-----------|
| **Plugin README** | Documentation | ~1h | `novamira-adrianv2/README.md` |

### Akzeptanzkriterien
- [x] REST endpoint `GET /novamira/v1/prop-schema` dokumentiert
- [x] PHPUnit test infrastructure (52 tests, 3 classes) dokumentiert
- [x] CI 11 jobs table vollständig
- [x] Deployment `deploy-plugin.sh` modes dokumentiert
- [x] PR #4: sprint-12 → master
- [x] Alle 184 Tests passen

---

## Qualitätssprung (Metriken)

| Metrik | Vorher | Sprint 1–7 | Sprint 8 | Sprint 9 | Sprint 10 | Sprint 11 | Sprint 12 | Sprint 14 | Sprint 15 | Sprint 16 | Sprint 17 |
|--------|--------|------------|----------|----------|-----------|-----------|-----------|-----------|-----------|
| DOM-Tiefe | 8 | ≤3 | ≤3 | ≤3 | ≤3 | ≤3 | ≤3 | ≤3 | ≤3 | ≤3 | ≤3 |
| Global Class % | 0% | ≥90% | ≥90% | ≥90% | ≥90% | ≥90% | ≥90% | ≥90% | ≥90% | ≥90% | ≥90% |
| GV-Substitution % | 0% | ≥95% | ≥95% | ≥95% | ≥95% | ≥95% | ≥95% | ≥95% | ≥95% | ≥95% | ≥95% |
| Grid-Nutzung | 0 | ≥35% | ≥35% | ≥35% | ≥35% | ≥35% | ≥35% | ≥35% | ≥35% | ≥35% | ≥35% |
| Components | 0 | ≥10 | ≥10 | ≥10 | ≥10 | ≥10 | ≥10 | ≥10 | ≥10 | ≥10 | ≥10 |
| Interaktionen | 0 | V4-native | V4-native | V4-native | V4-native | V4-native | V4-native | V4-native | V4-native | V4-native | V4-native |
| **Pipeline Tests** | 49 | 100 | 105 | 114 | 114 | 114 | 114 | 114 | **128** | 128 | 128 |
| **E2E Tests** | 0 | 12 | 15 | 18 | 18 | 18 | 18 | 18 | **18** | 18 | 18 |
| **PHPUnit Tests** | 2 | 21 | 21 | 52 | 52 | 52 | 52 | 52 | **52** | 52 | 52 |
| **Total** | 51 | 133 | 141 | 184 | 184 | 184 | 184 | 184 | **198** | 198 | 198 |
