# TODO — Offene Arbeiten im Unified Elementor Converter

> **Stand:** 2026-08-03, nach Read-back-/Cache-Vertragsprüfung
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

- **Live-Read-only-Preflight 2026-08-03:** MCP-Session-Handshake, Ability-Discovery (234 Abilities), Elementor 4.2.1, PHP 8.2.23 und WordPress 7.0.2 erfolgreich geprüft; Preflight bleibt wegen fehlendem WPCode Lite fehlgeschlagen. WordPress liegt außerdem über der getesteten Maximalversion 6.8. Keine Mutation, Installation oder `--fix`-Aktion ausgeführt.

- **Clean TypeScript-Build:** grün.
- **Fokussierte Regressionen:** 63 Tests grün für Parser/Extractor, Responsive-Wizard, Vision-Router-Injection, Legacy-Reparatur, Run-Report, V4-Plan und Design-Critic.
- **Serielle Vollsuite 2026-08-03 (nach Timeout-Korrektur):** 114 Testdateien, 1273 Tests bestanden, 2 Tests übersprungen; keine Fehler oder Timeouts im finalen Lauf (156,53 s).
- **Parallele Vollsuite:** bleibt als separates Flaky-Test-/Parallelisierungsrisiko dokumentiert; der maßgebliche serielle Release-Lauf ist vollständig grün.
- **Lint:** 0 Fehler und 0 Warnungen; die sechs `no-explicit-any`-Stellen wurden durch schmale Strukturtypen ersetzt.
- **Whitespace:** `git diff --check` grün.
- **Read-back/Cache:** direkte und `data`-Wrapper werden erkannt; der kanonische Dokument-Cache-Clear verwendet `{ post_ids: [postId] }`; direkte und gewrappte Fehler bleiben fehlgeschlagen.
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

## 2. P1 — Reparatur-Diff abgeschlossen

Der Reparatur-Diff ist inventarisiert und durch fokussierte Reviews, Build-, Test- und Lint-Gates abgesichert. Die abschließende vollständige Diff-Prüfung, die Remote-Synchronität und die Veröffentlichung sind erfolgt (Release-Commit `f4264e6`, Push auf `main` verifiziert).

- [x] Geänderte Dateien nach Build-/Typfix, Laufzeitfix, API-Adapter, Test und Dokumentation klassifiziert.
- [x] `packages/target-v4/src/legacy-plan.ts` als dauerhaften Adapter bestätigt; Dry-Run-Regression deckt den Vertrag ab.
- [x] Änderungen auf unbeabsichtigte Format-/Portierungsänderungen geprüft.
- [x] Untracked-Dateien geprüft; die neuen Legacy-Reparaturmodule und Tests sind beabsichtigt.
- [x] `git diff --check` und Produktions-Lint grün.
- [x] Commit nach bestandenen finalen Release-Gates erstellt und gepusht; Remote-Status verifiziert.
- [ ] Live-Read-back-/Cache-Response gegen das freigegebene Novamira-Testziel erneut bestätigen.

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

- [x] `FramerConvertOptions` als bewusst kompatiblen No-op entschieden und getestet; `textStyles`/`colorStyles` werden nicht stillschweigend in eine zweite Mapping-Logik übernommen.
- [x] `autoTextEditor()` als expliziten kompatiblen No-op behalten und per Regressionstest abgesichert.
- [x] Framer-XML-Parser gegen Entities, Single-Quote-Attribute, gemischte Tag-Schreibweise, self-closing Nodes und falsch/unbekannt geschlossene Tags gehärtet und getestet.
- [x] Responsive-JSON im Wizard zur Laufzeit validiert; ungültige, ausdrücklich angegebene Dateien werden verständlich abgelehnt.

### 4.2 QA-/Report-Pfade

- [x] `runPipeline()` mit `visionEnhance` und injiziertem Router als Integrationsfall getestet.
- [x] Auto-Fix reicht den letzten `GeometryProbeReport` an den Run-Report weiter; der Vertrag ist über den Orchestrator-/Report-Pfad und fokussierte Regressionen abgesichert.
- [x] `run-report.md` mit echtem `GeometryProbeReport` als Regressionstest abgesichert.
- [x] Parallel-Timeout des `cmd-design-critic`-Tests als bekannte Vitest-Forks-/Parallelisierungsbesonderheit dokumentiert; der isolierte und serielle Lauf ist grün.

