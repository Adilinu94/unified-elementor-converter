# Bauplan v2.0 — Vollständige Integration aller Stärken

> Ergänzt `docs/BAUPLAN-v1.0.md` (Phasen 35–50) um eine vollständige Funktionsaudit beider Quell-Repos. Phasen 35–49 bleiben wie dort spezifiziert gültig — hier stehen nur Korrekturen/Präzisierungen dazu. Neu: Phasen 51–58.
> Grundlage: verifizierte Analyse von `site-clone-to-v3` (45.510 LOC, 1289/1289 Tests grün, tsc sauber) und `Framer-to-Elementor-V4-Pipeline` (50.653 LOC, 491/492 Tests, 2 tsc-Fehler).

---

## Teil 1 — Die V3/V4-Trennregel, präzisiert

Bestehende Regel bleibt hart: V3-Code importiert nie aus V4-Code, nie umgekehrt. Neu präzisiert, weil bei dieser Integration öfter Grenzfälle auftreten:

**Der Test pro Datei:** *„Weiß dieser Code, was ein V3-Element oder ein V4-Atomic-Element ist (Struktur, `$$type`, Settings-Schema)?"*
- **Ja** → gehört strikt in `target-v3/` bzw. `target-v4/`, niemals gemeinsam, niemals von der jeweils anderen Seite importiert.
- **Nein**, reiner Mechanismus ohne Zielformat-Wissen (z. B. „schreibe einen WPCode-Snippet", „führe einen Preflight-Check aus", „vergleiche zwei Screenshots per SSIM") → darf als Infrastruktur in `core/`, `mcp/`, `qa/` oder `extractors/` liegen und von beiden Targets genutzt werden.

Dieser Test entscheidet unten jede Zuordnung. Wo eine bestehende Quelldatei beides mischt (z. B. `wpcode.ts`), wird sie exakt an dieser Linie aufgetrennt — siehe Phase 54.

---

## Teil 2 — Vollständigkeitsaudit

### 2a. `site-clone-to-v3` — noch offene Module

Bereits georderte Phasen 43–49 in `BAUPLAN-v1.0.md` decken diese Module ab. Präzisierung nach Datei-Abgleich mit dem aktuellen elconv-Stand:

| Ordner (Quelle) | Dateien | Bereits in elconv vorhanden? | Präzisierte Restarbeit | Phase |
|---|---|---|---|---|
| `scraper/` | 8 Dateien | `font-downloader`, `image-downloader`, `manifest-builder`, `rate-limiter`, `robots-check` bereits 1:1 in `extractors/src/assets/` | Nur **`favicon-og-downloader.ts`, `svg-downloader.ts`** sind neu | 43 (kleiner als ursprünglich angenommen) |
| `recon/` | 7 Dateien | `index`, `detect-spa`(≈SPA-Teil von `recon-runner`), `recon-runner`, `types` teilweise vorhanden | **`mutation-observer.ts`, `animation-events.ts`, `state-capture.ts`, `mock-types.ts`** neu | 46 |
| `orchestrator/` | 3 Dateien | `core/orchestrator/{index,pipeline,types}.ts` als Basis vorhanden | `manager-workflow.ts`, `run-report.ts` neu; `phase-orchestrator.ts`-Logik in bestehendes `pipeline.ts` **mergen**, nicht duplizieren | 48 (erweitert um Teil 4b) |
| `mcp/` | 8 Dateien | `mcp/src/{adapter,abilities,batch-scheduler,chunked-deploy,circuit-breaker,deploy,idempotency,preflight,targets,transaction}.ts` bereits umfangreich vorhanden | Verbleibend: `wp-push.ts` (V3-Push-Body + kritischer Hinweis, siehe unten), `convert-page-v3-to-v4.ts`/`upgrade-v4.ts` (**vor Port gegen `novamira-adrianv2` abgleichen** — dort laut Wissensstand bereits nativ als PHP-Ability implementiert; nur die dünne MCP-Client-Seite portieren, keine Logik duplizieren), `phase10-*.ts` (Session-Handling, ggf. schon durch `adapter.ts` abgedeckt — Diff prüfen) | 47 |
| `classifier/` | 13 Dateien | `target-v3/src/classifier/{index,style-classifier,types,widget-mapper}.ts` vorhanden, aber `widget-mapper.ts` nur 144 Zeilen vs. 792 Zeilen im Quell-Repo | **Mergen, nicht ersetzen**: 144-Zeilen-Version ist ein Subset. `component-detector`, `detect-by-structure`, `detect-by-vision`, `pro-detector`, `responsive-settings`, `section-picker`, `token-resolver`, `widget-degradation`, `widget-validator` komplett neu | 45 |
| `builder/` | 6 Dateien | `target-v3/src/{builder,normalize}.ts` (224 + 99 Zeilen) vorhanden | `v3-builder.ts`(347)+`v3-multi-column.ts`(121)+`v3-section.ts`(122) → in `builder.ts` **mergen**; `v3-container-normalize.ts`(190) → in `normalize.ts` **mergen**; `animation-injector.ts`(348) → gehört zu Phase 54 (WPCode-Split). **`v4-builder.ts` ist bereits Grundlage von `target-v4/builder.ts`** — keine weitere Aktion nötig | 44 |
| `cli/` | 15 Dateien | 6 Basis-Commands vorhanden | Siehe Phase 49 (zusammengeführt mit Framer-CLI, Teil 4b) | 49 |

### 2b. `Framer-to-Elementor-V4-Pipeline` — vollständig neu zu bewerten

Der bestehende Bauplan deckt hiervon nur `src/types/*`, `src/extractor/unframer-bridge.ts`, `src/converter/{framer-utils,v4-tree-builder}.ts` ab (Phase 50). Der Rest — **der Großteil der 50.653 LOC** — fehlt komplett im bisherigen Plan.

| Gruppe | Dateien (Auswahl) | Ziel-Ort in elconv | V3/V4 | Neue Phase |
|---|---|---|---|---|
| Framer-Extraktion | `extract-framer-{components,css-tokens,dark-mode,forms,interactions,styles}.ts`, `framer-animation-extractor.ts`, `extract-style-map.ts`, `extract-responsive-breakpoints.ts`, `expand-components.ts`, `generate-component-cache.ts`, `scripts/lib/framer-cache.ts` | `extractors/src/framer/` (neuer Unterordner, parallel zu `browser/`) | Input-Layer, zielformat-neutral | **51** |
| V4-Tree-Postprocessing | `generate-global-classes.ts`, `auto-scale-responsive.ts`, `integrate-responsive.ts`, `patch-v4-tree-media-ids.ts` | `target-v4/src/postprocess/` | **V4-only** | **52** |
| V4-Guards & Cross-Validation | `validate-v4-tree.ts`, `check-v4-requirements.ts`, `verify-build-binding.ts`, `cross-validate-sources.ts`, `framer-pre-build-validate.ts` | `target-v4/src/guards.ts` (erweitern von aktuell 4 auf die dokumentierten 12 Guards) + neu `target-v4/src/cross-validate.ts` | **V4-only** | **53** |
| WPCode-Generalisierung | `inject-animation-code.ts`, `scripts/lib/wp-css-injector.ts` | Split: `core/src/wpcode.ts` (generischer Snippet-Writer) + `target-v4/src/animation.ts` (V4-Codegen) | Mechanismus gemeinsam, Codegen getrennt | **54** |
| Framer-Preflight-Gates | `scripts/preflight/{ensure-elementor-experiments,check-unframer-connectivity,verify-xml-project-match}.ts`, `preflight-check.ts` | `mcp/src/preflight.ts` (erweitern) | Mechanismus gemeinsam | **55** |
| MCP-Brücken & Asset-Upload | `asset-to-wp-media.ts`, `export-mcp-xml.ts`, `html-to-widget-plan.ts` | `mcp/src/abilities.ts` (erweitern) | Mechanismus gemeinsam | **56** |
| Build-Orchestrierung | `build-dependency-graph.ts` (Kahn-Algorithmus), `parallel-pre-build.ts`, `scripts/lib/{pipeline-waves,pipeline-state}.ts` | `core/src/orchestrator/` (erweitert Phase 48) | Mechanismus gemeinsam | **48 erweitert** |
| Post-Build-QA-Automatisierung | `post-build-hook.ts`, `post-build-auto-fix.ts`, `run-post-build-qa.ts`, `section-compare.ts`, `deduplicate-visual-qa.ts`, `visual-qa.ts` | `qa/src/` | Mechanismus gemeinsam | **58** |
| Deploy-Resilienz | `scripts/lib/{rollback,split-large-tree}.ts` | `mcp/src/chunked-deploy.ts` abgleichen | Mechanismus gemeinsam | 47 (ergänzen) |
| WP-Kompatibilität | `scripts/lib/{pro-fallback,elementor-version}.ts` | `mcp/src/{preflight,targets}.ts` | Mechanismus gemeinsam | 55 (ergänzen) |
| CLI (gesamt) | `src/cli/*` (11 Dateien, **kanonische Version** — siehe Hinweis unten) | `cli/src/` | Dispatcht in beide Targets, Router selbst gemeinsam | **49** |
| Framer-MCP-Bridge | `src/builder/mcp-bridge.ts` | `target-v4/src/` (fehlte in ursprünglicher Phase-50-Quellenliste — Ergänzung) | **V4-only** | 50 (ergänzen) |
| Meta-/Ops-Tooling | `build-quality-gate.ts`, `measure-quality-metrics.ts`, `quarterly-audit.ts`, `profile-pipeline.ts`, `lint-test-count.ts`, `inspect-v4-schemas.ts`, `sync-schema.ts`, `scripts/lib/{audit-resilience,foundation-resilience,auto-memory-save,error-tracker}.ts` | **nicht in packages/** — siehe Teil 5, Punkt 3 | — | offen |
| PHP-Ability-Injector | `novamira-ability-code-injector/*.php` (11 Dateien) | **nicht nach elconv** — siehe Teil 5, Punkt 1 | — | offen |
| `tools/framer-export/` | eigenständiges Sub-Tool | siehe Teil 5, Punkt 5 | — | offen |

**Wichtiger Hinweis zur CLI-Quelle:** Es gibt drei CLI-Stände im Framer-Repo: Root-`wizard.ts` (673 Zeilen, `@ts-nocheck`), `scripts/wizard/*` (12 Dateien) und `src/cli/*` (11 Dateien). Laut Kopfkommentar von `wizard.ts` selbst („Sprint 6: Refactored to thin router. Sub-commands are modularized in `src/cli/cmd-*.js`") ist **`src/cli/*` die kanonische, aktuelle Quelle**; Root-`wizard.ts` ist nur ein dünner Einstiegspunkt, `scripts/wizard/*` vermutlich der Vor-Sprint-6-Stand. Vor dem Port kurz per `git log` verifizieren, aber nicht beide Stände parallel portieren.

**`site-clone-to-v3`'s eigene `cli/` (15 Dateien: `wizard.ts`, `clone.ts`, `clone-v3.ts`, `dry-run.ts`, `incremental.ts`, `diff-only.ts`, `state-manager.ts`, `update-checker.ts`, `prompts.ts`, `changelog-generator.ts`, `v3v4-diff.ts`, `pipeline-runner.ts`, `phase11-*.ts`) fließt in dieselbe Phase 49 ein** — beide Wizards (V3-seitig und V4-seitig) werden zu **einem** `elconv`-Wizard vereinheitlicht, der nach Zielformat verzweigt, statt zwei separate Wizard-Implementierungen zu führen. Der Router-Mechanismus ist gemeinsam (Prompts, State-Management, Update-Checker), die Handler pro Command rufen strikt getrennten Target-Code auf.

---

## Teil 3 — Vor dem Portieren zu fixende Bugs

Nicht mitportieren, sondern vorher klären — sonst wird Bug-Code strukturell in elconv eingebaut:

1. **`design-system-builder.ts`** (Framer-Repo): 2 echte `tsc`-Fehler (`string | undefined` und `string | null` nicht kompatibel mit `string`). Beim Portieren nach Phase 51 korrigieren, nicht kopieren.
2. **`tools/framer-export` Build fehlt lokal**: 1 fehlgeschlagener Test (`FramerExport: dist/cli/index.js ist ausführbar`) wegen fehlendem Build-Schritt. Siehe Teil 5, Punkt 5 — muss geklärt sein, bevor Phase 51 startet, sonst wiederholt sich der Fehler in elconv.
3. **`@ts-nocheck` in `wizard.ts`/`src/cli/*`**: Diese Dateien sind von der Typprüfung ausgenommen. Beim Port nach Phase 49 vollständig typisieren — elconv hat aktuell 0 `tsc`-Fehler, das soll so bleiben.

---

## Teil 4 — Phasenplan

### 4a. Bestehende Phasen 43–50 — nur Delta zu `BAUPLAN-v1.0.md`

| Phase | Delta |
|---|---|
| 43 (Scraper) | Umfang kleiner: nur `favicon-og-downloader.ts` + `svg-downloader.ts` |
| 44 (Builder) | `v4-builder.ts` braucht keine Aktion (bereits Basis von `target-v4/builder.ts`); `animation-injector.ts` wandert zu Phase 54 statt hierher |
| 45 (Classifier) | Größter Einzelposten: 792→144-Zeilen-`widget-mapper.ts` ist ein **Merge**, kein Append |
| 46 (Recon) | 4 der 7 Quelldateien bereits (teilweise) vorhanden — Restarbeit kleiner als ursprünglich angenommen |
| 47 (MCP/WP-Push) | **Kritischer Hinweis aus `wp-push.ts` wörtlich übernehmen**: „Never use batch-build-page for V3 nested trees — it silently ignores nested elements and only saves top-level sections." `deploy.ts` wählt aktuell schon korrekt `inject-calibrated-page` für V3 — Restarbeit ist der eigentliche Push-Body + Pre-Push-Normalize-Aufruf (Abhängigkeit zu Phase 44). Vor Port von `convert-page-v3-to-v4.ts`/`upgrade-v4.ts` gegen `novamira-adrianv2` abgleichen (Duplikat-Risiko) | 
| 48 (Orchestrator) | Erweitert um Build-Dependency-Graph (Kahn) und Parallel-Pre-Build aus dem Framer-Repo — siehe 4b |
| 49 (CLI) | Deutlich größerer Umfang als ursprünglich „Wizard/Resume/Dry-Run" — siehe Vereinheitlichung oben, jetzt **1 Wizard statt 2** |
| 50 (Framer-Bridge) | Quellenliste um `src/builder/mcp-bridge.ts` ergänzt |

### 4b. Neue Phasen 51–58

**Phase 51 — Framer-Extraktion**
- Quelle: 11 `extract-framer-*`/`framer-animation-extractor.ts`/`expand-components.ts`/`generate-component-cache.ts`-Dateien + `framer-cache.ts`
- Ziel-Ort: `extractors/src/framer/` (neu)
- V3/V4: input-layer, zielformat-neutral (analog zu bestehendem `extractors/src/framer-xml.ts`, das erweitert statt ersetzt wird)
- Kernschritte: (1) jede Extraktionsfunktion mit Typ-Contract aus `core/src/contracts/` verdrahten, (2) `framer-cache.ts` als Cache-Layer davor schalten (analog bereits vorhandenem `extraction cache` aus Basis-Phasen), (3) 2 tsc-Fehler aus Teil 3 dabei beheben
- Tests: pro Extraktions-Funktion ein Unit-Test mit echtem Framer-HTML-Fixture (aus dem Quell-Repo übernehmbar)
- DoD: `tsc --noEmit` clean, alle 9 Extraktions-Funktionen decken die im Quell-Repo dokumentierten Fälle ab (Dark-Mode, Interactions, Forms, Components)

**Phase 52 — V4-Tree-Postprocessing**
- Quelle: `generate-global-classes.ts`, `auto-scale-responsive.ts`, `integrate-responsive.ts`, `patch-v4-tree-media-ids.ts`
- Ziel-Ort: `target-v4/src/postprocess/`
- V3/V4: **strikt V4-only**, darf `target-v3` nie importieren
- Abhängigkeit: Phase 51 (braucht Extraktionsdaten als Input)
- DoD: Global-Classes-Vorschläge decken die dokumentierten Kernregeln ab (≥2 Elemente gleicher Signatur → GC; `background.color` immer GC außer bei `--local-bg-set`)

**Phase 53 — V4-Guards & Cross-Validation**
- Quelle: `validate-v4-tree.ts`, `check-v4-requirements.ts`, `verify-build-binding.ts`, `cross-validate-sources.ts`, `framer-pre-build-validate.ts`
- Ziel-Ort: `target-v4/src/guards.ts` (von 4 auf 12 Guards erweitern) + neu `target-v4/src/cross-validate.ts` (7 Checks inkl. `GV_ID_DRIFT`)
- V3/V4: **strikt V4-only**
- Abhängigkeit: Phase 52
- DoD: Score-Schwelle ≥ 85 % wie im Quell-Repo dokumentiert reproduzierbar; alle 12 Guard-IDs vorhanden (aktuell nur G6–G9)

**Phase 54 — WPCode-Generalisierung**
- Quelle: `inject-animation-code.ts`, `scripts/lib/wp-css-injector.ts`, plus Aufsplittung des bestehenden `target-v3/src/wpcode.ts`
- Ziel-Ort: `core/src/wpcode.ts` (neu — generisches `WpCodeSnippet`-Interface, aus `target-v3/wpcode.ts` herausgezogen) + `target-v3/src/wpcode.ts` (behält nur `AnimationConfig`/V3-Codegen) + `target-v4/src/animation.ts` (neu, V4-Codegen)
- V3/V4: Mechanismus gemeinsam (Snippet-Erzeugung/-Push), Inhalt strikt getrennt — Musterbeispiel für die Teil-1-Regel
- Abhängigkeit: Phase 44 (V3-Animation-Injector als Vorlage für den Split)
- DoD: `target-v3` und `target-v4` importieren beide aus `core/src/wpcode.ts`, aber keines aus dem jeweils anderen Target

**Phase 55 — Framer-Preflight-Gates**
- Quelle: `scripts/preflight/{ensure-elementor-experiments,check-unframer-connectivity,verify-xml-project-match}.ts`, `preflight-check.ts`, `pro-fallback.ts`, `elementor-version.ts`
- Ziel-Ort: `mcp/src/preflight.ts` (erweitern, Framework existiert bereits)
- V3/V4: Mechanismus gemeinsam, `ensure-elementor-experiments` ist inhaltlich V4-spezifisch (Atomic-Experiments) — als eigener Gate-Typ registrieren, nicht das Framework selbst V4-spezifisch machen
- DoD: 4 neue Gate-Typen im bestehenden Preflight-Framework registriert, kein neues Preflight-System daneben

**Phase 56 — MCP-Brücken & Asset-Upload**
- Quelle: `asset-to-wp-media.ts`, `export-mcp-xml.ts`, `html-to-widget-plan.ts`
- Ziel-Ort: `mcp/src/abilities.ts` (erweitern)
- V3/V4: `html-to-widget-plan.ts` wird von beiden Targets genutzt (generische HTML→Widget-Brücke zur externen `novamira/adrians-html-to-elementor-widget-plan`-Ability)
- Abhängigkeit: Phase 51
- DoD: Asset-Upload-Queue nutzt bestehende `chunked-deploy.ts`-Infrastruktur statt eigener Batch-Logik

**Phase 57 — entfällt als eigene Phase, aufgegangen in Phase 48 (siehe 4a)**

**Phase 58 — Post-Build-QA-Automatisierung**
- Quelle: `post-build-hook.ts`, `post-build-auto-fix.ts`, `run-post-build-qa.ts`, `section-compare.ts`, `deduplicate-visual-qa.ts`, `visual-qa.ts`
- Ziel-Ort: `qa/src/`
- V3/V4: Mechanismus gemeinsam (QA-Vergleichslogik kennt keine Zielformat-Struktur)
- **Harte Abhängigkeit: Healing-Loop muss vorher fertig sein** (bestehende Tech-Schuld #1 aus `BAUPLAN-v1.0.md` — `auto-fix.ts` ist aktuell nur Typ-Stub). Diese Phase baut auf einer funktionierenden Engine auf, nicht auf Stubs.
- `post-build-auto-fix.ts` ruft laut Quellcode `adrians-*`-Abilities per MCP auf (bestätigt in `ABILITIES-MAP.md`) — **nur der MCP-Call wird portiert, nicht PHP-Logik nachgebaut**
- DoD: Healing-Loop verifiziert lauffähig (nicht nur typgeprüft) **bevor** diese Phase als done markiert wird

---

## Teil 5 — Offene Entscheidungen (dein Go nötig, blockiert aber nicht den Rest)

1. **PHP-Ability-Injector (11 Dateien, 1.502 Zeilen).** `novamira-ability-code-injector/ABILITIES-MAP.md` sagt selbst wörtlich: die Dateien „werden im Novamira-Plugin unter dem `novamira-adrianv2/`-Namespace registriert". Das ist keine Vermutung mehr, sondern dokumentiert. **Empfehlung: nicht nach elconv, bleibt/wandert nach `novamira-adrianv2`.** Restarbeit: prüfen, ob alle 11 dort aktuell registriert sind (die Map ist vom 13.06., Pipeline-Version 0.7.0 — möglicherweise veraltet gegenüber jetzigem Stand 0.20.0).
2. **`WordPress_mcp_adrian` vs. `novamira-adrianv2`.** Beide Quell-Repos verlinken `WordPress_mcp_adrian/ARCHITECTURE.md` als Ziel-Plugin, `site-clone-to-v3`s README verlinkt „Novamira plugin" separat auf `novamira-adrianv2`. Vermutlich zwei Namen für dasselbe Repo (Rename) — bräuchte kurze Bestätigung, bevor die neue elconv-Doku darauf verlinkt.
3. **Meta-/Ops-Tooling** (Quality-Gate, Audit, Profiler, Lint-Test-Count, Schema-Sync/Inspect, Resilience-Audits). **Empfehlung:** nicht in die 7 Kern-Packages, sondern als optionale `elconv doctor --deep`-Erweiterung oder eigener, nicht mit-publizierter `tools/`-Ordner im Root (analog zu `tools/framer-export` im Quell-Repo). Verhindert Bundle-Aufblähung für Nutzer, die nur `elconv convert` wollen.
4. **`session-init.ts`** vs. bereits vorhandenes `cli/cmd-session.ts`. Vermutlich redundant — nur Feature-Diff prüfen, kein Vollport nötig.
5. **`tools/framer-export`** (eigenständiges CLI-Subtool mit eigenem `src/{ai,cli,config,exporter,formatter,logger,network,platforms,server}/`). Aktuell externe Voraussetzung, die laut CHANGELOG schon mal vergessen wurde separat zu installieren (Ursache für den 1 fehlgeschlagenen Test aus Teil 3). **Empfehlung:** als echtes 8. Workspace-Package aufnehmen (`packages/framer-export`) statt externe lose Abhängigkeit — macht `npm ci` allein ausreichend, kein separater Install-Schritt mehr vergessbar.

---

## Teil 6 — Weitere sinnvolle Verbesserungen

- **Root-Hygiene nachziehen**: `eslint.config.mjs` existiert fertig und funktionierend in `site-clone-to-v3` — kann nahezu 1:1 übernommen werden, kein Neuschrieb nötig. `docs/AI-EXECUTOR-PLAYBOOK.md` existiert ebenfalls wortwörtlich in `site-clone-to-v3/docs/` als Basis. `README.md` und `.prettierrc.json` fehlen komplett und sollten vor Phase 51 ergänzt werden, nicht danach.
- **Technische Schulden vor Erweiterung lösen**: Die 3 parallelen Diff-Layer und die doppelten `IssueType`/`IssueSeverity`-Definitionen (bereits in `BAUPLAN-v1.0.md` als Schuld dokumentiert) sollten **vor** Phase 58 konsolidiert werden — sonst wächst die Redundanz mit jedem neuen QA-Script weiter statt sich aufzulösen.
- **AIRouter-Provider fehlen**: `ClaudeProvider`/`Gpt4VisionProvider` sind nicht implementiert, wodurch der komplette AI-Layer (Phase 38, bereits „fertig" laut Status) faktisch nicht instanziierbar ist. Sollte vor Phase 51 (die stark auf KI-gestützte Klassifikation angewiesen sein wird) nachgezogen werden.
- **`elementor-version.ts`** (Framer-Repo) prüft die Elementor-Version WP-seitig vor dem Build — das deckt sich konzeptionell mit dem PHP-seitigen `Elementor_Version_Resolver` in `novamira-adrianv2`. Empfehlung: TS-Seite ruft nur die bestehende PHP-Ability ab, keine eigene Versions-Erkennungslogik duplizieren.

---

## Teil 7 — Empfohlene Reihenfolge

1. Teil 3 (Bugfixes) + Teil 6 Root-Hygiene — unabhängig, sofort
2. Phasen 43, 45, 46 (Scraper, Classifier, Recon) — unabhängig voneinander, parallelisierbar
3. Phase 44 (Builder-Merge) → dann Phase 54 (WPCode-Split, braucht 44 als Vorlage)
4. Phase 51 (Framer-Extraktion) — kann parallel zu 2./3. laufen
5. Phase 52 → Phase 53 (V4-Postprocessing → V4-Guards, sequenziell)
6. Phase 55, 56 — unabhängig, können früh laufen
7. Phase 48 erweitert (Orchestrator) → Phase 47 (MCP/WP-Push, braucht normalisierten Tree aus 44)
8. Phase 50 ergänzt (Framer-Bridge) — braucht 51, 52, 53
9. AIRouter-Provider (Teil 6) → **Healing-Loop fertigstellen** → Phase 58 (Post-Build-QA)
10. Phase 49 (CLI-Vereinheitlichung) **zuletzt** — verdrahtet alle vorherigen Phasen als Commands

---

## Teil 8 — Definition of Done (Gesamt)

- Jede Zeile aus Teil 2a/2b hat einen Haken (✅ portiert) oder eine explizit begründete Ausnahme aus Teil 5
- `npx tsc --noEmit` weiterhin 0 Fehler über alle 8 Packages
- `npx vitest run` grün; Zielgröße realistisch bei ~2.400+ Tests (676 aktuell + 1289 aus site-clone-to-v3-Funktionsumfang + Framer-Anteil, abzüglich Redundanzen)
- Ein dedizierter Test verifiziert die V3/V4-Isolation aktiv (Cross-Import schlägt fehl / Contamination-Check greift) — nicht nur Konvention, sondern erzwungen
- `npm run lint` läuft durch (aktuell nicht der Fall)
- `README.md`, `docs/AI-EXECUTOR-PLAYBOOK.md`, `docs/CRITICAL-FAILURE-POINTS.md` vorhanden
