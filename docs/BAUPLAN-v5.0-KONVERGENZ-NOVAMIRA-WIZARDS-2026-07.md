# BAUPLAN v5.0 — Konvergenz, Novamira-Ability-Sync & Wizards

> **Status:** Geplant
> **Datum:** 2026-07-30
> **Basis:** Verifizierter Stand aller drei Repos (tsc 0 Fehler, 1006/1011 Tests grün — 3 Fails nur durch lokal gesetzte API-Keys) + Live-Discovery gegen `testseite.nick-webdesign.de` (263 Abilities, siehe `NOVAMIRA-LIVE-ABILITIES-2026-07-30.txt`)
> **Vorher:** BAUPLAN v4.0 (Phasen 75–99, geplant, nicht begonnen), HANDOFF-2026-07-30.md (P6-Kollisionen offen)

---

## Teil A — Ist-Zustand der drei Repos (verifiziert, nicht behauptet)

### A.1 unified-elementor-converter (das Ziel-Repo)

| Aspekt | Stand |
|---|---|
| Build/Tests | `tsc --noEmit` 0 Fehler; 1006/1011 Tests grün (3 Fails: AI-Smoke-Tests machen echte API-Calls, weil `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` in der Umgebung gesetzt sind — Testbug, kein Codebug) |
| CLI verdrahtet | `elconv convert / wizard / doctor / deploy / qa / design-critic / session-init / target` (`packages/cli/src/index.ts`) |
| Wizard | `cmd-wizard.ts` = **flag-basierte State-Machine, NICHT interaktiv**. Vier weitere Wizard-Dateien (`wizard.ts`, `v4-wizard.ts`, `framer-build-wizard.ts`, `prompts.ts` — mit readline/inquirer) sind **unverdrahteter toter Code** (gleiches Muster wie die bestätigte `v4-cmd-*`-Familie, 2.027 Zeilen) |
| Novamira-Anbindung | **71 referenzierte Ability-Namen, davon 46 TOT** (Alt-Namespace `novamira/adrians-*`, existiert auf dem Live-Server nicht mehr) |
| Bekannte Baustellen | P6: 10 Barrel-Export-Kollisionen (größte, `v3-container-normalize.ts` vs. `normalize.ts`, zwischenzeitlich per Commit `9cd0139` gemergt); `healing-loop.ts` vs. `healing-loop-v2.ts`; `cmd-qa.ts` Score hartkodiert `return 92`; Phase 73 pending |

### A.2 Framer-to-Elementor-V4-Pipeline

| Aspekt | Stand |
|---|---|
| Charakter | Domänenstark (V4-Schema, $$type, 14 Guards, Global Classes), aber produktionsschwach: 40+ npm-Scripts statt One-Shot-CLI, `wizard.ts` mit `@ts-nocheck` |
| Wizard | `wizard.ts` = interaktiver readline-Wizard mit Recovery-Mode + Subcommands (preflight/dry-run/preview/promote/batch/serve) — **funktional das beste Wizard-UX der drei Repos**, aber untypisiert |
| Novamira-Anbindung | 45 referenzierte Abilities, **34 TOT** (Alt-Namespace) |
| Einzigartig, noch nicht (vollständig) im unified | Interaktiver Recovery-Wizard; `serve`-Modus (HTTP-API Port 7123); `batch`-Multi-Page-Build; `novamira-ability-code-injector/`-PHP-Quellen (im unified nur als Kopie mitgeführt) |
| Bekannte Lücken (E2E-Protokoll) | Style-Referenzen ungelöst, backgroundColor verworfen (Bug 3), starre RC-11-Fallbacks, inlineTextStyle ignoriert — diese Lücken wurden im unified teils behoben, im Quell-Repo nie |

### A.3 site-clone-to-v3

