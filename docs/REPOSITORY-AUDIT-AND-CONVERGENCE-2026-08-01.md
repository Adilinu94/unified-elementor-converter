# Repository-Audit & Konvergenzplan — 2026-08-01

> **Verbindlicher Plattformvertrag:** [`docs/REPOSITORY-CHARTA.md`](REPOSITORY-CHARTA.md) ist die zentrale, dauerhaft sichtbare Charta für beliebige Framer→Elementor-Projekte. Dieser Audit beschreibt den aktuellen Stand und die offenen Arbeiten; die Charta definiert die übergreifenden Regeln, Fallbacks und Release-Gates.

> **Scope:** `unified-elementor-converter`, `Framer-to-Elementor-V4-Pipeline` und `site-clone-to-v3`
>
> **Analysebasis:** aktueller Quellcode, package scripts, CLI-/Wizard-Implementierungen, Tests und operative Dokumentation. Historische Baupläne werden nur als Herkunft und nicht als aktueller Implementierungsnachweis gewertet.
>
> **Zielentscheidung:** `unified-elementor-converter` ist der kanonische Ausführungskern. Die beiden Vorgänger bleiben Maintenance-Mode-Referenzen mit klaren, sicheren Einstiegspunkten; neue Pipeline-Logik wird nicht mehr parallel in ihnen entwickelt.

---

## 1. Executive Summary

| Repository | Aktueller Wert | Hauptproblem | Priorität |
|---|---|---|---:|
| `unified-elementor-converter` | Einziger gemeinsamer V3/V4-Kern; sauberer Workspace-Build; Registry, QA, Batch, Serve, Rollback, Preflight; Wizard baut/validiert, führt vor echten Deploys Live-Preflight aus und kann snapshot-gesichert deployen | URL-Convert läuft über den Browser-/Pipeline-Kern und erzeugt Tree/Report; lokales Wizard-Resume und ein injizierbarer Remote-State-Port sind vorhanden, der produktive MCP-Remote-State bleibt ohne verifiziertes Ability-Schema `unavailable`; High-Level-Live-Deploy unterstützt derzeit bewusst nur `direct`; große automatische oder nicht explizit freigegebene Direct-Payloads werden kontrolliert abgewiesen | P1 |
| `Framer-to-Elementor-V4-Pipeline` | Größte V4-Domain-Tiefe: Atomic-Schema, Guards, Tokens, Global Classes, Recovery-/Batch-/Serve-Flows | Viele npm-Scripts, `@ts-nocheck` im Wizard-/CLI-Cluster, alte/uneinheitliche Ability-Namen trotz Mapping; HTTP-API meldet teilweise synthetische Statuswerte | P1 |
| `site-clone-to-v3` | Reifster V3-Spezialworkflow: Profile, Section-Auswahl, Responsive-/Font-/Animation-Optionen, Framer-Build-Orchestrator, Auto-Fix | Einige Commander-Kommandos sind noch Stubs (`extract`, `extract-tokens`, `apply-kit`, `build`, ursprünglich auch `add-target`); Legacy-Pipeline bleibt schwer mit Unified-State synchronisierbar | P1 |

### Wichtigste Schlussfolgerung

Die Konvergenz ist architektonisch bereits weit fortgeschritten, aber funktional nicht durchgehend abgeschlossen: Eine vorhandene CLI-Hilfe oder ein vorhandener Wizard-Eintrag ist noch kein Beweis, dass die Phase einen echten Extract-/Build-/Deploy-Aufruf ausführt. Künftige Akzeptanzkriterien müssen daher immer **Codepfad + Artefakt + Test + ehrlicher Exit-Code** prüfen.

**Umsetzungsgrenze dieser Runde:** Die produktiven Änderungen und Regressionstests liegen im Unified-Repository. `Framer-to-Elementor-V4-Pipeline` und `site-clone-to-v3` wurden als Read-only-Referenzen analysiert und bewusst nicht parallel verändert. Ihre repo-spezifischen Wizards bleiben Maintenance-Einstiegspunkte; die Portierung weiterer Spezialoptionen nach Unified ist als Folgearbeit dokumentiert.

## 1.1 Verbindlicher Offen-Stand — 2026-08-01

Diese Liste ist die maßgebliche Zusammenfassung der noch offenen Arbeiten. `docs/TODO-OFFEN-2026-07-31.md` bleibt die ausführliche technische Checkliste mit Einzeldateien, Testkommandos und Übergabevermerken; dieses Audit ist deren priorisierte, repositoryübergreifende Zusammenfassung. `AGENTS.md` verweist weiterhin auf die technische Checkliste. Historische Baupläne und archivierte TODO-Listen dürfen ältere `pending`-Markierungen enthalten und werden dadurch nicht wieder zu offenen Aufgaben.

### Statusbegriffe

