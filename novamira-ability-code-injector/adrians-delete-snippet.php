<?php
/**
 * Novamira Ability: adrians-delete-snippet
 *
 * Ability-Name:  novamira/adrians-delete-snippet
 * Version:       1.1.0
 *
 * Löscht ein WPCode-Snippet, deaktiviert es (Soft-Delete) oder aktiviert es wieder.
 *
 * Parameter:
 *   { "title": string  PFLICHT  - Snippet-Titel
 *     "mode":  string  optional - "delete"(def) | "deactivate" | "activate" }
 *
 * Rückgabe:
 *   { "success": bool, "snippet_id": int, "action": "deleted"|"deactivated"|"activated"|"not_found", "message": string }
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

require_once __DIR__ . '/adrians-helpers.php';

function novamira_adrians_delete_snippet( array $params ): array {

    /* ── Capability-Check (Defense-in-Depth) ─────────────────────────── */
    if ( ! current_user_can( 'manage_options' ) ) {
        return [ 'success' => false, 'message' => 'Fehlende Berechtigung: manage_options erforderlich.' ];
    }

    $title = isset( $params['title'] ) ? sanitize_text_field( $params['title'] ) : '';
    $mode  = isset( $params['mode'] )  ? sanitize_key( $params['mode'] )         : 'delete';

    if ( empty( $title ) ) {
        return [ 'success' => false, 'message' => 'Parameter "title" fehlt.' ];
    }

    $snippet_id = novamira_find_wpcode_snippet( $title );

    if ( ! $snippet_id ) {
        return [
            'success'    => true,
            'snippet_id' => 0,
            'action'     => 'not_found',
            'message'    => "Snippet \"$title\" nicht gefunden.",
        ];
    }

    if ( $mode === 'activate' ) {
        wp_update_post( [ 'ID' => $snippet_id, 'post_status' => 'publish' ] );
        delete_transient( 'wpcode_snippets' );
        delete_transient( 'wpcode_snippets_auto_insert' );
        return [
            'success'    => true,
            'snippet_id' => $snippet_id,
            'action'     => 'activated',
            'message'    => "Snippet \"$title\" (ID: $snippet_id) aktiviert.",
        ];
    }

    if ( $mode === 'deactivate' ) {
        wp_update_post( [ 'ID' => $snippet_id, 'post_status' => 'draft' ] );
        delete_transient( 'wpcode_snippets' );
        delete_transient( 'wpcode_snippets_auto_insert' );
        return [
            'success'    => true,
            'snippet_id' => $snippet_id,
            'action'     => 'deactivated',
            'message'    => "Snippet \"$title\" (ID: $snippet_id) deaktiviert.",
        ];
    }

    wp_delete_post( $snippet_id, true );

    delete_transient( 'wpcode_snippets' );
    delete_transient( 'wpcode_snippets_auto_insert' );

    return [
        'success'    => true,
        'snippet_id' => $snippet_id,
        'action'     => 'deleted',
        'message'    => "Snippet \"$title\" (ID: $snippet_id) gelöscht.",
    ];
}
