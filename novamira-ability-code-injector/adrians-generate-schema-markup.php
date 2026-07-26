<?php
/**
 * Novamira Ability: adrians-generate-schema-markup
 *
 * Ability-Name:  novamira-adrianv2/adrians-generate-schema-markup
 * Version:       1.0.0
 *
 * Generiert strukturiertes JSON-LD Schema.org-Markup für einen WordPress-Post
 * und injiziert es als WPCode-Snippet im <head> (via wp_head-Hook).
 *
 * Unterstützte Schema-Typen:
 *   WebPage       — Standard-Seite (default)
 *   Article       — Blog-Post / Artikel
 *   LocalBusiness — Lokales Unternehmen (nutzt Site-Title + Adress-Meta)
 *   BreadcrumbList — Breadcrumb-Navigation
 *
 * Parameter:
 *   {
 *     "post_id":     int     PFLICHT - WordPress Post-ID
 *     "schema_type": string  optional - "WebPage"|"Article"|"LocalBusiness" (default: "WebPage")
 *     "apply":       bool    optional - false = Dry-Run, gibt nur JSON-LD aus (default: true)
 *   }
 *
 * Rückgabe:
 *   { "success": bool, "post_id": int, "schema_type": string,
 *     "schema_json": string, "snippet_id": int|null, "dry_run": bool, "message": string }
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

require_once __DIR__ . '/adrians-helpers.php';
require_once __DIR__ . '/adrians-code-injector.php';

function novamira_adrians_generate_schema_markup( array $params ): array {

    if ( ! current_user_can( 'manage_options' ) ) {
        return [ 'success' => false, 'message' => 'Fehlende Berechtigung: manage_options erforderlich.' ];
    }

    $post_id     = absint( $params['post_id']     ?? 0 );
    $schema_type = sanitize_key( $params['schema_type'] ?? 'WebPage' );
    $apply       = isset( $params['apply'] ) ? (bool) $params['apply'] : true;

    $allowed_types = [ 'webpage', 'article', 'localbusiness', 'breadcrumblist' ];
    if ( ! in_array( strtolower( $schema_type ), $allowed_types, true ) ) {
        $schema_type = 'WebPage';
    }

    if ( ! $post_id ) {
        return [ 'success' => false, 'message' => 'Parameter "post_id" fehlt oder ungültig.' ];
    }

    $post = get_post( $post_id );
    if ( ! $post ) {
        return [ 'success' => false, 'message' => "Post $post_id nicht gefunden." ];
    }

    // Schema normalisieren (Groß-/Kleinschreibung)
    $type_map = [
        'webpage' => 'WebPage', 'article' => 'Article',
        'localbusiness' => 'LocalBusiness', 'breadcrumblist' => 'BreadcrumbList',
    ];
    $schema_type = $type_map[ strtolower( $schema_type ) ] ?? 'WebPage';

    $permalink   = get_permalink( $post_id );
    $title       = get_the_title( $post_id );
    $excerpt     = $post->post_excerpt ?: '';
    $modified    = get_post_modified_time( 'c', false, $post_id );
    $published   = get_post_time( 'c', false, $post_id );
    $site_name   = get_bloginfo( 'name' );

    // ── Schema generieren ─────────────────────────────────────────────
    $schema = [ '@context' => 'https://schema.org', '@type' => $schema_type ];

    switch ( $schema_type ) {
        case 'Article':
            $schema += [
                'headline'       => $title,
                'description'    => $excerpt,
                'url'            => $permalink,
                'datePublished'  => $published,
                'dateModified'   => $modified,
                'publisher'      => [
                    '@type' => 'Organization',
                    'name'  => $site_name,
                    'url'   => home_url(),
                ],
            ];
            $author_id = $post->post_author;
            if ( $author_id ) {
                $schema['author'] = [
                    '@type' => 'Person',
                    'name'  => get_the_author_meta( 'display_name', $author_id ),
                ];
            }
            break;

        case 'LocalBusiness':
            $schema += [
                'name'        => $site_name,
                'url'         => home_url(),
                'description' => get_bloginfo( 'description' ),
                'address'     => [
                    '@type'           => 'PostalAddress',
                    'addressLocality' => get_option( 'novamira_local_city',    '' ),
                    'addressCountry'  => get_option( 'novamira_local_country', 'DE' ),
                ],
            ];
            $phone = get_option( 'novamira_local_phone', '' );
            if ( $phone ) $schema['telephone'] = $phone;
            break;

        default: // WebPage
            $schema += [
                'name'        => $title,
                'description' => $excerpt,
                'url'         => $permalink,
                'inLanguage'  => get_bloginfo( 'language' ),
                'isPartOf'    => [ '@type' => 'WebSite', 'name' => $site_name, 'url' => home_url() ],
                'dateModified' => $modified,
            ];
    }

    $schema_json    = json_encode( $schema, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
    $php_snippet    = novamira_build_schema_php_snippet( $schema_json, $post_id );
    $snippet_title  = "Schema.org $schema_type – Post #$post_id";
    $snippet_id     = null;

    if ( $apply && post_type_exists( 'wpcode_snippet' ) ) {
        // Via adrians-code-injector als WPCode-Snippet speichern
        $inject_result = novamira_adrians_code_injector( [
            'title'      => $snippet_title,
            'type'       => 'php',
            'code'       => $php_snippet,
            'location'   => 'site_wide_header',
            'on_conflict'=> 'replace',
            'tags'       => [ 'seo', 'schema', 'structured-data', strtolower( $schema_type ) ],
            'description'=> "JSON-LD Schema.org $schema_type für Post #$post_id. Auto-generiert von adrians-generate-schema-markup.",
        ] );
        $snippet_id = $inject_result['snippet_id'] ?? null;
    }

    return [
        'success'     => true,
        'post_id'     => $post_id,
        'dry_run'     => ! $apply,
        'schema_type' => $schema_type,
        'schema_json' => $schema_json,
        'snippet_id'  => $snippet_id,
        'snippet_title' => $snippet_title,
        'message'     => $apply
            ? "JSON-LD $schema_type Schema als WPCode-Snippet '$snippet_title' gespeichert (ID: $snippet_id)."
            : "Dry-Run: JSON-LD $schema_type Schema generiert (nicht gespeichert).",
    ];
}

function novamira_build_schema_php_snippet( string $schema_json, int $post_id ): string {
    $fn_uid = 'novamira_schema_' . substr( md5( "schema_{$post_id}_" . time() ), 0, 8 );
    $escaped = str_replace( "'", "\\'", $schema_json );
    $lines   = [
        '<?php',
        "function {$fn_uid}() {",
        $post_id > 0
            ? "    if ( ! is_singular() || (int) get_the_ID() !== {$post_id} ) { return; }"
            : '',
        "    echo '<script type=\"application/ld+json\">';",
        "    echo '" . $escaped . "';",
        "    echo '</script>';",
        '}',
        "add_action( 'wp_head', '{$fn_uid}', 5 );",
    ];
    return implode( "\n", array_filter( $lines ) );
}