- **ERLEDIGT / verifiziert:** Implementiert, getestet und durch den aktuellen Build-/Lint-Stand bestätigt.
- **OFFEN / Unified:** Muss im kanonischen Repository umgesetzt werden.
- **OFFEN / Maintenance:** Betrifft ausschließlich die beiden Vorgänger-Repositories; keine neue parallele Pipeline-Entwicklung.
- **BLOCKIERT / extern:** Benötigt Live-MCP, WordPress-Zugang, Unframer, Produktentscheidung oder eine Freigabe.
- **ZURÜCKGESTELLT:** Sinnvolle Verbesserung, aber kein Blocker für den aktuellen Unified-Konverter.

### Priorisierte offene Arbeiten

| ID | Priorität | Bereich | Status | Offener Punkt | Abnahmekriterium |
|---|---:|---|---|---|---|
| O-01 | ✅ | Release-Schritt | ERLEDIGT / verifiziert | Geprüfte Änderungen sind committet (`f4264e6`), vor dem Push wurde `git fetch origin` ausgeführt und der Remote-Status ist verifiziert. Keine offene Produktlücke. | Sauberer Commit, Push auf den vorgesehenen Branch, Remote-Commit geprüft — erfüllt. |
| O-02 | ✅ | Unified CLI | ERLEDIGT / verifiziert | `elconv convert --url` läuft über den Browser-/Pipeline-Kern und schreibt Tree sowie Conversion-Report. | URL-Pipeline, Output-/Report-Kollisionen, Timeout-, robots- und Rate-Limit-Fehler sind durch deterministische Tests abgesichert. |
| O-03 | P1 | Unified Deploy | TEILWEISE / Unified | `upload-php` und `split` sind im High-Level-CLI an den Orchestrator angeschlossen, bleiben aber bis zur Verifikation ihrer serverseitigen Parameterverträge bewusst `unavailable`; `direct` bleibt der einzige live pushbare Pfad. Offline-Vorbereitung ist vorhanden: `large-deploy-plan.ts` friert den geplanten Aufrufvertrag (replace/append, Read-back + Cache-Clear nach jedem Schritt) mit Registry-Guard ein; deterministische Offline-Fixtures (V3 im `upload-php`-Band, V4 im `split`-Band) und 18 Mock-Adapter-Tests sichern Bandenwahl, Vertrag und ehrliches Gate ab. | Erst nach verifizierten Upload-/Append-Schemas dürfen große V3-/V4-Trees chunk-/PHP-basiert, snapshot- und rollback-fähig deployt werden; keine Strategie endet nur mit einem behaupteten Erfolg. |
| O-04 | P1 | Unified Wizard | TEILWEISE / Unified | Target-Profilimport und target-relevante V3-/V4-Spezialfragen sind im gemeinsamen Wizard-State verdrahtet; lokales Resume ist verifiziert. Ein maschinenlesbarer `wizard-contract.json` (Exit-Codes 0/1/2, Per-Phase-Status, vollständiges Options-Forwarding-Manifest, Artefaktpfade) wird nach jeder Phase persistiert; Wizard-Viewports fließen in die URL-Pipeline; QA meldet ehrlich `skipped`/`unavailable`. Remote-`pipeline-state` bleibt ohne verifiziertes MCP-Schema strukturiert `unavailable`; produktive Build-/QA-Adapter-Parität (weitere Optionen in Build/QA) bleibt Folgearbeit. | Lokales Resume und persistierte Optionen funktionieren; Remote-Resume darf erst nach verifiziertem Adapter und vollständiger Optionsweitergabe als produktiv gelten. |
| O-05 | ✅ | Framer/V3-Verträge | ERLEDIGT / verifiziert | `textStyles`/`colorStyles` und `autoTextEditor` sind als kompatible No-op-Verträge entschieden; Responsive-JSON und ungewöhnliche XML-Strukturen sind validiert und regression-getestet. | Jede Funktion ist angewendet, bewusst als No-op dokumentiert oder validiert; Tests und Doku vorhanden. |
| O-06 | ✅ | QA/Reports | ERLEDIGT / verifiziert | Vision-Enhance-Integration, Geometry-Report-Weitergabe und `run-report.md` sind getestet; der Parallel-Timeout ist als bekannte Vitest-Einschränkung dokumentiert, der serielle Gate-Lauf bleibt maßgeblich. | Integrationsfälle prüfen Router/Report/Probe ohne unnötige Browserläufe; serieller Status reproduzierbar, Parallelrisiko ausdrücklich dokumentiert. |
| O-07 | P1 | Maintenance V3 | OFFEN / Maintenance | `extract`, `extract-tokens`, `apply-kit`, `build` und der Target-Wizard müssen entweder auf Unified weiterleiten oder kontrolliert mit Exit 2 und Migrationshinweis enden. | Kein Stub meldet Erfolg; README/AGENTS/Hilfe zeigen den kanonischen Unified-Einstieg. |
| O-08 | P1 | Maintenance V4 | OFFEN / Maintenance | `@ts-nocheck`-Wizard-/CLI-Grenzen, synthetische Serve-Statuswerte und Legacy-Ability-Doku schrittweise bereinigen. | Serve liefert echten Job-/State-Status oder ist eindeutig als Legacy markiert; neue Ability-Namen kommen aus der Unified-Registry. |
| O-09 | P2 | Test-/Datenbasis | TEILWEISE / extern | Read-only Live-Preflight, MCP-Session, 234 Abilities, Elementor/PHP/WP und Read-back-/Cache-Response-Verträge sind bestätigt. Ein echter Deploy bleibt wegen fehlendem erforderlichem WPCode Lite sowie fehlender ausdrücklicher Mutationsfreigabe offen. | WPCode-Port vorhanden oder freigegeben, Snapshot davor, Live-Preflight bestanden, Push, Cache-/Permalink-Prüfung und anschließende echte QA sind protokolliert; keine Produktionsseite ohne Freigabe. |
| O-10 | P2 | V4-Parität | ZURÜCKGESTELLT | Framer-Sonderfälle (Style-Referenzen, Backgrounds, Inline-Text, CMS, Unknown Widgets) als Unified-Fixtures portieren; `buildV4Plan()` separat absichern. | Fixtures, V4-only-Ausgabe, Widget-Count und Fallback-Entscheidungen sind getestet und dokumentiert. |
| O-11 | P2 | Konvergenz | ZURÜCKGESTELLT | Preview/Promote, `elconv migrate-site`, historische Target-Profilmigration und serverseitige V3→V4-Site-Konvertierung ausbauen. | Snapshot-/QA-/Rollback-Vertrag für Preview/Promote und Site-Migration ist definiert und getestet. |
| O-12 | P3 | Betrieb/KI | ZURÜCKGESTELLT | Ability-Schema-Codegen, Nightly-Drift-CI, maschinenlesbarer Wizard-Vertrag, Server-Memory/Skill-Deployment, Golden-Page und Performance-Metriken. | Automatisierte Drift-/Schema-/Performance-Gates und versionierte Referenzseite sind eingerichtet. |
| O-13 | P3 | Repository-Lifecycle | ZURÜCKGESTELLT | Vorgänger-Repositories nach stabiler Migration auf Maintenance-Mode/Archivierung umstellen und PHP-Injector/Meta-Tools separat dokumentieren. | Migration, Zuständigkeit und letzte kompatible Wrapper sind dokumentiert; keine parallele Feature-Entwicklung bleibt offen. |

