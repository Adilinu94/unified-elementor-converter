<?php
/**
 * Novamira Ability: adrians-get-snippet
 *
 * Ability-Name:  novamira/adrians-get-snippet
 * Version:       1.0.0
 *
 * Ruft ein einzelnes WPCode-Snippet nach Titel oder ID ab.
 * Spart Tokens gegenüber adrians-list-snippets + manuelles Filtern.
 *
 * Parameter:
 *   { "title":      string  optional  - Snippet-Titel (exakte Übereinstimmung)
 *     "snippet_id": int     optional  - WPCode Post-ID
 *   }
 *   (title ODER snippet_id muss angegeben sein)
 *
 * Rückgabe:
 *   { "success": bool, "snippet_id": int, "title": str, "slug": str,
 *     "type": str, "location": str, "active": bool, "priority": int,
 *     "tags": [...], "code": str, "description": str }
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

require_once __DIR__ . '/adrians-helpers.php';

function novamira_adrians_get_snippet( array $params ): array {

    /* ── Capability-Check (Defense-in-Depth) ─────────────────────────── */
    if ( ! current_user_can( 'manage_options' ) ) {
        return [ 'success' => false, 'message' => 'Fehlende Berechtigung: manage_options erforderlich.' ];
    }

    /* ── WPCode prüfen ───────────────────────────────────────────────── */
    if ( ! post_type_exists( 'wpcode_snippet' ) ) {
        return [ 'success' => false, 'message' => 'WPCode nicht aktiv.' ];
    }

    /* ── ID oder Titel auflösen ──────────────────────────────────────── */
    if ( ! empty( $params['snippet_id'] ) ) {
        $id = absint( $params['snippet_id'] );
    } elseif ( ! empty( $params['title'] ) ) {
        $id = novamira_find_wpcode_snippet( sanitize_text_field( $params['title'] ) );
    } else {
        return [ 'success' => false, 'message' => 'Parameter "title" oder "snippet_id" erforderlich.' ];
    }

    if ( ! $id ) {
        return [ 'success' => false, 'message' => 'Snippet nicht gefunden.' ];
    }

    $post = get_post( $id );
    if ( ! $post || $post->post_type !== 'wpcode_snippet' ) {
        return [ 'success' => false, 'message' => "Kein wpcode_snippet mit ID $id gefunden." ];
    }

    $tags = wp_get_post_terms( $id, 'wpcode_tag', [ 'fields' => 'names' ] );

    return [
        'success'     => true,
        'snippet_id'  => $id,
        'title'       => $post->post_title,
        'slug'        => $post->post_name,
        'type'        => get_post_meta( $id, '_wpcode_snippet_type',         true ) ?: 'unknown',
        'location'    => get_post_meta( $id, '_wpcode_auto_insert_location', true ) ?: '',
        'active'      => $post->post_status === 'publish',
        'priority'    => (int) ( get_post_meta( $id, '_wpcode_snippet_priority', true ) ?: 10 ),
        'tags'        => is_array( $tags ) ? $tags : [],
        'code'        => $post->post_content,
        'description' => $post->post_excerpt,
    ];
}
