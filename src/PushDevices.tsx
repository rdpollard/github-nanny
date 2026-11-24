import { useEffect, useState } from 'react';
import { NotificationDiagnostics } from './NotificationDiagnostics';
import type { AlertSettings, PushSettings } from '../shared/contracts';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';

function publicKey(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
}

export function PushDevices({ refreshKey = 0 }: { refreshKey?: number }) {
  const [settings, setSettings] = useState<PushSettings | null>(null);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('This browser');
  const [alerts, setAlerts] = useState<AlertSettings | null>(null);
  const supported = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    if (supported) void navigator.serviceWorker.ready.then(value => { if (!controller.signal.aborted) setRegistration(value); });
    return () => controller.abort();
  }, [supported, refreshKey]);

  async function request<T = Record<string, unknown>>(method: string, path = '/api/admin/push', value?: object, signal?: AbortSignal): Promise<T> {
    const response = await fetch(path, { method, cache: 'no-store', credentials: 'same-origin', signal,
      ...(value ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) } : {}) });
    const data: unknown = await response.json();
    const error = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'Push settings are unavailable.';
    if (!response.ok) throw new Error(response.status === 401 ? 'Sign in again to manage push devices.' : error);
    return data as T;
  }
  async function load(signal?: AbortSignal) {
    setBusy(true); setError(null);
    try {
      const [value, alertValue] = await Promise.all([request<PushSettings>('GET', undefined, undefined, signal), request<AlertSettings>('GET', '/api/admin/alerts', undefined, signal)]);
      if (!signal?.aborted) { setSettings(value); setAlerts(alertValue); }
    }
    catch (error) { if (!signal?.aborted) { setSettings(null); setError(error instanceof Error ? error.message : 'Push settings are unavailable.'); } }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  async function enable() {
    if (!registration || !settings?.applicationServerKey) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      // Invoke permission immediately from the button gesture, before network
      // requests or any other awaited browser operation.
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notifications were not allowed. Change this site’s browser notification permission before retrying.');
      const key = publicKey(settings.applicationServerKey);
      let subscription = await registration.pushManager.getSubscription();
      const previous = subscription?.options.applicationServerKey;
      if (subscription && (!previous || previous.byteLength !== key.length || new Uint8Array(previous).some((v, i) => v !== key[i]))) {
        if (!await subscription.unsubscribe()) throw new Error('The old browser subscription could not be removed. Please retry.');
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await request('POST', undefined, { label, subscription: subscription.toJSON() });
      await load();
      setMessage('Browser registered. Send a test below and confirm this device displays it.');
    } catch (error) { setError(error instanceof Error ? error.message : 'This browser could not be registered.'); }
    finally { setBusy(false); }
  }
  async function change(id: string, test: boolean) {
    setBusy(true); setError(null); setMessage(null);
    try {
      await request(test ? 'POST' : 'DELETE', test ? '/api/admin/push/test' : '/api/admin/push', { id });
      await load();
      setMessage(test ? 'The push service accepted the test. Confirm that this device displayed it.' : 'Device removed. Browser notification permission is managed separately.');
    } catch (error) {
      await load();
      setError(error instanceof Error ? error.message : 'The device could not be updated.');
    } finally { setBusy(false); }
  }
  async function manageAlerts(enable: boolean) {
    setBusy(true); setError(null); setMessage(null);
    try {
      await request(enable ? 'POST' : 'DELETE', '/api/admin/alerts');
      await load();
      setMessage(enable ? 'Idle alerts enabled. After observed activity, a fresh confirmed idle period sends one alert to each registered device.' : 'Idle alerts disabled. Automatic Actions checks continue.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Idle alerts could not be updated.'); }
    finally { setBusy(false); }
  }
  return <Card className="mt-6">
    <CardHeader><CardTitle>Push devices</CardTitle><CardDescription>Register each browser while signed in and verify a test notification, then enable idle alerts below.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {!supported && <p>This browser does not support Web Push here. On iPhone or iPad, add Nanny to the Home Screen and open the installed app (iOS 16.4 or newer).</p>}
      {settings && !settings.configured && <p>Server push setup is pending.</p>}
      {supported && settings?.configured && !registration && <p>Waiting for the service worker. Reload this page if it does not become ready.</p>}
      <label className="block space-y-2"><span className="text-sm font-medium">Device name</span><input className="block w-full rounded-md border bg-background p-2" value={label} onChange={event => setLabel(event.target.value)} maxLength={60} disabled={busy} /></label>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => { void enable(); }} disabled={busy || !supported || !settings?.configured || !registration || !label.trim()}>Register this browser</Button>
        <Button variant="outline" onClick={() => { void load(); }} disabled={busy}>Reload push devices</Button>
      </div>
      {busy && <p role="status">Loading or updating push devices…</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {settings?.devices.length === 0 && <p>No push devices registered.</p>}
      {!!settings?.devices.length && <ul aria-label="Registered push devices" className="space-y-3">
        {settings.devices.map(device => <li key={device.id} className="space-y-3 rounded-lg border p-3">
          <p className="break-all font-medium">{device.label}</p>
          <p className="text-sm text-muted-foreground">Registered {new Date(device.createdAt).toLocaleString()}.{!device.ready && ' Server keys changed; remove this registration and register the browser again.'}{device.expiresAt && ` Subscription expires ${new Date(device.expiresAt).toLocaleString()}.`}</p>
          {device.lastTestAt && <p className="text-sm">Last test {new Date(device.lastTestAt).toLocaleString()}: {device.lastResult === 'accepted' ? 'accepted by push service; device display needs confirmation' : device.lastResult || 'result not confirmed'}.</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { void change(device.id, true); }} disabled={busy || !device.ready || Date.parse(device.testNotBefore) > Date.now()}>Send test to {device.label}</Button>
            <Button variant="outline" onClick={() => { void change(device.id, false); }} disabled={busy}>Remove {device.label}</Button>
          </div>
        </li>)}
      </ul>}
      {supported && <NotificationDiagnostics registration={registration} />}
      <section aria-label="Idle alert controls" className="space-y-3 border-t pt-4">
        <h2 className="font-semibold">Automatic idle alerts</h2>
        {alerts && <>
          <p role="status">{alerts.enabled ? 'Idle alerts are enabled.' : 'Idle alerts are off.'}</p>
          <p className="text-sm text-muted-foreground">Ready devices: {alerts.deviceCount}. Pending deliveries: {alerts.pendingDevices}. Recent delivery issues: {alerts.deliveryIssues}.</p>
          {!alerts.monitoring && <p>Start automatic Actions checks before enabling alerts.</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { void manageAlerts(true); }} disabled={busy || alerts.enabled || !alerts.configured || !alerts.monitoring || alerts.deviceCount === 0}>Enable idle alerts</Button>
            <Button variant="outline" onClick={() => { void manageAlerts(false); }} disabled={busy}>Disable idle alerts</Button>
          </div>
        </>}
        <p className="text-sm text-muted-foreground">The first quiet check stays silent. After activity ends, confirmed idle sends one notification per device with a GitHub run link. Pausing checks or changing scope turns alerts off. Background and lock-screen banners depend on browser and phone settings.</p>
      </section>
      <p className="text-sm text-muted-foreground">Tests are limited to once per minute per device. Reload after waiting to retry. Push-service acceptance does not guarantee display; browser and operating-system settings affect delivery. Removing a device stops future sends from Nanny.</p>
    </CardContent>
  </Card>;
}