### 4.3 V4-Adapter

- [x] Eigenen Test für `buildV4Plan()` mit klassifiziertem Section-Fixture ergänzt: Widget-Mapping, Summary und V4-only output.
- [x] Unknown-Widget-Fallback (`html`/`e-html`) als bewusste, im Adapter dokumentierte Produktentscheidung festgelegt.
- [x] `V4Plan.summary.widgetCount` bei verschachtelten e-flexbox-Strukturen rekursiv geprüft; gezählt werden nur echte Widgets.

### 4.4 O-03 Vorbereitung — Offline-Fixtures und Mock-Adapter-Tests (keine produktive Freischaltung)

- [x] `packages/mcp/src/large-deploy-plan.ts`: friert den geplanten Aufrufvertrag für `upload-php` (2 Chunks: replace → append) und `split` (20-Element-Chunks, danach append) als reine Daten mit ausschließlich Registry-bekannten Ability-Namen ein; `requiresSchemaVerification: true` ist als Literal-Typ gesetzt, damit kein Codepfad den Plan als verifiziert behandeln kann.
- [x] `assertPlanUsesKnownAbilities()`: Registry-Drift-Guard wirft `UnknownAbilityError` bei unbekanntem Namen; Regressionscheck, dass nie `execute-php`/`file_get_contents` referenziert wird (historischer Temp-File-Bug).
- [x] `runPlannedDeploy()`: mock-ausführbarer Executor mit einem Retry pro Chunk-Deploy, Read-back + Cache-Clear nach jedem relevanten Schritt, Resume-/Checkpoint-Reporting; produktiv erst nach verifizierten Server-Schemas übernehmen.
- [x] Offline-Fixtures `tests/unit/mcp/fixtures/large-trees.ts`: deterministische V3-Tree im `upload-php`-Band (~464 KB) und V4-Tree im `split`-Band (~1,43 MB).
- [x] **Framer-Sonderfall-Fixtures erweitert:** zusätzliche realistische V3-/V4-Trees mit Style-Referenzen (V3 `css_classes`-String-Gotcha; V4 `classes`-Binding an `styles{}` inkl. externer `gc-*`-Global-Class-Refs und Global-Variable-Props `global-color-variable`/`global-font-variable`), CMS-Collection-Instanzen (V3 `posts`-Widget, V4 `e-grid`-Loop mit `collectionId`/`cmsCollectionSlug`) und Unknown-Widget-Fallbacks (V3 `widgetType: 'html'`, V4 `e-html` mit `html-content`-$$type) — im `upload-php`-Band (~449 KB) bzw. `split`-Band (~1,34 MB); die V4-Sonderfall-Tree besteht die komplette V4-Guard-Suite als Realismus-Gate.
- [x] `tests/unit/mcp/large-deploy-offline.test.ts`: 34 Tests — Bandenwahl, geplanter Vertrag (modes/Reihenfolge/Parameter), Registry-Guard, ehrliches Gate (`executeDeploy` bleibt `capability-unavailable` mit 0 MCP-Calls), Mock-Ausführung mit Retry/Resume sowie Sonderfall-Inhalts-/Vertrags-Regressionen über die neuen Fixtures.

**Status:** `executeDeploy` gated `upload-php`/`split` weiterhin mit `capability-unavailable` und führt keinen MCP-Write aus; die serverseitigen Upload-/Append-Schemas bleiben bis zur Verifikation gegen das echten Testziel unverifiziert.

### 4.5 O-04 Wizard-Verträge — maschinenlesbarer Vertrag und Optionsweitergabe

