---
slug: session-start-checklist
title: Session-Start Checkliste (Clone Pipeline)
description: Pflichtchecks vor jedem Clone-Pipeline-Run. Prueft MCP-Erreichbarkeit, Ziel-WordPress-Konfiguration, Elementor-Version, und Robots.txt-Erlaubnis.
version: "1.0.0"
tags: [checklist, session, preflight]
---

# Session-Start Checkliste

Vor jedem Clone-Run diese Checks ausfuehren:

## 1. MCP-Verbindung pruefen

```json
{ "ability": "novamira-adrianv2/discover-abilities", "parameters": {} }
```
Erwartet: Liste aller Abilities > 20 Eintraege.
Bei Fehler: MCP-Endpoint-URL in targets.json pruefen.

## 2. Ziel-WordPress pruefen

```json
{ "ability": "novamira-adrianv2/v4-preflight", "parameters": {} }
```

Ausgabe lesen:
- `elementor_version` -> V3 oder V4? -> richtigen Build-Modus waehlen
- `atomic_supported` -> true? -> V4-Bridge-Pfad moeglich
- `novamira_version` -> >= 1.7.0 fuer Context-Page-Support

## 3. Robots.txt der Quell-URL

```bash
npx clone-v3 preflight https://example.com
```

Bei `robots_allowed: false` -> STOP. Keine ethische Grundlage zum Klonen.

## 4. State aus vorheriger Session pruefen

```bash
ls output/state.json  # existiert?
cat output/state.json | python3 -m json.tool | grep '"status"'
```

Falls vorhanden und unvollstaendig -> `--resume` verwenden statt neu starten.

## 5. Target-Profil waehlen

```bash
npx clone-v3 targets list
# yoursite-local (V4) | test4 (V3) | production (V4)
```

V4-Target? -> dryrun-page-v4.json + V4-Bridge-Workflow
V3-Target? -> direkt via elementor-set-content

## 6. Output-Verzeichnis bereinigen (optional)

```bash
rm -rf output/  # Alten Clone-State loeschen fuer sauberen Run
```

Nur wenn kein Resume benoetigt wird.

## Danach: Clone starten

```bash
npx clone-v3 clone https://example.com \
  --target <target-name> \
  [--output-format v3|v4] \
  [--resume]
```
