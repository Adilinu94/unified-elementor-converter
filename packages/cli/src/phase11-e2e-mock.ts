/**
 * Phase 11 — E2E Mock Layer
 *
 * Provides deterministic mock implementations of network-dependent operations
 * so the pipeline can be exercised in CI / offline environments without
 * hitting real WordPress targets.
 *
 * Plan reference: §15.3 E2E Mock Layer
 */

import type { CloneMode } from "./phase11-cli-flags.js";

export interface MockE2EConfig {
  baseUrl: string;
  target: string;
  mode: CloneMode;
  offline: boolean;
}

export interface MockSection {
  id: string;
  selector: string;
  tagName: string;
  textPreview: string;
}

export interface MockV3Output {
  mode: CloneMode;
  sections: MockSection[];
  generatedAt: string;
}

export interface MockHandshakeResult {
  success: boolean;
  sessionId: string;
  negotiatedAbilities: string[];
  reason?: string;
}

export interface MockPushResult {
  pageId: string;
  pushedSections: number;
  pushedAt: string;
}

const MOCK_HTML_OFFLINE = `<!DOCTYPE html>
<html lang="en">
<head><title>Example Domain</title></head>
<body>
  <header class="site-header"><h1>Welcome to example.com</h1></header>
  <section class="hero"><p>Mock hero content for offline E2E</p></section>
  <section class="features"><p>Mock features</p></section>
  <footer class="site-footer"><p>Mock footer</p></footer>
</body>
</html>`;

const MOCK_HTML_ONLINE = MOCK_HTML_OFFLINE.replace(
  "Mock hero content for offline E2E",
  "Mock hero content (online)"
);

export async function mockFetchHtml(url: string, offline: boolean): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 1));
  return offline ? MOCK_HTML_OFFLINE : MOCK_HTML_ONLINE.replace("example.com", new URL(url).hostname);
}

export async function mockDiscoverInternalLinks(
  baseUrl: string,
  offline: boolean
): Promise<string[]> {
  await new Promise((resolve) => setTimeout(resolve, 1));
  const origin = new URL(baseUrl).origin;
  if (offline) {
    return [`${origin}/about`, `${origin}/contact`];
  }
  return [`${origin}/about`, `${origin}/contact`, `${origin}/services`];
}

export async function mockExtractSections(
  html: string,
  baseUrl: string,
  offline: boolean
): Promise<MockSection[]> {
  await new Promise((resolve) => setTimeout(resolve, 1));
  const sectionMatches = html.match(/<(?:section|header|footer)[^>]*class="([^"]+)"/g) ?? [];
  return sectionMatches.map((match, idx) => {
    const classMatch = match.match(/class="([^"]+)"/);
    const className = classMatch ? classMatch[1] : `mock-${idx}`;
    return {
      id: `mock-section-${idx}`,
      selector: `.${className}`,
      tagName: match.startsWith("<header") ? "header" : match.startsWith("<footer") ? "footer" : "section",
      textPreview: offline ? "Mock content for offline E2E" : `Mock content from ${baseUrl}`,
    };
  });
}

export async function mockBuildV3Output(
  sections: MockSection[],
  mode: CloneMode,
  offline: boolean
): Promise<MockV3Output> {
  await new Promise((resolve) => setTimeout(resolve, 1));
  return {
    mode,
    sections,
    generatedAt: new Date(offline ? 0 : Date.now()).toISOString(),
  };
}

export async function mockMcpHandshake(
  target: string,
  offline: boolean
): Promise<MockHandshakeResult> {
  await new Promise((resolve) => setTimeout(resolve, 1));
  if (offline) {
    return {
      success: true,
      sessionId: `mock-session-${target}`,
      negotiatedAbilities: ["create-page", "add-section", "add-widget", "apply-css"],
    };
  }
  return {
    success: false,
    sessionId: "",
    negotiatedAbilities: [],
    reason: "mock-online-failure",
  };
}

export async function mockPushPage(
  output: MockV3Output,
  target: string,
  offline: boolean
): Promise<MockPushResult> {
  await new Promise((resolve) => setTimeout(resolve, 1));
  if (!offline) {
    throw new Error("mockPushPage: online mode requires real MCP adapter");
  }
  return {
    pageId: `mock-page-${target}-${output.sections.length}`,
    pushedSections: output.sections.length,
    pushedAt: new Date(0).toISOString(),
  };
}