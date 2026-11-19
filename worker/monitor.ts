import type { MonitorPhase } from '../shared/contracts.ts';

export interface MonitorState {
  phase: MonitorPhase;
  revision: number;
  activityObserved: boolean;
  idleEpoch: number;
}

export const initialMonitorState = (): MonitorState => ({
  phase: 'unknown', revision: 0, activityObserved: false, idleEpoch: 0,
});

// Called for fresh, deduplicated activity evidence. A completion is evidence
// of activity too, but can only nominate an idle check, never assert idle.
export function observeActivity(state: MonitorState): MonitorState {
  return { ...state, phase: 'busy', revision: state.revision + 1, activityObserved: true };
}

export interface Scan {
  revision: number;
  complete: boolean;
  activeRunCount: number;
}

export function reconcile(state: MonitorState, scan: Scan): {
  state: MonitorState;
  idleNotice: { epoch: number } | null;
} {
  if (!scan.complete || scan.revision !== state.revision ||
    !Number.isSafeInteger(scan.activeRunCount) || scan.activeRunCount < 0) {
    return { state, idleNotice: null };
  }
  if (scan.activeRunCount > 0) {
    return { state: { ...state, phase: 'busy', activityObserved: true }, idleNotice: null };
  }
  const epoch = state.idleEpoch + (state.activityObserved ? 1 : 0);
  return {
    state: { ...state, phase: 'idle', activityObserved: false, idleEpoch: epoch },
    idleNotice: state.activityObserved ? { epoch } : null,
  };
}