| Aspekt | Stand |
|---|---|
| Charakter | Production-ready V3-Konverter, 12-Phasen-Pipeline, bestes MCP-Hygiene-Niveau |
| Wizard | `framer-build-wizard.ts` = interaktiver @inquirer/prompts-Wizard, 9 Fragen, sauber typisiert — **beste Wizard-Codequalität der drei Repos** |
| Novamira-Anbindung | 20 referenzierte Abilities, **nur 1 tot** (`novamira/upload` → heißt live `novamira/create-upload-link`). Einziges Repo, das bereits `novamira-adrianv2/*` korrekt nutzt, inkl. `upgrade-page-to-v4` und `convert-page-v3-to-v4` |
| Einzigartig, noch nicht im unified | `src/mcp/upgrade-v4.ts` + `convert-page-v3-to-v4`-Wrapper (serverseitige V3→V4-Konvertierung als Alternative zur lokalen Bridge) — prüfen, ob im unified `mcp`-Paket vorhanden |

### A.4 Live-Server-Fähigkeiten (Discovery 2026-07-30)

- Elementor 4.2.1 + Pro 4.1.0, V4 Atomic vollständig aktiv (Runtime, Style-Schema, Global Classes, Variables, Interactions)
- 263 Abilities in 3 Namespaces: `novamira/*` (Kern: set-content, execute-php, WPCode, Dateisystem, WP-CLI, Astra, Gutenberg), `novamira-adrianv2/*` (Builder/Audit/Batch/Atomic-Widgets), `mcp-adapter/*`
- **Vom keinem Repo genutzt, aber wertvoll:** `novamira-adrianv2/convert-site-v3-to-v4` (ganze Site), `check-editor-health`, `pipeline-state` (serverseitiger Pipeline-Zustand!), `score-distinctiveness`, `suggest-design-fixes`, `v4-performance-analysis`, `normalize-section-spacing`, `zero-container-padding`, `memory-save/get/list` (serverseitiges Agent-Memory), `skill-write/get` (Skills auf dem Server ablegen), `run-wp-cli`, `create-admin-access-link`

---

## Teil B — Phasenplan (100–115)

### Sprint 1 — Fundament reparieren (unified) — höchste Priorität

**Phase 100: Novamira-Ability-Registry als Single Source of Truth**
- Neu: `packages/mcp/src/ability-registry.ts` — generiert aus `docs/NOVAMIRA-LIVE-ABILITIES-2026-07-30.txt`
- Exportiert `KNOWN_ABILITIES` (const-Array) + Typ `AbilityName` + `ALIAS_MAP` für die 46 toten Alt-Namen (`novamira/adrians-X` → `novamira-adrianv2/X`, `novamira/upload` → `novamira/create-upload-link`, `novamira-adrianv2/adrians-X` → `novamira-adrianv2/X`)
- `novamira-client.ts`: vor jedem Call Name durch `resolveAbilityName()` schleusen; unbekannte Namen → harter Fehler mit Vorschlag
- Neu: `elconv doctor --sync-abilities` ruft `mcp-adapter-discover-abilities` live auf, difft gegen Registry, schreibt Drift-Report
- Test: jeder im Produktivcode referenzierte Ability-Name MUSS in Registry oder Alias-Map existieren (CI-Gate gegen künftige Drift)
- Akzeptanz: 0 tote Ability-Referenzen im unified-Produktivcode

**Phase 101: P6-Kollisionen abbauen (aus HANDOFF übernommen, jetzt eingeplant)**
- 101a: ~~`v3-container-normalize.ts` in `normalize.ts` mergen (die nie ausgeführte Phase 44), Tests zusammenführen~~ ✅ **bereits erledigt** durch parallele Session (Commit `9cd0139`, 2026-07-30)
- 101b: `healing-loop.ts` → `healing-loop-v2.ts`-Ablösung abschließen, v1 löschen
- 101c: `v4-cmd-*.ts`-Familie (2.027 Zeilen) löschen — der interaktive Wizard aus Phase 103 ersetzt ihre Funktion; `runDryRun`/`runPipeline`/`printHelp`-Kollisionen verschwinden damit
- 101d: Rest-Kollisionen (`hexToRgb`, `profilesPath`, `extractCssFromHtml`, `classifySection`) umbenennen/mergen
- Akzeptanz: Barrel-Scan findet 0 Doppel-Exporte

