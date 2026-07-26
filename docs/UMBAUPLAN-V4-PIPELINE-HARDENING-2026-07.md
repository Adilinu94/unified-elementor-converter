# Umbauplan — Framer-to-Elementor-V4-Pipeline Hardening (Juli 2026)

**Zielgruppe:** schwächere / billigere KI oder Junior. Phasen strikt sequentiell, DoD pro Phase.

**Repo:** `Adilinu94/Framer-to-Elementor-V4-Pipeline`  
**Schwester:** `Adilinu94/site-clone-to-v3` (nur lesen / Bridge-Handoff — **kein** V3-Schema in den V4-Build mischen)

**Anlass:** Vergleich mit site-clone-to-v3. Die V4-Pipeline ist **domain-stärker** (Guards, GC/GV, Unframer, Preflight), aber **produkt-schwächer** (kein `clone-v3`-ähnliches One-Shot-CLI, dünne Any-URL-Story, Stub-Bridge aus V3, Doc-Drift, manuelle Agent-Schritte).

**Geschätzter Aufwand:** 40–55 h (schwächere KI: 55–75 h).

---

# 0. Pflichtregeln

## 0.1 Arbeitsweise

1. Eine Phase nach der anderen; DoD grün → weiter.  
2. Kleine Commits; Englisch in Code/Tests/Commits.  
3. `npm test` (bzw. dokumentierte Baseline) vor „fertig“.  
4. **Kein Breaking** an `convert-xml-to-v4` CLI-Flags ohne Phase „Breaking“ + CHANGELOG.  
5. ESM + TypeScript (`tsx`); bestehende Script-Namen in `package.json` **additiv** erweitern.  
6. Keine Secrets; keine hardcodierten Produktions-Hosts.  
7. Bei Port aus site-clone-to-v3: **Ideen/Algorithmen**, nicht V3-`container`-Trees als Atomic ausgeben.

## 0.2 Verboten

- V3 `elType: container` als finales V4-Dokument speichern.  
- Global Classes überspringen „weil’s schneller geht“.  
- `elementor-set-content` mit `elements` statt `content` (bzw. umgekehrt je Ability — README/Skill beachten).  
- Assertions löschen.  
- Monorepo-Merge mit site-clone in **dieser** Umbauphase (nur optionale Package-Extraktion vorbereiten).

## 0.3 Definition Phase grün

```
[ ] Dateien existieren / geändert
[ ] AC erfüllt
[ ] npm test → exit 0   (oder package.json test:lib + pipeline)
[ ] CHANGELOG [Unreleased]
[ ] docs/UMBAUPLAN-V4-PROGRESS.md updated
[ ] Commit conventional
[ ] Keine Secrets
```

## 0.4 Warum umbauen? (Ist-Zustand ehrlich)

| Stärke (behalten) | Schwäche (dieses Dokument) |
|---|---|
| convert-xml-to-v4 + validate score | Kein produktisiertes One-Shot CLI wie `clone-v3` |
| 14 Guards, GC/GV, media patch | Viele manuelle npm-Scripts / Agent-Schritte |
| Preflight experiments/unframer/xml-match | Preflight nicht Default vor jedem wizard run |
| dual-source skill docs | CSS-Fallback nicht immer wired im happy path |
| section-compare, visual-qa | Nicht als `v4 qa` Subcommand vereinheitlicht |
| shared design-tokens (Handkopie) | Drift-Risiko zu site-clone |
| v4-builder in site-clone ist Stub | Bridge `v4-json` Input unvollständig / unter-getestet |
| BLUEPRINT.md SSOT | README/PIPELINE/Skills drift |

## 0.5 Phasen-Reihenfolge (BINDEND)