### Bewusst nicht als offen zu behandeln

Die folgenden Punkte sind erledigt und dürfen in neuen TODO-Listen nicht erneut als offene Phasen erscheinen: Workspace-`tsc --build`, V3/V4-Contamination-Guards, Ability-Registry/Alias-Auflösung, Unified-Wizard für lokale HTML/XML-Builds, Wizard-Live-Preflight, Snapshot vor Deploy, V3/V4-Direct-Push-Routing, echte QA-Scores mit Referenz, Batch-Retry/Rate-Limit/Resume, Fix-Learning, Plugin-Preflight sowie die Feature-Phasen 100–115.

### Empfohlene Reihenfolge

1. ✅ **O-01** Geprüften Release-Diff veröffentlichen und Remote-Stand prüfen — erledigt (`f4264e6`).
2. **O-03** große Deploy-Strategien als wichtigste verbleibende Unified-Produktlücke schließen; O-02 ist umgesetzt und verifiziert.
3. **O-04** Remote-State und vollständige Wizard-Optionsweitergabe vervollständigen; O-05/O-06 sind umgesetzt und verifiziert.
4. **O-07/O-08** die Vorgänger ehrlich auf Migration/Maintenance ausrichten.
5. **O-09** Live-Verifikation nur mit explizitem Target und Freigabe durchführen.
6. **O-10 bis O-13** als nachgelagerte Konvergenz-, Betriebs- und Lifecycle-Arbeiten behandeln.

---

## 2. Repository A — `unified-elementor-converter`

### 2.1 Ist-Zustand

**Architektur**

- Monorepo mit Core, Extractors, Target-V3, Target-V4, MCP, QA und CLI.
- Harte V3/V4-Isolation durch getrennte Target-Pakete und Contamination-Guards.
- `@elconv/mcp` enthält Ability-Registry, Alias-Auflösung, Deploy-/Batch-Infrastruktur, Snapshot/Rollback, Server-Critic und Preflight.
- `@elconv/qa` enthält Pixelmatch/SSIM, Geometry-Probes, Healing und Fix-Learning.

**CLI und APIs**

- `elconv convert`: HTML/XML- und URL-Konversion; URL nutzt den Browser-/Pipeline-Kern und schreibt Tree-/Report-Artefakte.
- `elconv wizard`: interaktiver V3/V4-Einstieg mit TTY-Guard, Resume, Fortschrittsanzeige, echter lokaler Extraktion/Build/Guard-Validierung, read-only Live-Preflight vor Deploys und snapshot-gesichertem MCP-Deploy.
- `elconv doctor`, `deploy`, `qa`, `design-critic`, `target`, `session-init`, `batch`, `serve`, `rollback`, `preflight`.
- HTTP: `GET /health`, `POST /convert`, `POST /qa` auf dem lokalen Serve-Modus.
- MCP-Wire-Format und 263 Live-Abilities sind in `ability-registry.ts` und `NOVAMIRA-LIVE-ABILITIES-2026-07-30.txt` dokumentiert.