**Phase 102: Echte QA-Scores + AI-Test-Isolation** ✅ **erledigt** (Commit `78e753e`)
- ~~`cmd-qa.ts`: `return 92`-Placeholder durch echte pixelmatch/SSIM-Berechnung aus `packages/qa` ersetzen~~ ✅ (blend 0.6·SSIM + 0.4·pixelmatch via `diffScreenshots`+`computeSsim`; ohne Referenz/ohne Playwright → `null` statt erfundenem Score)
- ~~AI-Smoke-Tests: `vi.stubEnv('OPENAI_API_KEY','')` etc.~~ ✅ (env pro Test geleert)
- ~~`section-render-check.ts` testen (letztes ungetestetes Phase-61-Modul)~~ ✅ **bereits erledigt** durch parallele Session (Commit `9cd0139`: 188 Zeilen Tests)
- Akzeptanz erfüllt: volle Suite grün (1052 passed) auch mit gesetzten `OPENAI_API_KEY`+`ANTHROPIC_API_KEY`; `elconv qa` liefert echte Werte

### Sprint 2 — Wizards (Anforderung 5)

**Phase 103: unified — interaktiver `elconv wizard`** ✅ **erledigt**
- ⚠️ **Plan-Korrektur (verifiziert am Code):** Nur `v4-wizard.ts` (593 Z.) war echter toter Code (nirgends importiert, nicht im Barrel) → **gelöscht**. `wizard.ts`, `framer-build-wizard.ts`, `prompts.ts` sind **NICHT tot**, sondern der aktive `clone-v3`-Legacy-Cluster (importiert von `clone-v3.ts`/`pipeline-runner.ts`) → bleiben erhalten (Konvergenz/Deprecation in Phase 104/107)
- ✅ Interaktiver Pfad in `cmd-wizard.ts` ergänzt (@inquirer/prompts `select`/`input`/`confirm`; UX aus framer-build-wizard geerntet): Ziel V3/V4 → Quelle URL/XML/HTML → Output → Deploy(post_id) → Dry-Run; speist dieselbe State-Machine
- ✅ Flag-Modus bleibt (`--no-interactive` erzwingt Flag-Pfad; `--target` überspringt Prompts); State-Resume unverändert über extrahierte `runWizardStateMachine`
- ✅ Bonus: `qaScore = 95`-Placeholder in `executeQa` entfernt (verweist jetzt auf `elconv qa`)
- Akzeptanz: `elconv wizard` ohne Flags führt interaktiv durch beide Targets (TTY-Guard); State-Resume funktioniert; Tests in `tests/unit/cli/cmd-wizard.test.ts`
- Ablauf: (1) Ziel V3/V4 → (2) Quelle Live-URL/Framer-XML/HTML → (3) WP-Target wählen/anlegen (aus `targets.ts`-Profilen) → (4) Live-Preflight via `mcp-adapter-discover-abilities` + `elementor-check-setup` (bei V4: atomic.* prüfen) → (5) Seite: post_id oder neu → (6) QA-Optionen (Threshold, Max-Fix-Runden, Geometry-Probe vs. Vision) → (7) Dry-Run/Deploy → (8) Zusammenfassung + Resume-State
- Flag-Modus (`cmd-wizard.ts`-State-Machine) bleibt als non-interaktiver Pfad erhalten (`--no-interactive`)
- Akzeptanz: `elconv wizard` ohne Flags führt komplett interaktiv durch beide Targets; State-Resume funktioniert

**Phase 104: Vorgänger-Repos — Wizard-Pflege light + Deprecation** ✅ **erledigt** (site-clone `ccc1d15`, V4-Pipeline `1926c50`)
- ✅ Beide Repos: README-Banner „Maintenance-Mode“ + Wizard-Startbildschirm-Hinweis
- ✅ V4-Pipeline: `McpBridge.normalizeAbilityName()` mappt alle 34 toten `novamira/adrians-*` zentral in `_callInternal` (+ REST-Fallback-Lookup); Tests in `tests/lib/mcp-bridge-namespace.test.js` (4/4 grün, Suite 495/496 — 1 vorbestehender env-Fehler in framer-export-dist)
- ✅ site-clone: `novamira/upload` war bereits gefixt (Plan-Korrektur); tatsächlich tot war `novamira/upload_asset` → `novamira-adrianv2/upload-asset` (real-fixers.ts + Test, 13/13 grün, tsc 0)
- Akzeptanz erfüllt: beide Repos gegen Live-Server lauffähig, Deprecation sichtbar

