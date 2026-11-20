export type MonitorPhase = 'unknown' | 'busy' | 'idle';

// Only these fixed outcomes may reach the browser or authentication logs.
export const SIGN_IN_MESSAGES = {
  failed: 'Sign-in could not be completed. Please try again.',
  state: 'This sign-in request expired or could not be verified. Start sign-in again in this browser.',
  credentials: 'GitHub rejected the app\'s client ID or client secret. Check the app credentials in Cloudflare.',
  verification: 'GitHub could not verify this sign-in code. Start sign-in again.',
  callback: 'GitHub rejected the redirect URI. Check the registered redirect URI in the GitHub App settings.',
  provider: 'GitHub could not complete the token exchange. Please try again.',
  identity: 'GitHub authorized the app, but its account details could not be verified. Please try again.',
  denied: 'This GitHub account is not the configured dashboard owner.',
  cancelled: 'GitHub sign-in was cancelled.',
  success: 'Your GitHub identity is connected.',
} as const;
export type SignInOutcome = keyof typeof SIGN_IN_MESSAGES;

export const DISCOVERY_MESSAGES = {
  setup: 'The GitHub App private key is missing or invalid. Check the Worker secret.',
  not_installed: 'The GitHub App is not installed on the configured owner account.',
  permissions: 'Check the installation: it must be active with Actions and Metadata read-only access.',
  authentication: 'GitHub rejected App authentication. Check that the private key belongs to this App.',
  rate_limited: 'GitHub has limited requests. Wait before checking repository access again.',
  incomplete: 'The repository list could not be completed consistently. Please try again.',
  unavailable: 'GitHub repository access could not be checked. Please try again.',
} as const;
export type DiscoveryFailure = keyof typeof DISCOVERY_MESSAGES;

export interface RepositoryDiscovery {
  checkedAt: string;
  owner: string;
  installationId: number;
  selection: 'all' | 'selected';
  repositoryCount: number;
  privateRepositoryCount: number;
  repositories: { id: number; name: string; url: string }[];
}

export interface OwnerSession {
  configured: boolean;
  authenticated: boolean;
  owner: { id: string; login: string } | null;
  installationUrl: string | null;
}

export interface ActiveRun {
  id: number;
  repository: string;
  workflow: string;
  branch: string;
  status: 'queued' | 'in_progress' | 'waiting' | 'pending' | 'requested';
  url: string;
  startedAt: string;
}

export interface DashboardSnapshot {
  phase: MonitorPhase;
  connected: boolean;
  checkedAt: string | null;
  repositoryCount: number;
  runs: ActiveRun[];
  message: string | null;
}

export function unconnectedSnapshot(): DashboardSnapshot {
  return {
    phase: 'unknown', connected: false, checkedAt: null,
    repositoryCount: 0, runs: [],
    message: 'GitHub monitoring is not connected yet.',
  };
}
