/**
 * Framer MCP Bridge — Config discovery + Unframer connectivity.
 * Phase 50: Supplement to the extraction layer.
 *
 * Provides:
 * - MCP config discovery (.mcp.json, env vars)
 * - REST endpoint map for Novamira abilities
 * - Unframer bridge for getProjectXml / getNodeXml
 * - Session handshake (JSON-RPC 2.0)
 *
 * V3/V4: Input-layer, target-format-neutral.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface McpConfigResult {
  mcpUrl: string;
  authHeader: string | null;
  wpUrl: string;
  serverKey: string;
}

export interface FramerBridgeOptions {
  mcpUrl?: string;
  authHeader?: string | null;
  wpUrl?: string;
  timeout?: number;
  verbose?: boolean;
}

export interface RestEndpoint {
  url: string;
  method: 'GET' | 'POST';
  body?: Record<string, unknown>;
}

export interface UnframerProjectNode {
  id: string;
  name?: string;
  type?: string;
}

export interface UnframerProject {
  pages?: UnframerProjectNode[];
  components?: UnframerProjectNode[];
}

// ============================================================================
// REST Endpoint Map (Novamira abilities → direct REST fallback)
// ============================================================================

export const REST_ENDPOINT_MAP: Record<string, (p: Record<string, unknown>) => RestEndpoint> = {
  'novamira/elementor-set-content': (p) => ({
    url: `/wp-json/novamira/v1/elementor/set-content`,
    method: 'POST',
    body: { post_id: p.post_id, content: p.content },
  }),
  'novamira/elementor-get-content': (p) => ({
    url: `/wp-json/novamira/v1/elementor/get-content/${p.post_id}`,
    method: 'GET',
  }),
  'novamira/adrians-export-design-system': (p) => ({
    url: `/wp-json/novamira/v1/design-system/export${p.what ? `?what=${encodeURIComponent(String(p.what))}` : ''}`,
    method: 'GET',
  }),
  'novamira/adrians-media-upload': (p) => ({
    url: '/wp-json/novamira/v1/media/upload',
    method: 'POST',
    body: p,
  }),
  'novamira/adrians-batch-media-upload': (p) => ({
    url: '/wp-json/novamira/v1/media/batch-upload',
    method: 'POST',
    body: p,
  }),
  'novamira/adrians-setup-v4-foundation': (p) => ({
    url: '/wp-json/novamira/v1/elementor/foundation',
    method: 'POST',
    body: p,
  }),
  'novamira/adrians-layout-audit': (p) => ({
    url: `/wp-json/novamira/v1/elementor/layout-audit/${p.post_id}`,
    method: 'GET',
  }),
  'novamira/adrians-visual-qa': (p) => ({
    url: `/wp-json/novamira/v1/elementor/visual-qa/${p.post_id}`,
    method: 'GET',
  }),
  'novamira/adrians-responsive-audit': (p) => ({
    url: `/wp-json/novamira/v1/elementor/responsive-audit/${p.post_id}`,
    method: 'GET',
  }),
  'novamira/adrians-variable-audit': (p) => ({
    url: '/wp-json/novamira/v1/elementor/variable-audit',
    method: 'POST',
    body: p,
  }),
  'novamira/adrians-batch-create-variables': (p) => ({
    url: '/wp-json/novamira/v1/elementor/variables/batch',
    method: 'POST',
    body: p,
  }),
  'novamira/adrians-add-global-class-variant': (p) => ({
    url: '/wp-json/novamira/v1/elementor/class-variant',
    method: 'POST',
    body: p,
  }),
  'novamira/adrians-apply-variable-to-class': (p) => ({
    url: '/wp-json/novamira/v1/elementor/class-variable',
    method: 'POST',
    body: p,
  }),
};

// ============================================================================
// Config Discovery
// ============================================================================

/**
 * Find MCP config file from standard locations.
 */