### Sprint 3 — KI-Nutzbarkeit (Anforderung 4)

**Phase 105: AGENTS.md pro Repo (KI-Einstiegspunkt)** ✅ **erledigt**
- ✅ unified: neues `AGENTS.md` im Root (Muster site-clone): Was ist das, Monorepo-Layout, CLI-Referenz, Ability-Registry-Regeln, Workflows V3+V4, Gotchas, Arbeitsregeln
- ✅ V4-Pipeline: `AGENTS.md` neu — kurz, Deprecation + Verweis auf unified + normalizeAbilityName-Hinweis
- ✅ site-clone: `AGENTS.md` um Maintenance-Mode-Banner + Namespace-Hinweis ergänzt
- Akzeptanz erfüllt: Jedes Repo beantwortet in EINER Datei: Wie verwenden? Welche Tools? Welche Abilities? Welche Config?

**Phase 106: Ability-Playbook** ✅ **erledigt**
- ✅ `docs/NOVAMIRA-ABILITY-PLAYBOOK.md` erstellt — 9 Pipeline-Schritte (Preflight/V3/V4/Assets/Code/QA/Konvertierung/Cache/Server-State) mit via `mcp-adapter-get-ability-info` live verifizierten Input-Schemata (u.a. batch-build-page, elementor-set-content, setup-v4-foundation, create-global-class, visual-qa, convert-page-v3-to-v4, check-setup, batch-media-upload, page-audit) + Alias-Anhang + Drift-Kontrolle
- ⚠️ Dabei verifiziert: `create-wpcode-snippet` existiert NUR als `novamira-adrianv2/*` (Registry war korrekt); `novamira/upload_asset`-Alias in ALIAS_MAP ergänzt
- Akzeptanz erfüllt: Ein KI-Agent kann ohne Code-Lektüre den korrekten Ability-Call pro Schritt nachschlagen

### Sprint 4 — Konvergenz abschließen (Anforderung 3)

**Phase 107: Gap-Portierung Rest** ✅ **erledigt**
- ✅ `upgrade-v4.ts`/`convert-page-v3-to-v4.ts` waren bereits ins `mcp`-Paket portiert — aber mit kaputtem Import (`./mcp-adapter.js` existiert nicht) → auf `./adapter.js` gefixt; CLI-Option `elconv deploy --server-convert` (+ `--convert-dry-run`, `--convert-auto-fix`) verdrahtet
- ✅ `elconv serve` (HTTP-API, Port 7123, node:http: GET /health, POST /convert, POST /qa) + `elconv batch --manifest <json>` (Multi-Page, continue-on-error) neu in `packages/cli`
- ✅ Feature-Matrix in MIGRATION.md dokumentiert; Tests in `tests/unit/cli/cmd-batch-serve.test.ts` (Manifest-Validierung, echte Konversion über HTTP, Fehlerrouten)
- ⚠️ Dabei entdeckt: Root-`tsc --noEmit` prüft NICHTS (`files: []`) — echter Check ist `tsc --build`, der viele vorbestehende Fehler zeigt (eigenes Arbeitspaket, siehe Phase 109+)
- Akzeptanz erfüllt: Feature-Matrix unified ⊇ (V4-Pipeline ∪ site-clone); dokumentiert in MIGRATION.md

