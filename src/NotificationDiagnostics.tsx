import { useState } from 'react';
import { Button } from './components/ui/button';

const outcomes: Record<string, string> = {
  received: 'Tap reached Nanny; opening has not completed.',
  opened: 'Browser reported opening Nanny.',
  'no-window': 'Browser returned no app window; opening is not confirmed.',
  blocked: 'Browser blocked opening Nanny.',
  focused: 'An existing Nanny window was focused; navigation was not confirmed.',
  navigated: 'An existing Nanny window was focused and navigated.',
};
export function NotificationDiagnostics({ registration }: { registration: ServiceWorkerRegistration | null }) {
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function inspect() {
    if (!registration?.active) return;
    setBusy(true);
    const channel = new MessageChannel();
    try {
      const data = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The notification handler did not respond. Reload Nanny and retry; an older handler may still be active.')), 3000);
        channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data); };
        try { registration.active!.postMessage({ kind: 'notification-click-diagnostic' }, [channel.port2]); }
        catch { clearTimeout(timer); reject(new Error('The notification handler is unavailable. Reload Nanny and retry.')); }
      });
      if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 'tap-v2' || !('lastClick' in data)) {
        setResult('The expected notification handler is not active. Reload Nanny and retry.'); return;
      }
      const click = data.lastClick;
      if (!click) { setResult('Handler tap-v2 is active. No notification tap is recorded in this browser. Send a fresh test, tap its notification, then check again.'); return; }
      if (typeof click !== 'object' || !('outcome' in click) || typeof click.outcome !== 'string' || !Object.hasOwn(outcomes, click.outcome)) {
        setResult('The local tap record could not be read.'); return;
      }
      const when = 'at' in click && typeof click.at === 'string' && Number.isFinite(Date.parse(click.at)) ? new Date(click.at).toLocaleString() : 'time unavailable';
      const error = 'error' in click && ['InvalidAccessError', 'NotAllowedError', 'TypeError', 'SecurityError', 'OtherError'].includes(String(click.error)) ? ` (${String(click.error)})` : '';
      setResult(`Handler tap-v2. Last tap ${when}: ${outcomes[click.outcome]}${error}`);
    } catch (error) { setResult(error instanceof Error ? error.message : 'The notification handler is unavailable.'); }
    finally { channel.port1.close(); channel.port2.close(); setBusy(false); }
  }
  return <section aria-label="Notification tap diagnostics" className="space-y-3 border-t pt-4">
    <h2 className="font-semibold">Notification taps on this browser</h2>
    <p className="text-sm text-muted-foreground">If a notification opens nothing, open Settings manually and check here after tapping a fresh test. Only the latest tap time and browser outcome are kept on this device; nothing is sent to the server. No record can also mean local storage is unavailable.</p>
    <Button variant="outline" disabled={busy || !registration?.active} onClick={() => { void inspect(); }}>Check notification taps</Button>
    {result && <p role="status">{result}</p>}
  </section>;
}