**Konfiguration**

- Strikte `ElconvConfigSchema`-Validierung in `packages/core/src/config.ts`.
- Projektdatei: `elconv.config.yaml`.
- WordPress-Ziele: `elconv target` in `.elconv/targets.json`; historische `~/.clone-v3/profiles.json`-Kompatibilität existiert im Core.
- MCP-Credentials werden über `--auth-env` oder injizierte Profile erwartet; Secrets dürfen nicht in Git landen.

**Verifikation**

- Clean `tsc --build`, fokussierte Regressionen und Produktions-Lint sind für die aktuelle Preflight-/Strategie-Anpassung grün; read-only Live-Preflight bestätigte MCP-Session, 234 Abilities, Elementor 4.2.1, PHP 8.2.23 und WordPress 7.0.2, bleibt aber wegen fehlendem WPCode Lite fehlgeschlagen; die verbleibenden offenen Produkt-/Releasepunkte stehen in Abschnitt 1.1.
- V3-/V4-Golden-Path, Visual-Regression und CLI-Smoke-Gates sind dokumentiert.
- Bekannte Einschränkung: parallele Vollsuite kann beim bestehenden Design-Critic-Test flaken; serieller Lauf ist der deterministische Gate.

### 2.2 Konkrete Lücken

#### P0 — Wizard-Vertrag: umgesetzt, Restgrenzen dokumentiert

`packages/cli/src/cmd-wizard.ts` führt für HTML/XML echte Extraktion, SourceSpec-Artefakt, target-spezifischen Build und Guards aus. URL-Szenarien laufen über den vorhandenen Pipeline-Kern und schreiben ein V3-/V4-Build-Artefakt. Ein realer Deploy erfasst vor dem Push einen Live-Snapshot und nutzt `pushToWordPress`, das V3/V4 korrekt auf getrennte Registry-Abilities routet.

Verifiziert durch `tests/unit/cli/cmd-wizard.test.ts`, `tests/unit/cli/cmd-deploy.test.ts` und den Build-Gate. Ohne MCP-Credentials endet ein Deploy mit einem ehrlichen Fehler. `--strategy upload-php` und `--strategy split` sind im High-Level-CLI an den Orchestrator angeschlossen, melden ohne verifizierte serverseitige Upload-/Append-Schemas aber bewusst `unavailable` und führen keinen MCP-Write aus; bis zur externen Schema-Verifikation ist `--strategy direct` erforderlich, bei großen Direct-Payloads zusätzlich `--force-large-direct`.

Live-Preflight ist jetzt vor jedem echten Wizard-Deploy verdrahtet: Ability-Discovery prüft die target-spezifischen Push-Abilities, `novamira/elementor-check-setup` und Plugin/PHP/WP-Kompatibilität laufen read-only über MCP; V4 blockiert zusätzlich bei fehlendem Atomic-Runtime. Dry-Runs bleiben ohne MCP-Aufruf. Große automatische Trees und große explizite Direct-Pushes werden vor Snapshot/Mutation abgewiesen; letzteres erfordert das bewusste Opt-in `--force-large-direct`. Offen bleiben: QA-Referenz-/Repair-Prompts, optionaler Remote-State sowie die externe Verifikation der Upload-/Append-Schemas für explizite `upload-php`/`split`-Deploys; bis dahin bleiben diese Strategien strukturiert `unavailable`.

#### URL-Extraktion im eigenständigen CLI — ERLEDIGT / verifiziert

`cmd-convert.ts` führt `--url` über den Browser-/Pipeline-Kern aus und schreibt reproduzierbare Tree- und Conversion-Report-Artefakte. Output-/Report-Kollisionen sowie Timeout-, robots- und Rate-Limit-Fehler werden kontrolliert behandelt und sind durch deterministische Tests abgesichert. Der Wizard nutzt denselben Pipeline-Kern für URL-Szenarien.

#### P1 — Wizard-Szenarioabdeckung

Der Unified-Wizard fragt Ziel, Quelltyp, Quelle, Output sowie bei Deployment Post-ID, MCP-URL, Auth-Env, Titel und Template ab. HTML/XML-Dry-Runs erzeugen SourceSpec-, Tree- und Guard-Artefakte; URL-Szenarien nutzen den vorhandenen Pipeline-Kern. Die gemeinsame State-Machine persistiert nun:

- V3: Viewports, Strictness, Animationen, Fonts, Sections, Repair- und QA-Optionen.
- V4: Token-/Global-Class-Strategie, Responsive-Varianten und Unknown-Widget-Strategie.
- Zielprofile: secret-freier Import aus `~/.clone-v3/profiles.json` und `.elconv/targets.json`; Live-Credentials bleiben separat über `--auth-env`.
- QA: Referenz-URL, Threshold und maximale Reparaturrunden.