```
V0  Prep / Baseline / Progress
V1  CLI Product Surface (doctor, build, qa) — Commander oder bestehender wizard
V2  One-Shot Happy Path (xml → validate → optional deploy dry)
V3  Preflight always-on + fail codes
V4  Real V3-JSON / any-intermediate Bridge Intake (strict $$type upgrade path)
V5  Large-tree deploy + rollback (align with V3 deploy lessons)
V6  Pattern library V4 (glass header / stats / orbit) as Atomic+HTML hybrids
V7  Section-compare + visual-qa unified report
V8  Animation plan → WPCode inject reliability
V9  Shared-schema drift check vs site-clone (CI script)
V10 Targets profile (~/.config or project .v4-targets.json)
V11 Docs freeze: BLUEPRINT SSOT + skill sync + delete contradictions
V12 E2E offline fixture + version bump 0.21.0
```

**Optional später (nicht in V0–V12 Pflicht):** Playwright any-URL scraper (besser langfristig in site-clone bleiben und nur Bridge).  
**Nicht Ziel:** Vollmerge beider Repos.

**Executor notes (weaker models):** [`docs/AI-EXECUTOR-NOTES-V4.md`](./AI-EXECUTOR-NOTES-V4.md)  
**Visual QA backlog:** [`docs/VISUAL-QA-IMPROVEMENTS-2026-07.md`](./VISUAL-QA-IMPROVEMENTS-2026-07.md)  
**Shared product items with V3:** `../site-clone-to-v3/docs/PRODUCT-BACKLOG-P1-P10.md` (P2 dual-write, P3 probes, P6 section map, P8 healing, P9 viewports, P10 CI) — implement V4-side under V5/V7/V8/V12 as applicable.  
**All plans are site-agnostic** (any Framer/source URL).

---

# Phase V0 — Prep / Baseline

## Schritte

```bash
cd Framer-to-Elementor-V4-Pipeline
git checkout main
git pull origin main
git checkout -b feat/v4-pipeline-hardening-2026-07
npm ci
npm test
npm run test:e2e   # if fails, document in docs/BASELINE-TEST-STATUS.md
```

## Neue Datei

`docs/UMBAUPLAN-V4-PROGRESS.md` — Tabelle V0–V12.

## DoD V0

```
[ ] Branch + baseline
[ ] Progress file
[ ] Commit: chore(docs): start v4 pipeline hardening umbauplan
```

---

# Phase V1 — CLI Product Surface

## Ziel

Wie site-clone: **wenige, merkbare Befehle** statt 40 npm-Scripts im Kopf behalten.

## Ist

- `wizard.ts` + viele `npm run X`  
- `src/cli/cmd-*.ts` existieren teilweise (doctor, dry-run, pipeline, …) — **vereinheitlichen und dokumentieren**

## Soll-UX

```bash
# Preferred entry (add bin in package.json)
npx framer-v4 doctor
npx framer-v4 build --xml tools/framer-export/homepage.xml --out v4-tree.json
npx framer-v4 validate --tree v4-tree.json
npx framer-v4 deploy --tree v4-tree.json --post-id …   # may stay dry-run default
npx framer-v4 qa --framer-url … --wp-url …
npx framer-v4 wizard   # existing interactive
```

## Dateien

```
package.json                 # "bin": { "framer-v4": "./dist-or-tsx-entry.js" }
src/cli/main.ts              # NEU — router
src/cli/cmd-build.ts         # thin wrap convert + validate
src/cli/cmd-validate.ts
src/cli/cmd-deploy.ts
src/cli/cmd-qa.ts
# reuse cmd-doctor, cmd-preflight, wizard
tests/cli-main.test.js
```

## V1.1 Regeln

1. Jeder Subcommand exit `0|1|2` (ok/fail/usage).  
2. `--json` Flag für Machine output wo sinnvoll.  
3. Alte `npm run convert` etc. **bleiben** (Back-compat).  
4. `bin` darf `tsx` nutzen ODER build-step — wähle **eine** Variante und dokumentiere.

## DoD V1

```
[ ] framer-v4 --help lists subcommands
[ ] doctor + build --help work
[ ] Commit: feat(cli): unified framer-v4 bin with doctor build validate
```

