# Verifikations-Checkliste: `upload-php` und `split` produktiv freischalten (O-03)

> **Zweck:** Diese Checkliste beschreibt den vollständigen, kontrollierten Weg von der
> Offline-Vorbereitung bis zur produktiven Freischaltung der großen Deploy-Strategien
> `upload-php` und `split`. Sie ist die operative Anleitung zur Statuszeile in
> `docs/TODO-OFFEN-2026-07-31.md` (Abschnitt 4.4) und zur Audit-Zeile in
> `docs/REPOSITORY-AUDIT-AND-CONVERGENCE-2026-08-01.md`.
>
> **Harte Regel:** Keiner der Schritte wird gegen eine Produktionsseite ausgeführt.
> Mutationen und Installationen auf dem WordPress-Ziel laufen nur nach ausdrücklicher
> Freigabe und immer mit Snapshot davor.

---

## 0. Ausgangslage (was bereits existiert)

| Artefakt | Ort | Status |
|---|---|---|
| Eingefrorener Aufrufvertrag | `packages/mcp/src/large-deploy-plan.ts` | ✅ offline |
| Registry-Drift-Guard (`assertPlanUsesKnownAbilities`) | `packages/mcp/src/large-deploy-plan.ts` | ✅ offline |
| Mock-Executor mit Retry/Resume (`runPlannedDeploy`) | `packages/mcp/src/large-deploy-plan.ts` | ✅ offline |
| Offline-Fixtures (V3 ~465 KB, V4 ~1,4 MB inkl. Sonderfälle) | `tests/unit/mcp/fixtures/large-trees.ts` | ✅ offline |
| Schema-Verifikationscheck | `packages/mcp/src/large-deploy-verification.ts` + `elconv doctor --verify-large-deploy` | ✅ offline |
| Produktives Gate (hart) | `packages/mcp/src/deploy.ts` — `capability-unavailable` für beide Strategien | 🔒 **bleibt geschlossen bis §4** |

**Vertrags-Referenz (die vier Abilities + erwartete Parameter):**

| Ability | Rolle | Erwartete Parameter |
|---|---|---|
| `novamira-adrianv2/elementor-inject-calibrated-page` | V3-Deploy (direct) | `post_id`, `_elementor_data`, `elementor_version`, `wp_page_template`, `transaction_id`, `mode` |
| `novamira-adrianv2/batch-build-page` | V4-Deploy | `post_id`, `elements`, `transaction_id`, `mode` |
| `novamira-adrianv2/tree-chunk-start` | Tree-Chunk Start | `post_id`, `mode`, `wp_page_template`, `elementor_version` |
| `novamira-adrianv2/tree-chunk-append` | Tree-Chunk Append | `session_id`, `chunk_index`, `chunk_data` |
| `novamira-adrianv2/tree-chunk-commit` | Tree-Chunk Commit | `session_id`, `post_id` (Output = inject `post_id, sections_count, kit_id, warnings, blocks_invalidated, saved_at, element_id_map`) |
| `novamira/elementor-get-content` | Read-back | `post_id`, `full_dump` |
| `novamira/elementor-clear-document-cache` | Cache-Clear | `post_ids` |

Tree-Chunk ist seit Plugin fc26eb6 (2026-08-06) die kanonische Large-Strategie für MCP-only Clients (~2 KB/Chunk, 5 MB Cap, TTL 15 Min).

**Band-Grenzwerte** (`packages/core/src/deploy-strategy.ts`): `< 400 KB` → `direct` · `< 1 200 KB` → `upload-php` · `≥ 1 200 KB` → `split`.

---

## 1. Phase 1 — Testziel-Freigabe (externe Voraussetzung, niemand kann das ersetzen)

> Diese Phase ist die einzige, die nicht offline erledigt werden kann. Ohne sie
> stoppt die Checkliste hier — ehrlich, nicht stillschweigend.

