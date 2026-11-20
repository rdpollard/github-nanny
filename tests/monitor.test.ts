import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialMonitorState, observeActivity, reconcile, stabilize } from '../worker/monitor.ts';

test('first idle observation is quiet; busy to idle produces one notice per activity period', () => {
  const initial = reconcile(initialMonitorState(), { revision: 0, complete: true, activeRunCount: 0 });
  assert.equal(initial.state.phase, 'idle');
  assert.equal(initial.idleNotice, null);
  const busy = observeActivity(initial.state);
  const done = reconcile(busy, { revision: 1, complete: true, activeRunCount: 0 });
  assert.deepEqual(done.idleNotice, { epoch: 1 });
  assert.equal(reconcile(done.state, { revision: 1, complete: true, activeRunCount: 0 }).idleNotice, null);
  const next = observeActivity(done.state);
  assert.deepEqual(reconcile(next, { revision: 2, complete: true, activeRunCount: 0 }).idleNotice, { epoch: 2 });
});

test('idle stabilization requires a second scan started after the first empty check plus ten seconds', () => {
  const busy = { ...observeActivity(initialMonitorState()), emptySince: null, lastCompleteAt: null };
  const first = stabilize(busy, { revision: 1, complete: true, activeRunCount: 0, startedAt: 0, finishedAt: 20_000 });
  assert.equal(first.state.phase, 'unknown');
  assert.equal(first.state.activityObserved, true);
  assert.equal(first.idleNotice, null);
  const overlapping = stabilize(first.state, { revision: 1, complete: true, activeRunCount: 0, startedAt: 20_001, finishedAt: 40_000 });
  assert.equal(overlapping.state.phase, 'unknown'); // A long request does not satisfy stabilization.
  const second = stabilize(overlapping.state, { revision: 1, complete: true, activeRunCount: 0, startedAt: 40_001, finishedAt: 40_002 });
  assert.equal(second.state.phase, 'idle');
  assert.deepEqual(second.idleNotice, { epoch: 1 });
  const restarted = stabilize(first.state, { revision: 1, complete: true, activeRunCount: 1, startedAt: 30_001, finishedAt: 30_002 });
  assert.equal(restarted.state.phase, 'busy');
  assert.equal(restarted.state.emptySince, null);
  const afterOutage = stabilize(first.state, { revision: 1, complete: true, activeRunCount: 0, startedAt: 200_000, finishedAt: 200_001 });
  assert.equal(afterOutage.state.phase, 'unknown');
  assert.equal(afterOutage.state.emptySince, 200_001);
  assert.equal(afterOutage.idleNotice, null);
});

test('stabilization rejects out-of-order scans and incomplete or invalid timing evidence', () => {
  const state = { ...observeActivity(initialMonitorState()), emptySince: 100, lastCompleteAt: 200 };
  for (const scan of [
    { revision: 0, complete: true, activeRunCount: 0, startedAt: 20_000, finishedAt: 20_001 },
    { revision: 1, complete: false, activeRunCount: 0, startedAt: 20_000, finishedAt: 20_001 },
    { revision: 1, complete: true, activeRunCount: 0, startedAt: 199, finishedAt: 20_001 },
    { revision: 1, complete: true, activeRunCount: 0, startedAt: 20_000, finishedAt: 19_000 },
    { revision: 1, complete: true, activeRunCount: 0, startedAt: NaN, finishedAt: 20_001 },
  ]) assert.equal(stabilize(state, scan).state, state);
});

test('initial sync can observe existing work, and every active run must finish', () => {
  const busy = reconcile(initialMonitorState(), { revision: 0, complete: true, activeRunCount: 2 });
  assert.equal(busy.state.phase, 'busy');
  const oneLeft = reconcile(busy.state, { revision: 0, complete: true, activeRunCount: 1 });
  assert.equal(oneLeft.idleNotice, null);
  assert.deepEqual(reconcile(oneLeft.state, { revision: 0, complete: true, activeRunCount: 0 }).idleNotice, { epoch: 1 });
});

test('a late webhook invalidates an otherwise empty scan', () => {
  const beforeScan = observeActivity(initialMonitorState());
  const duringScan = observeActivity(beforeScan);
  const result = reconcile(duringScan, { revision: beforeScan.revision, complete: true, activeRunCount: 0 });
  assert.equal(result.state, duringScan);
  assert.equal(result.idleNotice, null);
});

test('partial, failed, or invalid scans cannot establish idle', () => {
  const state = observeActivity(initialMonitorState());
  for (const scan of [
    { revision: 1, complete: false, activeRunCount: 0 },
    { revision: 1, complete: true, activeRunCount: -1 },
    { revision: 1, complete: true, activeRunCount: NaN },
    { revision: 1, complete: true, activeRunCount: 0.5 },
  ]) {
    assert.equal(reconcile(state, scan).idleNotice, null);
    assert.equal(reconcile(state, scan).state, state);
  }
});
