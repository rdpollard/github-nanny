import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Lock, LogOut } from 'lucide-react';
import { DISCOVERY_MESSAGES, SIGN_IN_MESSAGES, type OwnerSession, type RepositoryAccessReport, type SavedMonitoringScope, type SignInOutcome } from '../shared/contracts';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';

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
    if (!session?.authenticated) { setScope(null); setScopeError(null); return; }
    const controller = new AbortController();
    void manageScope('GET', controller.signal);
    return () => controller.abort();
  }, [session?.authenticated]);

  async function manageScope(method: 'GET' | 'POST' | 'DELETE', signal?: AbortSignal) {
    setScopeBusy(true);
    setScope(null);
    setScopeError(null);
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
      if (!signal?.aborted) setScope(data);
    } catch {
      if (!signal?.aborted) setScopeError('The saved scope is unavailable. Reload it or try again.');
    } finally { if (!signal?.aborted) setScopeBusy(false); }
  }

  async function signOut(allDevices = false) {
    setSigningOut(true);
    setError(null);
    try {
      const response = await fetch(allDevices ? '/api/auth/logout-all' : '/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Sign-out unavailable');
      setDiscovery(null);
      setDiscoveryError(null);
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
            <p className="text-sm text-muted-foreground">Owner sign-in is ready. Live repository monitoring is not connected yet.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => { void signOut(); }} disabled={signingOut || checking || scopeBusy}><LogOut aria-hidden="true" />{signingOut ? 'Signing out…' : 'Sign out'}</Button>
              <Button variant="outline" onClick={() => { void signOut(true); }} disabled={signingOut || checking || scopeBusy}>Sign out all devices</Button>
            </div>
          </>}
        </CardContent>
      </Card>
      {session?.authenticated && <Card className="mt-6">
        <CardHeader><CardTitle>Repository access</CardTitle><CardDescription>Verify the configured personal and organization installations when you choose. This does not start Actions monitoring.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={() => { void checkRepositories(); }} disabled={checking || signingOut || scopeBusy}>{checking ? 'Checking repository access…' : 'Check repository access'}</Button>
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
        <CardHeader><CardTitle>Public monitoring scope</CardTitle><CardDescription>Save all public repositories from the configured installations after a fresh access check. Private repositories and their activity are excluded. Saving does not start Actions monitoring yet.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { void manageScope('POST'); }} disabled={scopeBusy || checking || signingOut}>Save public scope</Button>
            <Button variant="outline" onClick={() => { void manageScope('GET'); }} disabled={scopeBusy || checking || signingOut}>Reload saved scope</Button>
            <Button variant="outline" onClick={() => { void manageScope('DELETE'); }} disabled={scopeBusy || checking || signingOut}>Disconnect saved scope</Button>
          </div>
          {scopeBusy && <p role="status">Loading or updating saved scope…</p>}
          {scopeError && <p role="alert">{scopeError}</p>}
          {scope && <>
            <p role="status">{scope.prepared ? `Public scope saved: ${scope.repositories.length} repositories. Actions monitoring is not active yet.` : 'No public monitoring scope is saved.'}</p>
            {scope.verifiedAt && <p className="text-sm text-muted-foreground">Verified {new Date(scope.verifiedAt).toLocaleString()}. Saved access does not guarantee current access.</p>}
            {scope.repositories.length > 0 && <ul aria-label="Saved public repositories" className="max-h-72 space-y-2 overflow-auto">
              {scope.repositories.map(repository => <li key={repository.id}><a className="break-all text-sky-700 underline dark:text-sky-400" href={repository.url} target="_blank" rel="noopener noreferrer">{repository.name}</a></li>)}
            </ul>}
          </>}
          <p className="text-sm text-muted-foreground">Disconnect clears the saved scope. It does not uninstall the GitHub App or sign you out.</p>
        </CardContent>
      </Card>}
    </main>
  );
}
