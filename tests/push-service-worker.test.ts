import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
function worker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const notifications: { title: string; options: { body: string; tag: string } }[] = [];
  const navigations: string[] = [];
  let windows: { url: string; navigate: (url: string) => Promise<void>; focus: () => Promise<void> }[] = [];
  runInNewContext(source, { URL, Response, self: {
    addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
    location: { origin: 'https://nanny.example' },
    registration: { showNotification: async (title: string, options: { body: string; tag: string }) => { notifications.push({ title, options }); } },
    clients: { matchAll: async () => windows, openWindow: async (url: string) => { navigations.push(url); } },
  } });
  const emit = async (name: string, data: object) => {
    let pending: Promise<unknown> | undefined;
    handlers.get(name)!({ ...data, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
  };
  return { notifications, navigations, emit, setWindows: (value: typeof windows) => { windows = value; } };
}

test('push events display a visible test or neutral fallback and never assert idle', async () => {
  const w = worker();
  await w.emit('push', { data: { json: () => ({ version: 1, kind: 'test', title: 'GitHub is idle', path: 'https://evil.example' }) } });
  assert.equal(w.notifications[0].title, 'GitHub Nanny test');
  assert.match(w.notifications[0].options.body, /Automatic idle alerts are not enabled/);
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
  w.setWindows([{ url: 'https://nanny.example/settings', navigate: async url => { w.navigations.push(url); }, focus: async () => { focused = true; } }]);
  await click(); assert.equal(focused, true); assert.deepEqual(w.navigations, ['https://nanny.example/', 'https://nanny.example/']);
  w.setWindows([{ url: 'https://nanny.example/settings', navigate: async () => {}, focus: async () => { throw new Error('Window closed'); } }]);
  await click(); assert.equal(w.navigations.at(-1), 'https://nanny.example/');
  assert.equal(w.navigations.length, 3);
});