Die Fragen führen weiterhin nicht in getrennte Pipelines; sie liegen in einem target-neutralen State und werden nur im passenden Zielzweig abgefragt bzw. validiert. Alte lokale State-Dateien werden beim Resume mit sicheren Defaults normalisiert.

#### P1 — Remote-State und weitere Betriebsverträge

Der Wizard führt vor einem echten Deploy jetzt automatisch `mcp-adapter-discover-abilities`, `novamira/elementor-check-setup` und die bestehende Plugin/PHP/WP-Kompatibilitätsprüfung aus. Fehlende Required-Plugins, zu alte Laufzeiten oder fehlendes V4-Atomic-Runtime blockieren den Deploy mit einem kontrollierten Fehler; Dry-Runs führen keine MCP-Abfragen aus. Der Wizard besitzt nun einen injizierbaren Remote-State-Port mit identischer State-Serialisierung; der reale `pipeline-state`-MCP-Adapter bleibt bis zur Verifikation des Ability-Schemas bewusst `unavailable` und wird bei nicht-dry CLI-Aufruf ohne Adapter mit Exit 2 gemeldet. Die neuen V3-/V4-Optionen werden in dieser Teilstufe validiert und persistiert; die vollständige Weitergabe an alle Build-/QA-Adapter bleibt Folgearbeit. Zusätzlich fehlen Ability-Schema-Codegen, Nightly-Drift-CI und die dauerhafte Golden-Page als Live-Referenz.

### 2.3 Ziel-Wizard im Unified-Repo

```text
elconv wizard
  1. Szenario: URL | Framer-XML | HTML | bestehender Tree
  2. Ziel: V3 | V4 Atomic
  3. Zielprofil: lokal gespeichertes Profil | MCP URL + auth-env | Dry-Run ohne Target
  4. Zieloptionen:
       V3: Viewports, Strictness, Sections, Fonts, Animationen
       V4: Token-/GC-Strategie, Responsive, Unknown-Widget-Strategie
  5. QA/Reparatur: Referenz, Threshold, Auto-Fix, Healing, AI-Diagnose
  6. Zusammenfassung + explizite Bestätigung
  7. Preflight → Extract → Build → Validate → Snapshot → Deploy → QA
  8. State lokal speichern; optional remote pipeline-state synchronisieren
```

**Vertrag:** Jeder Schritt schreibt einen überprüfbaren Artefaktpfad oder einen expliziten Status (`ok`, `skipped`, `unavailable`, `failed`). Kein synthetischer Erfolg.

---

## 3. Repository B — `Framer-to-Elementor-V4-Pipeline`

### 3.1 Ist-Zustand

**Stärken**

- V4-Atomic-Domainlogik ist die tiefste der drei Quellen: `$$type`, e-flexbox, Style-Klassen, Global Variables, Responsive-Varianten und 14 Guards.
- Root-`wizard.ts` bündelt Recovery-Mode und Subcommands: `preflight`, `dry-run`, `preview`, `promote`, `batch`, `serve`, `pipeline`, `doctor`.
- Framer-Spezialität: FramerExport, XML, CSS-/Token-Extraktion, Animationen, Design-System- und Build-Manifest-Artefakte.
- V4-spezifische Preflight-, Schema-, Binding-, Cross-Validation- und Visual-QA-Scripts sind umfangreich.

**APIs und Endpoints**

- MCP-Bridge über `src/builder/mcp-bridge.ts`.
- Wizard-Serve: `GET /health`, `POST /build`, `GET /builds/:id`.
- Unframer MCP für Projekt-/Node-XML und Code-Dateien.
- Novamira MCP für Elementor-/Atomic-Setup, Content, Variables, Global Classes und QA.

**Konfiguration**

- `.env.example`: `FRAMER_EXPORT_DIR`, `WP_API_URL`, `WP_API_USERNAME`, `WP_API_PASSWORD`, Timeouts, Retries, Validation-Threshold, Batch-Größe und Preview-URLs.
- Zusätzlich `mcp-server-config.example.json`, `pipeline-profile.json`, `theme-defaults.json`.
- Sehr viele npm Scripts bilden faktisch eine zweite CLI.

### 3.2 Konkrete Lücken

#### P0 — Typisierung des kanonischen Wizard-Routers

`wizard.ts` sowie `src/cli/cmd-*.ts` tragen `@ts-nocheck`. Das verschleiert Vertragsdrift bei MCP-Parametern, Exit-Codes und API-Responses. Neue Entwicklung soll nicht mehr in diesem Cluster stattfinden, aber kritische Fixes benötigen mindestens schmale Boundary-Typen.

#### P1 — Serve-API ist nur teilweise produktiv

`GET /builds/:id` liefert einen synthetischen `completed`-Status statt den echten Pipeline-State. `POST /build` akzeptiert nur eine minimale Payload und startet keinen nachverfolgbaren Job. Das ist für Agenten irreführend.