**Phase 108: Neue Server-Fähigkeiten nutzen (über Konvergenz hinaus)** ✅ **erledigt** (Akzeptanz)
- ✅ Neu: `packages/mcp/src/server-critic.ts` — typisierte Clients für drei bisher von keinem Repo genutzte Live-Abilities (`suggest-design-fixes`, `score-distinctiveness`, `pipeline-state`); Shapes aus live `get-ability-info` transkribiert (2026-07-30), nicht geraten
- ✅ `suggest-design-fixes` + `score-distinctiveness` produktiv in den Design-Critic-Flow eingehängt: `elconv design-critic --server-critic --post-id <id> --mcp-url <url> --auth-env <ENV>` läuft serverseitig gegen einen deployten Post und faltet Distinctiveness (`--min-distinctiveness`, default 70) in das Pass/Fail-Gate — **schließt Phase 73** (Design-Critic ↔ Server; lokaler L1-Critic + serverseitige L2-Analyse)
- ✅ `pipeline-state`-Client als Remote-Backend für Session/Resume vorhanden (save/load/cleanup/list; wirft bei fehlender pipelineId/state) — Verdrahtung in den Wizard-State folgt in eigenem Commit
- ⏳ Offen (Bonus über Akzeptanz hinaus): `memory-save/list` für Build-Lessons, `skill-write` fürs Server-Skill-Deploy, Wizard-Remote-State
- ✅ Tests: `tests/unit/mcp/server-critic.test.ts` (9, Fake-Adapter, kein Netzwerk) + `tests/unit/cli/cmd-design-critic.test.ts` (Verdrahtungs-Guard: `--server-critic` ohne Flags → Exit 2); volle Suite 1074 grün, eslint 0 auf geänderten Dateien
- ⚠️ Dabei bestätigt: Ein sauberer `tsc --build` fehlt workspace-weit (viele vorbestehende Typfehler + Barrel-Kollisionen in core/mcp/cli; die TS5055-Emit-Kollisionen waren reine stale-`dist`-Hygiene und verschwinden nach `tsc --build --clean` + Neubau) → Phase 109+ Arbeitspaket
- Akzeptanz erfüllt: Phase 73 geschlossen; 2 neue Abilities produktiv verdrahtet + getestet (3. als Client+Test bereit)

### Sprint 5 — Härtung (aus BAUPLAN v4.0 priorisiert)

**Phase 109–115 (Reihenfolge):** 109 Zod-Config-Validation (v4.0-V5) → 110 WordPress Snapshot/Rollback (V3) → 111 Streaming Progress/ETA im Wizard (V8) → 112 Visual-Regression-Pixel-Diff CI (V9) → 113 Multi-Page-Batch-Orchestrator vervollständigen (V10) → 114 Fix-Learning (V6) → 115 Plugin-Compat-Preflight (V7). CI (V2) und Import-Repair (V1) sind bereits erledigt und werden aus v4.0 gestrichen.