- [ ] **Isoliertes WordPress-Testziel freigeben** — eine ausdrücklich für Tests
      freigegebene Instanz mit aktivem Novamira-Plugin (bekanntes Ziel:
      `testseite.nick-web-design.de`, Elementor 4.2.1 + Pro 4.1.0, V4 Atomic aktiv).
      **Niemals eine Produktionsseite verwenden.**
- [ ] **WPCode Lite installieren oder bewusst freigeben** — der V3-Live-Preflight
      markiert WPCode Lite als erforderlich (Status `docs/TODO-OFFEN-2026-07-31.md` §7).
      Alternativ eine bewusst freigegebene CSS/JS-Port-Alternative dokumentieren.
- [ ] **Sicheren MCP-/WordPress-Zugang bereitstellen** — neuer Zugang
      (`user:application-password`), nur per Umgebungsvariable (`--auth-env`), keine
      Secrets in Git.
- [ ] **Ausdrückliche Mutationsfreigabe erteilen** — schriftlich (z. B. im Issue/Commit),
      dass auf diesem Ziel getestete Mutationen ausgeführt werden dürfen.
- [ ] **Snapshot-Recht bestätigen** — das Ziel erlaubt Snapshot-Capture vor jeder
      Änderung und Rollback danach (`elconv rollback`).
- [ ] **Bekannte Grenze bestätigen:** WordPress 7.0.2 liegt über der getesteten
      Maximalversion 6.8 (Read-only-Preflight 2026-08-03) — Abweichungen vor dem
      ersten Test dokumentieren.

**Abnahme:** Alle Häkchen gesetzt, Ziel + Zugang im Target-Profil
(`elconv target add --name <testprofil> --mcp-url <url> --site-url <url>`) hinterlegt.

---

## 2. Phase 2 — Offline-/Read-only-Verifikation (keine Mutation)

### 2.1 Registry-Sync bestätigen (Read-only)

```bash
elconv doctor --sync-abilities --target-name <testprofil>
# Erwartet: Exit 0, "Registry is in sync" — sonst zuerst die Registry pflegen.
```

### 2.2 Live-Preflight (Read-only)

```bash
elconv doctor --target v3 --mcp-url <url> --auth-env <ENV_VAR>   # MCP + Kompatibilität
elconv preflight --mode v3 --mcp-url <url> --auth-env <ENV_VAR>  # Plugin/PHP/WP
# V4 zusätzlich: elconv doctor --target v4 ... (Atomic-Runtime-Gate)
```

### 2.3 Schema-Verifikation des Large-Deploy-Vertrags

```bash
# Human-Report (mit Profil):
elconv doctor --verify-large-deploy --target-name <testprofil>

# Oder mit expliziten Zugangsdaten:
elconv doctor --verify-large-deploy --mcp-url <url> --auth-env <ENV_VAR>

# Maschinenlesbare Evidenz für das Verifikationsprotokoll:
elconv doctor --verify-large-deploy --target-name <testprofil> --json \
  > docs/evidence/large-deploy-verification-<datum>.json
```

**Exit-Codes:** `0` = alle vier Live-Schemas erfüllen den eingefrorenen Vertrag
(inkl. `mode`-Enum `replace`+`append`) · `1` = nicht verifiziert (unavailable,
unerkanntes Shape, fehlende Parameter, fehlendes Mode-Enum) · `2` = Usage.

**Interpretation der JSON-Report-Felder:**

| Feld | Bedeutung |
|---|---|
| `ok` | Alle vier Abilities verifiziert |
| `checks[].status` | `checked` (Schema geholt) oder `unavailable` (Fetch fehlgeschlagen) |
| `checks[].shapeRecognized` | Live-Payload-Shape erkannt; `false` ⇒ ehrlich nicht verifiziert |
| `checks[].missingParams` | Vertragsparameter, die das Live-Schema nicht deklariert |
| `checks[].mode` | `declared`/`values`/`supported` + `issue` für die Deploy-Abilities |
| `requiresLiveRoundtrip` | **Immer `true`** — dieser Check kann das Gate nie öffnen |

