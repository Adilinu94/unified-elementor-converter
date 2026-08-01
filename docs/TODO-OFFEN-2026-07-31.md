# TODO — Offene Arbeiten im Unified Elementor Converter

> **Stand:** 2026-07-31, nach der Build-Reparatursession
> **Zweck:** Aktueller Übergabestand. Erledigte Build-/Integrationsarbeiten sind von echten Produktlücken und optionalen Folgearbeiten getrennt.

---

## 0. Verifizierter Kurzstatus

### Erledigt/verifiziert in dieser Reparatursession

- [x] Workspace-Projektgraph korrigiert: `target-v3` referenziert `qa`.
- [x] `npx tsc --build --clean && npx tsc --build --pretty false` ist grün (Exit 0).
- [x] Die 17 ursprünglichen CLI-TypeScript-Fehler sind behoben.
- [x] CLI-Verträge vereinheitlicht:
  - AIRouter-Factory-Vertrag
  - kanonische Unified-Imports in `clone-v3`
  - Dry-Run über V3-/V4-Adapter
  - DOM-Lib für Playwright-`evaluate`
  - explizite Phase-11-Barrel-Aliase
  - korrekte Probe-/Responsive-Typen
- [x] V3/V4-Grenze bleibt getrennt; der V4-Legacy-Plan importiert nicht aus `target-v3`.
- [x] Inline-SVGs behalten jetzt `sourceElement`-Provenienz; kleine valide SVGs werden nicht mehr verworfen.
- [x] SVG-Selector-Escaping für IDs/Klassen ergänzt.
- [x] XML-Attribute und Text-Entities werden beim Framer-XML-Adapter dekodiert.
- [x] Dry-Run-Regressionstest ergänzt: V3-/V4-Artefakte, Animationsartefakt, keine `fetch`-/MCP-Aufrufe und keine V3/V4-Kontamination.
- [x] Browser-Regressionstest für kleine Inline-SVGs und Provenienz ergänzt.
- [x] Temporäre Prüfdatei `tv4-check.txt` entfernt.
- [x] Mechanische Lint-Fehler in den betroffenen Legacy-Dateien bereinigt.

### Aktuelle Qualitätsnachweise

- **Clean TypeScript-Build:** grün.
- **Fokussierte Regressionen:** 12 Legacy-/Healing-Tests grün nach der letzten Report-Erweiterung.
- **Serielle Vollsuite:** 100 Testdateien, 1159 Tests bestanden, 2 Tests übersprungen.
- **Parallele Vollsuite:** ein reproduzierter/isolierter Lauf zeigte 1148 grüne Tests plus einen Timeout im bestehenden `cmd-design-critic`-Test; seriell läuft derselbe Test grün. Das bleibt als Flaky-Test-/Parallelisierungsrisiko dokumentiert.
- **Lint:** 0 Fehler und 0 Warnungen; die sechs `no-explicit-any`-Stellen wurden durch schmale Strukturtypen ersetzt.
- **Whitespace:** `git diff --check` grün.
- **Gate-Bericht:** Die ausgeführten Golden-/Visual-/CLI-Gates sind in `docs/RELEASE-GATES-2026-07-31.md` vollständig dokumentiert.

### Nicht erneut als offene Phasen einplanen

Laut aktuellem v5-Bauplan bleiben die Feature-Phasen 100–115 als implementiert dokumentiert: Ability-Registry, Wizard, Konvergenz, Server-Design-Critic, Snapshot/Rollback, Progress, Visual-Regression-CI, Batch-Orchestrator, Fix-Learning und Plugin-Preflight.

---

## 1. P0 — Erledigt: Workspace-Build

Der ursprüngliche P0-Block ist abgeschlossen.

- [x] `packages/cli/src/analysis/pipeline.ts`
- [x] `packages/cli/src/clone-v3.ts`
- [x] `packages/cli/src/cmd-design-critic.ts`
- [x] `packages/cli/src/dry-run.ts`
- [x] `packages/cli/src/framer-build-wizard.ts`
- [x] `packages/cli/src/index.ts`
- [x] Project references und Clean-Build geprüft.

**Abnahme:** `tsc --build` ohne Fehler; V3/V4-Isolation bleibt intakt.

---

## 2. P1 — Reparatur-Diff abschließen

Der Reparatur-Diff ist inventarisiert und die aktuellen Änderungen sind durch fokussierte Reviews, Build-, Test- und Lint-Gates abgesichert. Vor dem Commit bleiben die abschließende vollständige Diff-Prüfung, die Remote-Synchronität und die Veröffentlichung.

- [x] Geänderte Dateien nach Build-/Typfix, Laufzeitfix, API-Adapter, Test und Dokumentation klassifiziert.
- [x] `packages/target-v4/src/legacy-plan.ts` als dauerhaften Adapter bestätigt; Dry-Run-Regression deckt den Vertrag ab.
- [x] Änderungen auf unbeabsichtigte Format-/Portierungsänderungen geprüft.
- [x] Untracked-Dateien geprüft; die neuen Legacy-Reparaturmodule und Tests sind beabsichtigt.
- [x] `git diff --check` und Produktions-Lint grün.
- [ ] Commit nach bestandenen finalen Release-Gates erstellen und pushen.

