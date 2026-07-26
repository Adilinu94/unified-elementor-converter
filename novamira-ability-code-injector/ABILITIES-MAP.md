# Novamira Abilities Map
> **Stand:** 2026-06-13 | **Pipeline-Version:** 0.7.0

Vollständige Übersicht aller Abilities im `novamira-adrianv2/` Custom-Namespace
sowie der Standard-`novamira/`-Abilities die von der Pipeline genutzt werden.

---

## Namespace `novamira-adrianv2/` — Custom Abilities (dieses Repo)

Alle PHP-Files liegen in `novamira-ability-code-injector/` und werden im
Novamira-Plugin unter dem `novamira-adrianv2/`-Namespace registriert.

### WPCode Snippet-Management

| Ability | PHP-Datei | Status | Beschreibung |
|---------|-----------|--------|--------------|
| `adrians-code-injector` | `adrians-code-injector.php` | ✅ | Snippet anlegen / aktualisieren (upsert) |
| `adrians-list-snippets` | `adrians-list-snippets.php` | ✅ | Snippets auflisten mit DB-Filter |
| `adrians-get-snippet` | `adrians-get-snippet.php` | ✅ | Einzelabruf by Titel oder snippet_id |
| `adrians-update-snippet` | `adrians-update-snippet.php` | ✅ | In-place Update (ID bleibt erhalten) |
| `adrians-delete-snippet` | `adrians-delete-snippet.php` | ✅ | Löschen / Deaktivieren / Aktivieren |
| `adrians-batch-inject-snippets` | `adrians-batch-inject-snippets.php` | ✅ | Batch-Modus: bis zu 20 Snippets in 1 Call |

### Post-Build Auto-Fix

| Ability | PHP-Datei | Status | Beschreibung |
|---------|-----------|--------|--------------|
| `adrians-fix-color-contrast` | `adrians-fix-color-contrast.php` | ✅ | WCAG AA Kontrast-Analyse + Patch-Plan |
| `adrians-add-alt-text-from-context` | `adrians-add-alt-text.php` | ✅ | Alt-Texte aus Dateiname / Titel generieren |
| `adrians-generate-meta-tags` | `adrians-generate-meta-tags.php` | ✅ | SEO Title + Description (Yoast/RankMath) |
| `adrians-generate-schema-markup` | `adrians-generate-schema-markup.php` | ✅ | JSON-LD Schema.org als WPCode-Snippet |

### Shared Helpers (kein direktes Ability-Interface)

| Datei | Funktion | Genutzt von |
|-------|---------|------------|
| `adrians-helpers.php` | `novamira_find_wpcode_snippet()` | code-injector, delete, get, update, batch |
| `adrians-helpers.php` | `novamira_walk_elementor_tree()` | fix-color-contrast, add-alt-text |

---

## Namespace `novamira/` — Standard Novamira Plugin Abilities

Abilities aus dem Novamira-Core-Plugin (yoursite.local). Nicht im Repo enthalten.

### Elementor Core

| Ability | Beschreibung |
|---------|-------------|
| `elementor-set-content` | Elementor V4-Content via JSON-Tree setzen |
| `elementor-get-content` | Aktuellen Elementor-Content abrufen |
| `elementor-create-global-class` | Neue GC anlegen |
| `elementor-create-variable` | Neue GV anlegen |
| `elementor-list-global-classes` | Alle GCs auflisten |
| `elementor-delete-global-class` | GC löschen |

### Build & Foundation

| Ability | Beschreibung |
|---------|-------------|
| `adrians-setup-v4-foundation` | ⚠️ Session-live GV+GC-IDs holen — NIEMALS cachen |
| `adrians-batch-build-page` | V3-kompatibler Seiten-Builder (nicht für Framer-Trees) |
| `adrians-export-design-system` | Design-System Export (GVs, GCs, Breakpoints) |
| `adrians-patch-element-styles` | Post-Build Style-Patches per element_id |

### QA & Audit

| Ability | Beschreibung |
|---------|-------------|
| `adrians-layout-audit` | Layout-Struktur-Analyse (PFLICHT nach Build) |
| `adrians-visual-qa` | Overflow / Z-Index / Visual-QA |
| `adrians-responsive-audit` | Breakpoint-Analyse |
| `adrians-page-audit` | Vollständige Seiten-Analyse |

### Media

| Ability | Beschreibung |
|---------|-------------|
| `adrians-media-upload` | Einzelnes Asset hochladen |
| `adrians-batch-media-upload` | Mehrere Assets hochladen |

### Utility

| Ability | Beschreibung |
|---------|-------------|
| `execute-php` | PHP-Code direkt ausführen (Sandbox) |
| `create-post` | WordPress-Post anlegen |
| `get-post` | Post-Meta abrufen |

---

## Ability-Aufruf-Format (MCP-Adapter)

Alle Calls gehen über `mcp-adapter-execute-ability`:

```json
{
  "ability_name": "novamira-adrianv2/adrians-code-injector",
  "parameters": {
    "title": "Hero GSAP",
    "type": "gsap",
    "code": "gsap.from('.e-heading', { opacity: 0 });"
  }
}
```

> **Nie direkter Call ohne Adapter!**  
> ❌ `{ "method": "novamira-adrianv2/adrians-code-injector" }`  
> ✅ `{ "name": "mcp-adapter-execute-ability", "arguments": { "ability_name": "novamira-adrianv2/..." } }`

---

## Pflege dieser Datei

Bei jedem neuen PHP-File in `novamira-ability-code-injector/`:
1. Ability in obige Tabelle eintragen
2. Status auf ✅ setzen
3. Ability in `novamira-skill/elementor-v4-build.md` Verbots-/Erlaubnis-Liste prüfen
4. Test in `tests/pipeline.test.js` (optional, je nach Komplexität)