- [ ] Report ist `ok: true` UND `requiresLiveRoundtrip: true` wurde bestätigt
      (die Evidenz dokumentiert, dass Schema-Verifikation ≠ Freischaltung ist).
- [ ] Bei `ok: false`: Jeden `issue` dokumentieren — falls das Live-Schema vom
      eingefrorenen Vertrag abweicht, entscheiden: Vertrag anpassen (bewusste
      Plan-Änderung mit Tests) oder Server-Anpassung einfordern.

**Abnahme:** Verifikations-JSON abgelegt; jede Abweichung ist begründet und
entschieden. **Weiterhin keine Mutation.**

---

## 3. Phase 3 — Kontrollierter Live-Roundtrip (erste echte Mutation, klein)

> Reihenfolge strikt einhalten. Jede Stufe nur bestehen, wenn die vorherige grün ist.
> **V3 zuerst, dann V4** — der V3-Inject-Pfad ist der etabliertere.

### 3.1 Baseline: kleiner `direct`-Deploy (Transport/Snapshot/Rollback beweisen)

```bash
# 1) Kleinen Tree im direct-Band (< 400 KB) bauen/auswählen, z. B.:
elconv convert --target v3 --html ./fixture.html --out ./small-v3.json

# 2) Dry-Run (kein MCP-Aufruf, Exit 0):
elconv deploy --target v3 --tree ./small-v3.json --post-id <ID> --dry-run

# 3) Echter Deploy (Snapshot wird automatisch vor der Mutation gezogen):
elconv deploy --target v3 --tree ./small-v3.json --post-id <ID> \
  --mcp-url <url> --auth-env <ENV_VAR> --snapshot-dir .elconv-snapshots
```

- [ ] Deploy Exit 0; Snapshot-Pfad wird ausgegeben (`Snapshot: <pfad>`).
- [ ] **Read-back:** Inhalt der Post-ID entspricht dem Tree
      (Deploy-Orchestrator verifiziert automatisch via `verifyPersistedTree`).
- [ ] **Cache-Clear** nach dem Deploy ausgeführt (`elementor-clear-document-cache`).

### 3.2 Frontend-Render + Multi-Viewport-QA

```bash
# Referenz-URL (Originalseite) und Deploy-Permalink vergleichen — nur mit echter
# Referenz wird ein realer Score berechnet (sonst ehrlich "not scored"):
elconv qa --url <deploy-permalink> --ref-url <source-url>

# Wizard-QA-Pfad mit expliziten Viewports (Desktop/Tablet/Mobile):
elconv wizard ... --qa-ref-url <source-url> --viewports 1440,768,390
```

- [ ] Desktop/Tablet/Mobile rendern korrekt (kein CSS-Bruch, keine Lade-Fehler).
- [ ] QA-Score ≥ Schwellwert ODER Abweichungen sind klassifiziert und dokumentiert.

### 3.3 Rollback-Test (Snapshot-Verhalten beweisen)

```bash
elconv rollback --list --snapshot-dir .elconv-snapshots          # Snapshot vorhanden?
elconv rollback --post-id <ID> --dry-run --snapshot-dir .elconv-snapshots
elconv rollback --snapshot "<pfad>" --mcp-url <url> --auth-env <ENV_VAR>   # echter Restore
# Danach erneut read-back: Inhalt entspricht wieder dem Snapshot-Zustand.
```

- [ ] Rollback stellt den Vor-Deploy-Zustand wieder her (Read-back bestätigt).

### 3.4 Erster echter `upload-php`-Deploy (Band 400 KB – 1,2 MB)

> **Bewusst erst jetzt:** Phase 2 (§2.3) hat das `mode`-Schema verifiziert, Phase 3.1–3.3
> haben Transport, Snapshot und Rollback bewiesen. Der Tree muss im upload-php-Band liegen
> (Fixtures: `tests/unit/mcp/fixtures/large-trees.ts`, V3 ~449–465 KB).

```bash
elconv deploy --target v3 --tree ./upload-php-v3.json --post-id <ID> \
  --strategy upload-php --mcp-url <url> --auth-env <ENV_VAR> --snapshot-dir .elconv-snapshots
```