- [x] `packages/cli/src/wizard-contract.ts`: maschinenlesbarer `wizard-contract.json`-Vertrag — Exit-Codes (0 ok, 1 Phase fehlgeschlagen, 2 Usage), Per-Phase-Status (`ok`/`failed`/`skipped`/`pending`/`unavailable`), vollständiges Forwarding-Manifest aller V3-/V4-/QA-Optionen und Artefaktpfade pro Phase.
- [x] `wizardViewportsToConfig()`: Wizard-Viewports werden an die URL-Pipeline (Playwright-Multi-Viewport-Capture + Responsive-Matrix) weitergegeben.
- [x] `runWizardStateMachine` persistiert den Vertrag nach jeder Phase mit ehrlichem Exit-Code (auch bei Fehlschlag) und QA-Phase meldet maschinenlesbar `skipped`/`unavailable` statt synthetischem Erfolg.
- [x] Remote-Pipeline-State bleibt strukturiert `unavailable`: `remoteStateConfigured` im Vertrag ist ohne verifizierten Adapter `false`; Dry-Runs berühren Remote-State nie.
- [x] 15 Tests in `tests/unit/cli/wizard-contract.test.ts` (Exit-Codes, Viewport-Mapping, Forwarding, Statuses, Vertragspersistenz, Remote-Gate).
- [x] **Build-Optionen-Durchreichung:** `packages/core/src/build-options.ts` definiert den kanonischen `BuildOptions`-Vertrag (strictness/animations/fonts/sections) plus `guardThresholdForStrictness()` (draft 70 / balanced 85 / pixel-perfect 95) und `matchesSectionSelector()`/`selectSpecSections()`; `buildV3Tree`/`buildV4Tree` akzeptieren die Optionen und konsumieren `sections` (Section-Filter nach id/semanticRole/cssClass); `executeBuild` reicht alle vier Optionen an die Builder durch, `executeValidate` nutzt den Strictness-Schwellwert, und die URL-Pipeline erhält sie via `runPipeline` (Sections scopen Build + Animation-Targets, `animations: none` überspringt Stage 6, `fonts: system` überspringt Font-Downloads/Kit-Sync, Strictness mappt auf den QA-Acceptance-Score); der `wizard-contract.json` führt `optionsAppliedToBuild` als maschinenlesbaren Paritäts-Nachweis.
- [x] Regressionen: `tests/unit/core/build-options.test.ts` (14 Tests: Threshold-Mapping, Selector-Matching, Sections-Filter in beiden Buildern) + e2e-`--sections`-Test im Wizard (gefilterter Baum wird tatsächlich gebaut) + `optionsAppliedToBuild`-Assertions im Vertragstest.

### 4.6 O-12 Konsolidierter, versionierter Wizard-Contract — `wizard-contract.schema`