**Abnahme:** keine unreviewten Dateien, keine temporären Prüfartefakte, nachvollziehbarer Diff.

---

## 3. P1 — Legacy-Pfade implementiert, Port-Voraussetzungen dokumentiert

Die drei Legacy-Optionen sind jetzt an echte, injizierbare Verträge angebunden. Ohne die jeweils erforderlichen Ports melden sie explizit `unavailable`; Laufzeitfehler oder ein nicht erreichtes Reparaturziel melden `failed`. Kein nicht ausgeführter Pfad darf als Erfolg erscheinen.

- [x] **Auto-Fix:** `runAutoFixLoop()` über `probeRunner`, `probeChecks` und `WpcodeUpdatePort`; CLI baut bei MCP-Target den WPCode-Port.
- [x] **Healing:** Capture → Diff → Fix → Re-Capture → Verify über `runHealingLoop()`; reale Diff-Issues werden klassifiziert und nach Re-Capture erneut bewertet.
- [x] **Full-context repair:** `detectIssues()` → `RepairBlockInput` → injizierter `AIRouter`; Bericht bleibt diagnostisch und schreibt keine WordPress-Änderung.
- [x] CLI-/Pipeline-Status und Artefakte dokumentieren `ok`, `unavailable` und `failed` getrennt.
- [x] Tests für Ports, Re-Capture, fehlende Voraussetzungen und `runPipeline()`-Stage-/Artefaktverträge ergänzt.

**Voraussetzungen:** Auto-Fix benötigt `--clone-url`, `--post-id`, `--probe-checks`, MCP-WPCode-Port und Probe-Runner; Healing benötigt `--clone-url` und Healing-Fix-Port; Full-context repair benötigt `--clone-url`, AI-Key/Router und Context-Provider.

---

## 4. P1 — Noch offene Laufzeitverträge und Tests

### 4.1 Framer-/V3-Kompatibilität

- [ ] `FramerConvertOptions` fachlich entscheiden: `textStyles`/`colorStyles` anwenden oder den bewusst ignorierten Legacy-Hook als deprecateten No-op dokumentieren.
- [ ] `autoTextEditor()` fachlich entscheiden: echte alte Funktion zurückholen, Hook entfernen oder No-op ausdrücklich als kompatiblen Legacy-Hook testen.
- [ ] Framer-XML-Parser zusätzlich gegen beschädigte/ungewöhnliche Eingaben, gemischte Tag-Schreibweise und verschachtelte/self-closing Strukturen testen.
- [ ] Responsive-JSON im Wizard nicht nur typisieren, sondern zur Laufzeit validieren und verständlich ablehnen.

### 4.2 QA-/Report-Pfade

- [ ] `runPipeline()` mit `visionEnhance` und injiziertem Router als Integrationsfall testen.
- [ ] Prüfen, dass Auto-Fix/Healing den letzten `GeometryProbeReport` weiterreichen und keinen unnötigen zweiten Browserlauf auslösen.
- [ ] `run-report.md` mit echtem `GeometryProbeReport` als Regressionstest absichern.
- [ ] Parallel-Timeout des `cmd-design-critic`-Tests diagnostizieren und entweder Test-Isolation/Mocks verbessern oder als bekannte Vitest-Parallelisierungsbesonderheit dokumentieren.

### 4.3 V4-Adapter

- [ ] Eigenen Test für `buildV4Plan()` mit klassifiziertem Section-Fixture ergänzen: Widget-Mapping, Summary und V4-only output.
- [ ] Unknown-Widget-Fallback (`html`) als bewusste Produktentscheidung dokumentieren oder konfigurierbar machen.
- [ ] Prüfen, ob `V4Plan.summary.widgetCount` bei verschachtelten e-flexbox-Strukturen exakt dem erwarteten Produktvertrag entspricht.

---

## 5. P1/P2 — Lint- und Codequalität

Der Produktions-Lint ist vollständig bereinigt:

- [x] `packages/cli/src/cmd-deploy.ts` — CLI-Strategie wird ohne `any` typisiert; `auto` wird korrekt zu automatischer Auswahl normalisiert.
- [x] `packages/extractors/src/browser/playwright-extractor.ts` — Browser-Globals und structured-clone-Rückgabe sind schmal typisiert.
- [x] `packages/target-v4/src/mcp-bridge-v4.ts` — HTTPS-Agent wird als `unknown` statt `any` geführt.
- [x] Produktions-Lint erneut ausgeführt: 0 Fehler, 0 Warnungen.

Weitere Codequalitätsarbeiten sind nicht mehr durch diese Warnungsgruppe blockiert.

---

## 6. P2 — Zentrale Dokumentation synchronisieren

Die zentralen Statusdokumente sind synchronisiert. Historische Plan- und Handoff-Dateien bleiben als historische Protokolle gekennzeichnet; der aktuelle Status steht in diesem TODO, `AGENTS.md`, `README.md` und dem v5-Bauplan:

