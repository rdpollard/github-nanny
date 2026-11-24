import { useCallback, useEffect, useState } from 'react';
import { Activity, Bell, CheckCircle, Clock, ExternalLink, GitBranch, GitFork, Loader, Moon, RefreshCw, Sun, ZoomIn, ZoomOut } from 'lucide-react';
import type { DashboardSnapshot } from '../shared/contracts';
import { unconnectedSnapshot } from '../shared/contracts';
import { demoSnapshot } from './demo';
import { StatusBadge } from './components/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Button } from './components/ui/button';
import { notificationRunUrl } from './lib/notification-link';

function readPreference(key: string): boolean {
  try { return localStorage.getItem(key) === 'true'; } catch { return false; }
}

export function App() {
  const demo = new URLSearchParams(location.search).get('demo') === '1';
  const [alertRunUrl, setAlertRunUrl] = useState(() => notificationRunUrl(location.hash));
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(() => demo ? demoSnapshot() : unconnectedSnapshot());
  const [loading, setLoading] = useState(false);
  const [compact, setCompact] = useState(() => readPreference('nanny-compact'));
  const [dark, setDark] = useState(() => readPreference('nanny-dark'));
  const [filter, setFilter] = useState<'all' | 'running' | 'queued'>('all');
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const update = () => setAlertRunUrl(notificationRunUrl(location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('nanny-dark', String(dark));
      localStorage.setItem('nanny-compact', String(compact));
    } catch { /* Preferences remain usable without browser storage. */ }
  }, [dark, compact]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (demo) return;
    setLoading(true);
    try {
      const response = await fetch('/api/status', { cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('Unable to check GitHub status.');
      const data: DashboardSnapshot = await response.json();
      if (!signal?.aborted) setSnapshot(data);
    } catch {
      if (!signal?.aborted) setSnapshot(previous => ({
        ...previous, phase: 'unknown', runs: [], checkedAt: null,
        message: 'Status could not be refreshed. Current activity cannot be confirmed.',
      }));
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [demo]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const interval = setInterval(() => { void refresh(controller.signal); }, 30_000);
    const online = () => { setOffline(false); void refresh(controller.signal); };
    const offline = () => setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      controller.abort(); clearInterval(interval);
      window.removeEventListener('online', online); window.removeEventListener('offline', offline);
    };
  }, [refresh]);

  const currentRuns = !offline && snapshot.phase !== 'unknown' ? snapshot.runs : [];
  const running = currentRuns.filter(run => run.status === 'in_progress').length;
  const waiting = currentRuns.length - running;
  const visible = currentRuns.filter(run => filter === 'all' || (filter === 'running' ? run.status === 'in_progress' : run.status !== 'in_progress'));
  const repositories = [...new Set(visible.map(run => run.repository))];
  const phase = offline ? 'unknown' : snapshot.phase;

  return (
    <main className={`mx-auto max-w-6xl ${compact ? 'p-4' : 'p-4 sm:p-8'}`}>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-slate-900 p-3 text-white dark:bg-slate-700"><GitFork aria-hidden="true" className="size-6" /></div>
          <div><h1 className="text-xl font-bold sm:text-2xl">GitHub Nanny</h1><p className="text-sm text-muted-foreground">A little less checking. A little more doing.</p></div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label={compact ? 'Expand layout' : 'Compact layout'} aria-pressed={compact} onClick={() => setCompact(!compact)}>{compact ? <ZoomOut /> : <ZoomIn />}</Button>
          <Button variant="ghost" size="icon" aria-label={dark ? 'Use light theme' : 'Use dark theme'} onClick={() => setDark(!dark)}>{dark ? <Sun /> : <Moon />}</Button>
          <Button variant="outline" onClick={() => { void refresh(); }} disabled={loading || demo}><RefreshCw aria-hidden="true" className={loading ? 'motion-safe:animate-spin' : ''} />Refresh</Button>
          <Button variant="outline" asChild><a href="/settings">Manage</a></Button>
        </div>
      </header>

      {demo && <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950 dark:text-amber-100"><p><strong>Demo preview.</strong> These are sample runs, not your GitHub activity.</p><a className="underline" href="/">Return to live dashboard</a></div>}

      {alertRunUrl && <section aria-label="Idle alert run" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-5">
        <div><h2 className="font-semibold">From your idle alert</h2><p className="text-sm text-muted-foreground">View the run linked by the notification. Current activity is shown below.</p></div>
        <Button variant="outline" asChild><a href={alertRunUrl} rel="noreferrer">View run on GitHub<ExternalLink aria-hidden="true" /></a></Button>
      </section>}

      <section aria-live="polite" className="mb-6 rounded-xl border bg-card p-5 sm:p-6">
        <div className="flex items-center gap-3">
          {phase === 'busy' ? <Activity aria-hidden="true" className="size-7 text-sky-600" /> : phase === 'idle' ? <CheckCircle aria-hidden="true" className="size-7 text-emerald-600" /> : <Clock aria-hidden="true" className="size-7 text-slate-500" />}
          <div><h2 className="text-xl font-bold">{phase === 'busy' ? 'GitHub is busy' : phase === 'idle' ? 'GitHub is idle' : 'Status unavailable'}</h2>
            <p className="text-sm text-muted-foreground">{offline ? 'You are offline. Connect to check current activity.' : snapshot.message ?? (phase === 'busy' ? 'We’re keeping an eye on every monitored run.' : 'All monitored Actions have finished.')}</p>
          </div>
        </div>
        {!snapshot.connected && !demo && <a href="/?demo=1" className="mt-4 inline-block text-sm font-medium text-sky-700 underline dark:text-sky-400">Preview the dashboard with sample data</a>}
      </section>

      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Filter active runs">
        {([
          { key: 'all', label: 'Active runs', count: currentRuns.length, color: 'bg-slate-700', Icon: Activity },
          { key: 'running', label: 'Running', count: running, color: 'bg-sky-600', Icon: Loader },
          { key: 'queued', label: 'Queued / waiting', count: waiting, color: 'bg-orange-600', Icon: Clock },
        ] as const).map(({ key, label, count, color, Icon }) => (
          <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)} className={`flex items-center justify-between rounded-xl border-2 p-5 text-left text-white shadow-sm transition ${color} ${filter === key ? 'border-slate-950 dark:border-white' : 'border-transparent'}`}>
            <div><p className="text-sm font-medium">{label}</p><p className="mt-1 text-3xl font-bold">{snapshot.connected && phase !== 'unknown' ? count : '—'}</p></div>
            <Icon aria-hidden="true" className="size-7 opacity-80" />
          </button>
        ))}
      </div>

      <section aria-label="Active workflow runs" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Repositories with activity</h2><span className="text-sm text-muted-foreground">{snapshot.connected ? `${snapshot.repositoryCount} repositories monitored` : 'Awaiting GitHub connection'}</span></div>
        {repositories.map(repository => (
          <Card key={repository} className={compact ? 'gap-3 py-3' : ''}>
            <CardHeader><CardTitle className="flex items-center gap-2"><GitFork aria-hidden="true" className="size-4 text-muted-foreground" />{repository}</CardTitle></CardHeader>
            <CardContent><ul className="divide-y">
              {visible.filter(run => run.repository === repository).map(run => (
                <li key={`${run.id}:${run.attempt ?? 1}`} className={`flex flex-wrap items-center justify-between gap-3 ${compact ? 'py-2' : 'py-4'}`}>
                  <div className="min-w-0"><a className="inline-flex items-center gap-2 font-medium hover:underline" href={run.url} target="_blank" rel="noopener noreferrer">{run.workflow}<ExternalLink aria-label="Opens GitHub" className="size-3 shrink-0" /></a><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><GitBranch aria-hidden="true" className="size-3" />{run.branch}{run.attempt && ` · Attempt ${run.attempt}`}</p></div>
                  <StatusBadge status={run.status} />
                </li>
              ))}
            </ul></CardContent>
          </Card>
        ))}
        {repositories.length === 0 && <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">{!snapshot.connected ? 'Your active runs will appear here after GitHub is connected.' : phase === 'unknown' ? 'Current activity cannot be confirmed.' : visible.length === 0 && snapshot.runs.length > 0 ? 'No runs match this filter.' : 'No active runs.'}</div>}
      </section>

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-xs text-muted-foreground">
        <p>{snapshot.checkedAt ? `Last checked ${new Date(snapshot.checkedAt).toLocaleTimeString()}` : 'No live check completed yet'}</p>
        <p className="flex items-center gap-1"><Bell aria-hidden="true" className="size-3" />{snapshot.alertsEnabled ? 'Idle push alerts enabled' : 'Idle push alerts are off'}</p>
      </footer>
    </main>
  );
}
