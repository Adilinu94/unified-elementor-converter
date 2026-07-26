<?php
/**
 * Novamira Ability: adrians-batch-inject-snippets
 *
 * Ability-Name:  novamira/adrians-batch-inject-snippets
 * Version:       1.0.0
 *
 * Legt mehrere WPCode-Snippets in einem MCP-Call an (oder aktualisiert sie).
 * Reduziert MCP-Roundtrips für Animations-Builds von N auf 1.
 *
 * Parameter:
 *   {
 *     "snippets": [
 *       { ...selbe Parameter wie novamira/adrians-code-injector... },
 *       ...
 *     ]
 *   }
 *   Limit: max. 20 Snippets pro Batch-Call.
 *
 * Rückgabe:
 *   { "success": bool, "total": int, "failed": int,
 *     "results": [ { "snippet_id": int, "title": str, "action": str, ... } ] }
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

require_once __DIR__ . '/adrians-helpers.php';
require_once __DIR__ . '/adrians-code-injector.php';

function novamira_adrians_batch_inject_snippets( array $params ): array {

    /* ── Capability-Check (Defense-in-Depth) ─────────────────────────── */
    if ( ! current_user_can( 'manage_options' ) ) {
        return [ 'success' => false, 'message' => 'Fehlende Berechtigung: manage_options erforderlich.' ];
    }

    /* ── Parameter validieren ────────────────────────────────────────── */
    if ( empty( $params['snippets'] ) || ! is_array( $params['snippets'] ) ) {
        return [ 'success' => false, 'message' => 'Parameter "snippets" (Array) fehlt oder leer.' ];
    }

    $snippets = $params['snippets'];

    if ( count( $snippets ) > 20 ) {
        return [
            'success' => false,
            'message' => 'Batch-Limit überschritten: max. 20 Snippets pro Call (erhalten: ' . count( $snippets ) . ').',
        ];
    }

    /* ── Jeden Snippet über den Einzel-Handler verarbeiten ───────────── */
    $results = [];
    foreach ( $snippets as $snippet_params ) {
        $results[] = novamira_adrians_code_injector( (array) $snippet_params );
    }

    $failed = array_filter( $results, static fn( $r ) => empty( $r['success'] ) );

    return [
        'success' => empty( $failed ),
        'total'   => count( $results ),
        'failed'  => count( $failed ),
        'results' => $results,
    ];
}
