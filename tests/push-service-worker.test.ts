import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
function worker(options: { mode?: 'open' | 'null' | 'reject' | 'throw'; storageBlocked?: boolean; saved?: Map<string, Response> } = {}) {
  const handlers = new Map<string, (event: unknown) => void>();
  const notifications: { title: string; options: { body: string; tag: string } }[] = [];
  const navigations: string[] = [];
  const calls: string[] = [];
  const saved = options.saved ?? new Map<string, Response>();
  type Window = { url: string; navigate: (url: string) => Promise<Window | null>; focus: () => Promise<void> };
  let windows: Window[] = [];
  runInNewContext(source, { URL, URLSearchParams, Response, caches: {
    open: async () => {
      if (options.storageBlocked) throw new Error('Storage blocked');
      return { put: async (key: string, value: Response) => { saved.set(key, value); }, match: async (key: string) => saved.get(key)?.clone() };
    },
  }, self: {
    addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
    location: { origin: 'https://nanny.example' },
    registration: { showNotification: async (title: string, options: { body: string; tag: string }) => { notifications.push({ title, options }); } },
    clients: { matchAll: async () => { calls.push('match'); return windows; }, openWindow: (url: string) => {
      calls.push('open');
      assert.equal(new URL(url).origin, 'https://nanny.example');
      navigations.push(url);
      const error = Object.assign(new Error('secret URL must not be recorded'), { name: 'InvalidAccessError' });
      if (options.mode === 'throw') throw error;
      if (options.mode === 'reject') return Promise.reject(error);
      return Promise.resolve(options.mode === 'null' ? null : {});
    } },
  } });
  const emit = async (name: string, data: object) => {
    let pending: Promise<unknown> | undefined;
    handlers.get(name)!({ ...data, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
  };
  const diagnostic = async () => {
    let result: any;
    await emit('message', { data: { kind: 'notification-click-diagnostic' }, ports: [{ postMessage: (value: unknown) => { result = value; } }] });
    return result;
  };
  return { notifications, navigations, calls, saved, emit, diagnostic,
    setWindows: (value: typeof windows) => { windows = value; } };
}

test('push events display a visible test or neutral fallback and never assert idle', async () => {
  const w = worker();
  await w.emit('push', { data: { json: () => ({ version: 1, kind: 'test', title: 'GitHub is idle', path: 'https://evil.example' }) } });
  assert.equal(w.notifications[0].title, 'GitHub Nanny test');
  assert.match(w.notifications[0].options.body, /This is a test notification/);
  assert.equal(w.notifications[0].options.tag, 'github-nanny-test');
  for (const data of [undefined, { json: () => { throw new Error('Malformed payload'); } }, { json: () => ({ version: 1, kind: 'idle' }) }]) {
    await w.emit('push', { data });
    assert.equal(w.notifications.at(-1)!.title, 'GitHub Nanny');
    assert.doesNotMatch(w.notifications.at(-1)!.options.body, /is idle|finished/i);
  }
});

test('tap requests same-origin opening synchronously, before any enumeration or storage wait', async () => {
  const w = worker();
  let closed = false;
  const pending = w.emit('notificationclick', { notification: { data: { path: 'https://evil.example' }, close: () => { closed = true; } } });
  assert.equal(closed, true);
  assert.deepEqual(w.calls, ['open']);
  await pending;
  assert.deepEqual(w.navigations, ['https://nanny.example/']);
  assert.equal((await w.diagnostic()).lastClick.outcome, 'opened');
});

test('blocked opening falls back to focus BEFORE navigation, with bounded redacted diagnostics', async () => {
  for (const mode of ['reject', 'throw'] as const) {
    const w = worker({ mode });
    const existing = { url: 'https://nanny.example/settings',
      focus: async () => { w.calls.push('focus'); },
      navigate: async (url: string) => { w.calls.push('navigate'); w.navigations.push(url); return existing; } };
    w.setWindows([existing]);
    await w.emit('notificationclick', { notification: { data: {}, close: () => {} } });
    assert.deepEqual(w.calls, ['open', 'match', 'focus', 'navigate']);
    const value = await w.diagnostic();
    assert.equal(value.version, 'tap-v2');
    assert.equal(value.lastClick.outcome, 'navigated');
    assert.equal(value.lastClick.error, 'InvalidAccessError');
    assert.doesNotMatch(JSON.stringify(value), /secret URL|nanny.example/);
  }
});

test('absent windows, disappearing windows and null browser results are recorded without claiming success', async () => {
  for (const mode of ['reject', 'null'] as const) {
    const w = worker({ mode });
    w.setWindows([{ url: 'https://nanny.example/', focus: async () => { throw new Error('Window closed'); }, navigate: async () => null }]);
    await w.emit('notificationclick', { notification: { data: {}, close: () => {} } });
    assert.equal((await w.diagnostic()).lastClick.outcome, mode === 'null' ? 'no-window' : 'blocked');
  }
});

test('latest tap persists across worker restarts; storage failure never prevents opening', async () => {
  const w = worker();
  assert.equal((await w.diagnostic()).lastClick, null);
  for (let i = 0; i < 2; i++) await w.emit('notificationclick', { notification: { data: {}, close: () => {} } });
  assert.equal(w.saved.size, 1);
  assert.equal((await worker({ saved: w.saved }).diagnostic()).lastClick.outcome, 'opened');
  const blocked = worker({ storageBlocked: true });
  await blocked.emit('notificationclick', { notification: { data: {}, close: () => {} } });
  assert.equal((await blocked.diagnostic()).lastClick.outcome, 'opened');
});

test('idle tags and canonical run context survive the app-first tap path, including old notifications', async () => {
  const w = worker();
  const url = 'https://github.com/rdpollard/github-nanny/actions/runs/123/attempts/2';
  const payload = { version: 1, kind: 'idle', epoch: 7, url, checkedAt: new Date().toISOString() };
  await w.emit('push', { data: { json: () => payload } });
  assert.equal(w.notifications.at(-1)!.title, 'GitHub is idle');
  assert.equal(w.notifications.at(-1)!.options.tag, 'github-nanny-idle-7');
  await w.emit('notificationclick', { notification: { data: { runUrl: url }, close: () => {} } });
  const target = new URL(w.navigations.at(-1)!);
  assert.equal(target.origin, 'https://nanny.example');
  assert.equal(new URLSearchParams(target.hash.slice(1)).get('idle-run'), url);
  for (const bad of ['https://evil.example/run', 'https://github.com/owner/repo/actions/runs/123?redirect=evil', 'javascript:alert(1)']) {
    await w.emit('push', { data: { json: () => ({ ...payload, url: bad }) } });
    assert.equal(w.notifications.at(-1)!.title, 'GitHub Nanny');
    await w.emit('notificationclick', { notification: { data: { runUrl: bad }, close: () => {} } });
    assert.equal(w.navigations.at(-1), 'https://nanny.example/');
  }
});
