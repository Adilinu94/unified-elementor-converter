<?php
/**
 * Novamira Ability: adrians-code-injector
 *
 * Ability-Name:  novamira/adrians-code-injector
 * Version:       1.0.0
 * Requires:      WPCode >= 2.0 (free), PHP >= 7.4, WordPress >= 6.0
 *
 * Beschreibung:
 *   Legt Custom CSS, JavaScript, HTML, PHP und GSAP-Animationen als WPCode-Snippets
 *   an (oder aktualisiert sie) und aktiviert sie sofort auf der Zielseite.
 *
 * Parameter (JSON-Objekt):
 * ┌─────────────────┬──────────┬──────────────────────────────────────────────────────┐
 * │ Parameter       │ Pflicht  │ Beschreibung                                         │
 * ├─────────────────┼──────────┼──────────────────────────────────────────────────────┤
 * │ title           │ JA       │ Snippet-Name (eindeutig — wird als Lookup-Key genutzt)│
 * │ type            │ JA       │ "css"|"js"|"html"|"php"|"gsap"                       │
 * │ code            │ JA*      │ Quellcode (* bei type=gsap der Animations-JS-Code)   │
 * │ location        │ nein     │ Wo der Code läuft (siehe Location-Tabelle unten)      │
 * │ post_id         │ nein     │ Nur auf dieser WordPress-Post-ID laden (0 = sitewide)│
 * │ on_conflict     │ nein     │ "replace"(def)|"skip"|"append"                       │
 * │ priority        │ nein     │ Ausführungs-Priorität 1-100 (Default: 10)            │
 * │ description     │ nein     │ Kurzbeschreibung für WPCode-UI                       │
 * │ tags            │ nein     │ Array von Tag-Strings, z.B. ["framer","hero"]        │
 * │ gsap_version    │ nein     │ GSAP-CDN-Version, z.B. "3.12.5" (Default: "3.12.5") │
 * │ gsap_plugins    │ nein     │ Array, z.B. ["ScrollTrigger","SplitText"]            │
 * └─────────────────┴──────────┴──────────────────────────────────────────────────────┘
 *
 * Location-Werte:
 *   "site_wide_header"  → <head>  (Standard für CSS)
 *   "site_wide_footer"  → <footer> / wp_footer  (Standard für JS)
 *   "everywhere"        → plugins_loaded, global  (Standard für PHP)
 *   "frontend"          → nur Frontend
 *   "admin"             → nur WP-Admin
 *   "after_post"        → nach Post-Content
 *   "before_content"    → vor Post-Content
 *
 * Rückgabe (JSON):
 *   { "success": bool, "snippet_id": int, "action": "created"|"updated"|"skipped",
 *     "slug": string, "title": string, "type": string, "location": string,
 *     "active": bool, "post_id": int|null, "message": string }
 *
 * WPCode Custom Post Type (wpcode_snippet) Meta-Felder:
 *   _wpcode_snippet_type          → "css"|"js"|"html"|"php"
 *   _wpcode_snippet_priority      → int
 *   _wpcode_auto_insert           → "1"
 *   _wpcode_auto_insert_location  → Location-Slug
 *   _wpcode_conditions            → serialized Conditional-Logic-Array
 *   _wpcode_use_post              → "0"|"1"
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit( 'No direct access.' );
}

require_once __DIR__ . '/adrians-helpers.php';

/**
 * Haupt-Ability-Handler.
 * Wird vom Novamira MCP-Adapter aufgerufen:
 *   ability_name: "novamira/adrians-code-injector"
 *   parameters:   { ... }
 *
 * @param  array $params  Deserialisierter JSON-Parameter-Array
 * @return array          Strukturierter Ergebnis-Array (wird zu JSON serialisiert)
 */
