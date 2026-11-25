import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createStore } from './store.mjs';
import { startHttp } from './server.mjs';

const call = async (client, name, args, options) => {
  const r = await client.callTool({ name, arguments: args }, undefined, options);
  assert.ok(!r.isError, JSON.stringify(r)); return r.structuredContent;
};

test('pending is distinct from synthetic idle; replay has stable evidence and preparation is idempotent', async () => {
  let clock = 0; const store = createStore({ now: () => clock }); const key = randomUUID();
  const first = store.prepare(key, 10);
  assert.equal(store.prepare(key, 10).ticketId, first.ticketId);
  assert.throws(() => store.prepare(key, 11), /Conflicting/);
  assert.equal((await store.wait(first.ticketId, 0)).status, 'pending');
  clock = 10_000;
  const ready = await store.wait(first.ticketId, 0);
  assert.equal(ready.status, 'synthetic_idle'); assert.equal(ready.synthetic, true);
  assert.equal(store.get(first.ticketId).eventId, ready.eventId);
  clock = 900_000; assert.equal(store.get(first.ticketId).status, 'expired');
});

test('manual cancellation interrupts an active wait; late completion cannot win', async () => {
  const store = createStore(); const t = store.prepare(randomUUID(), 30);
  const waiting = store.wait(t.ticketId, 25);
  await assert.rejects(store.wait(t.ticketId, 0), /already active/);
  store.cancel(t.ticketId);
  assert.equal((await waiting).status, 'cancelled');
  assert.equal(store.cancel(t.ticketId).status, 'cancelled');
  assert.equal((await store.wait(t.ticketId, 0)).eventId, null);
});

test('transport interruption releases the lease and budgets and limits are finite', async () => {
  const store = createStore(); const t = store.prepare(randomUUID(), 30);
  const abort = new AbortController(); const waiting = store.wait(t.ticketId, 25, abort.signal);
  abort.abort(); assert.equal((await waiting).status, 'interrupted');
  for (let n = 1; n < 40; n++) await store.wait(t.ticketId, 0);
  await assert.rejects(store.wait(t.ticketId, 0), /budget/);
  for (let n = 1; n < 8; n++) store.prepare(randomUUID(), 30);
  assert.throws(() => store.prepare(randomUUID(), 30), /limit/);
});

test('stdio negotiates real MCP and keeps protocol stdout clean', { timeout: 10_000 }, async () => {
  const client = new Client({ name: 'nanny-stdio-check', version: '0.1.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
    assert.equal((await client.listTools()).tools.length, 4);
    const t = await call(client, 'prepare_synthetic_wait', { requestKey: randomUUID(), delaySeconds: 0 });
    assert.equal((await call(client, 'wait_for_synthetic_idle', { ticketId: t.ticketId })).status, 'synthetic_idle');
    const manual = await call(client, 'prepare_synthetic_wait', { requestKey: randomUUID(), delaySeconds: 30 });
    const waiting = call(client, 'wait_for_synthetic_idle', { ticketId: manual.ticketId });
    await delay(30); await call(client, 'cancel_synthetic_wait', { ticketId: manual.ticketId });
    assert.equal((await waiting).status, 'cancelled');
    const invalid = await client.callTool({ name: 'prepare_synthetic_wait', arguments: { requestKey: randomUUID(), delaySeconds: 0, githubToken: 'fixture-not-a-secret' } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); }
});

test('HTTP reconnect, real 1-second event, cancellation and request guards', { timeout: 10_000 }, async () => {
  const { http, url } = await startHttp();
  const clients = [];
  const connect = async () => {
    const c = new Client({ name: 'nanny-http-check', version: '0.1.0' }); clients.push(c);
    await c.connect(new StreamableHTTPClientTransport(new URL(url))); return c;
  };
  try {
    let client = await connect();
    const t = await call(client, 'prepare_synthetic_wait', { requestKey: randomUUID(), delaySeconds: 1 });
    const before = performance.now();
    const event = await call(client, 'wait_for_synthetic_idle', { ticketId: t.ticketId, maxWaitSeconds: 25 });
    assert.ok(performance.now() - before >= 850); assert.equal(event.status, 'synthetic_idle');
    await client.close(); client = await connect();
    assert.equal((await call(client, 'get_synthetic_wait', { ticketId: t.ticketId })).eventId, event.eventId);
    const manual = await call(client, 'prepare_synthetic_wait', { requestKey: randomUUID(), delaySeconds: 30 });
    const waiting = call(client, 'wait_for_synthetic_idle', { ticketId: manual.ticketId });
    await delay(30); await call(client, 'cancel_synthetic_wait', { ticketId: manual.ticketId });
    assert.equal((await waiting).status, 'cancelled');
    const interrupted = await call(client, 'prepare_synthetic_wait', { requestKey: randomUUID(), delaySeconds: 30 });
    const controller = new AbortController();
    const cancelledRequest = call(client, 'wait_for_synthetic_idle', { ticketId: interrupted.ticketId }, { signal: controller.signal });
    await delay(30); controller.abort(); await assert.rejects(cancelledRequest);
    await delay(50);
    assert.equal((await call(client, 'wait_for_synthetic_idle', { ticketId: interrupted.ticketId, maxWaitSeconds: 0 })).status, 'pending');
    assert.equal((await fetch(url, { method: 'POST', headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const wrongHost = await new Promise((resolve, reject) => {
      const req = request(url, { method: 'POST', headers: { Host: 'untrusted.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(wrongHost, 403);
    assert.equal((await fetch(url)).status, 405);
    assert.equal((await fetch(url, { method: 'POST', body: 'x'.repeat(17_000) })).status, 413);
  } finally { for (const c of clients) await c.close(); http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); }
});