**Beobachtungs-Checkliste (der Kern der Verifikation):**
- [ ] Zwei Chunks ausgeführt: `mode: replace` → `mode: append`.
- [ ] Read-back + Cache-Clear **nach jedem Chunk** (Vertrag: 3 Calls pro Chunk).
- [ ] `transaction_id` wird in jedem Deploy-Call mitgeschickt und vom Server akzeptiert.
- [ ] Kein Inhalt geht verloren: Chunk-2-Append ersetzt nicht versehentlich Chunk 1.
- [ ] Exit 0, Transaction gemeldet, danach Render-QA (§3.2) grün.
- [ ] Rollback-Test (§3.3) erneut bestanden.

### 3.5 `split`-Deploy (Band ≥ 1,2 MB)

```bash
elconv deploy --target v4 --tree ./split-v4.json --post-id <ID> \
  --strategy split --mcp-url <url> --auth-env <ENV_VAR> --snapshot-dir .elconv-snapshots
```

**Beobachtungs-Checkliste:**
- [ ] 20-Element-Chunks werden erzeugt, letzter Chunk appended.
- [ ] Read-back + Cache-Clear nach jedem Chunk; Gesamtinhalt vollständig.
- [ ] V4-Atomic-Tree überlebt den Deploy (Global Classes/Variables intakt) —
      V4-Read-back-Vergleich gegen den Quell-Tree.
- [ ] Exit 0, Render-QA grün (V4 speziell: e-flexbox/e-heading sauber).
- [ ] Rollback-Test erneut bestanden.

**Abnahme Phase 3:** Beide Strategien haben auf dem Ziel den vollen Roundtrip
(Snapshot → Deploy → Read-back → Cache-Clear → Render-QA → Rollback) bestanden —
für V3 **und** V4. Das Protokoll mit allen Exit-Codes und QA-Scores wird abgelegt
(z. B. `docs/evidence/`).

---

## 4. Phase 4 — Literal kippen + Gate entfernen (bewusster Code-Entscheid)

> Nur nach bestandener Phase 3. Dieser Schritt ist absichtlich eine **bewusste
> Code-Änderung mit Tests** — niemals ein Nebeneffekt anderer Arbeit. Er besteht aus
> vier zusammengehörigen Teilen, die zusammen in **einem** Commit landen (eine
> Übergangszustand, in dem das Gate halb offen ist, ist nicht zulässig).

- [ ] **1. Plan-Literal entfernen** — `packages/mcp/src/large-deploy-plan.ts`:
      `requiresSchemaVerification: true` (Literalityp) wird entfernt/umgedreht;
      damit ist der Vertrag als verifiziert markierbar.
- [ ] **2. Gates in `deploy.ts` öffnen** — die Verdrahtung ist **vorbereitet**: seit
      dem O-03-Unlock-Vorbereitungscommit liegt `runPlannedDeploy()` bereits in `executeDeploy`
      hinter dem expliziten Opt-in `DeployOptions.largeDeployVerified` (produktiv
      setzt es niemand; ohne es bleibt `capability-unavailable` mit 0 MCP-Calls
      exakt erhalten). Der Unlock reduziert sich auf: das Opt-in in der CLI setzen
      (bzw. den `capability-unavailable`-Zweig entfernen) und die Gate-Assertions
      in den Offline-/Verifikations-Tests umstellen.
- [ ] **3. Verifikations-Gate-Literal anpassen** — `requiresLiveRoundtrip` in
      `large-deploy-verification.ts` wird vom Literal-`true` auf einen echten Zustand
      umgestellt (der Check berichtet jetzt den freigeschalteten Stand).
- [ ] **4. Betroffene Tests aktualisieren** — alle Gate-Assertions, die das
      `capability-unavailable`-Verhalten oder die Literale festnageln:
      `tests/unit/mcp/large-deploy-offline.test.ts` („ehrliches Gate mit 0 MCP-Calls“),
      `tests/unit/mcp/large-deploy-verification.test.ts` („gate literal“),
      Deploy-Tests, die `executeDeploy` mit diesen Strategien prüfen.
