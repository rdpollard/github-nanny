import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
function worker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const notifications: { title: string; options: { body: string; tag: string } }[] = [];
  const navigations: string[] = [];
  type Window = { url: string; navigate: (url: string) => Promise<Window | null>; focus: () => Promise<void> };
  let windows: Window[] = [];
  let openedFocused = false;
  runInNewContext(source, { URL, URLSearchParams, Response, self: {
    addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
    location: { origin: 'https://nanny.example' },
    registration: { showNotification: async (title: string, options: { body: string; tag: string }) => { notifications.push({ title, options }); } },
    clients: { matchAll: async () => windows, openWindow: async (url: string) => {
      assert.equal(new URL(url).origin, 'https://nanny.example', 'Notification clicks must first open the app');
      navigations.push(url);
      return { focus: async () => { openedFocused = true; } };
    } },
  } });
  const emit = async (name: string, data: object) => {
    let pending: Promise<unknown> | undefined;
    handlers.get(name)!({ ...data, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
  };
  return { notifications, navigations, emit, openedFocused: () => openedFocused,
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

test('notification clicks focus or open only the app and ignore payload navigation targets', async () => {
  const w = worker();
  let closed = false;
  const click = () => w.emit('notificationclick', { notification: { data: { path: 'https://evil.example' }, close: () => { closed = true; } } });
  await click(); assert.equal(closed, true); assert.deepEqual(w.navigations, ['https://nanny.example/']);
  let focused = false;
  const existing = { url: 'https://nanny.example/settings', navigate: async (url: string) => { w.navigations.push(url); return existing; }, focus: async () => { focused = true; } };
  w.setWindows([existing]);
  await click(); assert.equal(focused, true); assert.deepEqual(w.navigations, ['https://nanny.example/', 'https://nanny.example/']);
  w.setWindows([{ ...existing, navigate: async () => { throw new Error('Window closed'); } }]);
  await click(); assert.equal(w.navigations.at(-1), 'https://nanny.example/');
  assert.equal(w.navigations.length, 3);
});

test('idle notification taps open and focus the app with a canonical run link, including old notification data', async () => {
  const w = worker();
  const url = 'https://github.com/rdpollard/github-nanny/actions/runs/123/attempts/2';
  const payload = { version: 1, kind: 'idle', epoch: 7, url, checkedAt: new Date().toISOString() };
  await w.emit('push', { data: { json: () => payload } });
  assert.equal(w.notifications.at(-1)!.title, 'GitHub is idle');
  assert.equal(w.notifications.at(-1)!.options.tag, 'github-nanny-idle-7');
  await w.emit('notificationclick', { notification: { data: { runUrl: url }, close: () => {} } });
  const target = new URL(w.navigations.at(-1)!);
  assert.equal(target.origin, 'https://nanny.example');
  assert.equal(target.pathname, '/');
  assert.equal(new URLSearchParams(target.hash.slice(1)).get('idle-run'), url);
  assert.equal(w.openedFocused(), true);
  let focused = false;
  const existing = { url: 'https://nanny.example/settings', navigate: async (url: string) => { w.navigations.push(url); return existing; }, focus: async () => { focused = true; } };
  w.setWindows([existing]);
  await w.emit('notificationclick', { notification: { data: { runUrl: url }, close: () => {} } });
  assert.equal(focused, true);
  assert.equal(w.navigations.at(-1), target.href);
  // A matching tab can disappear during navigation; open a fresh app window.
  w.setWindows([{ ...existing, navigate: async () => null }]);
  await w.emit('notificationclick', { notification: { data: { runUrl: url }, close: () => {} } });
  assert.equal(w.navigations.at(-1), target.href);
  for (const bad of ['https://evil.example/run', 'https://github.com/owner/repo/actions/runs/123?redirect=evil', 'javascript:alert(1)']) {
    await w.emit('push', { data: { json: () => ({ ...payload, url: bad }) } });
    assert.equal(w.notifications.at(-1)!.title, 'GitHub Nanny');
    await w.emit('notificationclick', { notification: { data: { runUrl: bad }, close: () => {} } });
    assert.equal(w.navigations.at(-1), 'https://nanny.example/');
  }
});
