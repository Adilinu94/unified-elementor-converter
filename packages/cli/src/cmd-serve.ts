/**
 * elconv serve — HTTP API mode (Phase 107, ported from the V4-Pipeline
 * `serve` wizard subcommand, default port 7123).
 *
 * Exposes the local pipeline over plain HTTP so other tools (or an agent
 * without shell access) can drive conversions:
 *
 *   GET  /health           → { ok, version, commands }
 *   POST /convert          → body = convert flags JSON ({ target, url|html|xml, out?, skipGuards? })
 *   POST /qa               → body = { url, refUrl?, targetScore?, maxIterations?, outputDir? }
 *
 * Uses node:http only — no framework dependency. Responses are JSON.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { optionalFlag } from './args.js';
import { cmdConvert } from './cmd-convert.js';
import { runQaPipeline } from './cmd-qa.js';

const VERSION = '1.0.0';
export const DEFAULT_SERVE_PORT = 7123;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/**
 * Create (but do not listen on) the elconv HTTP server. Exported separately
 * from cmdServe so tests can drive it on an ephemeral port.
 */
export function createElconvServer(): Server {
  return createServer(async (req, res) => {
    const url = req.url ?? '/';
    try {
      if (req.method === 'GET' && url === '/health') {
        sendJson(res, 200, {
          ok: true,
          version: VERSION,
          commands: ['GET /health', 'POST /convert', 'POST /qa'],
        });
        return;
      }

      if (req.method === 'POST' && url === '/convert') {
        const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
        if (body.target !== 'v3' && body.target !== 'v4') {
          sendJson(res, 400, { ok: false, error: '"target" must be "v3" or "v4"' });
          return;
        }
        const flags: Record<string, string | boolean> = { target: body.target };
        for (const key of ['url', 'html', 'xml', 'out'] as const) {
          if (typeof body[key] === 'string') flags[key] = body[key] as string;
        }
        if (body.skipGuards === true) flags['skip-guards'] = true;
        const exitCode = await cmdConvert(flags);
        sendJson(res, exitCode === 0 ? 200 : 422, { ok: exitCode === 0, exitCode });
        return;
      }

      if (req.method === 'POST' && url === '/qa') {
        const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
        if (typeof body.url !== 'string' || body.url.length === 0) {
          sendJson(res, 400, { ok: false, error: '"url" is required' });
          return;
        }
        const report = await runQaPipeline({
          url: body.url,
          refUrl: typeof body.refUrl === 'string' ? body.refUrl : undefined,
          targetScore: typeof body.targetScore === 'number' ? body.targetScore : undefined,
          maxIterations: typeof body.maxIterations === 'number' ? body.maxIterations : 0,
          outputDir: typeof body.outputDir === 'string' ? body.outputDir : './qa-output',
        });
        sendJson(res, 200, { ok: report.passed, report });
        return;
      }

      sendJson(res, 404, { ok: false, error: `No route: ${req.method} ${url}` });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: (err as Error).message });
    }
  });
}

export async function cmdServe(flags: Record<string, string | boolean>): Promise<number> {
  const port = Number(optionalFlag(flags, 'port') ?? DEFAULT_SERVE_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    process.stderr.write('Error: --port must be a valid TCP port\n');
    return 2;
  }

  const server = createElconvServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolvePromise());
  }).catch((err: Error) => {
    process.stderr.write(`Error: cannot listen on port ${port}: ${err.message}\n`);
    return null;
  });

  if (!server.listening) return 1;

  process.stdout.write(`\n🌐 elconv serve — listening on http://localhost:${port}\n`);
  process.stdout.write(`   GET  /health\n   POST /convert   { target, url|html|xml, out?, skipGuards? }\n   POST /qa        { url, refUrl?, targetScore?, maxIterations?, outputDir? }\n`);
  process.stdout.write(`   Press Ctrl+C to stop.\n\n`);

  // Keep the process alive until the server closes (Ctrl+C / SIGTERM).
  await new Promise<void>((resolvePromise) => {
    const shutdown = (): void => {
      server.close(() => resolvePromise());
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    server.once('close', () => resolvePromise());
  });

  return 0;
}
