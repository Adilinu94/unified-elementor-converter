<?php
/**
 * Novamira Ability: adrians-generate-meta-tags
 *
 * Ability-Name:  novamira-adrianv2/adrians-generate-meta-tags
 * Version:       1.0.0
 *
 * Generiert SEO Meta-Tags (Title, Description, OG-Tags) für einen WordPress-Post
 * aus dem Elementor-Seiteninhalt und setzt sie via Yoast SEO, Rank Math oder
 * direkt als Post-Meta (automatischer Plugin-Fallback).
 *
 * Parameter:
 *   {
 *     "post_id":          int     PFLICHT  - WordPress Post-ID
 *     "meta_title":       string  optional - Expliziter SEO-Titel (überschreibt Auto)
 *     "meta_description": string  optional - Explizite Meta-Beschreibung (max 160 Zeichen)
 *     "og_image_id":      int     optional - Attachment-ID für OG-Image
 *     "apply":            bool    optional - false = Dry-Run (default: true)
 *   }
 *
 * Rückgabe:
 *   { "success": bool, "post_id": int, "seo_plugin": string,
 *     "fields_set": string[], "meta_title": string, "meta_description": string,
 *     "dry_run": bool, "message": string }
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

require_once __DIR__ . '/adrians-helpers.php';

function novamira_adrians_generate_meta_tags( array $params ): array {

    if ( ! current_user_can( 'manage_options' ) ) {
        return [ 'success' => false, 'message' => 'Fehlende Berechtigung: manage_options erforderlich.' ];
    }

    $post_id     = absint( $params['post_id']     ?? 0 );
    $apply       = isset( $params['apply'] ) ? (bool) $params['apply'] : true;
    $og_image_id = absint( $params['og_image_id'] ?? 0 );

    if ( ! $post_id ) {
        return [ 'success' => false, 'message' => 'Parameter "post_id" fehlt oder ungültig.' ];
    }

    $post = get_post( $post_id );
    if ( ! $post ) {
        return [ 'success' => false, 'message' => "Post $post_id nicht gefunden." ];
    }

    // ── Meta-Titel generieren ─────────────────────────────────────────
    if ( ! empty( $params['meta_title'] ) ) {
        $meta_title = sanitize_text_field( $params['meta_title'] );
    } else {
        $site_name  = get_bloginfo( 'name' );
        $post_title = get_the_title( $post_id );
        $meta_title = $post_title . ' – ' . $site_name;
        // Auf 60 Zeichen kürzen (Google-Empfehlung)
        if ( strlen( $meta_title ) > 60 ) {
            $meta_title = substr( $post_title, 0, 60 - strlen( $site_name ) - 3 ) . '... – ' . $site_name;
        }
    }

    // ── Meta-Beschreibung generieren ──────────────────────────────────
    if ( ! empty( $params['meta_description'] ) ) {
        $meta_description = sanitize_textarea_field( $params['meta_description'] );
    } else {
        // Aus Elementor-Inhalt oder Post-Excerpt extrahieren
        $excerpt = $post->post_excerpt;
        if ( empty( $excerpt ) ) {
            $elementor_data = get_post_meta( $post_id, '_elementor_data', true );
            $excerpt        = $elementor_data
                ? novamira_extract_text_from_elementor( $elementor_data )
                : wp_strip_all_tags( $post->post_content );
        }
        $meta_description = novamira_truncate_description( $excerpt, 155 );
    }

    // ── SEO-Plugin erkennen ───────────────────────────────────────────
    $seo_plugin  = novamira_detect_seo_plugin();
    $fields_set  = [];

    if ( $apply ) {
        switch ( $seo_plugin ) {
            case 'yoast':
                update_post_meta( $post_id, '_yoast_wpseo_title',   $meta_title );
                update_post_meta( $post_id, '_yoast_wpseo_metadesc', $meta_description );
                $fields_set[] = '_yoast_wpseo_title';
                $fields_set[] = '_yoast_wpseo_metadesc';
                if ( $og_image_id ) {
                    update_post_meta( $post_id, '_yoast_wpseo_opengraph-image-id', $og_image_id );
                    $fields_set[] = '_yoast_wpseo_opengraph-image-id';
                }
                break;

            case 'rank_math':
                update_post_meta( $post_id, 'rank_math_title',       $meta_title );
                update_post_meta( $post_id, 'rank_math_description',  $meta_description );
                $fields_set[] = 'rank_math_title';
                $fields_set[] = 'rank_math_description';
                if ( $og_image_id ) {
                    update_post_meta( $post_id, 'rank_math_og_thumbnail_id', $og_image_id );
                    $fields_set[] = 'rank_math_og_thumbnail_id';
                }
                break;

            default:
                // Fallback: Standard-WP-Meta
                update_post_meta( $post_id, '_seo_meta_title',       $meta_title );
                update_post_meta( $post_id, '_seo_meta_description',  $meta_description );
                $fields_set[] = '_seo_meta_title';
                $fields_set[] = '_seo_meta_description';
                break;
        }
    }

    return [
        'success'          => true,
        'post_id'          => $post_id,
        'dry_run'          => ! $apply,
        'seo_plugin'       => $seo_plugin,
        'meta_title'       => $meta_title,
        'meta_description' => $meta_description,
        'og_image_id'      => $og_image_id ?: null,
        'fields_set'       => $fields_set,
        'message'          => $apply
            ? "Meta-Tags via $seo_plugin gesetzt: " . implode( ', ', $fields_set )
            : "Dry-Run: Meta-Tags würden via $seo_plugin gesetzt werden.",
    ];
}

function novamira_detect_seo_plugin(): string {
    if ( defined( 'WPSEO_VERSION' ) || class_exists( 'WPSEO_Options' ) ) {
        return 'yoast';
    }
    if ( class_exists( 'RankMath' ) || defined( 'RANK_MATH_VERSION' ) ) {
        return 'rank_math';
    }
    return 'none';
}

function novamira_extract_text_from_elementor( string $elementor_data_raw ): string {
    // Einfacher Text-Extraktor: sucht nach common text-prop-Patterns
    $decoded = json_decode( $elementor_data_raw, true );
    if ( ! is_array( $decoded ) ) return '';

    $texts = [];
    array_walk_recursive( $decoded, function( $val, $key ) use ( &$texts ) {
        if ( in_array( $key, [ 'editor', 'title', 'description', 'text' ], true ) && is_string( $val ) ) {
            $clean = wp_strip_all_tags( $val );
            if ( strlen( $clean ) > 20 ) {
                $texts[] = $clean;
            }
        }
    } );
    return implode( ' ', array_slice( $texts, 0, 3 ) );
}

function novamira_truncate_description( string $text, int $max ): string {
    $text = wp_strip_all_tags( $text );
    $text = preg_replace( '/\s+/', ' ', $text );
    $text = trim( $text );
    if ( strlen( $text ) <= $max ) return $text;
    $truncated = substr( $text, 0, $max );
    $last_space = strrpos( $truncated, ' ' );
    return $last_space ? substr( $truncated, 0, $last_space ) . '…' : $truncated . '…';
}