**Ziel:** entweder als `legacy-preview-api` klar markieren oder gegen einen echten Job-/State-Store führen. Die bevorzugte Lösung ist der Unified-Serve-Contract.

#### P1 — Ability-Namespace und Dokumentation

Die Legacy-Call-Sites verwenden weiterhin alte `novamira/adrians-*`-Namen und verlassen sich auf zentrale Normalisierung. Das funktioniert nur solange das Mapping vollständig bleibt. Neue Namen müssen ausschließlich aus der Unified-Registry kommen; die Vorgänger-Bridge soll nur noch Kompatibilität leisten.

#### P2 — Script-Fläche reduzieren

40+ Pipeline-Scripts sind leistungsfähig, aber für KI-Systeme schwer navigierbar. Ein V4-Maintenance-Wizard darf die Spezialschritte nur als klar benannte Adapter ausführen und muss pro Schritt Artefakt, Input, Output, Exit-Code und Live-Anforderung ausgeben.

#### P2 — Framer-Sonderfälle

Die historische E2E-Dokumentation nennt offene oder fragile Fälle: Style-Referenzen, Hintergrundfarben, starre Fallbacks, Inline-Textstyles, CMS-Instanzen und externe Asset-/MCP-Abhängigkeiten. Diese müssen als Fixtures in Unified-V4-Tests überführt werden.

### 3.3 Ziel-Wizard im V4-Repository

Der bestehende Wizard bleibt als Maintenance-Entry, bekommt aber einen eindeutigen Banner und einen stabilen Vertrag:

```text
node --import tsx wizard.ts
  preflight [--format=json]
  dry-run
  pipeline --url <framer-url> | --export-dir <dir> [--resume] [--dry-run]
  preview --post-id <id>
  promote --preview-id <id> --target-id <id>
  batch --pages <file,...> [--post-ids <id,...>]
  serve --port <port>     # nur Legacy-Kompatibilität; neue API: elconv serve
  doctor [--format=json] [--fix]
```

**Akzeptanz:** keine neuen V4-Features ohne Port in `packages/target-v4` oder `packages/mcp`; jede Legacy-Änderung erhält einen Test gegen die Unified-Registry bzw. einen dokumentierten Alias.

---

## 4. Repository C — `site-clone-to-v3`

### 4.1 Ist-Zustand

**Stärken**

- Reifster V3-Workflow mit interaktivem Section-Picker, Viewports, Strictness, Font-/Animationsstrategie und Resume-State.
- `framer-build`-Wizard fragt Framer-Artefakte, WP-Ziel, Seite, QA-Probes, Responsive-Overrides, Fix-Runden und Dry-Run ab.
- `NovamiraClient` kapselt Session, Auth, JSON-RPC, Retry, Page-Injection, WPCode und Cache.
- V3-spezifische Render-Compatibility, Widget-Degradation, Geometry-Probe, Auto-Fix und Run-Report sind besonders wertvoll für Unified.

**APIs und Endpoints**

- `NovamiraClient` nutzt JSON-RPC/MCP und serverseitige Novamira-Abilities.
- V3-Tree-Deployment muss über `elementor-inject-calibrated-page` laufen; `batch-build-page` ist für verschachtelte V3-Bäume verboten.
- WPCode-/Media-/Cache-Adapter bilden die operativen Seitenpfade.
- Zielprofile liegen in `~/.clone-v3/profiles.json` und enthalten MCP-Endpunkt, Credentials, Elementor-Version, Pro-Flag und Retry-Policy.

**Konfiguration**

- Commander-Flags für `clone`, `framer-build`, `diff`, `v3v4-diff`, `convert-page-v3-to-v4`.
- Profile mit `os.homedir()`-sicheren Pfaden.
- `--mcp-url`/`--mcp-auth` können Profile überschreiben.
- Legacy-Reparaturflags: `--qa-auto-fix`, `--heal`, `--full-context-repair`.

### 4.2 Konkrete Lücken

#### P0 — Stub-Kommandos ehrlich machen oder portieren

Die Commander-Einträge `extract`, `extract-tokens`, `apply-kit` und `build` geben aktuell „not yet implemented“ aus. README und Status beschreiben sie teilweise wie produktive Befehle. Für KI-Nutzer ist das eine direkte Fehlleitung.

**Entscheidung:** Neue Implementierung gehört in Unified. Im Vorgänger müssen diese Befehle entweder:

1. auf `elconv`/Unified weiterleiten,
2. als `maintenance-only` mit Exit-Code 2 und Migrationshinweis enden,
3. oder vollständig aus der Hilfe entfernt werden.

Ein stiller Erfolg ist verboten.

#### P1 — Target-Wizard

`add-target` war zuvor ein Stub, obwohl `wp-target.ts` bereits `upsertTarget()` und ein vollständiges Profilmodell bereitstellt. Der Wizard muss Name, Label, Site-URL, MCP-Endpunkt, Credentials, Elementor-Version, Pro-Flag und Retry-Policy validiert erfassen und mit Modus 0600 speichern.