- [x] `docs/BAUPLAN-v5.0-KONVERGENZ-NOVAMIRA-WIZARDS-2026-07.md` — aktueller Status, grüner Clean-Build und Legacy-Pfade ergänzt.
- [x] `docs/PROGRESS.md` — verbindlicher `tsc --build`-Status sowie Phase 73 und Phasen 100–115 aktualisiert.
- [x] `docs/HANDOFF-2026-07-30.md` — ausdrücklich als historischer Ausgangsstand markiert und auf die aktuelle Doku verwiesen.
- [x] `README.md`/`AGENTS.md` — kanonischer Einstiegspunkt, Legacy-Kompatibilität, Port-Voraussetzungen und Dry-Run-Vertrag dokumentiert.
- [ ] Optional: weitere historische Detailabschnitte in Archivdokumenten redaktionell nachführen.

## 7. P2 — Noch ausstehende Release-Gates

- [x] `npx tsc --build --clean`
- [x] `npx tsc --build --pretty false`
- [x] betroffene Tests und Regressionen
- [x] serielle Vollsuite
- [x] Lint ohne Fehler
- [x] `git diff --check`
- [ ] parallele Vollsuite ohne Timeout/Flaky-Verhalten
- [x] V3-Golden-Path erneut ausführen — 8/8 bestanden
- [x] V4-Golden-Path erneut ausführen — 15/15 bestanden
- [x] Visual-Regression-Test in der aktuellen Arbeitsbaumversion ausführen — 2/2 bestanden
- [x] CLI-Smoke-Tests für `help`, `convert`, `wizard --no-interactive`, `batch`, `serve`, `rollback`, `preflight` — 43/43 Unit-/Smoke-Tests bestanden; direkte CLI-Smokes dokumentiert
- [ ] kontrollierter MCP-Dry-Run und Live-Preflight, falls Credentials/Target ausdrücklich verfügbar sind
- [x] Keine unreviewten untracked Dateien; die neuen Legacy-Module und Tests sind beabsichtigt.

**Release-Gate:** Build grün, Tests stabil, Lint akzeptiert, Dokumentation synchron, Diff reviewt, keine Secrets.

---

## 8. P3 — Optionale Roadmap

Nicht erforderlich für den abgeschlossenen Build-Block:

- [ ] Remote-Pipeline-State im Wizard tatsächlich verdrahten.
- [ ] Server-Memory für Build-Lessons (`memory-save/list/get`).
- [ ] Server-Skill-Deployment (`skill-write/get`).
- [ ] `elconv migrate-site` für die serverseitige V3→V4-Site-Konvertierung mit Snapshot und QA.
- [ ] Nightly-Ability-Drift-CI.
- [ ] Ability-Schema-Codegen aus `mcp-adapter-get-ability-info`.
- [ ] Golden-Page als dauerhafte V4-E2E-Referenz einfrieren.
- [ ] Vorgänger-Repositories archivieren.
- [ ] Meta-/Ops-Tooling getrennt unter `tools/` organisieren.
- [ ] PHP-Ability-Injector als separate Deployment-Komponente dokumentieren.

---

## 9. Empfohlene nächste Reihenfolge

1. Vollständigen Diff erneut reviewen und `git fetch origin` unmittelbar vor dem Commit ausführen.
2. Commit und Push der geprüften Folgeänderung; anschließend Remote-Status verifizieren.
3. Optional: kontrollierte Live-/MCP-Verifikation mit explizitem Target und Snapshot davor.
4. Optional: Parallel-Timeout des Design-Critic-Tests isolieren oder als bekannte Einschränkung weiterführen.

---

## 10. Definition of Done

- [x] Clean `tsc --build` ohne TypeScript-Fehler.
- [x] V3/V4-Isolation und Dry-Run-Regressionsnachweise vorhanden.
- [x] XML-Entity- und SVG-Provenienz-Regressionsnachweise vorhanden.
- [x] Serielle Vollsuite grün.
- [x] Lint ohne Fehler.
- [x] Alle Reparaturänderungen fachlich reviewt und für die Commit-Zuordnung vorbereitet.
- [x] Legacy-Optionen implementiert; fehlende Ports werden ausdrücklich als `unavailable` und nicht als Erfolg gemeldet.
- [ ] Responsive-/Framer-Legacy-Verträge entschieden und getestet.
- [ ] Paralleltest stabil oder als bekannte Einschränkung dokumentiert.
- [x] Zentrale Projekt-Dokumentation synchronisiert.
- [x] Release-/Smoke-/Golden-Gates abgeschlossen — siehe `docs/RELEASE-GATES-2026-07-31.md`.

---

## Verbindliche Prüfkommandos

```bash
npx tsc --build --clean
npx tsc --build --pretty false
npx vitest run --pool=forks --maxWorkers=1 --minWorkers=1 --testTimeout=15000
npx eslint packages/cli/src packages/extractors/src packages/target-v3/src packages/target-v4/src
git diff --check
git status --short --branch
```

> Keine dieser Prüfungen ersetzt eine kontrollierte Live-Verifikation gegen Novamira. Live-Deployments nur mit explizitem Target, Snapshot davor, Dry-Run wo möglich und anschließender QA durchführen.