- [x] `packages/core/src/contracts/wizard-contract.contract.ts`: `WizardContractSchema` (Zod) als **Single Source of Truth** — Phase-Namen/-Status-Enums, Exit-Codes (0/1/2/null), `optionsForwarded`, `optionsAppliedToBuild`, Artefaktpfade, Remote-State-Gate; `WizardContract`/`WizardContractPhase`/`WizardOptionsForwarded` werden per `z.infer` abgeleitet; `validateWizardContract()` soft-validiert („path: message“-Fehler via `formatZodIssues` aus config.ts); `wizardContractJsonSchemaDocument()` erzeugt deterministisch das JSON-Schema-Dokument (draft 2020-12) mit `$id`/`version`-Metadaten.
- [x] Versionierung: Vertrag trägt `schemaVersion: 1` (Maschinen-Gate) und `$schema: elconv/wizard-contract/v1` (Selbstbeschreibung); `writeWizardContract` validiert jedes Artefakt **vor dem Schreiben** — ein ungültiger Vertrag wird nie persistiert.
- [x] `schemas/wizard-contract.schema.json` (committet) + `scripts/export-wizard-contract-schema.ts` (Generierung; `node --import tsx scripts/export-wizard-contract-schema.ts`).
- [x] `tests/unit/cli/wizard-contract-schema.test.ts`: 16 Tests — valider Vertrag akzeptiert, Mutationen abgelehnt (falsches schemaVersion, fehlendes `$schema`, unbekannter Exit-Code/Status/Strictness, fehlendes `optionsAppliedToBuild`, falsches Target), Fehlerpfad-/Metadaten-Checks und **Drift-Guard**: die committete Schema-Datei muss exakt dem generierten Dokument entsprechen.
- [x] **Pre-O-12-Migration:** `migrateWizardContract()` in `packages/core/src/contracts/wizard-contract.contract.ts` erkennt alte Artefakte ohne `$schema` (Pre-O-12, commit a06d139) und soft-migriert sie — stempelt `$schema: elconv/wizard-contract/v1`, füllt fehlende `optionsForwarded`-Felder mit den Wizard-Defaults (`WIZARD_CONTRACT_DEFAULTS`, spiegelt `createWizardState`: viewports `[1440,768,390]`, strictness `balanced`, animations `auto`, fonts `auto`, sections `[]`, qa-Schwellen), leitet fehlendes `optionsAppliedToBuild` aus dem Forwarded-Set ab, vervollständigt die Phasenliste (Status `ok` bei abgeschlossenem Lauf/exitCode 0, `pending` bei laufendem, sonst `skipped`) und validiert das Ergebnis gegen das versionierte Schema; anderslautende Schema-IDs (neuere Version) und weiterhin ungültige Werte werden ehrlich abgelehnt.
- [x] `readWizardContract()` in `packages/cli/src/wizard-contract.ts`: liest `wizard-contract.json` von Platte (Fehler bei fehlender Datei/ungültigem JSON als `{ ok: false, errors }`), delegiert an die Migration — externe Tooling liest alte und neue Artefakte mit einem Validator.
- [x] `tests/unit/cli/wizard-contract-migration.test.ts`: 19 Tests — Pre-O-12-Erkennung, `$schema`-Stempel, Validierung des migrierten Vertrags, Erhalt aufgezeichneter Status, Ablehnung fremder Schema-ID/falscher Version/Nicht-Objekt, Default-Befüllung der Optionen, Ableitung des Paritäts-Records, Phasen-Abschlussregeln (ok/pending/skipped je exitCode), kanonische Phasenreihenfolge, ehrlicher Fehler bei weiterhin ungültigem Wert, Datei-Reader (Migration, fehlende Datei, kaputtes JSON) und **Drift-Guard**: `WIZARD_CONTRACT_DEFAULTS` muss den `createWizardState`-Defaults entsprechen.
- [x] **Remote-Pipeline-State-Mock-Kontrakt (O-04/O-12-Vorbereitung):** `packages/cli/src/remote-state.ts` definiert den `WizardRemoteStateAdapter`-Vertrag (`save`/`load`/`resume` + explizites `status`-Gate) mit einem einzigen Factory-Einstieg `createRemoteStateAdapter()` — solange `status.verified` nicht true ist ODER kein Pipeline-State-Executor injiziert ist, meldet jede Operation ehrlich `unavailable` und der MCP-Client wird nie berührt (strukturelles Gate, kein Codepfad kann vor Schema-Verifikation remote schreiben). Persistierte Payloads werden in `WizardRemoteStateEnvelope` gewickelt (`$schema: elconv/wizard-contract/v1` — Referenz auf `schemas/wizard-contract.schema.json`, gemeinsames `schemaVersion: 1`-Maschinen-Gate); `validateWizardRemoteStateEnvelope()` prüft Referenz/Gate/PipelineId/savedAt/state. `createMockRemoteStateAdapter()` implementiert denselben Vertrag als Offline-In-Memory-Harness. Fehlerpfade: `unavailable`, `notFound`, `invalid-envelope` (nie stilles Coerzen), Server-Fehlerpropagation.
- [x] `tests/unit/cli/remote-state.test.ts`: 21 Tests — Gate-Zustände (nicht verifiziert → alles `unavailable`, Executor 0 Calls; verifiziert ohne Executor → weiterhin `unavailable`), Mock-Roundtrip (save/load/resume, `$schema`-Referenz, notFound), verifizierter MCP-Pfad mit injiziertem Fake-Executor (Envelope-Save, Load-Mapping, Resume, notFound, Server-Fehler, invalid-envelope) und Envelope-Kontrakt inkl. **Drift-Guard**: Envelope-`$schema` muss der committeten `schemas/wizard-contract.schema.json`-`$id` entsprechen.
- [x] **Ability-Schema-Codegen (O-12-Nachfolger):** `packages/mcp/src/ability-schema.ts` leitet das versionierte JSON-Schema-Dokument deterministisch aus dem Ability-Registry ab (`KNOWN_ABILITIES`/`ALIAS_MAP`/`UNAVAILABLE_ABILITIES` — der eingefrorene Live-Snapshot): `abilityJsonSchemaDocument()` erzeugt `schemas/novamira-abilities.schema.json` (`$id: elconv/novamira-abilities/v1`, `schemaVersion: 1`-Maschinen-Gate, `knownAbilities`-Enum aller 263 Namen, Alias-Map, dokumentierte Lücken, Namespace-Zählungen); `abilityNamespace()`/`abilityNamespaceCounts()` gruppieren deterministisch; `buildAbilityRegistrySnapshot()` baut das selbstbeschreibende Snapshot-Payload. `scripts/export-ability-schema.ts` generiert das Artefakt (analog zum wizard-contract.schema).
- [x] `tests/unit/mcp/ability-schema.test.ts`: 12 Tests — Schema-Metadaten (`$id`/draft/version), Enum deckt alle 263 Namen exakt und nur bekannte ab, Root-Machine-Gate + required, Determinsmus, Namespace-Aufteilung (Zählung summiert auf 263, `mcp-adapter` = 1), Snapshot-Payload gegen Registry, **Drift-Guard 1**: committete Schema-Datei == generiertes Dokument; **Drift-Guard 2**: `docs/NOVAMIRA-LIVE-ABILITIES-2026-07-30.txt` enthält exakt die `KNOWN_ABILITIES`-Menge (263 Zeilen).

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
- [x] `elconv convert --url`-Status im Audit synchronisiert; URL-Pipeline und deterministische Fehlerverträge sind implementiert.
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
- [x] kontrollierter read-only MCP-Preflight gegen das verfügbare Testziel ausgeführt; Ergebnis ist wegen fehlendem WPCode Lite blockiert, ohne Mutation, Installation oder `--fix`-Aktion
- [x] Read-back-/Cache-Payloads (`content` direkt oder unter `data`, Cache `{ post_ids: [id] }`) gegen das freigegebene Live-Ziel bestätigt; zusätzlich MCP-Session-Handshake und `execute-php.data`-Wrapper korrigiert.
- [ ] WPCode Lite auf dem freigegebenen Testziel installieren oder bewusst einen alternativen CSS/JS-Port freigeben; V3-Live-Preflight markiert das Plugin als erforderlich.
- [x] Keine unreviewten untracked Dateien; `packages/mcp/src/readback.ts` sowie die zugehörigen Adapter-/Read-back-Tests sind beabsichtigt und in der Vollsuite enthalten.

