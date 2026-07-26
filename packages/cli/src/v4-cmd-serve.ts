// @ts-nocheck — Migration-Marker: Typen werden schrittweise verfeinert (UMBAUPLAN Step 14)
/**
 * src/cli/cmd-serve.js — Pipeline HTTP API
 *
 * Sprint 6: Extracted from wizard.js runServe().
 * Starts a minimal HTTP server for pipeline-as-a-service.
 */

/**
 * Gibt die Hilfe fuer dieses Subcommand aus.
 */
export function printHelp() {
  console.log(`wizard.js serve — Pipeline HTTP-API starten

USAGE:
  node wizard.js serve [--port <PORT>]

OPTIONS:
  --port <PORT>   HTTP-Port (default: 7123)

ENDPOINTS:
  GET  /health         Health-Check (version, uptime)
  POST /build          Build starten (body: { url, postId })
  GET  /builds/:id     Build-Status abrufen

BEISPIEL:
  node wizard.js serve
  node wizard.js serve --port 3099
`);
}

/**
 * Startet einen HTTP-Server für Pipeline-API-Calls.
 *
 * @param {number} [port=7123] - HTTP-Port
 * @returns {Promise<void>}
 */
export async function runServe(port = 7123) {
  try { var http = await import('node:http'); } catch { var http = await import('http'); }
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/health') {
      res.end(JSON.stringify({ status: 'ok', version: '0.10.0', uptime: process.uptime() }));
    } else if (req.method === 'POST' && req.url === '/build') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const { url, postId } = JSON.parse(body || '{}');
        const buildId = `build-${Date.now()}`;
        res.writeHead(202);
        res.end(JSON.stringify({ status: 'accepted', buildId, url, postId }));
      });
    } else if (req.method === 'GET' && req.url?.startsWith('/builds/')) {
      res.end(JSON.stringify({ status: 'completed', logs: [] }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found', endpoints: ['GET /health', 'POST /build', 'GET /builds/:id'] }));
    }
  });
  server.listen(port, () => process.stderr.write(`[serve] Pipeline-API auf http://localhost:${port}\n`));
}
