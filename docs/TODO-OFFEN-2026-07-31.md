# TODO — Offene Arbeiten im Unified Elementor Converter

> **Stand:** 2026-07-31, nach der Build-Reparatursession
> **Zweck:** Aktueller Übergabestand. Erledigte Build-/Integrationsarbeiten sind von echten Produkt- und Dokumentationslücken getrennt.

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
- **Fokussierte Regressionen:** 86 Tests grün.
- **Serielle Vollsuite:** 98 Testdateien, 1150 Tests grün, 2 Tests übersprungen.
- **Parallele Vollsuite:** ein reproduzierter/isolierter Lauf zeigte 1148 grüne Tests plus einen Timeout im bestehenden `cmd-design-critic`-Test; seriell läuft derselbe Test grün. Das bleibt als Flaky-Test-/Parallelisierungsrisiko dokumentiert.
- **Lint:** 0 Fehler; verbleibende `no-explicit-any`-Warnungen in bestehenden/kompatibilitätsnahen Dateien sind als Folgearbeit dokumentiert.
- **Whitespace:** `git diff --check` grün.

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

Der Reparatur-Diff wurde vollständig inventarisiert. Die Änderungen umfassen Build-/Typfixes, V3/V4-Adaptergrenzen, Laufzeitkorrekturen, Regressionstests und synchronisierte Dokumentation. Nach dem finalen Gate wird dieser Stand als nachvollziehbarer Commit veröffentlicht.

- [ ] `git diff` aller geänderten Dateien vollständig lesen und jede Änderung klassifizieren:
  - Build-/Typfix
  - Laufzeitfix
  - API-Adapter
  - Test
  - Dokumentation
  - Legacy-Kompatibilität
- [ ] `packages/target-v4/src/legacy-plan.ts` als dauerhaften Adapter bestätigen und den direkten Adapter-Vertrag mit einem eigenen Test oder der Dry-Run-Testabdeckung dokumentieren.
- [ ] Prüfen, ob alle Änderungen aus der vorherigen Session gewollt sind; keine unbeabsichtigten Format-/Portierungsänderungen übernehmen.
- [x] Untracked-Dateien geprüft: enthalten sind nur diese TODO-Doku, `packages/target-v4/src/legacy-plan.ts` und der neue Dry-Run-Test.
- [x] `git fetch origin` ausgeführt; `origin/main` war vor dem Commit unverändert.
- [ ] Commit nach bestandenen Release-Gates erstellen und pushen.

**Abnahme:** keine unreviewten Dateien, keine temporären Prüfartefakte, nachvollziehbarer Diff.

---

## 3. P1 — Bewusst übersprungene Legacy-Pfade entscheiden

In `packages/cli/src/analysis/pipeline.ts` werden diese Optionen bewusst nicht als Erfolg simuliert, sondern als übersprungen vermerkt:

- `--qa-auto-fix`
- `--heal`
- `--full-context-repair`

Offene Entscheidung je Pfad:

- [ ] **Auto-Fix:** kompatiblen injizierten Port zu `runAutoFixLoop()` herstellen oder Option als `deprecated/unavailable` kennzeichnen.
- [ ] **Healing:** echten Capture-/Fix-Vertrag zu `healing-loop-v2.ts` anbinden oder Option entfernen/deprecaten.
- [ ] **Full-context repair:** echten AIRouter-/RepairBlock-Vertrag anbinden oder Option entfernen/deprecaten.
- [ ] CLI-Hilfe, README, AGENTS und Wizard-UX mit dem tatsächlichen Status synchronisieren.
- [ ] Für jeden übersprungenen Pfad einen CLI-Test ergänzen, der den Hinweis und keinen falschen Score prüft.

**Regel:** Kein nicht ausgeführter Reparaturpfad darf als erfolgreich gemeldet werden.

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

Der Produktions-Lint hat keine Fehler, aber sechs Warnungen:

- `packages/cli/src/cmd-deploy.ts` — `any`
- `packages/extractors/src/browser/playwright-extractor.ts` — drei `any`
- `packages/target-v4/src/mcp-bridge-v4.ts` — zwei `any`

