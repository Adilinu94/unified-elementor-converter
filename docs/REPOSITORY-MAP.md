# Repository Map — Unified Elementor Converter

> **Kanonischer Einstieg für Menschen und KI-Agenten.**
> Für den aktuellen Arbeitsstand gilt `docs/TODO-OFFEN-2026-07-31.md`; historische Pläne und Archive sind keine aktuelle Aufgabenliste.

## 1. In welcher Reihenfolge lesen?

1. [`../AGENTS.md`](../AGENTS.md) — verbindliche Arbeitsregeln, CLI, MCP-Abilities und Gotchas.
2. [`REPOSITORY-CHARTA.md`](REPOSITORY-CHARTA.md) — Plattformvertrag und Definition of Done.
3. [`TODO-OFFEN-2026-07-31.md`](TODO-OFFEN-2026-07-31.md) — aktueller Status, Blocker und Release-Gates.
4. [`REPOSITORY-AUDIT-AND-CONVERGENCE-2026-08-01.md`](REPOSITORY-AUDIT-AND-CONVERGENCE-2026-08-01.md) — priorisierte Konvergenz- und Maintenance-Arbeiten.
5. [`RELEASE-GATES-2026-07-31.md`](RELEASE-GATES-2026-07-31.md) — historischer Gate-Bericht plus aktueller Arbeitsbaum-Nachtrag.
6. [`PROGRESS.md`](PROGRESS.md) — Phasenhistorie, nicht die primäre TODO-Liste.

## 2. Kanonischer Produktionspfad

```text
Source Adapter
  → Source Validation / Evidence
  → VisualPageIR
  → target-v3 oder target-v4
  → Guards
  → Snapshot / MCP Deploy
  → Read-back / Cache-Clear
  → Render- und Visual-QA
  → Report / Repair-Entscheidung
```

Neue generische Pipeline-Logik gehört in dieses Repository. Die beiden Vorgänger-Repositories sind nur Maintenance-/Migrationsreferenzen.

## 3. Workspace-Landkarte

| Bereich | Verantwortung | Einstieg |
|---|---|---|
| `packages/core` | Verträge, IR, Config, AI, Guards, Status, Targets | `packages/core/src/index.ts` |
| `packages/extractors` | Browser-, HTML-, Framer-XML-, Asset- und Source-Evidence-Extraktion | `packages/extractors/src/index.ts` |
| `packages/target-v3` | Elementor-V3-Planung und Emission | `packages/target-v3/src/index.ts` |
| `packages/target-v4` | Elementor-V4-Atomic-Planung, `$$type`, Global Classes | `packages/target-v4/src/index.ts` |
| `packages/mcp` | Ability-Registry, Adapter, Snapshot, Deploy, Read-back, Cache | `packages/mcp/src/index.ts` |
| `packages/qa` | Capture, Pixel/SSIM, Geometry, Diff, Healing, Design Critic | `packages/qa/src/index.ts` |
| `packages/cli` | `elconv`-Router, Wizard, Convert, Deploy, QA, Batch, Serve | `packages/cli/src/index.ts` |

**Harte Grenze:** V3- und V4-Target-Code importiert nicht aus dem jeweils anderen Target. Gemeinsame Mechanismen gehören in `core`, `mcp`, `qa` oder `extractors`.

## 4. Wichtigste Befehle

```bash
npm ci
npx tsc --build --pretty false
npx vitest run --pool=forks --maxWorkers=1 --minWorkers=1 --testTimeout=15000
npx eslint packages/cli/src packages/core/src packages/extractors/src packages/target-v3/src packages/target-v4/src packages/mcp/src packages/qa/src
git diff --check
```

CLI-Einstieg:

```text
elconv wizard       interaktiver V3/V4-Einstieg
elconv convert      URL, HTML oder Framer-XML → Tree + Report
elconv doctor       Guards, MCP und Ability-Drift
elconv deploy       Snapshot-gesicherter MCP-Deploy
elconv qa           echter Referenzvergleich, sonst not-scored
elconv preflight    Plugin-/PHP-/WordPress-Kompatibilität
elconv rollback     Snapshot wiederherstellen
```

## 5. Statusbegriffe

- `ok`: Schritt ausgeführt und erfolgreich.
- `skipped`: bewusst übersprungen.
- `unavailable`: Voraussetzung oder verifiziertes externes Schema fehlt.
- `failed`: Ausführung oder Zielprüfung fehlgeschlagen.
- `not-scored`: kein valider Referenzvergleich möglich.

Ein erfolgreicher HTTP-/MCP-Write ist ohne Read-back und Frontendprüfung kein visueller Erfolg.

## 6. Dokumentationsregeln

- Aktuelle Statusänderungen zuerst in `TODO-OFFEN-2026-07-31.md` und danach in `PROGRESS.md` bzw. `RELEASE-GATES-2026-07-31.md` nachführen.
- Neue Fähigkeiten und Ability-Namen gegen `packages/mcp/src/ability-registry.ts` und [`NOVAMIRA-ABILITY-PLAYBOOK.md`](NOVAMIRA-ABILITY-PLAYBOOK.md) prüfen.
- `docs/archive/` und `docs/archive-v4/` enthalten historische Entscheidungsprotokolle. Sie bleiben lesbar, sind aber nicht maßgeblich für neue Arbeit.
- Keine Secrets, Tokens, Application Passwords oder credential-bearing URLs in Code, Doku, Reports oder Git.
- Keine Datei löschen, nur weil sie unreferenziert ist: erst Produktionsimport, Tests, CI und historische Quellen prüfen.

## 7. Was aktuell nicht freigegeben ist

- Echte Live-Mutationen ohne explizites isoliertes Testziel, Snapshot und Freigabe.
- `upload-php` und `split`, solange ihre serverseitigen Upload-/Append-Schemas nicht verifiziert sind.
- V3-Live-Deploy solange der erforderliche WPCode-Port auf dem Testziel fehlt.
- Alte Vorgänger-Wizards als neue Hauptpipeline.

## 8. Aufräumentscheidung dieser Session

- Die drei neuen MCP-Dateien `packages/mcp/src/readback.ts`, `tests/unit/mcp/adapter.test.ts` und `tests/unit/mcp/readback.test.ts` sind produktiv benötigt und bleiben.
- Historische Plan- und Archivdateien bleiben erhalten, weil sie Quellen, Entscheidungen und Regressionserkenntnisse dokumentieren.
- Kaputte lokale Markdown-Links und veraltete Einstiegshinweise werden repariert.
