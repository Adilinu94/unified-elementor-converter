# Novamira Ability: adrians-code-injector

**Version:** 1.0.0 | **Requires:** WPCode ≥ 2.0 (free) + PHP 7.4+ + WP 6.0+

Legt Custom CSS, JavaScript, HTML, PHP und **GSAP-Animationen** als WPCode-Snippets
in WordPress an und aktiviert sie sofort — über den Novamira MCP-Adapter.

---

## Warum diese Ability?

Framer-Websites haben oft komplexe Animationen (GSAP ScrollTrigger, SplitText, Parallax,
Clip-Path-Reveals). Beim Konvertieren zu Elementor V4 wurden diese bisher weggelassen.

Mit `adrians-code-injector` kann der Agent nach dem Build Animations-Code direkt
als **WPCode-Snippet** injizieren — sauber, versioniert, aktivierbar/deaktivierbar
ohne Theme-Editierung.

---

## Ability-Übersicht

| Ability                          | Zweck                            |
|----------------------------------|----------------------------------|
| `novamira/adrians-code-injector` | Snippet anlegen / aktualisieren  |
| `novamira/adrians-list-snippets` | Alle Snippets auflisten          |
| `novamira/adrians-delete-snippet`| Snippet löschen / deaktivieren   |

---

## adrians-code-injector — Parameter

```json
{
  "title":         "Hero GSAP ScrollReveal",
  "type":          "gsap",
  "code":          "gsap.from('.e-heading', { opacity: 0, y: 60, duration: 1, scrollTrigger: '.e-heading' });",
  "post_id":       123,
  "gsap_version":  "3.12.5",
  "gsap_plugins":  ["ScrollTrigger"],
  "on_conflict":   "replace",
  "tags":          ["framer", "hero", "gsap"]
}
```

### Parameter-Referenz

| Parameter       | Pflicht | Default          | Beschreibung                                          |
|-----------------|---------|------------------|-------------------------------------------------------|
| `title`         | ✅ JA   | —                | Eindeutiger Snippet-Name (Lookup-Key bei Updates)     |
| `type`          | ✅ JA   | —                | `css` `js` `html` `php` `gsap`                       |
| `code`          | ✅ JA   | —                | Quellcode (bei `gsap`: reiner JS-Animations-Code)     |
| `location`      | ❌      | Typ-abhängig     | Wo der Snippet läuft (s.u.)                           |
| `post_id`       | ❌      | `0` (sitewide)   | Nur auf dieser WordPress-Post-ID laden                |
| `on_conflict`   | ❌      | `"replace"`      | `"replace"` `"skip"` `"append"`                      |
| `priority`      | ❌      | `10`             | Ausführungs-Priorität 1–100                           |
| `description`   | ❌      | `""`             | Beschreibung für WPCode-UI                            |
| `tags`          | ❌      | `[]`             | Array von Tag-Strings                                 |
| `gsap_version`  | ❌      | `"3.12.5"`       | GSAP CDN-Version (nur bei type=`gsap`)                |
| `gsap_plugins`  | ❌      | `["ScrollTrigger"]` | GSAP-Plugins (nur bei type=`gsap`)               |

### Location-Werte

| Location              | Wann läuft der Code           | Ideal für          |
|-----------------------|-------------------------------|--------------------|
| `site_wide_header`    | `<head>` (wp_head)            | CSS                |
| `site_wide_footer`    | `</body>` (wp_footer)         | JS                 |
| `everywhere`          | `plugins_loaded` hook         | PHP / GSAP-Enqueue |
| `frontend`            | Nur Frontend                  | JS/CSS             |
| `admin`               | Nur WP-Admin                  | Admin-Scripts      |
| `after_post`          | Nach Post-Inhalt              | Post-spezifisch    |

### Rückgabe

```json
{
  "success":    true,
  "snippet_id": 42,
  "action":     "created",
  "slug":       "hero-gsap-scrollreveal",
  "title":      "Hero GSAP ScrollReveal",
  "type":       "gsap",
  "location":   "everywhere",
  "active":     true,
  "post_id":    123,
  "message":    "Created: WPCode-Snippet \"Hero GSAP ScrollReveal\" (ID: 42, type: gsap, location: everywhere)"
}
```

---

## Type-Verhalten: `gsap`

Bei `type: "gsap"` wird der übergebene JS-Code **nicht direkt** als JS-Snippet
gespeichert. Stattdessen generiert die Ability automatisch einen vollständigen
**PHP `wp_enqueue_scripts` Snippet**, der:

1. GSAP Core vom jsDelivr CDN lädt
2. Alle gewünschten Plugins (ScrollTrigger, SplitText etc.) lädt
3. `gsap.registerPlugin()` aufruft
4. Den Animations-Code als `wp_add_inline_script()` anhängt

### Beispiel — Generiertes PHP für GSAP

```php
<?php
function novamira_gsap_a1b2c3d4() {
    if ( ! is_singular() || (int) get_the_ID() !== 123 ) {
        return;
    }
    wp_enqueue_script(
        'gsap-core',
        'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js',
        [], '3.12.5', true
    );
    wp_enqueue_script(
        'gsap-scrolltrigger',
        'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js',
        ['gsap-core'], '3.12.5', true
    );
    wp_add_inline_script(
        'gsap-scrolltrigger',
        'gsap.registerPlugin( ScrollTrigger );
         gsap.from(".e-heading", { opacity: 0, y: 60, scrollTrigger: ".e-heading" });'
    );
}
add_action( 'wp_enqueue_scripts', 'novamira_gsap_a1b2c3d4', 10 );
```