- [ ] `any`-Warnungen durch konkrete strukturelle Typen ersetzen, sofern die Playwright-/MCP-Grenzen das zulassen.
- [ ] Bei dynamischen Browser-/MCP-Objekten alternativ schmale lokale Interfaces verwenden.
- [ ] Danach Lint erneut mit 0 Fehlern und idealerweise 0 Warnungen ausführen.

Diese Warnungen blockieren den aktuellen Build nicht, sollten aber vor einem Release bereinigt werden.

---

## 6. P2 — Zentrale Dokumentation synchronisieren

Die folgenden Dokumente enthalten noch alte Statusformulierungen aus der Zeit vor der Reparatursession:

- [ ] `docs/BAUPLAN-v5.0-KONVERGENZ-NOVAMIRA-WIZARDS-2026-07.md`
  - Status von `Geplant` auf verifiziert/abgeschlossen oder „Feature-Phasen abgeschlossen, Integrationsnacharbeiten offen“ ändern.
  - alten roten `tsc`-Status entfernen.
  - Wizard-/Phase-73-/Ability-Angaben gegen den aktuellen Code abgleichen.
- [ ] `docs/PROGRESS.md`
  - `tsc --build` als verbindlichen Buildstatus aufnehmen.
  - Phase 73 und die Phasen 109–115 gegen Tests und aktuelle Implementierung abgleichen.
- [ ] `docs/HANDOFF-2026-07-30.md`
  - 17-Fehler-Stand als erledigt markieren.
  - neue verbleibende Punkte aus diesem TODO-Dokument verlinken.
- [ ] `README.md`/`AGENTS.md`
  - `elconv` als kanonischen Einstiegspunkt hervorheben.
  - `clone-v3`-Legacy-Kompatibilität und übersprungene Reparaturoptionen klar benennen.
  - Dry-Run-Garantie mit Beispiel dokumentieren.

---

## 7. P2 — Noch ausstehende Release-Gates

- [x] `npx tsc --build --clean`
- [x] `npx tsc --build --pretty false`
- [x] betroffene Tests und Regressionen
- [x] serielle Vollsuite
- [x] Lint ohne Fehler
- [x] `git diff --check`
- [ ] parallele Vollsuite ohne Timeout/Flaky-Verhalten
- [ ] V3-Golden-Path erneut ausführen
- [ ] V4-Golden-Path erneut ausführen
- [ ] Visual-Regression-Test in der aktuellen Arbeitsbaumversion ausführen
- [ ] CLI-Smoke-Tests für `help`, `convert`, `wizard --no-interactive`, `batch`, `serve`, `rollback`, `preflight`
- [ ] kontrollierter MCP-Dry-Run und Live-Preflight, falls Credentials/Target ausdrücklich verfügbar sind
- [ ] keine unreviewten untracked Dateien

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

1. Nach dem Push die veröffentlichten Commits und den Remote-Status verifizieren.
2. Eigenen V4-Legacy-Plan-Test und CLI-Tests für übersprungene Reparaturoptionen ergänzen.
3. Parallel-Timeout des Design-Critic-Tests isolieren/beheben.
4. `any`-Warnungen bereinigen.
5. Zentrale Docs synchronisieren.
6. Golden-/Visual-/CLI-Smoke-Gates ausführen.
7. Erst danach in kleine Commits aufteilen und vor Push `git fetch origin` ausführen.

---

## 10. Definition of Done

- [x] Clean `tsc --build` ohne TypeScript-Fehler.
- [x] V3/V4-Isolation und Dry-Run-Regressionsnachweise vorhanden.
- [x] XML-Entity- und SVG-Provenienz-Regressionsnachweise vorhanden.
- [x] Serielle Vollsuite grün.
- [x] Lint ohne Fehler.
- [ ] Alle Reparaturänderungen fachlich reviewt und in Commits zugeordnet.
- [ ] Übersprungene Legacy-Optionen implementiert oder ausdrücklich deprecatet/unavailable.
- [ ] Responsive-/Framer-Legacy-Verträge entschieden und getestet.
- [ ] Paralleltest stabil oder als bekannte Einschränkung dokumentiert.
- [ ] Zentrale Projekt-Dokumentation synchronisiert.
- [ ] Release-/Smoke-/Golden-Gates abgeschlossen.

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
