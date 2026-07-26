<?php
/**
 * Novamira Ability: adrians-add-alt-text
 *
 * Ability-Name:  novamira-adrianv2/adrians-add-alt-text-from-context
 * Version:       1.0.0
 *
 * Findet alle Elementor-Bild-Elemente einer Seite ohne Alt-Text und
 * generiert kontextbasierte Alt-Texte aus dem Dateinamen / dem umgebenden
 * Text. Setzt den Alt-Text direkt im WordPress Attachment-Meta.
 *
 * Parameter:
 *   {
 *     "post_id":       int   PFLICHT  - WordPress Post-ID
 *     "apply":         bool  optional - false = Dry-Run (default: true)
 *     "max_length":    int   optional - Max Alt-Text-Länge in Zeichen (default: 125)
 *     "overwrite":     bool  optional - Bestehende Alt-Texte überschreiben (default: false)
 *   }
 *
 * Rückgabe:
 *   { "success": bool, "post_id": int, "scanned": int, "updated": int,
 *     "skipped": int, "dry_run": bool, "results": [...] }
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

require_once __DIR__ . '/adrians-helpers.php';

function novamira_adrians_add_alt_text_from_context( array $params ): array {

    if ( ! current_user_can( 'manage_options' ) ) {
        return [ 'success' => false, 'message' => 'Fehlende Berechtigung: manage_options erforderlich.' ];
    }

    $post_id    = absint( $params['post_id']    ?? 0 );
    $apply      = isset( $params['apply'] ) ? (bool) $params['apply'] : true;
    $max_length = absint( $params['max_length'] ?? 125 );
    $overwrite  = (bool) ( $params['overwrite'] ?? false );

    if ( ! $post_id ) {
        return [ 'success' => false, 'message' => 'Parameter "post_id" fehlt oder ungültig.' ];
    }

    if ( ! get_post( $post_id ) ) {
        return [ 'success' => false, 'message' => "Post $post_id nicht gefunden." ];
    }

    $elementor_data = get_post_meta( $post_id, '_elementor_data', true );
    if ( empty( $elementor_data ) ) {
        return [
            'success' => true,
            'post_id' => $post_id,
            'message' => 'Kein Elementor-Inhalt gefunden.',
            'scanned' => 0, 'updated' => 0, 'skipped' => 0,
        ];
    }

    $tree = is_string( $elementor_data ) ? json_decode( $elementor_data, true ) : $elementor_data;
    if ( ! is_array( $tree ) ) {
        return [ 'success' => false, 'message' => 'Elementor-Daten konnten nicht geparst werden.' ];
    }

    $results = [];
    $scanned = 0;
    $updated = 0;
    $skipped = 0;

    novamira_walk_elementor_tree( $tree, function( $element ) use (
        &$results, &$scanned, &$updated, &$skipped,
        $apply, $max_length, $overwrite
    ) {
        $type = $element['elType'] ?? $element['widgetType'] ?? '';
        if ( ! in_array( $type, [ 'e-image', 'image' ], true ) ) {
            return;
        }

        $scanned++;
        $settings   = $element['settings'] ?? [];
        $image_data = $settings['image'] ?? $settings['background_image'] ?? null;

        // Attachment-ID aus V4 Format holen
        $attachment_id = null;
        if ( is_array( $image_data ) ) {
            $attachment_id = absint( $image_data['id'] ?? $image_data['value']['id'] ?? 0 ) ?: null;
        }

        if ( ! $attachment_id ) {
            $skipped++;
            return; // Kein Attachment → externe URL, nicht patchbar
        }

        $existing_alt = get_post_meta( $attachment_id, '_wp_attachment_image_alt', true );
        if ( ! empty( $existing_alt ) && ! $overwrite ) {
            $skipped++;
            $results[] = [
                'attachment_id' => $attachment_id,
                'action'        => 'skipped',
                'reason'        => 'Alt-Text bereits vorhanden: ' . esc_html( substr( $existing_alt, 0, 60 ) ),
            ];
            return;
        }

        // Kontextbasierter Alt-Text aus Dateiname generieren
        $attachment  = get_post( $attachment_id );
        $filename    = $attachment ? pathinfo( get_attached_file( $attachment_id ), PATHINFO_FILENAME ) : '';
        $title       = $attachment ? $attachment->post_title : '';
        $description = $attachment ? $attachment->post_content : '';

        // Priorität: Beschreibung > Titel > Dateiname
        $alt_source = $description ?: $title ?: $filename;

        // Bereinigen: Bindestriche/Unterstriche → Leerzeichen, CamelCase → Wörter
        $alt_text = preg_replace( '/[-_]/', ' ', $alt_source );
        $alt_text = preg_replace( '/([a-z])([A-Z])/', '$1 $2', $alt_text );
        $alt_text = trim( preg_replace( '/\s+/', ' ', $alt_text ) );
        $alt_text = ucfirst( strtolower( $alt_text ) );

        if ( strlen( $alt_text ) > $max_length ) {
            $alt_text = substr( $alt_text, 0, $max_length - 1 ) . '…';
        }

        if ( empty( $alt_text ) ) {
            $skipped++;
            return;
        }

        if ( $apply ) {
            update_post_meta( $attachment_id, '_wp_attachment_image_alt', sanitize_text_field( $alt_text ) );
            $updated++;
        }

        $results[] = [
            'attachment_id' => $attachment_id,
            'action'        => $apply ? ( $existing_alt ? 'overwritten' : 'added' ) : 'dry_run',
            'alt_text'      => $alt_text,
            'source'        => $description ? 'description' : ( $title ? 'title' : 'filename' ),
        ];
    } );

    return [
        'success' => true,
        'post_id' => $post_id,
        'dry_run' => ! $apply,
        'scanned' => $scanned,
        'updated' => $updated,
        'skipped' => $skipped,
        'results' => $results,
        'message' => $apply
            ? "$updated Alt-Texte gesetzt, $skipped übersprungen ($scanned Bilder gescannt)."
            : "Dry-Run: $updated Alt-Texte würden gesetzt werden ($scanned Bilder gescannt).",
    ];
}
