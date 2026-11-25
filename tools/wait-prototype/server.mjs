import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createStore } from './store.mjs';

const requestContext = new AsyncLocalStorage();

export function createMcp(store) {
  const server = new McpServer({ name: 'nanny-synthetic-wait', version: '0.1.0' });
  const output = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
  function tool(name, description, schema, run) {
    server.registerTool(name, { description: `SYNTHETIC ONLY: ${description}`, inputSchema: schema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }, async (input, extra) => {
      try { return output(await run(input, extra)); }
      catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
    });
  }
  const ticket = z.object({ ticketId: z.uuid() }).strict();
  tool('prepare_synthetic_wait', 'Create a fake event after 0–240 seconds; never observes GitHub.',
    z.object({ requestKey: z.uuid(), delaySeconds: z.number().int().min(0).max(240).default(185) }).strict(),
    input => store.prepare(input.requestKey, input.delaySeconds));
  tool('get_synthetic_wait', 'Read a fake ticket without waiting.', ticket, input => store.get(input.ticketId));
  tool('cancel_synthetic_wait', 'Cancel a fake wait; ordinary manual input remains valid.', ticket, input => store.cancel(input.ticketId));
  tool('wait_for_synthetic_idle', 'Wait at most 25 seconds for a fake event. Not proof of GitHub idle or CI success.',
    ticket.extend({ maxWaitSeconds: z.number().int().min(0).max(25).default(25) }),
    (input, extra) => store.wait(input.ticketId, input.maxWaitSeconds,
      requestContext.getStore() ? AbortSignal.any([extra.signal, requestContext.getStore()]) : extra.signal));
  return server;
}

export async function startHttp(port = 0) {
  const store = createStore();
  const sessions = new Map();
  let initializing = 0;
  const http = createServer(async (req, res) => {
    // Deliberately loopback only. No remote/public deployment or OAuth claims.
    const address = http.address();
    if (req.headers.host !== `127.0.0.1:${address.port}` || req.headers.origin || req.url !== '/mcp') {
      res.writeHead(403); res.end(); return;
    }
    if (req.method === 'DELETE') {
      const session = sessions.get(req.headers['mcp-session-id']);
      if (!session) { res.writeHead(404); res.end(); return; }
      await session.transport.handleRequest(req, res);
      await session.server.close(); return;
    }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST, DELETE' }); res.end(); return; }
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    let session;
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16_384) { res.writeHead(413); res.end(); return; }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const sessionId = req.headers['mcp-session-id'];
      session = sessions.get(sessionId);
      if (!session) {
        if (sessionId || body.method !== 'initialize') { res.writeHead(404); res.end(); return; }
        if (sessions.size + initializing >= 8) { res.writeHead(429); res.end(); return; }
        initializing++;
        const server = createMcp(store);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true,
          onsessioninitialized: id => { initializing--; session.reserved = false; sessions.set(id, session); } });
        session = { server, transport, lastUsed: Date.now(), reserved: true };
        transport.onclose = () => sessions.delete(transport.sessionId);
        await server.connect(transport);
      }
      session.lastUsed = Date.now();
      await requestContext.run(abort.signal, () => session.transport.handleRequest(req, res, body));
    } catch {
      if (!res.headersSent) res.writeHead(400);
      if (!res.writableEnded) res.end();
    } finally {
      if (session?.reserved) { initializing--; session.reserved = false; await session.server.close(); }
    }
  });
  const cleanup = setInterval(() => {
    for (const [id, session] of sessions) if (Date.now() - session.lastUsed > 15 * 60_000) {
      sessions.delete(id); void session.server.close();
    }
  }, 60_000);
  cleanup.unref();
  http.on('close', () => { clearInterval(cleanup); for (const s of sessions.values()) void s.server.close(); sessions.clear(); });
  http.maxConnections = 16;
  http.requestTimeout = 35_000; http.headersTimeout = 10_000;
  await new Promise((resolve, reject) => { http.once('error', reject); http.listen(port, '127.0.0.1', resolve); });
  return { http, url: `http://127.0.0.1:${http.address().port}/mcp` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--http')) {
    const port = Number(process.env.NANNY_PROTOTYPE_PORT ?? 4317);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid prototype port');
    const { http, url } = await startHttp(port);
    console.error(`Synthetic Nanny MCP listening on ${url}; loopback only, no GitHub connection.`);
    for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => http.close());
  } else {
    await createMcp(createStore()).connect(new StdioServerTransport());
  }
}
