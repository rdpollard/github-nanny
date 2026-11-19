import { test } from 'node:test';
import assert from 'node:assert/strict';
import api from '../worker/index.ts';

test('unconfigured monitor reports unknown, not idle, with no caching', async () => {
  const response = await api.fetch(new Request('https://example.com/api/status'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const data = await response.json();
  assert.equal(data.phase, 'unknown');
  assert.equal(data.connected, false);
});

test('API rejects unsupported mutations and unknown routes', async () => {
  assert.equal((await api.fetch(new Request('https://example.com/api/status', { method: 'POST' }))).status, 405);
  assert.equal((await api.fetch(new Request('https://example.com/api/other'))).status, 404);
});
