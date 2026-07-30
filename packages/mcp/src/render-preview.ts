/**
 * Render Preview MCP Ability (Phase 61).
 *
 * Defines the MCP ability for rendering a single element/section in a
 * temporary post and returning HTML + computed styles for verification.
 *
 * @module mcp/render-preview
 */

// ============================================================================
// Types
// ============================================================================

export interface RenderPreviewInput {
  /** V3 element JSON to render. */
  elementJson: string;
  /** Optional: existing post ID to use as temp container. */
  tempPostId?: number;
  /** Viewport width for rendering. */
  viewportWidth?: number;
}

export interface RenderPreviewOutput {
  html: string;
  computedStyles: Record<string, Record<string, string>>;
  boundingBoxes: Record<string, { x: number; y: number; width: number; height: number }>;
  renderTimeMs: number;
  success: boolean;
  error?: string;
}

export interface RenderPreviewAbility {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ============================================================================
// Ability definition
// ============================================================================

export const RENDER_PREVIEW_ABILITY: RenderPreviewAbility = {
  name: 'novamira/elementor-render-preview',
  description: 'Renders a single Elementor element/section in a temporary post and returns the rendered HTML with computed styles.',
  inputSchema: {
    type: 'object',
    properties: {
      element_json: {
        type: 'string',
        description: 'JSON string of the Elementor element(s) to render',
      },
      temp_post_id: {
        type: 'number',
        description: 'Optional existing draft post ID to use as render container',
      },
      viewport_width: {
        type: 'number',
        description: 'Viewport width for rendering (default: 1440)',
        default: 1440,
      },
    },
    required: ['element_json'],
  },
};

// ============================================================================
// Call builders
// ============================================================================

/**
 * Build the MCP call to render a preview of element(s).
 */
export function buildRenderPreviewCall(input: RenderPreviewInput): {
  ability: string;
  params: Record<string, unknown>;
} {
  return {
    ability: RENDER_PREVIEW_ABILITY.name,
    params: {
      element_json: input.elementJson,
      temp_post_id: input.tempPostId,
      viewport_width: input.viewportWidth ?? 1440,
    },
  };
}

/**
 * Build the full render-preview workflow:
 * 1. Create temp post
 * 2. Inject element
 * 3. Render + collect computed styles
 * 4. Delete temp post
 */
export function buildRenderPreviewWorkflow(input: RenderPreviewInput): Array<{
  step: number;
  ability: string;
  params: Record<string, unknown>;
  description: string;
}> {
  return [
    {
      step: 1,
      ability: 'novamira-adrianv2/execute-php',
      params: {
        code: `
          $post_id = wp_insert_post([
            'post_title' => 'elconv-render-preview-' . time(),
            'post_status' => 'draft',
            'post_type' => 'page',
          ]);
          return ['post_id' => $post_id];
        `,
        description: 'Create temp draft post for render preview',
      },
      description: 'Create temporary post',
    },
    {
      step: 2,
      ability: 'novamira-adrianv2/set-page-content',
      params: {
        post_id: '__TEMP_POST_ID__',
        content: input.elementJson,
      },
      description: 'Inject element into temp post',
    },
    {
      step: 3,
      ability: 'browser/execute-js',
      params: {
        url: '__TEMP_POST_URL__',
        code: `
          const els = document.querySelectorAll('[data-id]');
          const result = { styles: {}, boxes: {} };
          for (const el of els) {
            const id = el.getAttribute('data-id');
            const cs = window.getComputedStyle(el);
            result.styles[id] = Object.fromEntries(Array.from(cs).map(p => [p, cs.getPropertyValue(p)]));
            const rect = el.getBoundingClientRect();
            result.boxes[id] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          }
          return result;
        `,
      },
      description: 'Collect computed styles from rendered preview',
    },
    {
      step: 4,
      ability: 'novamira-adrianv2/execute-php',
      params: {
        code: `wp_delete_post(__TEMP_POST_ID__, true); return ['deleted' => true];`,
        description: 'Delete temp preview post',
      },
      description: 'Cleanup temp post',
    },
  ];
}

/**
 * Parse render preview response into structured output.
 */
export function parseRenderPreviewResponse(raw: unknown): RenderPreviewOutput {
  const data = raw as Record<string, unknown> | null;
  if (!data) {
    return {
      html: '',
      computedStyles: {},
      boundingBoxes: {},
      renderTimeMs: 0,
      success: false,
      error: 'No response from render preview',
    };
  }

  return {
    html: (data['html'] as string) ?? '',
    computedStyles: (data['styles'] as Record<string, Record<string, string>>) ?? {},
    boundingBoxes: (data['boxes'] as Record<string, { x: number; y: number; width: number; height: number }>) ?? {},
    renderTimeMs: (data['renderTimeMs'] as number) ?? 0,
    success: true,
  };
}
