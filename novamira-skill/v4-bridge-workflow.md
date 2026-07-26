---
slug: v4-bridge-workflow
title: V4 Bridge Workflow (site-clone-to-v3 -> V4 Elementor)
description: Wie der dryrun-page-v4.json Output von site-clone-to-v3 in die Framer-to-Elementor-V4-Pipeline uebergeben wird um auf V4-Atomic-Targets zu deployen. Der Schluesselpfad fuer Clone-Any-Site-zu-V4.
version: "1.0.0"
tags: [bridge, v4, elementor, pipeline, clone]
---

# V4-Bridge-Workflow: site-clone-to-v3 → Framer-to-Elementor-V4-Pipeline

## Warum diese Bridge?

site-clone-to-v3 klont beliebige Live-Seiten.
Die V4-Pipeline hat das Guard-System, die GC-Generierung und den novamira-Deploy.
Kombiniert ergibt sich: **Clone any live site → V4 Elementor**.

## Bridge-Pfad

```
site-clone-to-v3 CLI
    --output-format v4
    ↓
output/dryrun-page-v4.json   (V4-Intermediate-Tree)
    ↓
Framer-to-Elementor-V4-Pipeline
    node wizard.js --input output/dryrun-page-v4.json --input-format v4-json
    ↓
14 Guards (Score >= 85%)
GC-Generierung
novamira Deploy
    ↓
WordPress V4 Atomic Page
```

## Schritt 1: V4-Output aus site-clone-to-v3

```bash
npx clone-v3 clone https://example.com \
  --target my-v4-site \
  --output-format v4 \
  --dry-run
```

Output: `output/dryrun-page-v4.json`

Das JSON hat das Format:
```json
{
  "version": "v4-atomic",
  "source": "https://example.com",
  "elements": [
    { "type": "e-flexbox", "id": "abc123", "classes": [...], "elements": [...] }
  ],
  "tokens": { "colors": {...}, "typography": {...} }
}
```

## Schritt 2: V4-Pipeline uebernimmt

```bash
cd /path/to/Framer-to-Elementor-V4-Pipeline
node wizard.js \
  --input /path/to/output/dryrun-page-v4.json \
  --input-format v4-json \
  --target yoursite-local
```

Pipeline:
1. Liest V4-JSON (ueberspringt XML-Parsing-Phase)
2. Fuehrt alle 14 Guards aus
3. Generiert Global Classes
4. Deployt via novamira-adrianv2/batch-build-page

## Guard-Kompatibilitaet

V3-Guards (G1-G5): nicht relevant fuer V4-Pfad
V4-Guards (G6-G10): ALLE werden von V4-Pipeline geprueft

Zusaetzlich prueft V4-Pipeline:
- G11: CSS-Logical-Properties (padding-inline statt margin-left)
- G12: Style-ID ohne Hyphens
- G13: GC-Binding vollstaendig
- G14: Line-Height-Unit korrekt

## Wann V4-Bridge verwenden

| Szenario | Empfehlung |
|---------|-----------|
| Ziel-WP nutzt Elementor V3 | Direktpfad: V3-JSON via elementor-set-content |
| Ziel-WP nutzt Elementor V4 Atomic | V4-Bridge-Pfad (dieser Skill) |
| Ziel-WP-Version unbekannt | `novamira-adrianv2/v4-preflight` aufrufen, dann entscheiden |

## Fallback bei Bridge-Fehler

Wenn V4-Bridge scheitert (Guard-Score < 70%):
1. `--output-format v3` als Fallback
2. V3-JSON direkt via elementor-set-content deployen
3. Spaeter manuell V3->V4 via `adrians-convert-page-v3-to-v4`
