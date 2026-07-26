---
name: site-clone-pipeline
description: Complete workflow skill for running the site-clone-to-v3 TypeScript pipeline. Covers all phases from URL extraction through WordPress deploy, including guard validation, cross-validation, and resume from state. Use when cloning any external website into Elementor V3 or V4.
---

# Skill: site-clone-to-v3 Pipeline

> **Repo:** `Adilinu94/site-clone-to-v3`
> **CLI:** `npm run dev -- clone --url <url> --target <target> [--post-id <id>]`
> **Output dir:** `./output/<domain>/`
> **Resume:** `npm run dev -- clone --resume ./output/<domain>/state.json`

---

## Wann aktivieren

- User sagt: "klone diese Seite", "baue diese Seite in Elementor nach", "extrahiere Design-Tokens von …"
- Eine externe URL soll als Elementor V3 oder V4 Page deployed werden
- Ein bestehender Clone-Output (`cloned-page-v3.json`) soll nach WP gepusht werden
- Der User nennt eine URL und ein WP-Target

---

## Pipeline-Phasen (Phase-Orchestrator)

| Phase | Name | Output |
|---|---|---|
| 0 | URL-Analyse & Robots-Check | `research/robots-check.json` |
| 1 | Extraktor (Playwright/Browserbase) | `research/dom-snapshot.json`, `research/css-raw.json` |
| 2 | Design-Token-Extraktor | `research/tokens.json` |
| 3 | Font-Token-Extraktor | `research/fonts.json` |
| 4 | Section-Klassifikator | `research/sections.json` |
| 5 | V3-Builder | `cloned-page-v3.json` |
| 5.5 | **Guard-System** (runV3Guards) | score ≥ 85 required |
| 6 | V4-Builder (optional, wenn target.elementorMode=v4) | `dryrun-page-v4.json` |
| 7 | Media-Collector | `research/image-urls.json` |
| 8 | WP-Media-Upload | `research/media-id-map.json` |
| 9 | URL-Replacement in V3-Tree | `cloned-page-v3-final.json` |
| 10 | Cross-Validation | `output/cross-validation-report.json` |
| 11 | WP-Push via MCP | post deployed |
| 12 | Visual QA (optional) | `output/qa-report.json` |

---

## Standard-Ablauf (Schritt für Schritt)

### 1. Preflight

```bash
# Prüfe MCP-Verbindung und Target-Credentials
npm run dev -- preflight --target yoursite-local
```

### 2. Clone starten

```bash
# Vollständiger Clone + Push
npm run dev -- clone \
  --url https://example.com \
  --target yoursite-local \
  --post-id 42

# Dry-run (kein WP-Push, nur JSON erzeugen)
npm run dev -- clone \
  --url https://example.com \
  --target yoursite-local \
  --dry-run
```

### 3. Guard-Ergebnis prüfen

Nach Phase 5 prüft `runV3Guards()` die V3-Baumstruktur:

```typescript
import { runV3Guards, formatGuardReport } from './src/validator/json-guard.js';
const report = runV3Guards(v3Elements);
console.log(formatGuardReport(report));
// Guard Score: 95/100 — ✅ PASSED (threshold: 85)
```

**Bei Score < 85:** Pipeline stoppt. Fehler aus dem Guard-Report beheben, dann `--resume`.

### 4. Cross-Validation prüfen

```typescript
import { crossValidateV3, formatCrossValidationReport } from './src/qa/cross-validator.js';
const cv = crossValidateV3(tokens, v3Elements, 'https://example.com');
console.log(formatCrossValidationReport(cv));
```

**Bei totalDrift > 0 (warning-level):** Pipeline läuft weiter, Report wird gespeichert.
**Bei error-level (z.B. GV-ID drift):** Manuell prüfen vor Push.

### 5. Resume nach Fehler

```bash
npm run dev -- clone \
  --url https://example.com \
  --target yoursite-local \
  --resume ./output/example.com/state.json
```

Die Pipeline liest `.pipeline/state.json` und überspringt bereits abgeschlossene Phasen.

---

## Output-Struktur

```
output/example.com/
├── research/
│   ├── dom-snapshot.json       ← Phase 1: DOM-Baum
│   ├── css-raw.json            ← Phase 1: Extrahierte CSS
│   ├── tokens.json             ← Phase 2: DesignTokens
│   ├── fonts.json              ← Phase 3: FontTokens
│   ├── sections.json           ← Phase 4: SectionSpec[]
│   ├── image-urls.json         ← Phase 7: Bild-URLs
│   └── media-id-map.json       ← Phase 8: URL → WP-Attachment-ID
├── cloned-page-v3.json         ← Phase 5: V3Element[] (deploy-ready)
├── dryrun-page-v4.json         ← Phase 6: V4AtomicElement[] (optional)
├── cross-validation-report.json ← Phase 10: CV1-CV5 Ergebnisse
└── state.json                  ← Phase-State für --resume
```

---

## Deployment via novamira-adrianv2

Nach erfolgreichem Clone-Run:

### Medien hochladen (vor Tree-Push!)

```json
{
  "ability": "novamira-adrianv2/batch-media-upload",
  "parameters": {
    "urls": ["<aus research/image-urls.json>"],
    "return_id_map": true
  }
}
```

→ IDs in `cloned-page-v3-final.json` einsetzen.

### V3-Tree deployen

```json
{
  "ability": "novamira/elementor-inject-calibrated-page",
  "parameters": {
    "post_id": 42,
    "_elementor_data": "<cloned-page-v3-final.json Inhalt>",
    "elementor_version": "3.0.0"
  }
}
```

⚠️ **NIEMALS `batch-build-page`** verwenden — drops nested V3 elements silently.

### Cache leeren

```json
{
  "ability": "novamira-adrianv2/clear-cache",
  "parameters": { "post_id": 42, "include_nested": true }
}
```

### Audit

```json
{
  "ability": "novamira-adrianv2/layout-audit",
  "parameters": { "post_id": 42 }
}
```

---

## Guard-Schwellwerte

| Guard | Severity | Penalty | Häufige Ursache |
|---|---|---|---|
| G1 unique-ids | critical | −20 | Builder-Bug mit doppelten IDs |
| G2 no-orphan-columns | critical | −20 | Column außerhalb Section |
| G3 widget-required-settings | warning | −5 | Heading ohne title |
| G4 breakpoint-coverage | warning | −5 | Tablet ohne Mobile |
| G5 image-url-present | warning | −5 | Image-Widget ohne URL |

**Mindest-Score:** 85/100

---

## Target-Profile

Targets werden in `src/lib/wp-target.ts` konfiguriert oder via Env-Vars:

```env
WP_API_URL=http://yoursite.local/wp-json/mcp/novamira
WP_API_USERNAME=admin
WP_API_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
MCP_SITE_ID=yoursite-local
```

Vordefinierte Targets: `yoursite-local`, `testseite`, `treets`

---

## Bekannte Einschränkungen

- JavaScript-heavy SPAs (React, Vue) brauchen `--extractor browserbase` für korrekte DOM-Erfassung
- Hintergrundvideos werden nicht geklont (keine src-URL im DOM)
- Custom-Fonts ohne Google Fonts URL müssen manuell in WP hochgeladen werden
- `elementorMode: v4` in Target-Profil ist in Planung (Sprint B3) — aktuell immer V3 output
