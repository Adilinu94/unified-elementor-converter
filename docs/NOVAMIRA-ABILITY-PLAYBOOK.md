# NOVAMIRA-ABILITY-PLAYBOOK — der richtige Ability-Call pro Pipeline-Schritt

> **Zweck:** Ein KI-Agent kann hier ohne Code-Lektüre den korrekten Novamira-Ability-Call
> pro Pipeline-Schritt nachschlagen. Alle Namen sind gegen den Live-Server verifiziert
> (Discovery 2026-07-30, 263 Abilities, `docs/NOVAMIRA-LIVE-ABILITIES-2026-07-30.txt`);
> die Input-Schemata der Kern-Abilities wurden via `mcp-adapter-get-ability-info` abgerufen.
>
> **Wire-Format** (immer gleich): `mcp-adapter-execute-ability` mit
> `{ "ability_name": "<name>", "parameters": { … } }`.
> Im Code IMMER durch `resolveAbilityName()` (packages/mcp/src/ability-registry.ts) schleusen.

---

## 1. Preflight

| Ability | Parameter (Kurzform) | Wann |
|---|---|---|
| `novamira/elementor-check-setup` | `{}` (keine) | **Immer zuerst.** Liefert Elementor/Pro-Version, `atomic.*`-Flags (runtime, style_schema, global_classes, variables, interactions), Kit (`container_width`, `container_padding`, `active_breakpoints`), `issues[]`. Bei V4-Build: `atomic.runtime_available` MUSS true sein. |
| `novamira-adrianv2/check-editor-health` | `{ post_id? }` | Editor-Gesundheit vor großen Writes. |
| `novamira-adrianv2/greet` | `{ name }` | Billigster Verbindungstest (ersetzt alt `novamira/adrians-greet`). |
| `mcp-adapter/list-abilities` (via `mcp-adapter-discover-abilities`) | `{}` | Registry-Drift prüfen — CLI: `elconv doctor --sync-abilities`. |

## 2. Build V3 (Container + klassische Widgets)

| Ability | Parameter (Kurzform, verifiziert) | Hinweise |
|---|---|---|
| `novamira/elementor-set-content` | `{ post_id*, content*[], template_type? }` | **Der V3-Deploy-Weg für verschachtelte Trees.** Elemente mit `elType`/`element_type` (`container`, `widget`) + `widgetType`/`widget_type`. Server-seitige Validierung: unbekannte Control-IDs/Enums brechen ab und liefern die Schemas der betroffenen Widgets INLINE im Fehler → korrigieren, erneut senden. Regeln: `typography_typography:'custom'` vor `typography_font_size`; Dimensionen `{unit,top,right,bottom,left,isLinked}`; Slider `{size,unit}`; Farben `#RRGGBB`; responsive via Suffix `<key>_<breakpoint>`. Invalidiert Elementor-CSS-Cache + `clean_post_cache` automatisch. |
| `novamira/elementor-get-content` | `{ post_id* }` | Ist-Zustand lesen (vor Diff/Update). |
| `novamira/elementor-get-schema` | `{ widget_types?[] }` | OPTIONALE Discovery — Validierung läuft ohnehin serverseitig. |
| `novamira/elementor-add-element` / `elementor-edit-element` / `elementor-delete-element` | `{ post_id*, element_id/parent, settings }` | Chirurgische Einzel-Edits statt Voll-Redeploy. |

## 2b. Tree-Chunk Inject — chunked transport (Plugin fc26eb6, seit 2026-08-06 live)

FC26EB6 umgeht das MCP JSON-RPC Transport-Limit (~3–17 KB). Für große Trees ist dies die kanonische Large-Strategie für MCP-only Clients.

| Schritt | Ability | Parameter (verifiziert) | Hinweise |
|---|---|---|---|
| 2b.1 Start | `novamira-adrianv2/tree-chunk-start` | `{ post_id*, mode?('overwrite'|'merge_by_id'), wp_page_template?('elementor_canvas'|'elementor_header_footer'|'default'), elementor_version?('3.0.0') }` | Liefert `session_id` (32 hex) + `expires_at` (ISO, TTL 15 Min). Transient `adrianv2_chunk_<id>`. |
| 2b.2 Append | `novamira-adrianv2/tree-chunk-append` | `{ session_id*, chunk_index* (>=0), chunk_data* (string) }` | Strikt `chunk_index === next_index` sonst `chunk_out_of_order`. 5 MB Cap (`chunk_size_limit_exceeded`). Empfehlung ~2 KB/Chunk. |
| 2b.3 Commit | `novamira-adrianv2/tree-chunk-commit` | `{ session_id*, post_id* }` | `post_id` muss Start-`post_id` entsprechen (`chunk_post_id_mismatch`). `json_decode` Depth 64, löscht Transient immer (auch bei Fehler). Output identisch zu `elementor-inject-calibrated-page`: `post_id, sections_count, kit_id, warnings, blocks_invalidated, saved_at, element_id_map`. |

