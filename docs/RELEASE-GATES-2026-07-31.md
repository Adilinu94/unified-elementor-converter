# Release-Gates — 2026-07-31

> **Historischer Gate-Bericht:** Dieser Bericht dokumentiert den Gate-Lauf vom 31.07.2026 und bleibt als Nachweis archiviert. Der aktuelle Arbeitsbaumstand vom 03.08.2026 ist im Nachtrag am Ende dieses Dokuments sowie in `docs/TODO-OFFEN-2026-07-31.md` maßgeblich.
>
> Gate-Lauf auf Basis von Commit `28cde0c`; dabei wurde der CLI-Import-Seiteneffekt gefunden und im anschließend veröffentlichten Follow-up-Fix in `packages/cli/src/clone.ts` behoben. Die nach dem Fix wiederholten Gates sind die maßgeblichen Ergebnisse dieses historischen Berichts.

## Ergebnisübersicht

| Gate | Ergebnis | Nachweis |
|---|---:|---|
| V3 Golden Path | ✅ 8/8 | `tests/e2e/golden-path-v3.test.ts` |
| V4 Golden Path | ✅ 15/15 | `tests/e2e/golden-path-v4.test.ts` |
| Visual Regression | ✅ 2/2 | `tests/visual/visual-regression.test.ts` |
| CLI Unit-/Smoke-Gates | ✅ 43/43 | Router, Convert, Wizard, Batch, Serve, Rollback, Preflight, Dry-Run |
| Kombinierter Gate-Lauf | ✅ 68/68 | 9 Testdateien, seriell |
| Clean TypeScript Build | ✅ | `npx tsc --build --clean && npx tsc --build --pretty false` |
| Produktions-Lint | ✅ | 0 Fehler, 0 Warnungen |
| Diff-Check | ✅ | `git diff --check` |

Alle Testläufe wurden deterministisch seriell ausgeführt:

```text
--pool=forks --maxWorkers=1 --minWorkers=1
```

## V3 Golden Path

```bash
npx vitest run tests/e2e/golden-path-v3.test.ts \
  --pool=forks --maxWorkers=1 --minWorkers=1 --testTimeout=15000
```

**Ergebnis:** 8 Tests bestanden, 0 fehlgeschlagen, 0 übersprungen.

Abgedeckt sind unter anderem Setting-Validator, Auto-Companions, Flattening/Nesting, Widget-first Guards, Setting-first/Editability und L1-Design-Critic.

## V4 Golden Path

```bash
npx vitest run tests/e2e/golden-path-v4.test.ts \
  --pool=forks --maxWorkers=1 --minWorkers=1 --testTimeout=15000
```

**Ergebnis:** 15 Tests bestanden, 0 fehlgeschlagen, 0 übersprungen.

Abgedeckt sind V4-Validierung, V3-Kontamination, `$$type`-Envelopes, V3→V4-Bridge, V4-Guards, Auto-Scale, Global Classes und Section Templates.

## Visual Regression

```bash
npx vitest run tests/visual/visual-regression.test.ts \
  --pool=forks --maxWorkers=1 --minWorkers=1 --testTimeout=60000
```

**Ergebnis:** 2 Tests bestanden, 0 fehlgeschlagen, 0 übersprungen.

- Deterministische 800×600-Fixture entspricht der Baseline innerhalb des Gates.
- Der absichtlich umgefärbte Hero wird korrekt als Regression erkannt.
- Playwright/Chromium war verfügbar.
- Die Baseline wurde nicht verändert.

## CLI Unit-/Smoke-Gates

Die vorhandenen CLI-Gates bestanden mit **43/43 Tests**:

- `tests/unit/cli/cli.test.ts`
- `tests/unit/cli/cmd-batch-serve.test.ts`
- `tests/unit/cli/cmd-rollback.test.ts`
- `tests/unit/cli/cmd-preflight.test.ts`
- `tests/unit/cli/cmd-wizard.test.ts`
- `tests/unit/cli/dry-run.test.ts`

Zusätzlich wurde das gebaute, kanonische Executable `packages/cli/dist/cli.js` direkt geprüft:

