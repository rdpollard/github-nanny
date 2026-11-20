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

export const IDLE_STABILIZATION_MS = 10_000;
export const MAX_EMPTY_GAP_MS = 120_000;
export interface StabilizedMonitorState extends MonitorState {
  emptySince: number | null;
  lastCompleteAt: number | null;
}

// Only a second complete scan that STARTED after the quiet interval can
// confirm an apparent idle. Spending time inside the first scan is not enough.
export function stabilize(state: StabilizedMonitorState, scan: Scan & { startedAt: number; finishedAt: number }): {
  state: StabilizedMonitorState; idleNotice: { epoch: number } | null;
} {
  if (!scan.complete || scan.revision !== state.revision ||
    !Number.isSafeInteger(scan.activeRunCount) || scan.activeRunCount < 0 ||
    !Number.isSafeInteger(scan.startedAt) || scan.startedAt < 0 ||
    !Number.isSafeInteger(scan.finishedAt) || scan.finishedAt < scan.startedAt ||
    (state.lastCompleteAt !== null && scan.startedAt < state.lastCompleteAt)) return { state, idleNotice: null };
  const expired = state.emptySince !== null && scan.startedAt > state.emptySince + MAX_EMPTY_GAP_MS;
  if (scan.activeRunCount === 0 && (state.emptySince === null || expired || scan.startedAt < state.emptySince + IDLE_STABILIZATION_MS)) {
    return { state: { ...state, phase: 'unknown', emptySince: expired ? scan.finishedAt : state.emptySince ?? scan.finishedAt,
      lastCompleteAt: scan.finishedAt }, idleNotice: null };
  }
  const result = reconcile(state, scan);
  return { state: { ...result.state, emptySince: scan.activeRunCount ? null : state.emptySince,
    lastCompleteAt: scan.finishedAt }, idleNotice: result.idleNotice };
}