- [ ] **5. CLI-Texte anpassen** — `packages/cli/src/cmd-deploy.ts`: die Dry-Run-Zeilen
      „Capability: unavailable live …“ entfallen; Help-Text in `packages/cli/src/index.ts`
      („others require verified server schemas“) wird auf den freigeschalteten Stand
      aktualisiert.
- [ ] **6. Neuer Regressionstest** — ein Test, der den freigeschalteten
      `upload-php`/`split`-Pfad gegen die Offline-Fixtures ausführt (Mock-Adapter),
      inklusive Read-back/Cache-Clear-Vertrag und Resume-Verhalten — die alten
      Offline-Tests werden dazu erweitert statt ersetzt.

**Verbindliche Gates vor dem Commit** (AGENTS.md §7):

```bash
npx tsc --build --clean && npx tsc --build --pretty false
npx vitest run --pool=forks --maxWorkers=1 --minWorkers=1 --testTimeout=15000   # serielle Vollsuite
npx eslint packages/mcp/src packages/cli/src
git diff --check
```

---

## 5. Phase 5 — Post-Unlock-Nachweis (ein letzter Live-Roundtrip)

- [ ] `--verify-large-deploy` erneut ausführen → Report zeigt den freigeschalteten Stand.
- [ ] Einen weiteren echten `upload-php`- und `split`-Deploy auf dem Testziel ausführen
      (kompletter Roundtrip aus §3) — der produktive Pfad (nicht mehr nur der
      Schema-Check) wird damit live bestätigt.
- [ ] **Doku nachführen:**
      - `docs/TODO-OFFEN-2026-07-31.md` §4.4: Statuszeile „unverifiziert“ → verifiziert;
      - `docs/REPOSITORY-AUDIT-AND-CONVERGENCE-2026-08-01.md` (Zeile mit der externen
        Verifikation der Upload-/Append-Schemas);
      - `docs/NOVAMIRA-ABILITY-PLAYBOOK.md` (falls dort die Strategien als unavailable
        geführt werden);
      - `CHANGELOG.md`.
- [ ] Nightly-Drift-CI (sobald vorhanden) deckt die vier Vertrags-Abilities weiterhin ab —
      eine Server-Änderung am `mode`-Vertrag wird damit automatisch gemeldet.

---

## 6. Definition of Done (vollständige Freischaltung)

- [ ] Testziel freigegeben, WPCode-Entscheidung getroffen (§1).
- [ ] Schema-Verifikation grün, Evidenz-JSON abgelegt (§2).
- [ ] Kontrollierter Live-Roundtrip für V3 + V4 × `upload-php` + `split` bestanden (§3).
- [ ] Literal gekippt, Gates entfernt, CLI-Texte + Help aktualisiert (§4).
- [ ] Vollsuite + Lint + `tsc` grün; Regressionstests für den freigeschalteten Pfad (§4).
- [ ] Post-Unlock-Live-Roundtrip bestanden, Doku synchron (§5).

> **Bis hierher nicht erfüllt, bleibt `upload-php`/`split` strukturiert `unavailable` —
> das ist korrekt und sicher.** Der Schema-Check (§2.3) ist Evidenz, kein Freischalter.

---

## 7. Harte Regeln (wiederholend)

1. **Nie gegen Produktion testen** — nur das freigegebene, isolierte Testziel.
2. **Keine automatischen Mutationen/Installationen** — alles mit ausdrücklicher Freigabe
   und Snapshot davor.
3. **Kein `--fix`/Auto-Install** auf dem Ziel (WPCode-Lite-Entscheidung ist menschlich).
4. **Ein Finding pro Commit**; `git fetch origin` unmittelbar vor dem Push
   (parallele Sessions sind real).
5. **QA-Scores nur mit echter Referenz** — „not scored“ ist ein gültiges Ergebnis.
