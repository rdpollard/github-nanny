// Adapted from Cheney Yan's GitHub Workflow Dashboard, commit 8b18dcb.
// Copyright (c) 2026 Cheney Yan. MIT notice: licenses/github-workflow-dashboard.txt.
import { Clock, Loader } from 'lucide-react';
import type { ActiveRun } from '../../shared/contracts';

export function StatusBadge({ status }: { status: ActiveRun['status'] }) {
  const running = status === 'in_progress';
  const Icon = running ? Loader : Clock;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-white ${running ? 'bg-sky-600' : 'bg-orange-600'}`}>
      <Icon aria-hidden="true" className={`size-3 ${running ? 'motion-safe:animate-spin' : ''}`} />
      {running ? 'RUNNING' : status.toUpperCase()}
    </span>
  );
}