**Vorteile gegenüber direktem JS-Snippet:**
- Lädt GSAP nur wenn nötig (post_id-Guard)
- Korrekte WordPress-Dependency-Chain
- Kein `<script>`-Tag-Chaos im Footer
- Deduplication durch wp_enqueue (kein doppeltes GSAP)

### Unterstützte GSAP-Plugins

| Plugin          | `gsap_plugins` Wert  | CDN-Datei                     |
|-----------------|---------------------|-------------------------------|
| ScrollTrigger   | `"ScrollTrigger"`   | ScrollTrigger.min.js          |
| SplitText       | `"SplitText"`       | SplitText.min.js              |
| Draggable       | `"Draggable"`       | Draggable.min.js              |
| Flip            | `"Flip"`            | Flip.min.js                   |
| Observer        | `"Observer"`        | Observer.min.js               |
| MotionPath      | `"MotionPath"`      | MotionPathPlugin.min.js       |
| TextPlugin      | `"TextPlugin"`      | TextPlugin.min.js             |

> **Hinweis:** SplitText, MorphSVG, DrawSVG sind GSAP Club/Business-Plugins.
> Diese erfordern eine GSAP-Lizenz. Bei öffentlichen Sites nur ScrollTrigger,
> Draggable, Flip, Observer, TextPlugin nutzen (kostenlos, auch kommerziell).

---

## Pipeline-Integration (Node.js)

### Neuer npm-Script

```bash
npm run inject-code        # gibt Hilfe aus
npm run inject-code -- --plan animation-plan.json
npm run inject-code -- --from-framer-export exports/papaya/
```

### Workflow im Framer → Elementor Build

```
Phase 4: Execution
  ↓ elementor-set-content (Baum-Build)
  ↓ adrians-layout-audit  (PFLICHT)
  ↓ adrians-code-injector (NEU — Animationen injizieren)
  ↓ visual-qa
```

### animation-plan.json Format

```json
{
  "snippets": [
    {
      "title":       "Hero ScrollReveal",
      "type":        "gsap",
      "code":        "gsap.from('.s-shero .e-heading', { opacity: 0, y: 80, duration: 1.2, ease: 'power3.out', scrollTrigger: { trigger: '.s-shero', start: 'top 80%' }});",
      "post_id":     123,
      "gsap_plugins": ["ScrollTrigger"],
      "tags":        ["framer", "hero"]
    },
    {
      "title":    "Feature Cards Stagger",
      "type":     "gsap",
      "code":     "gsap.from('.s-sfeatures .e-container > *', { opacity: 0, y: 40, stagger: 0.15, scrollTrigger: { trigger: '.s-sfeatures', start: 'top 75%' }});",
      "post_id":  123,
      "gsap_plugins": ["ScrollTrigger"]
    },
    {
      "title":    "Global Animation CSS",
      "type":     "css",
      "code":     "[data-animate] { will-change: opacity, transform; }",
      "location": "site_wide_header",
      "tags":     ["framer", "performance"]
    }
  ]
}
```

---

## Installation in Novamira Plugin

Die PHP-Dateien müssen in das `novamira-adrians-extra` Plugin eingebunden werden:

### Methode 1: Direkte Einbindung (empfohlen)

Kopiere die PHP-Dateien nach:
```
wp-content/plugins/novamira-adrians/abilities/
  adrians-code-injector.php
  adrians-list-snippets.php
  adrians-delete-snippet.php
```

Dann in `novamira-adrians/novamira-adrians.php` registrieren:
```php
// In der Ability-Registry:
'adrians-code-injector'  => [ 'handler' => 'novamira_adrians_code_injector',  'file' => 'abilities/adrians-code-injector.php' ],
'adrians-list-snippets'  => [ 'handler' => 'novamira_adrians_list_snippets',  'file' => 'abilities/adrians-list-snippets.php' ],
'adrians-delete-snippet' => [ 'handler' => 'novamira_adrians_delete_snippet', 'file' => 'abilities/adrians-delete-snippet.php' ],
```

### Methode 2: Via execute-php (ohne Plugin-Änderung)

Der Agent kann die PHP-Ability-Inhalte direkt via `novamira/execute-php` ausführen.
Dazu den Inhalt von `adrians-code-injector.php` lesen und als Code-String übergeben.

---

## Zusammenfassung: Was ist wie realisiert

```
Framer Animation       Node.js Pipeline           WPCode (WordPress)
─────────────────      ─────────────────────       ──────────────────
GSAP .js Dateien  ──▶  inject-animation-code.js ─▶  wpcode_snippet CPT
CSS Transitions   ──▶  animation-plan.json       ─▶  publish + meta
Scroll Reveals    ──▶  MCP-Plan Steps            ─▶  wp_enqueue_scripts
                        ↓ Agent führt aus              ↓ läuft auf Site
                   animation-mcp-plan.json       GSAP animiert Elementor V4 Tree
```
