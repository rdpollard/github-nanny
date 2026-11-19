import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialMonitorState, observeActivity, reconcile } from '../worker/monitor.ts';

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