---

# Phase V2 — One-Shot Happy Path

## Ziel

Ein Befehl: XML → V4-Tree → validate score ≥85 → (optional) deploy.

## CLI

```bash
npx framer-v4 build \
  --xml ./tools/framer-export/homepage.xml \
  --out ./out/v4-tree.json \
  [--tokens ./tokens/token-mapping.json] \
  [--style-map ./tokens/style-map.json] \
  [--framer-url https://….framer.app] \
  [--validate] \
  [--prefer-gc] \
  [--deploy --post-id N --mcp-config ./mcp-server-config.json] \
  [--dry-run-deploy]
```

## Algorithmus

```
1. preflight (Phase V3 once wired; until then call existing preflight scripts if flags set)
2. if style-map missing/empty && --framer-url → css-fallback
3. convert-xml-to-v4 (existing)
4. if --validate → validate-v4-tree + framer-pre-build-validate; fail if score < 85
5. write out
6. if --deploy → deploy path (V5); else stop
```

## DoD V2

```
[ ] build without deploy produces valid tree on fixture xml
[ ] tests with fixture component-mode-b.xml or existing test fixtures
[ ] Commit: feat(cli): one-shot build with validate gate
```

---

# Phase V3 — Preflight Always-On

## Ziel

Preflight ist **Default** vor build/deploy, nicht optionales npm-Script.

## Bestehende Scripts (nutzen, nicht neu erfinden)

- `scripts/preflight/ensure-elementor-experiments.ts`  
- `scripts/preflight/check-unframer-connectivity.ts`  
- `scripts/preflight/verify-xml-project-match.ts`  
- `scripts/preflight-check.ts`  

## Dateien

```
src/preflight/run-all.ts     # orchestrates, returns typed report
src/cli/cmd-doctor.ts        # ensure uses run-all
```

## V3.1 Report Shape

```typescript
export interface PreflightReport {
  ok: boolean;
  checks: Array<{ id: string; status: 'pass' | 'fail' | 'warn' | 'skip'; message: string }>;
}
```

## V3.2 Policy

| Check | build --offline | build default | deploy |
|---|---|---|---|
| xml parse | fail | fail | fail |
| xml project match | fail if url given | fail if url given | fail if url given |
| unframer | skip unless --require-unframer | warn | warn |
| V4 experiments | skip offline | warn local / fail deploy | **fail** |
| mcp greet | skip | skip | **fail** |

## DoD V3

```
[ ] doctor uses run-all
[ ] build --skip-preflight exists for power users
[ ] Commit: feat(preflight): always-on preflight with typed report
```

---

# Phase V4 — Bridge Intake (V3-JSON / Intermediate → echtes Atomic)

## Ziel

Die Doku `v4-bridge-workflow` in site-clone verspricht `--input-format v4-json`.  
Heute: site-clone `v4-builder` emittiert **Pseudo-Atomic** (leere styles, Widget-Types oft noch V3).  
Diese Phase macht die **V4-Pipeline** zum strengen Gate + Upgrader.

## Dateien

```
scripts/ingest-bridge-json.ts
src/converter/bridge-upgrade.ts
tests/lib/bridge-upgrade.test.js
fixtures/bridge/dryrun-page-v4.sample.json
```

## V4.1 Ingest Regeln

1. Accept `{ version, elements, tokens? }` or raw elements array.  
2. Reject if any node has `elType: 'container'` without upgrade path.  
3. Map known V3 widgetTypes → Atomic:

| From | To |
|---|---|
| heading / widget heading | `e-heading` + $$type title |
| button | `e-button` |
| image | `e-image` (Invariant IV: id XOR url) |
| text-editor / text | `e-paragraph` or `e-text` per schema |
| html | keep as supported html atomic OR documented passthrough |
| container / section | `e-flexbox` / `e-div-block` with direction |

