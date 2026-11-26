import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Synthetic, process-local evidence only. Never import production monitoring here.
export function createStore({ now = () => performance.now() } = {}) {
  const tickets = new Map();
  const lifetime = 15 * 60_000;
  function read(id) {
    const ticket = tickets.get(id);
    if (!ticket) throw new Error('Unknown synthetic ticket');
    if (now() >= ticket.expires) ticket.status = 'expired';
    return ticket;
  }
  function result(t) {
    return { schemaVersion: 1, synthetic: true, ticketId: t.id,
      status: t.status === 'pending' && now() >= t.ready ? 'synthetic_idle' : t.status,
      eventId: t.status === 'pending' && now() >= t.ready ? `synthetic:${t.id}` : null,
      message: 'Synthetic timing test only. This is not GitHub status.' };
  }
  return {
    prepare(requestKey, delaySeconds) {
      for (const [id, t] of tickets) if (now() >= t.expires) tickets.delete(id);
      const previous = [...tickets.values()].find(t => t.requestKey === requestKey);
      if (previous) {
        if (previous.delaySeconds !== delaySeconds) throw new Error('Conflicting synthetic request key');
        return result(previous);
      }
      if (tickets.size >= 8) throw new Error('Synthetic ticket limit reached; restart prototype');
      const t = { id: randomUUID(), requestKey, delaySeconds, ready: now() + delaySeconds * 1000,
        expires: now() + lifetime, status: 'pending', calls: 0, waiting: false, wake: null };
      tickets.set(t.id, t); return result(t);
    },
    get(id) { return result(read(id)); },
    cancel(id) {
      const t = read(id);
      if (t.status !== 'expired') t.status = 'cancelled';
      t.wake?.abort(); return result(t);
    },
    async wait(id, maxWaitSeconds, signal) {
      const t = read(id);
      if (t.waiting) throw new Error('A synthetic wait is already active for this ticket');
      if (t.calls >= 40) throw new Error('Synthetic call budget exhausted');
      t.calls++; t.waiting = true;
      const wake = new AbortController(); t.wake = wake;
      const combined = signal ? AbortSignal.any([signal, wake.signal]) : wake.signal;
      const deadline = Math.min(now() + maxWaitSeconds * 1000, t.expires);
      try {
        while (true) {
          const state = result(read(id));
          if (signal?.aborted) return { ...state, status: 'interrupted', eventId: null };
          if (state.status !== 'pending' || now() >= deadline) return state;
          try { await delay(Math.max(1, Math.min(5000, t.ready - now(), deadline - now())), undefined, { signal: combined }); }
          catch (error) { if (error.name !== 'AbortError') throw error; }
        }
      } finally { t.waiting = false; if (t.wake === wake) t.wake = null; }
    },
  };
}
