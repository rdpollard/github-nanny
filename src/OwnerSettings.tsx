import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Lock, LogOut } from 'lucide-react';
import { ACTIONS_CHECK_MESSAGES, DISCOVERY_MESSAGES, SIGN_IN_MESSAGES, type ActionsCheck, type MonitoringControl, type OwnerSession, type RepositoryAccessReport, type SavedMonitoringScope, type SignInOutcome } from '../shared/contracts';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { StatusBadge } from './components/StatusBadge';
import { PushDevices } from './PushDevices';

export function OwnerSettings() {
  const [session, setSession] = useState<OwnerSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [checking, setChecking] = useState(false);
  const [discovery, setDiscovery] = useState<RepositoryAccessReport | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [scope, setScope] = useState<SavedMonitoringScope | null>(null);
  const [scopeBusy, setScopeBusy] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [actions, setActions] = useState<ActionsCheck | null>(null);
  const [actionsBusy, setActionsBusy] = useState(false);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const [control, setControl] = useState<MonitoringControl | null>(null);
  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [outcome] = useState<SignInOutcome | null>(() => {
    const value = new URLSearchParams(location.search).get('sign_in');
    return value && Object.hasOwn(SIGN_IN_MESSAGES, value) ? value as SignInOutcome : null;
  });
  // A caller can edit the URL. Confirm the session before displaying success.
  const notice = outcome && (outcome !== 'success' || session?.authenticated) ? SIGN_IN_MESSAGES[outcome] : undefined;

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/auth/session', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Session unavailable');
        const data: OwnerSession = await response.json();
        if (!controller.signal.aborted) setSession(data);
      }).catch(() => {
        if (!controller.signal.aborted) setError('Unable to load connection settings. Please reload.');
      });
    // Keep authorization outcomes out of copied URLs and subsequent referrers.
    if (location.search) history.replaceState(null, '', '/settings');
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!session?.authenticated) { setScope(null); setScopeError(null); setControl(null); return; }
    const controller = new AbortController();
    void manageScope('GET', controller.signal);
    return () => controller.abort();
  }, [session?.authenticated]);

  async function manageScope(method: 'GET' | 'POST' | 'DELETE', signal?: AbortSignal) {
    setScopeBusy(true);
    setScope(null);
    setScopeError(null);
    setActions(null);
    setActionsError(null);
    try {
      const response = await fetch('/api/admin/monitoring', { method, cache: 'no-store', credentials: 'same-origin', signal });
      if (!response.ok) {
        const data: { reason?: string } = await response.json();
        if (!signal?.aborted) setScopeError(response.status === 401 ? 'Sign in again before managing the saved scope.'
          : data.reason === 'conflict' ? 'The saved scope changed in another request. Reload it before trying again.'
          : data.reason === 'incomplete' ? 'A complete, nonempty public repository scope could not be verified. Nothing was saved.'
          : 'The saved scope is unavailable. Reload it or try again.');
        return;
      }
      const data: SavedMonitoringScope = await response.json();
      if (!signal?.aborted) { setScope(data); await manageControl('GET', signal); }
    } catch {
      if (!signal?.aborted) setScopeError('The saved scope is unavailable. Reload it or try again.');
    } finally { if (!signal?.aborted) setScopeBusy(false); }
  }

  async function manageControl(method: 'GET' | 'POST' | 'DELETE', signal?: AbortSignal) {
    setControlBusy(true);
    setControlError(null);
    setControl(null);
    try {
      const response = await fetch('/api/admin/reconciliation', { method, cache: 'no-store', credentials: 'same-origin', signal });
      if (!response.ok) {
        if (!signal?.aborted) setControlError(response.status === 401 ? 'Sign in again before managing automatic checks.'
          : 'Automatic checks could not be updated or loaded. Check webhook setup and verify the saved public scope, then reload.');
        return;
      }
      const data: MonitoringControl = await response.json();
      if (!signal?.aborted) setControl(data);
      if (method === 'POST' && !signal?.aborted) {
        const response = await fetch('/api/admin/monitoring', { cache: 'no-store', credentials: 'same-origin', signal });
        if (response.ok) setScope(await response.json());
        else setScope(null);
        setActions(null);
      }
    } catch { if (!signal?.aborted) setControlError('Automatic check settings are unavailable. Please reload.'); }
    finally { if (!signal?.aborted) setControlBusy(false); }
  }

  async function checkActionsNow() {
    setActionsBusy(true);
    setActions(null);
    setActionsError(null);
    try {
      const response = await fetch('/api/admin/actions', { method: 'POST', cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) {
        const data: { reason?: string } = await response.json();
        const reason = data.reason;
        setActionsError(response.status === 401 ? 'Sign in again before checking Actions.'
          : typeof reason === 'string' && Object.hasOwn(ACTIONS_CHECK_MESSAGES, reason)
            ? ACTIONS_CHECK_MESSAGES[reason as keyof typeof ACTIONS_CHECK_MESSAGES] : ACTIONS_CHECK_MESSAGES.unavailable);
        if (reason === 'not_prepared' || reason === 'scope_changed' || reason === 'conflict') setScope(null);
        return;
      }
      setActions(await response.json());
    } catch { setActionsError(ACTIONS_CHECK_MESSAGES.unavailable); }
    finally { setActionsBusy(false); }
  }

  async function signOut(allDevices = false) {
    setSigningOut(true);
    setError(null);
    try {
      const response = await fetch(allDevices ? '/api/auth/logout-all' : '/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Sign-out unavailable');
      setDiscovery(null);
      setDiscoveryError(null);
      setActions(null);
      setActionsError(null);
      setSession(previous => previous && { ...previous, authenticated: false, owner: null, installationUrl: null });
    } catch { setError('Sign-out could not be completed. Please try again.'); }
    finally { setSigningOut(false); }
  }

  async function checkRepositories() {
    setChecking(true);
    setDiscovery(null);
    setDiscoveryError(null);
    try {
      const response = await fetch('/api/admin/repositories', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) {
        const data: unknown = await response.json();
        const reason = data && typeof data === 'object' && 'reason' in data ? data.reason : null;
        setDiscoveryError(typeof reason === 'string' && Object.hasOwn(DISCOVERY_MESSAGES, reason)
          ? DISCOVERY_MESSAGES[reason as keyof typeof DISCOVERY_MESSAGES]
          : response.status === 401 ? 'Sign in again before checking repository access.' : DISCOVERY_MESSAGES.unavailable);
        return;
      }
      setDiscovery(await response.json());
    } catch { setDiscoveryError(DISCOVERY_MESSAGES.unavailable); }
    finally { setChecking(false); }
  }

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-8">
      <a href="/" className="mb-8 inline-flex items-center gap-2 text-sm hover:underline"><ArrowLeft aria-hidden="true" className="size-4" />Back to dashboard</a>
      <h1 className="mb-2 text-2xl font-bold">GitHub connection</h1>
      <p className="mb-6 text-muted-foreground">The dashboard is public. Only its configured owner can manage the connection.</p>
      {notice && <p role="status" className="mb-4 rounded-lg border bg-card p-4">{notice}</p>}
      {error && <p role="alert" className="mb-4 rounded-lg border border-red-400 p-4">{error}</p>}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Lock aria-hidden="true" className="size-4" />Owner access</CardTitle><CardDescription>Sign in with the GitHub account that owns this dashboard.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {!session && !error && <p>Loading connection settings…</p>}
          {session && !session.configured && <>
            <p>GitHub sign-in setup is pending.</p>
            <a className="text-sky-700 underline dark:text-sky-400" href="https://github.com/rdpollard/github-nanny/blob/main/docs/github-connection.md" target="_blank" rel="noopener noreferrer">Open the owner setup guide</a>
          </>}
          {session?.configured && !session.authenticated && <Button asChild><a href="/api/auth/login">Sign in with GitHub</a></Button>}
          {session?.authenticated && session.owner && <>
            <p>Signed in as <strong>{session.owner.login}</strong>.</p>
            {session.installationUrl && <Button asChild><a href={session.installationUrl} target="_blank" rel="noopener noreferrer">Install or manage GitHub App<ExternalLink aria-hidden="true" /></a></Button>}
            <p className="text-sm text-muted-foreground">Owner sign-in is ready. Manage public repository checks below.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => { void signOut(); }} disabled={signingOut || checking || scopeBusy || actionsBusy || controlBusy}><LogOut aria-hidden="true" />{signingOut ? 'Signing out…' : 'Sign out'}</Button>
              <Button variant="outline" onClick={() => { void signOut(true); }} disabled={signingOut || checking || scopeBusy || actionsBusy || controlBusy}>Sign out all devices</Button>
            </div>
          </>}
        </CardContent>
      </Card>
      {session?.authenticated && <Card className="mt-6">
        <CardHeader><CardTitle>Repository access</CardTitle><CardDescription>Verify the configured personal and organization installations when you choose. This does not start Actions monitoring.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={() => { void checkRepositories(); }} disabled={checking || signingOut || scopeBusy || actionsBusy || controlBusy}>{checking ? 'Checking repository access…' : 'Check repository access'}</Button>
          {discoveryError && <p role="alert">{discoveryError}</p>}
          {discovery && <>
            <p role={discovery.complete ? 'status' : 'alert'}>{discovery.complete
              ? `Configured repository access verified: ${discovery.repositoryCount} repositories (${discovery.repositories.length} public, ${discovery.privateRepositoryCount} private).`
              : 'Repository access is incomplete. Some configured accounts or required repositories need attention.'}</p>
            <p className="text-sm text-muted-foreground">Checked {new Date(discovery.checkedAt).toLocaleString()}. This covers only the accounts configured below; other collaborator repositories are not verified. Private repository names are not displayed.</p>
            {discovery.accounts.map(check => <section key={check.account.id} className="space-y-3 rounded-lg border p-3">
              <h2 className="font-semibold">{check.account.login} ({check.account.kind === 'User' ? 'Personal account' : 'Organization'})</h2>
              {check.reason && <p role="alert">{DISCOVERY_MESSAGES[check.reason]}</p>}
              {check.missingRepositories.length > 0 && <p className="break-all">Required public repositories not verified: {check.missingRepositories.map(name => `${check.account.login}/${name}`).join(', ')}.</p>}
              {check.inventory && <>
                <p>Repository access verified for {check.inventory.owner}: {check.inventory.repositoryCount} repositories ({check.inventory.repositories.length} public, {check.inventory.privateRepositoryCount} private).</p>
                <p className="text-sm text-muted-foreground">{check.inventory.selection === 'all' ? 'All repositories are selected for this installation.' : check.account.requiresAll
                  ? 'Only selected repositories are accessible. Choose All repositories in the installation to cover this account.'
                  : 'Selected repositories are accessible. Every configured required repository must be included.'}</p>
                {check.inventory.repositories.length > 0 && <ul aria-label={`Accessible public repositories for ${check.account.login}`} className="max-h-72 space-y-2 overflow-auto">
                  {check.inventory.repositories.map(repository => <li key={repository.id}><a className="break-all text-sky-700 underline dark:text-sky-400" href={repository.url} target="_blank" rel="noopener noreferrer">{repository.name}</a></li>)}
                </ul>}
              </>}
            </section>)}
          </>}
        </CardContent>
      </Card>}
      {session?.authenticated && <Card className="mt-6">
        <CardHeader><CardTitle>Public monitoring scope</CardTitle><CardDescription>Save all public repositories from the configured installations after a fresh access check. Private repositories and their activity are excluded. Saving pauses automatic checks and clears prior monitoring confidence.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { void manageScope('POST'); }} disabled={scopeBusy || checking || signingOut || actionsBusy || controlBusy}>Save public scope</Button>
            <Button variant="outline" onClick={() => { void manageScope('GET'); }} disabled={scopeBusy || checking || signingOut || actionsBusy || controlBusy}>Reload saved scope</Button>
            <Button variant="outline" onClick={() => { void manageScope('DELETE'); }} disabled={scopeBusy || checking || signingOut || actionsBusy || controlBusy}>Disconnect saved scope</Button>
          </div>
          {scopeBusy && <p role="status">Loading or updating saved scope…</p>}
          {scopeError && <p role="alert">{scopeError}</p>}
          {scope && <>
            <p role="status">{scope.prepared ? `Public scope saved: ${scope.repositories.length} repositories.` : 'No public monitoring scope is saved.'}</p>
            {scope.verifiedAt && <p className="text-sm text-muted-foreground">Verified {new Date(scope.verifiedAt).toLocaleString()}. Saved access does not guarantee current access.</p>}
            {scope.repositories.length > 0 && <ul aria-label="Saved public repositories" className="max-h-72 space-y-2 overflow-auto">
              {scope.repositories.map(repository => <li key={repository.id}><a className="break-all text-sky-700 underline dark:text-sky-400" href={repository.url} target="_blank" rel="noopener noreferrer">{repository.name}</a></li>)}
            </ul>}
          </>}
          <p className="text-sm text-muted-foreground">Disconnect clears the saved scope. It does not uninstall the GitHub App or sign you out.</p>
        </CardContent>
      </Card>}
      {session?.authenticated && <Card className="mt-6">
        <CardHeader><CardTitle>Automatic Actions checks</CardTitle><CardDescription>Check all unfinished Actions in the saved public repositories about once a minute. The public dashboard reads the latest complete result.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { void manageControl('POST'); }} disabled={!scope?.prepared || !control?.webhookConfigured || control.enabled || controlBusy || scopeBusy || checking || actionsBusy || signingOut}>Start automatic checks</Button>
            <Button variant="outline" onClick={() => { void manageControl('DELETE'); }} disabled={controlBusy || scopeBusy || checking || actionsBusy || signingOut}>Pause automatic checks</Button>
            <Button variant="outline" onClick={() => { void manageControl('GET'); }} disabled={controlBusy || scopeBusy || checking || actionsBusy || signingOut}>Reload automatic check settings</Button>
          </div>
          {controlBusy && <p role="status">Loading or updating automatic checks…</p>}
          {controlError && <p role="alert">{controlError}</p>}
          {control && <>
            <p role="status">{control.enabled ? control.checking ? 'An automatic check is in progress.' : 'Automatic checks are enabled.' : 'Automatic checks are paused.'}</p>
            {!control.webhookConfigured && <p>Configure the GitHub App webhook secret before starting.</p>}
            {control.enabled && <p className="text-sm text-muted-foreground">{control.nextCheckAt ? `Next check no earlier than ${new Date(control.nextCheckAt).toLocaleString()}.` : 'The first complete check should start within about a minute.'}</p>}
            {control.lastError && <p role="alert">The last automatic check could not confirm current activity. The dashboard shows unknown status until a complete check succeeds. {Object.hasOwn(ACTIONS_CHECK_MESSAGES, control.lastError) ? ACTIONS_CHECK_MESSAGES[control.lastError as keyof typeof ACTIONS_CHECK_MESSAGES] : ''}</p>}
          </>}
          <p className="text-sm text-muted-foreground">Idle requires two complete empty checks separated by a quiet interval. Waiting for approval also blocks idle. Push notifications are not enabled yet. Pausing hides live results; it keeps your saved scope and GitHub App installation.</p>
        </CardContent>
      </Card>}
      {session?.authenticated && <Card className="mt-6">
        <CardHeader><CardTitle>Manual Actions check</CardTitle><CardDescription>Check unfinished runs in the saved public repositories when you choose. Queued, running, requested, waiting and pending runs count as unfinished.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={() => { void checkActionsNow(); }} disabled={!scope?.prepared || actionsBusy || scopeBusy || checking || signingOut || controlBusy}>{actionsBusy ? 'Checking Actions…' : 'Check Actions now'}</Button>
          {actionsError && <p role="alert">{actionsError}</p>}
          {actions && <>
            <p role="status">{actions.runs.length ? `Unfinished runs observed: ${actions.runs.length}.` : 'No unfinished runs were found in this check. Global idle is not confirmed yet.'}</p>
            <p className="text-sm text-muted-foreground">Checked {new Date(actions.checkedAt).toLocaleString()} across {actions.repositoryCount} public repositories. This snapshot does not refresh automatically.</p>
            {actions.runs.length > 0 && <ul aria-label="Observed unfinished runs" className="space-y-3">
              {actions.runs.map(run => <li key={`${run.id}:${run.attempt}`} className="space-y-2 rounded-lg border p-3">
                <a className="break-all font-medium text-sky-700 underline dark:text-sky-400" href={run.url} target="_blank" rel="noopener noreferrer">{run.repository}: {run.workflow}</a>
                <p className="break-all text-sm text-muted-foreground">{run.branch} · Attempt {run.attempt}</p>
                <StatusBadge status={run.status} />
              </li>)}
            </ul>}
          </>}
          <p className="text-sm text-muted-foreground">A single empty check cannot confirm global idle. Use the live dashboard for automatic status. Push notifications are not enabled yet.</p>
        </CardContent>
      </Card>}
      {session?.authenticated && <PushDevices />}
    </main>
  );
}
