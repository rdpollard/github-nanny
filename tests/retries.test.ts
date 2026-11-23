import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryTimestamp } from '../worker/github/client.ts';

test('GitHub backoff honors delta/date Retry-After and the later rate reset, ignoring invalid/past timestamps', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  assert.equal(retryTimestamp(new Headers({ 'Retry-After': '60' }), now), now + 60_000);
  assert.equal(retryTimestamp(new Headers({ 'Retry-After': 'Mon, 23 Nov 2026 12:02:00 GMT' }), now), now + 120_000);
  assert.equal(retryTimestamp(new Headers({ 'Retry-After': '60', 'X-RateLimit-Reset': String(now / 1000 + 600) }), now), now + 600_000);
  assert.equal(retryTimestamp(new Headers({ 'Retry-After': '-1', 'X-RateLimit-Reset': 'Infinity' }), now), undefined);
  assert.equal(retryTimestamp(new Headers({ 'Retry-After': 'Sun, 22 Nov 2026 12:00:00 GMT', 'X-RateLimit-Reset': '9'.repeat(30) }), now), undefined);
});