export function findMcpConfig(projectRoot?: string): string | null {
  const root = projectRoot ?? process.cwd();

  const candidates = [
    process.env.MCP_CONFIG_PATH || null,
    join(root, '.mcp.json'),
    join(root, 'mcp-server-config.json'),
    join(root, '..', 'novamira-adrianv2', 'mcp-server-config.json'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Parse MCP config file and extract connection details.
 */
export function parseMcpConfig(configPath: string): McpConfigResult {
  const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  const servers = (raw.mcpServers || raw.servers || {}) as Record<string, Record<string, unknown>>;

  if (Object.keys(servers).length === 0) {
    throw new Error(`No mcpServers found in ${configPath}`);
  }

  // Prefer novamira server
  const key = Object.keys(servers).find((k) =>
    k.toLowerCase().includes('novamira'),
  ) || Object.keys(servers)[0];

  const srv = servers[key];

  // Resolve URL
  let mcpUrl: string | undefined = (srv.url || srv.endpoint) as string | undefined;

  if (!mcpUrl && srv.env && (srv.env as Record<string, string>).WP_API_URL) {
    mcpUrl = (srv.env as Record<string, string>).WP_API_URL;
  }
  if (!mcpUrl) {
    mcpUrl = process.env.WP_API_URL || undefined;
  }
  if (!mcpUrl) {
    throw new Error(
      `No URL for server "${key}". Expected: "url" in config, env.WP_API_URL, or WP_API_URL env var.`,
    );
  }

  // Resolve auth
  let authHeader: string | null = null;

  if (srv.headers && (srv.headers as Record<string, string>).Authorization) {
    authHeader = (srv.headers as Record<string, string>).Authorization;
  } else if (srv.env && (srv.env as Record<string, string>).WP_API_USERNAME && (srv.env as Record<string, string>).WP_API_PASSWORD) {
    const b64 = Buffer.from(
      `${(srv.env as Record<string, string>).WP_API_USERNAME}:${(srv.env as Record<string, string>).WP_API_PASSWORD}`,
    ).toString('base64');
    authHeader = `Basic ${b64}`;
  } else if (srv.wp_user && srv.wp_app_password) {
    const b64 = Buffer.from(`${srv.wp_user}:${srv.wp_app_password}`).toString('base64');
    authHeader = `Basic ${b64}`;
  } else if (srv.apiKey || srv.api_key) {
    authHeader = `Bearer ${srv.apiKey || srv.api_key}`;
  } else if (process.env.WP_API_USERNAME && process.env.WP_API_PASSWORD) {
    const b64 = Buffer.from(`${process.env.WP_API_USERNAME}:${process.env.WP_API_PASSWORD}`).toString('base64');
    authHeader = `Basic ${b64}`;
  } else if (process.env.NOVAMIRA_API_KEY) {
    authHeader = `Bearer ${process.env.NOVAMIRA_API_KEY}`;
  }

  const wpUrl = (srv.wp_url ||
    (srv.env ? (srv.env as Record<string, string>).WP_URL : null) ||
    mcpUrl.replace(/\/wp-json\/mcp\/.*$/, '')) as string;

  return { mcpUrl, authHeader, wpUrl, serverKey: key };
}

// ============================================================================
// Framer Bridge Class
// ============================================================================

/**
 * Framer MCP Bridge — handles Unframer connectivity and config discovery.
 * Lightweight wrapper that delegates actual HTTP to the McpAdapter.
 */
export class FramerBridge {
  readonly mcpUrl: string;
  readonly wpUrl: string;
  readonly timeout: number;
  readonly verbose: boolean;

  private _authHeader: string | null;
  private _sessionId: string | null = null;

  constructor(options: FramerBridgeOptions = {}) {
    this.mcpUrl = options.mcpUrl || '';
    this._authHeader = options.authHeader || null;
    this.wpUrl = options.wpUrl || '';
    this.timeout = options.timeout || 120000;
    this.verbose = options.verbose || false;
  }

  /**
   * Create a FramerBridge from config file discovery.
   */
  static fromConfig(projectRoot?: string): FramerBridge {
    const configPath = findMcpConfig(projectRoot);
    if (!configPath) {
      throw new Error('No MCP config found. Set MCP_CONFIG_PATH or create .mcp.json');
    }
    const config = parseMcpConfig(configPath);
    return new FramerBridge({
      mcpUrl: config.mcpUrl,
      authHeader: config.authHeader,
      wpUrl: config.wpUrl,
    });
  }

  /**
   * Get the REST endpoint for a given ability name.
   */
  getRestEndpoint(ability: string, params: Record<string, unknown>): RestEndpoint | null {
    const mapper = REST_ENDPOINT_MAP[ability];
    if (!mapper) return null;
    return mapper(params);
  }

  /**
   * Build full URL for a REST endpoint.
   */
  buildRestUrl(endpoint: RestEndpoint): string {
    return `${this.wpUrl}${endpoint.url}`;
  }

  /**
   * Get auth headers for requests.
   */
  getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this._authHeader) {
      headers['Authorization'] = this._authHeader;
    }
    if (this._sessionId) {
      headers['Mcp-Session-Id'] = this._sessionId;
    }
    return headers;
  }

  /**
   * Set session ID from handshake response.
   */
  setSession(sessionId: string): void {
    this._sessionId = sessionId;
  }

  /**
   * Check if bridge has valid configuration.
   */
  isConfigured(): boolean {
    return this.mcpUrl.length > 0;
  }

  /**
   * Get connection info for diagnostics.
   */
  getDiagnostics(): { mcpUrl: string; wpUrl: string; hasAuth: boolean; hasSession: boolean } {
    return {
      mcpUrl: this.mcpUrl,
      wpUrl: this.wpUrl,
      hasAuth: this._authHeader !== null,
      hasSession: this._sessionId !== null,
    };
  }
}

// ============================================================================
// Unframer Helpers
// ============================================================================

/**
 * Build the MCP call payload for getProjectXml.
 */
export function buildGetProjectXmlCall(): { tool: string; params: Record<string, unknown> } {
  return {
    tool: 'unframer/getProjectXml',
    params: {},
  };
}

/**
 * Build the MCP call payload for getNodeXml.
 */
export function buildGetNodeXmlCall(nodeId: string): { tool: string; params: Record<string, unknown> } {
  return {
    tool: 'unframer/getNodeXml',
    params: { nodeId },
  };
}

/**
 * Parse project structure from getProjectXml response.
 */
export function parseProjectStructure(response: unknown): UnframerProject {
  const data = response as Record<string, unknown>;

  const pages: UnframerProjectNode[] = [];
  const components: UnframerProjectNode[] = [];

  if (Array.isArray(data.pages)) {
    for (const p of data.pages) {
      const page = p as Record<string, unknown>;
      pages.push({ id: String(page.id), name: page.name as string | undefined, type: 'page' });
    }
  }

  if (Array.isArray(data.components)) {
    for (const c of data.components) {
      const comp = c as Record<string, unknown>;
      components.push({ id: String(comp.id), name: comp.name as string | undefined, type: 'component' });
    }
  }

  return { pages, components };
}

/**
 * Resolve concurrency from environment.
 */
export function resolveConcurrency(): number {
  const explicit = parseInt(process.env.MCP_CONCURRENCY || '', 10);
  if (!isNaN(explicit) && explicit > 0) return explicit;

  const profile = process.env.MCP_CONCURRENCY_PROFILE || 'medium';
  const presets: Record<string, number> = { low: 2, medium: 5, high: 10 };
  return presets[profile] || 5;
}