function novamira_adrians_code_injector( array $params ): array {

    /* ── 0. Capability-Check (Defense-in-Depth) ───────────────────────────── */
    if ( ! current_user_can( 'manage_options' ) ) {
        return [ 'success' => false, 'message' => 'Fehlende Berechtigung: manage_options erforderlich.' ];
    }

    /* ── 1. Parameter lesen & validieren ─────────────────────────────────── */

    $title       = isset( $params['title'] )       ? sanitize_text_field( $params['title'] )            : '';
    $type        = isset( $params['type'] )        ? strtolower( sanitize_key( $params['type'] ) )       : '';
    $code        = isset( $params['code'] )        ? $params['code']                                     : '';
    $location    = isset( $params['location'] )    ? sanitize_key( $params['location'] )                 : '';
    $post_id     = isset( $params['post_id'] )     ? absint( $params['post_id'] )                        : 0;
    $on_conflict = isset( $params['on_conflict'] ) ? sanitize_key( $params['on_conflict'] )              : 'replace';
    $priority    = isset( $params['priority'] )    ? max( 1, min( 100, absint( $params['priority'] ) ) ) : 10;
    $description = isset( $params['description'] ) ? sanitize_textarea_field( $params['description'] )   : '';
    $tags        = isset( $params['tags'] ) && is_array( $params['tags'] ) ? $params['tags']             : [];

    $gsap_version = isset( $params['gsap_version'] ) ? sanitize_text_field( $params['gsap_version'] ) : '3.12.5';
    $gsap_plugins = isset( $params['gsap_plugins'] ) && is_array( $params['gsap_plugins'] )
                    ? array_map( 'sanitize_text_field', $params['gsap_plugins'] )
                    : [ 'ScrollTrigger' ];

    if ( empty( $title ) ) {
        return [ 'success' => false, 'message' => 'Parameter "title" fehlt oder leer.' ];
    }

    $allowed_types = [ 'css', 'js', 'javascript', 'html', 'php', 'gsap' ];
    if ( ! in_array( $type, $allowed_types, true ) ) {
        return [ 'success' => false, 'message' => 'Ungültiger type "' . $type . '". Erlaubt: ' . implode( ', ', $allowed_types ) ];
    }

    if ( empty( $code ) ) {
        return [ 'success' => false, 'message' => 'Parameter "code" fehlt oder leer.' ];
    }

    /* ── 2. WPCode prüfen ────────────────────────────────────────────────── */

    if ( ! post_type_exists( 'wpcode_snippet' ) && ! class_exists( 'WPCode' ) && ! defined( 'WPCODE_VERSION' ) ) {
        return [
            'success' => false,
            'message' => 'WPCode-Plugin nicht aktiv. Installieren: wordpress.org/plugins/insert-headers-and-footers',
        ];
    }

    /* ── 3. Typ → WPCode-Typ mappen ──────────────────────────────────────── */

    $type_map    = [ 'css' => 'css', 'js' => 'js', 'javascript' => 'js', 'html' => 'html', 'php' => 'php', 'gsap' => 'php' ];
    $wpcode_type = $type_map[ $type ];

    /* ── 4. GSAP: PHP-Enqueue-Snippet generieren ─────────────────────────── */

    if ( $type === 'gsap' ) {
        $code     = novamira_build_gsap_snippet( $code, $gsap_version, $gsap_plugins, $post_id );
        $location = $location ?: 'everywhere';
    }

    /* ── 5. Default-Location ─────────────────────────────────────────────── */

    if ( empty( $location ) ) {
        $location_defaults = [ 'css' => 'site_wide_header', 'js' => 'site_wide_footer', 'html' => 'site_wide_footer', 'php' => 'everywhere' ];
        $location          = $location_defaults[ $wpcode_type ] ?? 'site_wide_footer';
    }

    /* ── 6. Bestehendes Snippet suchen ───────────────────────────────────── */

    $existing_id = novamira_find_wpcode_snippet( $title );
    $action      = $existing_id ? 'updated' : 'created';

    if ( $existing_id && $on_conflict === 'skip' ) {
        return [
            'success'    => true,
            'snippet_id' => $existing_id,
            'action'     => 'skipped',
            'slug'       => get_post_field( 'post_name', $existing_id ),
            'title'      => $title,
            'type'       => $type,
            'location'   => $location,
            'active'     => get_post_status( $existing_id ) === 'publish',
            'post_id'    => $post_id ?: null,
            'message'    => "Snippet \"$title\" (ID: $existing_id) existiert — übersprungen (on_conflict=skip).",
        ];
    }

    if ( $existing_id && $on_conflict === 'append' ) {
        $existing_code = get_post_field( 'post_content', $existing_id );
        $separator     = "\n\n/* ── Novamira Append " . gmdate( 'Y-m-d H:i:s' ) . " ── */\n";
        $code          = $existing_code . $separator . $code;
    }

    /* ── 7. Post-Array aufbauen ──────────────────────────────────────────── */

    $post_data = [
        'post_type'    => 'wpcode_snippet',
        'post_title'   => $title,
        'post_content' => $code,
        'post_status'  => 'publish',   // sofort aktiv
        'post_excerpt' => $description,
    ];

    if ( $existing_id ) {
        $post_data['ID'] = $existing_id;
        $snippet_id      = wp_update_post( $post_data, true );
    } else {
        $snippet_id = wp_insert_post( $post_data, true );
    }

    if ( is_wp_error( $snippet_id ) ) {
        return [ 'success' => false, 'message' => 'WP-Fehler: ' . $snippet_id->get_error_message() ];
    }

    /* ── 8. WPCode-Meta-Felder setzen ────────────────────────────────────── */

    update_post_meta( $snippet_id, '_wpcode_snippet_type',         $wpcode_type );
    update_post_meta( $snippet_id, '_wpcode_snippet_priority',     (string) $priority );
    update_post_meta( $snippet_id, '_wpcode_auto_insert',          '1' );
    update_post_meta( $snippet_id, '_wpcode_auto_insert_location', $location );

    /* Post-spezifische Conditional Logic (nur wenn post_id gesetzt) */
    if ( $post_id > 0 && $type !== 'gsap' ) {
        // Für GSAP wird post_id bereits im PHP-Code selbst abgehandelt
        $condition = maybe_serialize( [
            [
                'type'  => 'show',
                'rules' => [
                    [ 'rule_type' => 'post_id', 'rule_value' => (string) $post_id ],
                ],
            ],
        ] );
        update_post_meta( $snippet_id, '_wpcode_conditions', $condition );
        update_post_meta( $snippet_id, '_wpcode_use_post', '1' );
    } else {
        delete_post_meta( $snippet_id, '_wpcode_conditions' );
        update_post_meta( $snippet_id, '_wpcode_use_post', '0' );
    }

    /* Tags */
    if ( ! empty( $tags ) ) {
        wp_set_post_terms( $snippet_id, $tags, 'wpcode_tag' );
    }

    /* ── 9. WPCode-Cache leeren ──────────────────────────────────────────── */

    delete_transient( 'wpcode_snippets' );
    delete_transient( 'wpcode_snippets_auto_insert' );
    wp_cache_delete( 'wpcode_snippets', 'wpcode' );
    wp_cache_delete( 'wpcode_auto_insert_snippets', 'wpcode' );

    /* ── 10. Ergebnis ────────────────────────────────────────────────────── */

    return [
        'success'    => true,
        'snippet_id' => $snippet_id,
        'action'     => $action,
        'slug'       => get_post_field( 'post_name', $snippet_id ),
        'title'      => $title,
        'type'       => $type,
        'location'   => $location,
        'active'     => true,
        'post_id'    => $post_id ?: null,
        'message'    => ucfirst( $action ) . ": WPCode-Snippet \"$title\" (ID: {$snippet_id}, type: {$type}, location: {$location})",
    ];
}

