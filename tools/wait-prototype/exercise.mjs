import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttp } from './server.mjs';

const { http, url } = await startHttp();
const client = new Client({ name: 'nanny-timing-exercise', version: '0.1.0' });
const long = process.argv.includes('--long');
const start = performance.now();
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const prepared = await client.callTool({ name: 'prepare_synthetic_wait', arguments: { requestKey: randomUUID(), delaySeconds: long ? 185 : 1 } });
  const ticketId = prepared.structuredContent.ticketId;
  let state;
  for (let calls = 1; calls <= 12; calls++) {
    const before = performance.now();
    const response = await client.callTool({ name: 'wait_for_synthetic_idle', arguments: { ticketId, maxWaitSeconds: 25 } }, undefined, { timeout: 35_000 });
    state = response.structuredContent;
    const seconds = (performance.now() - before) / 1000;
    assert.ok(seconds < 30); assert.equal(state.synthetic, true);
    console.log(JSON.stringify({ call: calls, seconds: +seconds.toFixed(2), status: state.status, elapsed: +((performance.now() - start) / 1000).toFixed(2) }));
    if (state.status !== 'pending') break;
  }
  assert.equal(state.status, 'synthetic_idle');
  if (long) assert.ok(performance.now() - start >= 180_000);
} finally {
  await client.close(); http.closeAllConnections(); await new Promise(resolve => http.close(resolve));
}
