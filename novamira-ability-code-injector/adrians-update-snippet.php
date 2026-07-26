<?php
/**
 * Novamira Ability: adrians-update-snippet
 *
 * Ability-Name:  novamira-adrianv2/adrians-update-snippet
 * Version:       1.0.0
 *
 * Aktualisiert einen bestehenden WPCode-Snippet in-place.
 * Im Gegensatz zu delete+create bleibt die Post-ID (snippet_id) erhalten —
 * Referenzen in Animations-Plans und injection-summary.json bleiben gültig.
 *
 * Parameter:
 *   {
 *     "title":        string  PFLICHT - Exakter Snippet-Titel (Lookup-Key)
 *     "new_code":     string  optional - Neuer Quellcode
 *     "new_title":    string  optional - Neuer Titel (umbenennen)
 *     "new_type":     string  optional - Neuer Typ: css|js|html|php|gsap
 *     "new_location": string  optional - Neuer Location-Slug
 *     "new_priority": int     optional - Neue Priorität (1–100)
 *     "new_tags":     array   optional - Neue Tags (ersetzt alle bestehenden)
 *   }
 *
 * Rückgabe:
 *   { "success": bool, "snippet_id": int, "title": str,
 *     "updated_fields": str[], "message": str }
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

require_once __DIR__ . '/adrians-helpers.php';

function novamira_adrians_update_snippet( array $params ): array {

    if ( ! current_user_can( 'manage_options' ) ) {
        return [ 'success' => false, 'message' => 'Fehlende Berechtigung: manage_options erforderlich.' ];
    }

    if ( ! post_type_exists( 'wpcode_snippet' ) ) {
        return [ 'success' => false, 'message' => 'WPCode nicht aktiv.' ];
    }

    $title = sanitize_text_field( $params['title'] ?? '' );
    if ( ! $title ) {
        return [ 'success' => false, 'message' => 'Parameter "title" erforderlich.' ];
    }

    $id = novamira_find_wpcode_snippet( $title );
    if ( ! $id ) {
        return [ 'success' => false, 'message' => "Snippet \"$title\" nicht gefunden. Nutze adrians-code-injector um ihn anzulegen." ];
    }

    $update         = [ 'ID' => $id ];
    $updated_fields = [];

    // ── Post-Felder aktualisieren ─────────────────────────────────────────
    if ( isset( $params['new_code'] ) ) {
        // wp_kses_post erlaubt gültiges HTML; für PHP/JS-Snippets nutzen wir
        // wp_unslash + sanitize_textarea_field um Injection zu verhindern
        $update['post_content'] = wp_unslash( sanitize_textarea_field( $params['new_code'] ) );
        $updated_fields[]       = 'code';
    }

    if ( isset( $params['new_title'] ) ) {
        $new_title_clean        = sanitize_text_field( $params['new_title'] );
        $update['post_title']   = $new_title_clean;
        $update['post_name']    = sanitize_title( $new_title_clean );
        $updated_fields[]       = 'title';
    }

    if ( count( $update ) > 1 ) {
        $result = wp_update_post( $update, true );
        if ( is_wp_error( $result ) ) {
            return [ 'success' => false, 'message' => 'wp_update_post fehlgeschlagen: ' . $result->get_error_message() ];
        }
    }

    // ── Post-Meta aktualisieren ───────────────────────────────────────────
    if ( isset( $params['new_type'] ) ) {
        $allowed_types = [ 'css', 'js', 'html', 'php', 'gsap', 'text' ];
        $new_type      = sanitize_key( $params['new_type'] );
        if ( in_array( $new_type, $allowed_types, true ) ) {
            update_post_meta( $id, '_wpcode_snippet_type', $new_type );
            $updated_fields[] = 'type';
        }
    }

    if ( isset( $params['new_location'] ) ) {
        update_post_meta( $id, '_wpcode_auto_insert_location', sanitize_key( $params['new_location'] ) );
        $updated_fields[] = 'location';
    }

    if ( isset( $params['new_priority'] ) ) {
        $priority = max( 1, min( 100, absint( $params['new_priority'] ) ) );
        update_post_meta( $id, '_wpcode_snippet_priority', $priority );
        $updated_fields[] = 'priority';
    }

    if ( isset( $params['new_tags'] ) && is_array( $params['new_tags'] ) ) {
        $clean_tags = array_map( 'sanitize_text_field', $params['new_tags'] );
        wp_set_post_terms( $id, $clean_tags, 'wpcode_tag', false ); // false = ersetzen, nicht anhängen
        $updated_fields[] = 'tags';
    }

    // WPCode-Cache leeren
    delete_transient( 'wpcode_snippets' );
    delete_transient( 'wpcode_snippets_auto_insert' );

    if ( empty( $updated_fields ) ) {
        return [
            'success'        => false,
            'snippet_id'     => $id,
            'message'        => 'Keine aktualisierbaren Parameter übergeben. Nutze new_code, new_title, new_type, new_location, new_priority oder new_tags.',
        ];
    }

    return [
        'success'        => true,
        'snippet_id'     => $id,
        'title'          => get_the_title( $id ),
        'updated_fields' => $updated_fields,
        'message'        => "Snippet \"" . get_the_title( $id ) . "\" (ID: $id) aktualisiert: " . implode( ', ', $updated_fields ) . '.',
    ];
}