4. Wrap visual props in `$$type` envelopes using **existing** helpers from convert-xml-to-v4 / framer-utils — **nicht** neue Envelope-Logik erfinden.  
5. Run full `validate-v4-tree`; score < 85 → fail with report.  
6. Emit `bridge-upgrade-report.json` (mapped counts, unmapped widgets).

## V4.2 CLI

```bash
npx framer-v4 ingest-bridge \
  --input ../site-clone-to-v3/research/example/dryrun-page-v4.json \
  --out ./out/upgraded-v4.json \
  --validate
```

## V4.3 Unmapped Policy

- `strict` (default): unmapped widget → error  
- `--lenient`: unmapped → `e-div-block` + html dump of JSON (warn)

## DoD V4

```
[ ] sample fixture upgrades + validates ≥85 or documented known gaps
[ ] Commit: feat(bridge): ingest and upgrade intermediate v4-json to atomic
```

---

# Phase V5 — Large-Tree Deploy + Rollback

## Ziel

ClinicHub/V3-Lektion: set-content Payload-Limits; Upload+PHP; Rollback.

## Port-Ideen aus site-clone V2-Plan Phase D (nicht Code 1:1)

## Dateien

```
scripts/lib/deploy-strategy.ts
scripts/deploy-v4-tree.ts
scripts/lib/rollback.ts          # expand if exists
tests/lib/deploy-strategy.test.js
```

## V5.1 Strategies

```
bytes < 400k  → direct set-content (array wrap!)
bytes < 1.2M  → upload file + PHP update_post_meta
bytes ≥ 1.2M  → split top-level sections / multi-step plan
```

## V5.2 Pflicht nach Deploy

1. CSS cache rebuild (Skill Schritt — als Ability oder PHP)  
2. `verify-build-binding`  
3. Optional clear document cache  

## V5.3 CLI

```bash
npx framer-v4 deploy \
  --tree ./out/v4-tree.json \
  --post-id N \
  --mcp-config ./mcp-server-config.json \
  [--strategy auto|direct|upload-php|split] \
  [--backup-dir ./backups] \
  [--dry-run]
```

Default: **dry-run false only if --execute** (safer for weaker AI: require `--execute` flag).

Empfehlung Implementierung:

```
deploy is dry-run by default; --execute required for live write
```

## DoD V5

```
[ ] strategy unit tests
[ ] dry-run default / --execute
[ ] Commit: feat(deploy): large-tree strategies rollback and execute flag
```

---

# Phase V6 — V4 Pattern Library (ClinicHub-Fehlerklassen)

## Ziel

Dieselben UI-Fallen wie V3, aber **Atomic-konform** (oder HTML-Atomic passthrough).

## Dateien

```
src/patterns/types.ts
src/patterns/sticky-glass-header.ts
src/patterns/stat-row.ts
src/patterns/orbit-cluster.ts
src/patterns/index.ts
tests/lib/patterns-v4.test.js
```

## V6.1 Regeln

1. Bevorzuge **ein** HTML-capable Atomic / raw HTML widget **wenn** Nested flex V4 gleich stacked.  
2. Inline white title für Orbit.  
3. Header scroll CSS nur Pills.  
4. Output = valid V4 subtree + optional GC candidates.  
5. Nach Generate: `validate-v4-tree` auf Wrapper-Page.

## V6.2 CLI

```bash
npx framer-v4 pattern glass-header --input ./pattern-input.json --out ./frag.json
```

## DoD V6

```
[ ] 3 patterns + validation tests
[ ] Commit: feat(patterns): v4 glass stats orbit generators
```

---

# Phase V7 — Unified QA Report

## Ziel

`section-compare` + `visual-qa` + **structural probes** + optional a11y → **ein** Report-JSON/HTML.  
Nie „done“ nur wegen MCP-Write-OK.

