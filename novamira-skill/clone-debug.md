---
slug: clone-debug
title: Clone Pipeline Debug Guide
description: Fehlerbehebung fuer die haeufigsten Probleme beim Klonen einer Website mit site-clone-to-v3. Tabellen mit Symptom, Ursache und Fix fuer Extraction-Fehler, Media-Probleme, Guard-Failures, und WP-Push-Fehler.
version: "1.0.0"
tags: [debug, clone, troubleshooting]
---

# Clone Pipeline Debug Guide

## Extraction-Fehler (Phase 2)

| Symptom | Ursache | Fix |
|---------|---------|-----|
| Playwright timeout | JavaScript-heavy SPA nicht vollstaendig geladen | `--hydration-timeout 10000` hinzufuegen |
| robots.txt blockiert | Robots.txt disallows crawl | Preflight schlaegt fehl -> User informieren |
| Bilder nicht extrahiert | Lazy-loading, außerhalb Viewport | `--lazy-scroll true` aktivieren |
| Fonts fehlen | Google Fonts via CSS @import | `--font-intercept true` |
| Background-images fehlen | CSS background-image nicht im DOM | Bekannte Limitation -> manuell nacharbeiten |

## Guard-Failures (Phase 7)

| Guard | Failure | Fix |
|-------|---------|-----|
| G1: unique-ids | Duplizierte Element-IDs | `src/lib/v3-id.ts` erzeugt neue IDs -> rebuild |
| G2: no-orphan-columns | Column ausserhalb Section | Classifier-Bug -> Issue melden |
| G3: widget-settings | Heading ohne title | Manuell im Elementor-Editor nacharbeiten |
| G4: breakpoints | Tablet ohne Mobile | `responsive-settings.ts` anpassen |
| G6: $$type | Unbekannter $$type-Wert | `KNOWN_DOLLAR_TYPES` in json-guard.ts erweitern |
| G7: no-hyphen | Hyphens in Klassen-Namen | Classifier normalisiert nicht -> fix in classifier |

## Media-Upload-Fehler (Phase 8)

| Symptom | Ursache | Fix |
|---------|---------|-----|
| 403 bei externer URL | CORS/Hotlink-Protection | Screenshot als Fallback, manuell hochladen |
| WP-Media-ID 0 | Upload fehlgeschlagen | Retry mit `--media-retry 3` |
| Bilder zu gross | Datei > 8MB PHP-Limit | `--media-compress true` |
| Bilder korrekt hochgeladen aber nicht sichtbar | ID-Map nicht im Tree angewendet | state.json pruefen: media_map vorhanden? |

## WP-Push-Fehler (Phase 9)

| Symptom | Ursache | Fix |
|---------|---------|-----|
| elementor-set-content 422 | content ist Objekt statt Array | Bug im V3-Builder: immer Array-Format pruefen |
| Seite leer nach Push | Elementor Pro Cache | `clear-cache` mit `include_nested: true` |
| Widgets nicht sichtbar | Widget-Plugin fehlt | Pruefe ob Pro/Addon-Plugins aktiv sind |
| Fonts falsch | WP hat Fonts nicht registriert | `register-google-font` Ability aufrufen |

## Resume nach Fehler

```bash
# state.json zeigt wo Pipeline gestoppt hat
cat output/state.json

# Resume ab letzter erfolgreicher Phase
npx clone-v3 clone https://example.com --target my-wp --resume
```

## Diagnose-Befehle

```bash
# Preflight pruefen
npx clone-v3 preflight https://example.com --target my-wp

# Nur Extraktion (keine WP-Operationen)
npx clone-v3 clone https://example.com --dry-run --stop-after extract

# Guards allein pruefen (ohne Push)
npx clone-v3 clone https://example.com --diff-only

# HTML-Report oeffnen
open output/build-report.html
```
