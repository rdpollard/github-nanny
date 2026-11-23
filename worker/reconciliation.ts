import { authConfig, webhookConfigured, type Bindings } from './auth/config.ts';
import type { Fetcher } from './auth/github.ts';
import { ActionsCheckError, checkActions } from './github/actions.ts';
import { MonitoringScopeStore } from './github/scope-store.ts';
import { ControlStore } from './monitor-control.ts';
import type { ActionsCheck } from '../shared/contracts.ts';
import { deliverIdle } from './push/delivery.ts';

// Cron is a wake-up signal. D1 decides whether a scan is due, and fences any
// process that resumes after its lease expires or after an owner change.
export async function reconcileOnce(env: Bindings, options: { fetcher?: Fetcher } = {}): Promise<void> {
  const config = authConfig(env);
  if (!env.DB || !config || !webhookConfigured(env)) return;
  const configured = await new MonitoringScopeStore(env.DB).configured(env, config);
  if (!configured) return;
  const controls = new ControlStore(env.DB);
  const lease = await controls.claim(configured.key, configured.scope.revision);
  if (!lease) return;
  let requests = 0;
  let reason: string | null = null;
  let retryAt: number | undefined;
  let observation: ActionsCheck | null = null;
  try {
    observation = await checkActions(env, config, configured.accounts[0].login, { fetcher: options.fetcher, lease,
      onUsage: count => { requests = count; } });
  } catch (error) {
    reason = error instanceof ActionsCheckError ? error.reason : 'unavailable';
    retryAt = error instanceof ActionsCheckError ? error.retryAt : undefined;
    console.warn({ event: 'scheduled_actions_check_failed', reason });
  }
  await controls.finish(lease, reason, requests, retryAt);
  if (!reason && observation) await deliverIdle(env, config, observation, options.fetcher);
}