**Ausführliche Spec / ClinicHub-Transfer:**  
→ [`docs/VISUAL-QA-IMPROVEMENTS-2026-07.md`](./VISUAL-QA-IMPROVEMENTS-2026-07.md)  
Sister V3: `../site-clone-to-v3/docs/VISUAL-QA-IMPROVEMENTS-2026-07.md`

## Dateien

```
scripts/run-unified-qa.ts
src/qa/report-types.ts
src/qa/structural-probes.ts       # shared probe IDs with V3
src/qa/capture-wait.ts            # fonts, lazyload, Elementor ready
tests/lib/unified-qa.test.js
```

## CLI

```bash
npx framer-v4 qa \
  --framer-url … \
  --wp-url … \
  [--section hero|all] \
  [--a11y] \
  --out ./qa-report.json

# aliases (align with V3 rename)
# --ref-url / --live-url
```

## Report fields (target)

```json
{
  "passed": false,
  "sections": [{
    "id": "hero",
    "mismatchRatio": 0.12,
    "matchPct": 88,
    "passed": false,
    "structural": [
      { "id": "header-shell-transparent", "ok": true },
      { "id": "hero-video-on-right", "ok": false, "detail": "…" }
    ]
  }],
  "a11y": { "violations": 0 },
  "binding": { "ok": true },
  "notes": []
}
```

## V4-only probes (zusätzlich zu V3-Set)

- `no-v3-widgets-on-v4-page`
- `global-classes-bound`
- `$$type-styles-present`

## DoD V7

```
[ ] unified report schema + mock test (pixel + structural)
[ ] capture waits for Elementor/fonts/lazy images
[ ] shared probe IDs documented with V3
[ ] Commit: feat(qa): unified section-compare visual-qa report
```

---

# Phase V8 — Animation Inject Reliability

## Ziel

`inject-animation-code` + Framer animation extractor → deterministischer Plan + WPCode/Ability.

## Schritte

1. Lese `scripts/inject-animation-code.ts` + `framer-animation-extractor.ts`.  
2. Ensure plan schema versioned.  
3. CLI:

```bash
npx framer-v4 animations extract --html … --out animation-plan.json
npx framer-v4 animations inject --plan animation-plan.json --post-id N --execute
```

4. Page-scope condition (wie V3 WPCode page-scope) — PHP snippet nur auf post_id.  
5. Tests: plan parse + dry inject.

## DoD V8

```
[ ] extract/inject dry-run tests
[ ] Commit: feat(animations): reliable plan extract and page-scoped inject
```

---

# Phase V9 — Shared Schema Drift Check

## Ziel

`src/shared-schemas/design-tokens.ts` bleibt sync mit site-clone.

## Dateien

```
scripts/check-shared-schema-drift.ts
.github/workflows/ci.yml    # step if sibling checkout unavailable → skip
docs/SHARED-SCHEMA.md
```

## Algorithmus

```
1. If env SITE_CLONE_PATH or ../site-clone-to-v3 exists:
     hash both design-tokens.ts
     exit 1 on mismatch
2. Else skip with warn (CI optional matrix)
```

## DoD V9

```
[ ] script + docs
[ ] Commit: chore(ci): shared design-tokens drift check
```

---

# Phase V10 — Targets Profile

## Ziel

Wie site-clone `add-target` / `~/.config/clone-v3/targets.json` — keine Secrets in Repo.

## Dateien

```
src/targets/types.ts
src/targets/store.ts
src/cli/cmd-target.ts
tests/lib/targets.test.js
```

## Schema

```json
{
  "targets": {
    "mysite": {
      "mcpEndpoint": "https://…/wp-json/novamira/v1/mcp",
      "authEnv": "NOVAMIRA_AUTH_MYSITE",
      "defaultTemplate": "elementor_canvas"
    }
  }
}
```

Auth **nur** via Env-Var-Name, nie Password in JSON.

## CLI

```bash
npx framer-v4 target add
npx framer-v4 target list
npx framer-v4 deploy --target mysite --tree … --execute
```

## DoD V10