#### P1 — Framer/V3-Artefaktverträge

`textStyles`/`colorStyles`, `autoTextEditor`, Responsive-JSON, beschädigte XML-Strukturen und ungewöhnliche/self-closing Tags brauchen explizite Entscheidungen und Tests. Diese Hooks dürfen nicht gleichzeitig „ignoriert“ und als vollständig unterstützt dokumentiert werden.

#### P2 — Client-Batching und große Seiten

`mcpBatchSize` ist im Profilmodell gespeichert, wird aber nicht konsumiert. Seiten mit mehr als etwa 50 Sections brauchen deterministische Chunk-/Resume-/Rate-Limit-Verträge.

#### P2 — V3→V4-Bridge

Die serverseitige Konvertierung ist als Spezialpfad vorhanden, aber neue Arbeit daran soll in Unified-MCP und Target-V4 landen. Der Vorgänger darf nur einen kompatiblen Wrapper behalten.

### 4.3 Ziel-Wizard im V3-Repository

```text
npx clone-v3 clone <url>
  URL → Target-Profil → Viewports → Animationen → Fonts
  → Strictness → Section-Auswahl → QA-/Repair-Optionen
  → Zusammenfassung → Resume-State → Pipeline

npx clone-v3 framer-build
  Framer XML → Styles/Code/Live-URL → WP Target → Page
  → Probe/Structure/Responsive → Fix-Runden/Threshold → Dry-Run
```

Der V3-Wizard bleibt in diesem Repo als Maintenance-Kompatibilitätsweg. Für neue Builds soll er einen Migrationshinweis auf `elconv wizard` ausgeben; sein Profil- und QA-Wissen wird in Unified als Adapter-/Testmaterial weitergeführt.

---

## 5. Konvergenz-Matrix: Was muss in Unified landen?

| Fähigkeit | Quelle | Ziel in Unified | Status |
|---|---|---|---|
| V3 Tree-/Widget-Mapping | site-clone | `packages/target-v3` | vorhanden, weiter mit Golden Fixtures härten |
| V3 Render-Compatibility + CSS-Fallbacks | site-clone | target-v3/qa | vorhanden, Lücken als Fixtures portieren |
| V3 Framer-Build-Orchestrator | site-clone | CLI + target-v3 | teilweise vorhanden; `framer-build-wizard` kompatibel halten |
| V4 Atomic Schema/Guards/GC | V4 pipeline | `packages/target-v4` | vorhanden |
| Framer XML/Token/Animation | V4 pipeline | extractors/target-v4 | vorhanden, Sonderfälle nachtesten |
| MCP Registry/Alias/Drift | Unified | `packages/mcp` | vorhanden |
| Batch mit Retry/Rate-Limit/Resume | V4 pipeline + Unified | `packages/mcp` + CLI | vorhanden |
| Preview/Promote | V4 pipeline | MCP/CLI Snapshot/Rollback | Snapshot/Rollback vorhanden; Preview/Promote als sichere Folgephase |
| HTTP API | V4 pipeline | `elconv serve` | vorhanden, V4 Legacy-API nicht weiter ausbauen |
| Auto-Fix/Healing/AI-Diagnose | site-clone | qa + CLI ports | implementiert; Live-MCP- und E2E-Verifikation ergänzen |
| Profile/Target-Store | site-clone | core + `elconv target` | zwei Speicherformate; Zusammenführung/Import priorisieren |
| PHP Ability Injector | V4/V3 | separates Deployment-Artefakt | bewusst nicht in Target-Logik mischen |

---

## 6. Priorisierter Implementationsplan

### Phase A — Verträge und Wahrheit (P0, 1–2 Tage)

1. ✅ Unified-Wizard-Executor auf echte Extract-/Build-/Validate-/Deploy-Aufrufe umgestellt.
2. ✅ Wizard- und eigenständiges `convert --url`-Szenario an den vorhandenen Browser-/Pipeline-Kern angebunden; Tree-/Report-Ausgabe und Fehlerverträge sind getestet.
3. ✅ Lokale Artefakte, Guards, Snapshot und ehrliche Fehler-/Skip-Pfade getestet.
4. V3-Stub-Kommandos auf Unified-Migration oder Exit-2-Meldung umstellen.
5. V4-Serve-Synthetik als Legacy markieren; keine falschen `completed`-Antworten mehr.

### Phase B — Wizard-Konvergenz (P1, 2–4 Tage)

1. Gemeinsames Wizard-Optionsschema in Unified erweitern.
2. V3-Optionen nur im V3-Zweig fragen: Viewports, Strictness, Fonts, Animationen, Sections, Repair.
3. V4-Optionen nur im V4-Zweig fragen: Token/GC, Responsive, Unknown Widgets, Preview/Promote.
4. ✅ Target-Profilimport aus `~/.clone-v3/profiles.json` und `.elconv/targets.json` mit secret-freier Projektion anbieten.
5. ✅ Live-Preflight vor einem nicht-dry Deploy ausführen (Discovery, Elementor-Setup, Plugin/PHP/WP-Kompatibilität; Dry-Run bleibt offline).
6. ✅ Lokalen State und injizierbaren Remote-State-Port mit identischer Serialisierung testen; produktiver MCP-Adapter bleibt bis zur Schema-Verifikation offen.

