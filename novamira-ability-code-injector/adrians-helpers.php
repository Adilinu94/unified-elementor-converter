<?php
/**
 * Novamira Code-Injector: Gemeinsame Hilfsfunktionen
 *
 * Geteilt von:
 *   - adrians-code-injector.php
 *   - adrians-delete-snippet.php
 *   - adrians-list-snippets.php
 *   - adrians-get-snippet.php (zukünftig)
 *
 * Lade-Reihenfolge: Diese Datei MUSS vor allen anderen Ability-Files
 * geladen werden. Alle Ability-Files im code-injector-Ordner rufen
 * require_once __DIR__ . '/adrians-helpers.php'; am Anfang auf.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Sucht ein WPCode-Snippet nach exaktem Titel.
 *
 * Durchsucht alle Post-Status (publish, draft, private, trash),
 * damit bestehende Snippets auch nach Deaktivierung gefunden werden.
 *
 * @param  string $title  Exakter Snippet-Titel (bereits sanitized)
 * @return int            Post-ID oder 0 wenn nicht gefunden
 */
if ( ! function_exists( 'novamira_find_wpcode_snippet' ) ) {
    function novamira_find_wpcode_snippet( string $title ): int {
        $q = new WP_Query( [
            'post_type'      => 'wpcode_snippet',
            'post_status'    => [ 'publish', 'draft', 'private', 'trash' ],
            'title'          => $title,
            'posts_per_page' => 1,
            'fields'         => 'ids',
            'no_found_rows'  => true,
        ] );
        return ! empty( $q->posts ) ? (int) $q->posts[0] : 0;
    }
}

/**
 * Traversiert einen Elementor-Element-Tree rekursiv.
 * Wird von adrians-fix-color-contrast, adrians-add-alt-text und weiteren Abilities genutzt.
 *
 * @param array    $tree     Elementor-Element-Array (Top-Level oder elements[])
 * @param callable $callback Wird für jedes Element aufgerufen, erhält das Element-Array
 */
if ( ! function_exists( 'novamira_walk_elementor_tree' ) ) {
    function novamira_walk_elementor_tree( array $tree, callable $callback ): void {
        foreach ( $tree as $element ) {
            if ( ! is_array( $element ) ) {
                continue;
            }
            $callback( $element );
            if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
                novamira_walk_elementor_tree( $element['elements'], $callback );
            }
        }
    }
}