```
[ ] target store tests (temp dir)
[ ] Commit: feat(targets): named wp targets with env-based auth
```

---

# Phase V11 — Docs Freeze (SSOT)

## Ziel

Eine Wahrheit: **BLUEPRINT.md** (bereits beansprucht). Skills + README + PIPELINE dürfen nicht widersprechen.

## Schritte (exakt)

1. Lies BLUEPRINT.md, README.md, PIPELINE.md, `novamira-skill/framer-v4-pipeline.md`.  
2. Erstelle `docs/DOC-MAP.md`:

```
BLUEPRINT.md     = architecture SSOT
PIPELINE.md      = command order only (link to CLI framer-v4)
README.md        = quickstart using framer-v4 bin only
novamira-skill/* = agent procedures; must call same commands
```

3. Entferne/archiviere widersprüchliche „Schritt 9a“-Duplikate; **eine** Deploy-Sequenz.  
4. Skill: ergänze Large-tree, `--execute`, bridge ingest, patterns.  
5. README: Badge Tests + Link Umbauplan Progress.

## DoD V11

```
[ ] DOC-MAP.md
[ ] README quickstart ≤ 40 lines using new CLI
[ ] Commit: docs: freeze ssot blueprint and align skills readme
```

---

# Phase V12 — E2E Offline Fixture + Release

## Ziel

Offline- deterministischer E2E-Pfad für CI.

## Fixture

```
tests/fixtures/mini-homepage.xml
tests/fixtures/mini-style-map.json
```

## Test

```
build --xml mini --validate → score ≥ 85
ingest-bridge sample → validate
patterns glass → validate
```

## Release

- Version **0.21.0** in package.json  
- CHANGELOG release section  
- Progress all done  

## DoD V12

```
[ ] npm test + test:e2e grün (offline)
[ ] Commit: chore(release): v0.21.0 pipeline hardening
```

---

# Anhang A — Mapping site-clone Stärken → V4 (nur sinnvolles)

| site-clone Stärke | In V4 übernehmen? | Phase |
|---|---|---|
| Product CLI `clone-v3` | **Ja** als `framer-v4` | V1–V2 |
| Targets profile | **Ja** | V10 |
| Large-tree deploy lessons | **Ja** | V5 |
| Pattern library | **Ja** (Atomic/HTML) | V6 |
| Screenshot gate checklist | **Ja** light | V7 |
| Playwright any-URL scraper | **Nein** als Core (Bridge) | — |
| V3 container normalize | **Nein** im V4-tree | — |
| Pro widget classifier | Optional later | backlog |
| Circuit breaker MCP | Nur wenn mcp-client schwächer | backlog |

---

# Anhang B — Explizit Backlog (NICHT in V0–V12)

- Monorepo merge mit site-clone  
- npm publish public  
- Full any-URL clone inside V4 repo  
- Auto-enable Elementor Pro widgets  
- Visual auto-fix that invents layout  

---

# Anhang C — MCP Deploy Checkliste (Skill + Deploy)

```
[ ] content is Array for set-content
[ ] V4 experiments on
[ ] CSS cache rebuild after write
[ ] verify-build-binding
[ ] media ids patched (Invariant IV)
[ ] no hyphen-illegal style ids
[ ] backup exists if --execute
```

---

# Anhang D — Progress-Tabelle

| Phase | Status | Commit | Date | Notes |
|------|--------|--------|------|-------|
| V0 Prep | pending | | | |
| V1 CLI surface | pending | | | |
| V2 One-shot build | pending | | | |
| V3 Preflight always-on | pending | | | |
| V4 Bridge ingest | pending | | | |
| V5 Large-tree deploy | pending | | | |
| V6 Patterns | pending | | | |
| V7 Unified QA | pending | | | |
| V8 Animations | pending | | | |
| V9 Schema drift | pending | | | |
| V10 Targets | pending | | | |
| V11 Docs freeze | pending | | | |
| V12 Release 0.21.0 | pending | | | |

