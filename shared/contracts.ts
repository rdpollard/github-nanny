export type MonitorPhase = 'unknown' | 'busy' | 'idle';

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
