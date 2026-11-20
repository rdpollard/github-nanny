import { unconnectedSnapshot } from '../shared/contracts.ts';
import type { Bindings } from './auth/config.ts';
import { authRoute } from './auth/routes.ts';
import { webhookRoute } from './github/webhook.ts';

// Public status awaits continuous reconciliation and activation. Owner checks
// and signed callbacks alone do not establish current global idle.
export default {
  async fetch(request: Request, env: Bindings = {}): Promise<Response> {
    const url = new URL(request.url);
    const webhook = await webhookRoute(request, env);
    if (webhook) return webhook;
    const auth = await authRoute(request, env);
    if (auth) return auth;
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET' } });
    }
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, service: 'github-nanny' }, { headers });
    }
    if (url.pathname === '/api/status') {
      return Response.json(unconnectedSnapshot(), { headers });
    }
    return Response.json({ error: 'Not found' }, { status: 404, headers });
  },
};