Regeln: `start → N× append(0..N-1) → commit → read-back + cache-clear + verify`. Bei `chunk_session_not_found_or_expired` neue Session starten. `commit` Permission via `check_inject_permission()` (nur dort). `batch-build-page` ist seit fc26eb6 als veraltet markiert.

## 3. Build V4 Atomic

Reihenfolge: Foundation → Variables → Global Classes → Page.

| Schritt | Ability | Parameter (Kurzform, verifiziert) |
|---|---|---|
| 3.1 Foundation | `novamira-adrianv2/setup-v4-foundation` | `{ create_missing?: true }` — **VOR batch-build-page.** Legt `e-flexbox-base`/`e-div-block-base` an (padding:0, GitHub #32154) und liefert `variables{colors,fonts,sizes}`, `classes{label→id}`, `quick_ref` zum direkten Einsetzen. Idempotent. |
| 3.2 Variables | `novamira-adrianv2/batch-create-variables` | `{ variables: [{type,label,value},…] }` (einzeln: `create-variable`) |
| 3.3 Global Class | `novamira-adrianv2/create-global-class` | `{ label*, selector?, styles?: [{meta:{breakpoint,state},props:{…}}] }` → `{ id: "g-…" }` |
| 3.4 Variante | `novamira-adrianv2/add-global-class-variant` | `{ class_id, meta, props }` — responsive/hover-Varianten |
| 3.5 Page | `novamira-adrianv2/batch-build-page` | `{ elements*[], post_id?, title?, slug?, status?(draft), template?(elementor_header_footer), page_css?, page_js? }` — Element-Knoten: `{type, id?, settings?, styles?, children?, css_id?, css_class?, attributes?}`. Atomic-Settings im `$$type`-Format (Skalare werden auto-gewrappt); V4-responsive über `styles`-Map `variants[]` mit `meta.breakpoint` (NICHT Suffix-Keys). Liefert `post_id`, `permalink`, `edit_url`, `element_ids[]`. ⚠️ Für tief verschachtelte reine V3-Trees `elementor-set-content` bevorzugen. |
| 3.6 Validierung | `novamira-adrianv2/validate-v4-tree` | `{ elements }` — vor dem Write |

## 4. Assets

| Ability | Parameter (Kurzform, verifiziert) | Hinweise |
|---|---|---|
| `novamira-adrianv2/batch-media-upload` | `{ files*: [{filename*, content_base64*, mime_type?, alt_text?, title?},…] }` | Max 30 Dateien / 10 MB je Datei. Liefert `wp_media_id` + `wp_url` je Datei. Ersetzt N × `media-upload`. |
| `novamira-adrianv2/media-upload` | `{ filename, content_base64, … }` | Einzeldatei (alt: `novamira/adrians-media-upload`). |
| `novamira-adrianv2/upload-asset` | `{ page_id, asset_url, filename }` | Server-seitiger Fetch von URL → Media Library (alt: `novamira/upload_asset`). |
| `novamira/create-upload-link` | `{ … }` | Signierter Upload-Link (alt: `novamira/upload`). |
| `novamira-adrianv2/add-alt-text-from-context` | `{ post_id }` | Alt-Texte generieren (alt: `adrians-add-alt-text`). |

## 5. Code (CSS/JS/PHP)

| Ability | Parameter (Kurzform) | Hinweise |
|---|---|---|
| `novamira-adrianv2/create-wpcode-snippet` | `{ title, code, code_type, location, … }` | ⚠️ Gotchas: `location:'site_wide_footer'` (NICHT `site_footer`); Inline-JS als `code_type:'html'` mit `<script>`; NIE `priority` senden. Alias-Ziel von alt `adrians-code-injector`. Es gibt KEIN `novamira/create-wpcode-snippet` (falscher Namespace). |
| `novamira-adrianv2/update-wpcode-snippet` / `get-` / `list-` / `delete-` / `set-wpcode-snippet-status` | `{ snippet_id, … }` | CRUD; Status statt Delete für Rollback. |
| `novamira-adrianv2/create-php-snippet` / `validate-php-snippet` | `{ code, … }` | PHP; vorher validieren. `\Elementor\Plugin` einfach escapen. |
| `novamira-adrianv2/add-custom-css` / `add-custom-js` | `{ post_id?, css/js }` | Page- oder Kit-Level. |
| `novamira/execute-php` | `{ code }` | Letzter Ausweg — nur `novamira/*`-Namespace. |
| `novamira/run-wp-cli` | `{ command }` | WP-CLI auf dem Server. |

## 6. QA & Audit

| Ability | Parameter (Kurzform, verifiziert) | Prüft |
|---|---|---|
| `novamira-adrianv2/visual-qa` | `{ post_id*, checks?: [overflow, z_index, negative_margins, overlap, fixed_dimensions] }` | Overflow-Risiken, z-index-Konflikte, negative Margins, Overlap — Desktop + responsive. Liefert `issues[]` mit `by_severity`. |
| `novamira-adrianv2/page-audit` | `{ post_id*, checks?: [empty_containers, missing_alt_text, broken_links, heading_hierarchy] }` | Struktur/Content-Audit. |
| `novamira-adrianv2/responsive-audit` | `{ post_id }` | Breakpoint-Abdeckung. |
| `novamira-adrianv2/class-audit` / `variable-audit` | `{ }` | Verwaiste/duplizierte Global Classes bzw. Variables (V4). |
| `novamira-adrianv2/audit-page-a11y` / `audit-page-seo` | `{ post_id }` | A11y/SEO. |
| `novamira-adrianv2/layout-audit` | `{ post_id }` | Nesting-Tiefe (>3 = Fehler; V4-Engine addiert `.e-con-inner`). |
| Lokal (kein MCP): `elconv qa --url --ref-url` | — | Echter pixelmatch/SSIM-Score (0.6·SSIM + 0.4·pixel). |

## 7. Konvertierung V3 → V4

| Ability | Parameter (Kurzform, verifiziert) | Hinweise |
|---|---|---|
| `novamira-adrianv2/convert-page-v3-to-v4` | `{ post_id*, dry_run?(true), target_post_id?, unknown_widget_strategy?(keep_v3\|skip\|error), run_kit_convert?, variable_map?, class_map?, semantic_classes?, auto_fix? }` | **Dry-run per Default.** `run_kit_convert:true` erzeugt erst Variables aus V3-Farben + Global Classes aus Typo-Presets. `target_post_id` schreibt in Kopie statt Quelle. |
| `novamira-adrianv2/upgrade-page-to-v4` | `{ post_id }` | Einfacher Upgrade-Pfad. |
| `novamira-adrianv2/kit-convert-v3-to-v4` | `{ dry_run? }` | Nur Design-System (Kit) — liefert `variable_map`/`class_map` zur Wiederverwendung. |
| `novamira-adrianv2/convert-site-v3-to-v4` | `{ … }` | Ganze Site (74 V3-Seiten auf der Testseite als reale Testmenge). Vorher Snapshot! |

## 8. Cache & Verify

| Ability | Parameter | Hinweise |
|---|---|---|
| `novamira-adrianv2/clear-cache` | `{ post_ids?[] }` | Nach jedem Write. `elementor-set-content` cleart bereits selbst. |
| `novamira/elementor-clear-document-cache` | `{ post_ids: [id] }` | Dokument-CSS-Cache (nur `novamira/*`-Namespace); kanonischer aktueller Payload. |
| **Regel** | — | **Erfolgreicher MCP-Write ≠ sichtbares Ergebnis.** Immer verifizieren: `elconv qa`, Geometry-Probe oder `visual-qa` nach Cache-Clear. |

## 9. Serverseitiger Zustand & Memory (Phase 108)

| Ability | Zweck |
|---|---|
| `novamira-adrianv2/pipeline-state` | Serverseitiger Pipeline-Zustand (Remote-Backend für Session/Resume). |
| `novamira-adrianv2/memory-save` / `memory-get` / `memory-list` | Build-Lessons pro Target-Site persistieren. |
| `novamira-adrianv2/skill-write` / `skill-get` | Skills direkt auf dem Server ablegen. |
| `novamira-adrianv2/suggest-design-fixes` / `score-distinctiveness` | Design-Critic-Server-Seite (Phase 73/108). |
| `novamira/create-admin-access-link` | Admin-Login-Link für manuelle Verifikation. |

---

## Anhang A — Namespace-Migration (tote Alt-Namen)

| Alt (tot) | Live | 
|---|---|
| `novamira/adrians-X` | `novamira-adrianv2/X` |
| `novamira-adrianv2/adrians-X` | `novamira-adrianv2/X` |
| `novamira/upload` | `novamira/create-upload-link` |
| `novamira/upload_asset` | `novamira-adrianv2/upload-asset` |
| `novamira/adrians-code-injector` | `novamira-adrianv2/create-wpcode-snippet` |
| `novamira/adrians-add-alt-text` | `novamira-adrianv2/add-alt-text-from-context` |
| `novamira/set-interaction` | `novamira/elementor-add-interaction` |
| `novamira/inject-calibrated-page` | `novamira-adrianv2/elementor-inject-calibrated-page` |
| `novamira/set-page-content` | `novamira-adrianv2/batch-build-page` |
| `novamira/version`, `novamira/elementor-render-preview` | **ersatzlos entfallen** (UNAVAILABLE_ABILITIES) |

Vollständige, maschinenlesbare Fassung: `packages/mcp/src/ability-registry.ts` (`ALIAS_MAP`).

## Anhang B — Drift-Kontrolle

```bash
elconv doctor --sync-abilities --target-name <profil>     # oder --mcp-url + --auth-env
```
Diff Registry ↔ Live-Server; CI-Gate: `tests/unit/mcp/ability-registry.test.ts`.