/* ─── Hilfsfunktionen ────────────────────────────────────────────────────── */

/**
 * Baut einen vollständigen PHP wp_enqueue_scripts Snippet für GSAP.
 *
 * Das generierte PHP lädt GSAP-Core + gewünschte Plugins vom CDN,
 * registriert die Plugins via gsap.registerPlugin() und führt
 * den übergebenen Animations-Code als Inline-Script aus.
 *
 * @param string   $animation_js  Reiner JS-Code (kein <script>-Tag)
 * @param string   $version       GSAP-Version, z.B. "3.12.5"
 * @param string[] $plugins       GSAP-Plugins, z.B. ["ScrollTrigger","SplitText"]
 * @param int      $post_id       0 = sitewide, >0 = nur auf dieser Seite
 */
function novamira_build_gsap_snippet( string $animation_js, string $version, array $plugins, int $post_id ): string {

    $v       = preg_replace( '/[^0-9.]/', '', $version );  // nur Zahlen + Punkte
    $cdn     = "https://cdn.jsdelivr.net/npm/gsap@{$v}/dist";
    $fn_uid  = 'novamira_gsap_' . substr( md5( $animation_js . $v . implode( '', $plugins ) ), 0, 8 );

    /* Plugin-CDN-Map */
    $plugin_file_map = [
        'ScrollTrigger' => 'ScrollTrigger.min.js',
        'SplitText'     => 'SplitText.min.js',
        'Draggable'     => 'Draggable.min.js',
        'Flip'          => 'Flip.min.js',
        'Observer'      => 'Observer.min.js',
        'MotionPath'    => 'MotionPathPlugin.min.js',
        'TextPlugin'    => 'TextPlugin.min.js',
        'MorphSVG'      => 'MorphSVGPlugin.min.js',
        'DrawSVG'       => 'DrawSVGPlugin.min.js',
    ];

    /* PHP-Code aufbauen — String-Konkatenation, kein Heredoc (sicherer für Novamira) */
    $lines   = [];
    $lines[] = '<?php';
    $lines[] = '/**';
    $lines[] = ' * Novamira GSAP Snippet — ' . implode( ', ', $plugins );
    $lines[] = ' * GSAP ' . $v . ' | generiert von adrians-code-injector v1.0';
    $lines[] = ' */';
    $lines[] = 'function ' . $fn_uid . '() {';

    /* Post-spezifische Guard (wenn post_id gesetzt) */
    if ( $post_id > 0 ) {
        $lines[] = '    if ( ! is_singular() || (int) get_the_ID() !== ' . $post_id . ' ) {';
        $lines[] = '        return;';
        $lines[] = '    }';
    }

    /* GSAP Core */
    $lines[] = '    wp_enqueue_script(';
    $lines[] = "        'gsap-core',";
    $lines[] = "        '{$cdn}/gsap.min.js',";
    $lines[] = '        [],';
    $lines[] = "        '{$v}',";
    $lines[] = '        true';
    $lines[] = '    );';

    /* Plugins */
    $last_handle = 'gsap-core';
    $register_calls = [];

    foreach ( $plugins as $plugin ) {
        $plugin  = preg_replace( '/[^A-Za-z]/', '', $plugin );
        $file    = $plugin_file_map[ $plugin ] ?? ( $plugin . '.min.js' );
        $handle  = 'gsap-' . strtolower( $plugin );

        $lines[] = '    wp_enqueue_script(';
        $lines[] = "        '{$handle}',";
        $lines[] = "        '{$cdn}/{$file}',";
        $lines[] = "        [ '{$last_handle}' ],";
        $lines[] = "        '{$v}',";
        $lines[] = '        true';
        $lines[] = '    );';

        $last_handle      = $handle;
        $register_calls[] = '        gsap.registerPlugin( ' . $plugin . ' );';
    }

    /* Inline JS: registerPlugin + Animationscode */
    $register_block = ! empty( $register_calls ) ? implode( "\n", $register_calls ) . "\n\n" : '';
    $inline_js      = $register_block . $animation_js;

    $lines[] = '    wp_add_inline_script(';
    $lines[] = "        '{$last_handle}',";
    $lines[] = '        ' . wp_json_encode( $inline_js );
    $lines[] = '    );';
    $lines[] = '}';
    $lines[] = "add_action( 'wp_enqueue_scripts', '{$fn_uid}', 10 );";

    return implode( "\n", $lines );
}