**Maintenance-Repositories:** Erst danach repo-spezifische Wizard-Banner/Wrapper in V4-Pipeline und site-clone-to-v3 ändern; keine dritte divergierende Pipeline erzeugen.

### Phase C — V4/V3-Sonderfälle portieren (P1, 3–5 Tage)

1. Framer Style-Reference-, Inline-Text-, Background- und CMS-Fixtures in Unified ergänzen.
2. V3 Render-Compatibility- und WPCode-Fallen als Target-/QA-Regressionsfälle abbilden.
3. Große Trees über Batch-/Chunk-/Snapshot-Strategien testen.
4. Preview → QA → Promote über Snapshot/rollback-gesicherten Flow implementieren.

### Phase D — Wartbarkeit und KI-Nutzbarkeit (P2, 2–4 Tage)

1. Ability-Schema-Codegen aus `get-ability-info`.
2. Nightly-Ability-Drift-Workflow.
3. Ein maschinenlesbares `wizard-contract.json` mit Inputs, Outputs, Status und Exit-Codes.
4. V4-`@ts-nocheck` schrittweise an den MCP-/CLI-Grenzen abbauen.
5. Vorgänger-README/AGENTS auf reine Migration, kritische Fixes und Wrapper reduzieren.

### Phase E — Release und Betrieb (P2, laufend)

1. Golden-Page für V4 und reale V3-/V4-Live-Snapshots versionieren.
2. Kontrollierte MCP-Dry-Runs mit Snapshot davor automatisieren.
3. Performance-Metriken für große Seiten und Browser-/MCP-Latenz sammeln.
4. Vorgänger-Repositories nach erfolgreicher Migration archivieren.

---

## 7. Ressourcen und Voraussetzungen

- Node.js 20+ für Unified, Node 18+ für die Maintenance-Repositories.
- Playwright/Chromium für URL-Extraktion und visuelle QA.
- Novamira MCP-Zugang, WordPress Application Password und explizites Testziel.
- Unframer MCP für Framer-Projekt-/Node-XML, falls kein Exportfile vorliegt.
- Isolierte Testziele und Snapshots; keine Tests gegen Produktion ohne ausdrückliche Freigabe.
- CI: `tsc --build`, serielle Vollsuite, Golden Paths, Visual Regression, Lint, Ability-Drift-Gate.
- Keine Secrets in Dokumentation, Fixtures oder Commit-Historie.

---

## 8. Definition of Done

### Pro Repository

- README und AGENTS nennen den kanonischen Startbefehl, alle verfügbaren Commands, APIs/Endpoints, Konfigurationsdateien und Exit-Codes.
- Interaktiver Wizard führt durch ein reproduzierbares Szenario und bietet einen nicht-interaktiven Äquivalenzpfad.
- Jeder Wizard-Schritt hat einen überprüfbaren Output oder einen ehrlichen Fehler-/Skip-Status.
- Tests decken mindestens Help, Validierung, Dry-Run, Resume und einen realistischen Fehlerpfad ab.

### Für Unified als Konvergenzziel

- V3- und V4-Golden-Paths bleiben grün.
- Keine V3/V4-Kontamination.
- Keine Legacy-Ability ohne Registry/Alias.
- Deploys sind snapshot-/rollback-fähig.
- QA-Scores sind real oder ausdrücklich `not-scored`.
- Neue Features werden nur im Unified-Kern implementiert; Vorgänger erhalten höchstens Wrapper und kritische Fixes.

---

## 9. Sofort nächste technische Tickets

Die nummerierten Tickets sind mit dem verbindlichen Offen-Stand in Abschnitt 1.1 synchronisiert:

1. ✅ **O-01 / erledigt:** Geprüfte Änderungen sind committet, gepusht und der Remote-Status ist verifiziert.
2. **O-02 / erledigt:** `elconv convert --url` über den Browser-/Pipeline-Kern ist produktiv verdrahtet und getestet.
3. **O-03 / P1:** High-Level-Deploy für `upload-php` und `split` an den MCP-Orchestrator anbinden.
4. **O-04 / P1:** Remote-State, vollständige Wizard-Optionsweitergabe und die verbleibenden Adapter-Verträge abschließen; O-05/O-06 sind erledigt.
5. **O-07/O-08 / P1:** Beide Maintenance-Repositories auf ehrliche Migration-/Legacy-Verträge umstellen.
6. **O-09 / P2:** Kontrollierte Live-Verifikation mit explizitem MCP-/WordPress-Target.
7. **O-10 bis O-13 / P2/P3:** Sonderfall-Fixtures, Preview/Promote, Site-Migration, Drift-/Schema-Gates und Repository-Lifecycle.
