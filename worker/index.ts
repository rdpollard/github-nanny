import { unconnectedSnapshot } from '../shared/contracts.ts';

// Live ingestion and authenticated setup are the next milestone. Never report
// idle just because the scaffold does not have a GitHub connection yet.
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
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
