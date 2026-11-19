import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Lock, LogOut } from 'lucide-react';
import type { OwnerSession } from '../shared/contracts';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';

const notices: Record<string, string> = {
  failed: 'Sign-in could not be completed. Please try again.',
  denied: 'This GitHub account is not the configured dashboard owner.',
  cancelled: 'GitHub sign-in was cancelled.',
  success: 'Your GitHub identity is connected.',
};

export function OwnerSettings() {
  const [session, setSession] = useState<OwnerSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [outcome] = useState(() => new URLSearchParams(location.search).get('sign_in'));
  // A caller can edit the URL. Confirm the session before displaying success.
  const notice = outcome === 'success' && !session?.authenticated ? undefined : notices[outcome ?? ''];

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

  async function signOut() {
    setSigningOut(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Sign-out unavailable');
      setSession(previous => previous && { ...previous, authenticated: false, owner: null, installationUrl: null });
    } catch { setError('Sign-out could not be completed. Please try again.'); }
    finally { setSigningOut(false); }
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
            <Button variant="outline" onClick={() => { void signOut(); }} disabled={signingOut}><LogOut aria-hidden="true" />{signingOut ? 'Signing out…' : 'Sign out'}</Button>
          </>}
        </CardContent>
      </Card>
    </main>
  );
}