| Kommando | Ergebnis |
|---|---:|
| `help` | Exit 0, vollständige Unified-CLI-Hilfe |
| `version` | Exit 0, `elconv v1.0.0` |
| unbekanntes Kommando | Exit 2, erwartete Usage-Meldung |
| `preflight --mode v3` ohne MCP | Exit 2, erwartete fehlende Credentials |
| `wizard --no-interactive` ohne Target | Exit 2, erwartete Validierung |
| `batch` ohne Manifest | Exit 2, erwartete Validierung |
| `rollback --list` auf leerem Verzeichnis | Exit 0, „No snapshots found“ |
| `deploy` mit fehlender Tree-Datei | Exit 1, erwarteter `ENOENT` |
| V3 `convert` mit HTML-Fixture | Exit 0, gültiges JSON-Array mit 3 Root-Elementen |
| V4 `convert` mit Framer-XML-Fixture | Exit 0, gültiges JSON-Array mit 3 Root-Elementen |
| Legacy `clone.js help` | Exit 0, Legacy-Hilfe vorhanden |

### Während des Smoke-Laufs gefundener und behobener Befund

Der erste direkte Aufruf des Unified-CLI importierte über den Barrel-Export `clone.ts`. Dessen Legacy-`main()` lief beim Import unconditionally und erzeugte zusätzliche `[clone] FAILED`-Ausgaben. Das wurde in `packages/cli/src/clone.ts` durch einen Windows-sicheren Entry-Point-Guard mit `fileURLToPath()` und `resolve()` behoben.

Nach dem Fix:

- keine unerwarteten `[clone]`-Ausgaben beim Unified-CLI;
- `help`, `version` und alle erwarteten Usage-/Operational-Fälle liefern die dokumentierten Exit-Codes;
- der direkte Legacy-Clone-Help-Aufruf bleibt funktionsfähig.

### Beobachtung zum Wizard-Dry-Run

Der direkte Wizard-Dry-Run beendet sich erfolgreich mit Exit `0`. Das Ergebnis wird über den Wizard-State-/Artefaktpfad verwaltet; der angegebene `--out`-Pfad ist bei diesem Modus nicht der alleinige Ausgabepfad. Dieses Verhalten ist im Gate-Lauf dokumentiert und wurde nicht als Fehler gewertet.

## Aktueller Arbeitsbaum-Nachtrag — 2026-08-03

Nach der Read-back-/Cache-Vertragsprüfung und der MCP-Session-/Timeout-Korrektur wurden die aktuellen Gates erneut ausgeführt:

| Gate | Ergebnis |
|---|---:|
| Workspace-TypeScript-Build | ✅ |
| Fokussierte MCP-/CLI-Regressionen | ✅ 75/75 |
| Serielle Vollsuite | ✅ 114 Testdateien, 1273 bestanden, 2 übersprungen |
| Produktions-Lint | ✅ 0 Fehler, 0 Warnungen |
| `git diff --check` | ✅ |

Die parallele Vollsuite bleibt wegen des bekannten `cmd-design-critic`-Risikos nicht der maßgebliche Gate-Lauf. Der Live-Read-only-Preflight wurde ausgeführt, bleibt aber wegen fehlendem WPCode Lite blockiert; es wurde keine Mutation, Installation oder `--fix`-Aktion durchgeführt.

## Nicht Teil dieses Offline-Gates

- Live-MCP-Preflight und Live-Deploy: benötigen ein ausdrücklich bereitgestelltes Target und Credentials.
- Server-seitige QA gegen eine WordPress-Seite: benötigt Live-URL, Referenz-URL und ggf. Authentifizierung.
- Parallele Vollsuite ohne Timeout: der deterministische Release-Gate bleibt der serielle Lauf, da der bestehende `cmd-design-critic`-Test unter Parallel-Last flaky sein kann.

## Reproduzierbarkeit

```bash
npx tsc --build --clean
npx tsc --build --pretty false
npx vitest run tests/e2e/golden-path-v3.test.ts tests/e2e/golden-path-v4.test.ts tests/visual/visual-regression.test.ts tests/unit/cli/cli.test.ts tests/unit/cli/cmd-batch-serve.test.ts tests/unit/cli/cmd-rollback.test.ts tests/unit/cli/cmd-preflight.test.ts tests/unit/cli/cmd-wizard.test.ts tests/unit/cli/dry-run.test.ts --pool=forks --maxWorkers=1 --minWorkers=1 --testTimeout=60000
npx eslint packages/cli/src packages/core/src packages/extractors/src packages/target-v3/src packages/target-v4/src packages/mcp/src packages/qa/src
git diff --check
```
