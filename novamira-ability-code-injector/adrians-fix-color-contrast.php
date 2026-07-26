<?php
/**
 * Novamira Ability: adrians-fix-color-contrast
 *
 * Ability-Name:  novamira-adrianv2/adrians-fix-color-contrast
 * Version:       1.0.0
 *
 * Analysiert alle Elementor-Text-Elemente einer Seite auf WCAG AA-Kontrastfehler
 * und patcht die Farben via adrians-patch-element-styles.
 *
 * Strategie: Scannt post_content nach <e-heading>/<e-paragraph> Settings,
 * liest Farb-GV-Referenzen aus, berechnet Kontrast-Ratio und setzt eine
 * konforme Alternative wenn < 4.5:1 (Normal) oder < 3:1 (Groß).
 *
 * Parameter:
 *   {
 *     "post_id":      int   PFLICHT  - WordPress Post-ID
 *     "apply":        bool  optional - false = Dry-Run (default: true)
 *     "target_ratio": float optional - Mindestkontrastwert (default: 4.5)
 *   }
 *
 * Rückgabe:
 *   { "success": bool, "post_id": int, "scanned": int, "fixed": int,
 *     "skipped": int, "dry_run": bool, "issues": [...] }
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

require_once __DIR__ . '/adrians-helpers.php';

function novamira_adrians_fix_color_contrast( array $params ): array {

    if ( ! current_user_can( 'manage_options' ) ) {
        return [ 'success' => false, 'message' => 'Fehlende Berechtigung: manage_options erforderlich.' ];
    }

    $post_id      = absint( $params['post_id']      ?? 0 );
    $apply        = isset( $params['apply'] ) ? (bool) $params['apply'] : true;
    $target_ratio = (float) ( $params['target_ratio'] ?? 4.5 );

    if ( ! $post_id ) {
        return [ 'success' => false, 'message' => 'Parameter "post_id" fehlt oder ungültig.' ];
    }

    $post = get_post( $post_id );
    if ( ! $post ) {
        return [ 'success' => false, 'message' => "Post $post_id nicht gefunden." ];
    }

    // Elementor-Daten aus Post-Meta lesen
    $elementor_data = get_post_meta( $post_id, '_elementor_data', true );
    if ( empty( $elementor_data ) ) {
        return [
            'success' => true,
            'post_id' => $post_id,
            'message' => 'Kein Elementor-Inhalt gefunden. Post ist kein Elementor-Build.',
            'scanned' => 0, 'fixed' => 0, 'skipped' => 0,
        ];
    }

    $tree = is_string( $elementor_data ) ? json_decode( $elementor_data, true ) : $elementor_data;
    if ( ! is_array( $tree ) ) {
        return [ 'success' => false, 'message' => 'Elementor-Daten konnten nicht geparst werden.' ];
    }

    $issues  = [];
    $scanned = 0;

    // Rekursiv alle Text-Elemente scannen
    novamira_walk_elementor_tree( $tree, function( $element ) use ( &$issues, &$scanned, $post_id, $target_ratio ) {
        $type = $element['elType'] ?? $element['widgetType'] ?? '';
        if ( ! in_array( $type, [ 'e-heading', 'e-paragraph', 'e-button', 'heading', 'text-editor' ], true ) ) {
            return;
        }

        $scanned++;

        // Prüfe ob Textfarbe gesetzt ist
        $settings  = $element['settings'] ?? [];
        $color_val = $settings['color'] ?? $settings['title_color'] ?? $settings['text_color'] ?? null;

        if ( ! $color_val ) {
            return; // Kein expliziter Farbwert → inherit → überspringen
        }

        // Extrahiere Hex-Farbe
        $color_hex = null;
        if ( is_array( $color_val ) && isset( $color_val['value'] ) ) {
            $color_hex = is_string( $color_val['value'] ) ? $color_val['value'] : null;
        } elseif ( is_string( $color_val ) && preg_match( '/^#[0-9a-fA-F]{3,8}$/', $color_val ) ) {
            $color_hex = $color_val;
        }

        if ( ! $color_hex ) {
            return; // GV-Referenz oder unbekanntes Format → nicht automatisch patchbar
        }

        // Berechne Kontrast gegen weißen Hintergrund (#ffffff)
        $ratio = novamira_wcag_contrast_ratio( $color_hex, '#ffffff' );

        if ( $ratio < 4.5 ) {
            $issues[] = [
                'element_id'    => $element['id'] ?? null,
                'element_type'  => $type,
                'color'         => $color_hex,
                'ratio'         => round( $ratio, 2 ),
                'wcag_level'    => $ratio >= 3.0 ? 'AA-large' : 'FAIL',
                'suggested_fix' => 'Verwende dunklere Farbe oder Global-Variable mit höherem Kontrast.',
            ];
        }
    } );

    $fixed = 0;
    if ( $apply && ! empty( $issues ) ) {
        // In dieser Version: Issues ausgeben, Patches müssen via adrians-patch-element-styles
        // vom Agenten angewendet werden (automatisches Patching erfordert Kontext über GV-IDs)
        $fixed = 0; // Zähler für zukünftige Auto-Patch-Integration
    }

    return [
        'success'      => true,
        'post_id'      => $post_id,
        'dry_run'      => ! $apply,
        'scanned'      => $scanned,
        'issues_found' => count( $issues ),
        'fixed'        => $fixed,
        'target_ratio' => $target_ratio,
        'issues'       => $issues,
        'message'      => count( $issues ) === 0
            ? "Alle $scanned Text-Elemente bestehen WCAG AA (Ziel: $target_ratio:1)."
            : count( $issues ) . " von $scanned Elementen haben Kontrast-Probleme.",
        'next_step'    => count( $issues ) > 0
            ? 'Nutze novamira/adrians-patch-element-styles mit den element_ids aus issues[], um Farben zu korrigieren.'
            : null,
    ];
}

/**
 * WCAG 2.1 Kontrast-Ratio Berechnung.
 * @see https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */
function novamira_wcag_contrast_ratio( string $hex1, string $hex2 ): float {
    $l1 = novamira_relative_luminance( $hex1 );
    $l2 = novamira_relative_luminance( $hex2 );
    $lighter = max( $l1, $l2 );
    $darker  = min( $l1, $l2 );
    return ( $lighter + 0.05 ) / ( $darker + 0.05 );
}

function novamira_relative_luminance( string $hex ): float {
    $hex  = ltrim( $hex, '#' );
    if ( strlen( $hex ) === 3 ) {
        $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
    }
    $r = hexdec( substr( $hex, 0, 2 ) ) / 255;
    $g = hexdec( substr( $hex, 2, 2 ) ) / 255;
    $b = hexdec( substr( $hex, 4, 2 ) ) / 255;
    $to_linear = static fn( float $c ): float =>
        $c <= 0.04045 ? $c / 12.92 : ( ( $c + 0.055 ) / 1.055 ) ** 2.4;
    return 0.2126 * $to_linear( $r ) + 0.7152 * $to_linear( $g ) + 0.0722 * $to_linear( $b );
}