- **109 Zod-Config-Validation** ✅ **erledigt**: `zod@^4` als `@elconv/core`-Dependency; `packages/core/src/config.ts` auf ein Zod-Schema als Single Source of Truth umgestellt (`ElconvConfigSchema`, `ElconvConfig = z.infer<...>`). `parseConfig()` validiert ein vollständiges Dokument strikt und wirft `ConfigValidationError` (fehlendes Feld, falsches Enum, Zahl außerhalb Range, unbekannter Top-Level-Key = Typo-Guard); `validateConfig()` bleibt als lenientes Partial-Check (Vertrag der Bestandstests erhalten); `loadConfig()` ist jetzt fail-hard statt nur `console.warn`. Tests: `tests/unit/core/config.test.ts` 30 grün.
- **110 WordPress Snapshot/Rollback** ✅ **erledigt**: neues `packages/mcp/src/snapshot.ts` — `capturePageSnapshot()` (live `novamira/elementor-get-content` mit `full_dump=true`) speichert den Ist-Zustand einer Seite als restaurierbaren JSON-Snapshot; `restorePageSnapshot()` schreibt ihn via `novamira/elementor-set-content` zurück; dazu ein dateibasierter Store (`writeSnapshotFile`/`readSnapshotFile`/`listSnapshots`, neueste zuerst). Neuer Befehl `elconv rollback` (`--post-id` neuester Snapshot | `--snapshot <path>` | `--list` | `--dry-run`; Restore braucht `--mcp-url`+`--auth-env`). Tests: `tests/unit/mcp/snapshot.test.ts` (9) + `tests/unit/cli/cmd-rollback.test.ts` (5). (I/O-Schemata live verifiziert 2026-07-30; der alte cmd-deploy-„Backup" schrieb fälschlich den EINGEHENDEN Baum — ein echter Snapshot erfasst den zu überschreibenden Ist-Zustand.)
- **111 Streaming Progress/ETA im Wizard** ✅ **erledigt**: neues `packages/core/src/progress.ts` — `ProgressTracker` (injizierbare Uhr für deterministische Tests, optionaler Render-Sink), `formatDuration()`, `renderProgress()`; ETA = Durchschnitts-Schrittdauer × Restschritte. In `cmd-wizard.ts`-State-Machine verdrahtet: nach jeder Phase eine Statuszeile `[n/total] % • elapsed • ETA • phase`; Total = die in DIESEM Lauf verbleibenden Phasen (korrekt bei `--resume`). Tests: `tests/unit/core/progress.test.ts` (9); CLI-Suite 61 grün.

---

## Teil C — Prioritäten, Reihenfolge, Aufwand

| Prio | Phase | Warum zuerst | Aufwand (grob) |
|---|---|---|---|
| P0 | 100 | 46 tote Ability-Calls = unified kann gegen den echten Server teilweise NICHT deployen | 4–6 h |
| P0 | 101 | Kollisionen sind laut HANDOFF implementierungsabhängiges Verhalten = latente Bugs (101a bereits erledigt, Rest offen) | 4–8 h |
| P1 | 102 | QA-Placeholder untergräbt jede Qualitätsaussage; Test-Isolation blockt CI bei Nutzern mit Keys | 3–4 h |
| P1 | 103 | Kern-UX; nutzt vorhandenen toten Code als Rohmaterial | 8–12 h |
| P2 | 104, 105, 106 | Geringer Aufwand, hoher Nutzen für KI-Bedienbarkeit | je 2–4 h |
| P3 | 107, 108 | Konvergenz-Abschluss + Mehrwert | 6–10 h |
| P4 | 109–115 | Langfrist-Härtung | inkrementell |

**Ressourcen:** Node ≥ 20, npm-Workspace; Novamira-MCP-Zugang (`novamira-testseite-nick-w`, verifiziert funktionsfähig); optional ANTHROPIC/OPENAI-Keys für Vision-QA; Playwright-Browser für Extraktion/QA.

**Arbeitsregeln (aus HANDOFF übernommen, bindend):** Pro Modul Quellcode vollständig lesen → Tests mit echten Assertions → tsc + betroffener Test + volle Suite + Lint → ein Fund pro Commit → vor Push `git fetch origin` (parallele Sessions!).

---

## Teil D — Zusätzliche langfristige Vorschläge (über die Anforderungen hinaus)

1. **Ability-Schema-Codegen:** `mcp-adapter-get-ability-info` für alle genutzten Abilities abrufen → TypeScript-Typen generieren (`packages/mcp/src/generated/`) → Compile-Zeit-Sicherheit für Parameter statt `Record<string, unknown>`
2. **Nightly-Drift-CI:** GitHub-Action ruft wöchentlich discover-abilities auf und öffnet ein Issue bei Registry-Drift (verhindert Wiederholung des 46-tote-Referenzen-Problems)
3. **`convert-site-v3-to-v4`-Migrationskommando:** `elconv migrate-site` — ganze WordPress-Site V3→V4 mit Snapshot davor (Phase 110) und QA-Report danach; auf der Testseite warten 74 V3-Seiten als reale Testmenge
4. **Golden-Page auf der Testseite:** Post 4690 („Jacket Masters Native Widgets", einzige V4-Seite) als Referenz-Fixture für V4-E2E-Regression einfrieren
5. **Vorgänger-Repos archivieren:** Nach Phase 107 beide GitHub-Repos auf „archived" setzen — README verweist auf unified; beendet die dokumentierte Drift-Gefahr durch parallele Sessions endgültig
