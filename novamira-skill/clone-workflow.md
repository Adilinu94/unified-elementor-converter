---
slug: clone-workflow
title: site-clone-to-v3 Workflow
description: Vollstaendiger Workflow zum Klonen einer beliebigen Live-Website nach Elementor V3 oder V4 via site-clone-to-v3 CLI. Enthaelt alle Phasen (Extraktion, Analyse, Build, QA, Push), Guard-System, Media-Upload-Reihenfolge, und den V4-Bridge-Pfad ueber dryrun-page-v4.json.
version: "1.0.0"
tags: [clone, elementor, v3, v4, novamira, mcp]
---

# site-clone-to-v3 Workflow

## Wann diesen Skill verwenden
Immer wenn eine beliebige Live-Website nach Elementor V3 oder V4 geklont werden soll.
Eingabe: URL einer beliebigen Website. Ausgabe: Elementor-Seite auf der Ziel-WordPress-Instanz.

**Framer-spezifisch (Glass-Header, Orbit, Stats-Row, WPCode-GSAP, Screenshot-QA):**  
zusätzlich Agent-Skill `framer-to-elementor-v3` laden — siehe auch
`docs/CLINICHUB-SESSION-LESSONS-2026-07.md`.

## Kritische Regeln

1. `batch-media-upload` IMMER vor `elementor-set-content` (externe URLs zuerst in WP-Mediathek)
2. `content` in elementor-set-content ist IMMER ein Array, niemals ein Objekt
3. Guard-Score muss >= 85/100 sein vor dem WP-Push
4. Auf V4-Sites: V4-Pfad ueber `dryrun-page-v4.json` verwenden (siehe v4-bridge-workflow)
5. Nach dem Push: `clear-cache` mit `include_nested: true` (Elementor Pro Element Cache)

## CLI-Einstiegspunkte

```bash
# Kompletter Clone (V3 Default)
npx clone-v3 clone https://example.com --target my-wordpress

# Mit V4-Output fuer V4-Elementor-Sites
npx clone-v3 clone https://example.com --target my-wordpress --output-format v4

# Resume nach Fehler
npx clone-v3 clone https://example.com --target my-wordpress --resume

# Incremental (nur geaenderte Sections)
npx clone-v3 clone https://example.com --target my-wordpress --incremental

# Nur Diff berechnen ohne Push
npx clone-v3 clone https://example.com --target my-wordpress --diff-only
```

## Pipeline-Phasen (10 Phasen)

| Phase | Name | Beschreibung |
|-------|------|-------------|
| 1 | Preflight | Robots.txt check, MCP erreichbar?, Elementor aktiv? |
| 2 | Extraction | Playwright-Scrape: DOM, CSS, Fonts, Bilder |
| 3 | Recon | Animation-Events, Mutation-Observer, Scroll-Verhalten |
| 4 | Analysis | Design-Tokens extrahieren, Color/Font/Spacing System |
| 5 | Classification | Sections -> V3-Widget-Typ Mapping |
| 6 | Build | V3 JSON Tree bauen (oder V4 atomic fuer V4-Targets) |
| 7 | QA | Guard-Score, SSIM-Visual-Diff, Auto-Fix-Loop |
| 8 | Media Upload | Externe URLs -> WP-Mediathek, ID-Map erstellen |
| 9 | WP Push | elementor-set-content (V3) oder V4-Pipeline (V4) |
| 10 | Post-Push | Cache leeren, Layout-Audit, HTML-Report |

## Guard-System (vor Phase 9)

```typescript
import { runV3Guards, runV4Guards, formatGuardReport } from './src/validator/json-guard.js';

const report = runV3Guards(v3Elements);
console.log(formatGuardReport(report));
// Guard Score: 95/100 - PASSED
```

V3-Guards: G1 (unique IDs), G2 (no orphan columns), G3 (widget settings), G4 (breakpoints), G5 (image URLs)
V4-Guards: G6 ($$type), G7 (no hyphens in classes), G8 (DOM depth <= 4), G9 (no empty class), G10 (known types)

**Bei Score < 85%:** Push abbrechen. User informieren welche Guards failed. Ursache beheben.

## Media-Upload-Reihenfolge (PFLICHT)

```
Phase 8 muss VOR Phase 9 laufen:

1. Alle externen Bild-URLs aus dem V3/V4-Tree sammeln
2. novamira-adrianv2/batch-media-upload aufrufen
   -> Gibt URL-zu-ID-Map zurueck
3. Im Tree: alle url-Felder durch WP-URLs ersetzen
   V3: widget.settings.image.url = wpUrl, .id = wpId
   V4: settings.src.url = wpUrl, .id = wpId
4. DANN elementor-set-content/V4-Push
```

## WP-Push: V3-Pfad

```json
{
  "ability": "novamira/elementor-set-content",
  "parameters": {
    "post_id": 1234,
    "content": "<V3_JSON_ARRAY>"
  }
}
```

Danach: `repair-clonerlabs-page` (auto_fix: true) -> `clear-cache` -> `layout-audit`

## WP-Push: V4-Pfad

Siehe `v4-bridge-workflow.md` und `adrianv2-framer-pipeline-import` Skill.

## Multi-Target System

```bash
# Ziel-Profil erstellen
npx clone-v3 add-target

# Profil verwenden
npx clone-v3 clone https://example.com --target yoursite-local
npx clone-v3 clone https://example.com --target test4
```

Profiles in: `~/.config/clone-v3/targets.json`
