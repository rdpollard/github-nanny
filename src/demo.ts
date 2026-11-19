import type { DashboardSnapshot } from '../shared/contracts';

export function demoSnapshot(): DashboardSnapshot {
  const startedAt = new Date(Date.now() - 180_000).toISOString();
  return {
    connected: true, phase: 'busy', checkedAt: new Date().toISOString(), repositoryCount: 3, message: null,
    runs: [
      { id: 1, repository: 'example/web-app', workflow: 'Build and deploy', branch: 'main', status: 'in_progress', url: 'https://github.com/features/actions', startedAt },
      { id: 2, repository: 'example/web-app', workflow: 'Browser checks', branch: 'feature/navigation', status: 'queued', url: 'https://github.com/features/actions', startedAt },
      { id: 3, repository: 'example/api', workflow: 'Integration checks', branch: 'main', status: 'in_progress', url: 'https://github.com/features/actions', startedAt },
    ],
  };
}
