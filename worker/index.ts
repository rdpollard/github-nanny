import { unconnectedSnapshot } from '../shared/contracts.ts';
import type { Bindings } from './auth/config.ts';
import { authRoute } from './auth/routes.ts';
import { webhookRoute } from './github/webhook.ts';
import { reconcileOnce } from './reconciliation.ts';
import { publicStatus } from './status.ts';

export default {
  async scheduled(_controller: ScheduledController, env: Bindings): Promise<void> {
    try { await reconcileOnce(env); }
    catch { console.warn({ event: 'scheduled_reconciliation_unavailable' }); throw new Error('Scheduled reconciliation unavailable'); }
  },
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
      try { return Response.json(await publicStatus(env), { headers }); }
      catch {
        console.warn({ event: 'public_status_unavailable' });
        return Response.json({ ...unconnectedSnapshot(), message: 'Actions status is unavailable. Please try again.' }, { headers });
      }
    }
    return Response.json({ error: 'Not found' }, { status: 404, headers });
  },
};
