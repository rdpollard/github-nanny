import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webhookRoute } from '../worker/github/webhook.ts';

const env = {
  APP_ORIGIN: 'https://nanny.example', GITHUB_OWNER_ID: '27035363', GITHUB_CLIENT_ID: 'Iv1_test_client',
  GITHUB_CLIENT_SECRET: 'test-client-secret-only-for-fixtures', SESSION_SECRET: 'A'.repeat(43),
  GITHUB_WEBHOOK_SECRET: 'fixture-webhook-secret-is-not-a-real-credential',
};
const headers = {
  'Content-Type': 'application/json', 'X-GitHub-Delivery': '00000000-0000-0000-0000-000000000001',
  'X-GitHub-Event': 'workflow_run', 'X-Hub-Signature-256': `sha256=${'0'.repeat(64)}`,
};

test('webhook size limits reject declared and streamed overflow before signature verification or storage', async () => {
  // Call the actual handler without an HTTP transport: a real early 413 can
  // close an upload and make a client raise EPIPE instead of exposing status.
  const declared = new Request('https://nanny.example/api/webhooks/github', {
    method: 'POST', headers: { ...headers, 'Content-Length': '1048577' }, body: '{}',
  });
  assert.equal((await webhookRoute(declared, env))!.status, 413);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(1_048_577)); },
    cancel() { cancelled = true; },
  });
  const streamed = new Request('https://nanny.example/api/webhooks/github', {
    method: 'POST', headers, body: stream, duplex: 'half',
  } as RequestInit);
  assert.equal((await webhookRoute(streamed, env))!.status, 413);
  assert.equal(cancelled, true);
});