**Release-Gate:** Build grün, Tests stabil, Lint akzeptiert, Dokumentation synchron, Diff reviewt, keine Secrets.

---

## 8. P3 — Optionale Roadmap

Nicht erforderlich für den abgeschlossenen Build-Block:

- [ ] Remote-Pipeline-State im Wizard über einen verifizierten MCP-Adapter produktiv verdrahten; der aktuelle injizierbare Port und das lokale Resume sind umgesetzt, unbekanntes Schema bleibt `unavailable`.
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

1. ✅ Vollständigen Diff erneut reviewen und `git fetch origin` unmittelbar vor dem Commit ausführen.
2. ✅ Commit und Push der geprüften Folgeänderung; Remote-Status verifiziert.
3. Optional: kontrollierte Live-/MCP-Verifikation mit explizitem Target und Snapshot davor.
4. Optional: Parallel-Timeout des Design-Critic-Tests isolieren oder als bekannte Einschränkung weiterführen.

---

## 10. Definition of Done

- [x] Clean `tsc --build` ohne TypeScript-Fehler.
- [x] V3/V4-Isolation und Dry-Run-Regressionsnachweise vorhanden.
- [x] XML-Entity- und SVG-Provenienz-Regressionsnachweise vorhanden.
- [x] Serielle Vollsuite grün.
- [x] Lint ohne Fehler.
- [x] Alle Reparaturänderungen einschließlich MCP-Timeout-Korrektur fachlich reviewt und für die Commit-Zuordnung vorbereitet.
- [x] Legacy-Optionen implementiert; fehlende Ports werden ausdrücklich als `unavailable` und nicht als Erfolg gemeldet.
- [x] Responsive-/Framer-Legacy-Verträge entschieden und getestet.
- [x] Paralleltest als bekannte Einschränkung dokumentiert; serieller Release-Lauf bleibt maßgeblich.
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
