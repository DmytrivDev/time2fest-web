/**
 * Лічена присутність глядача (SPEC-12 W45, AC-59, AC-61, [П-1]): спільний фейковий менеджер замків для двох «вкладок»,
 * фейковий транспорт і запит токена; без мережі й без сховища.
 */
import type { RealtimeEnvelope } from '@time2fest/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  subscribeCountedViewers,
  VIEWER_LOCK_NAME,
  VIEWER_TOKEN_URL,
  type ViewerChannelListener,
  type ViewerChannelTransport,
  type ViewerLockManager,
  type ViewerPageEvents,
  type ViewerTokenFetch,
} from '@/lib/api/http/viewerPresence';

const CHANNEL = 'live:viewers';

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

/** Exclusive locks of one browser profile: one holder per name, the waiters in order; `signal` aborts a waiter. */
function fakeLocks() {
  let holder: string | null = null;
  const queue: Array<{ name: string; run: () => void; abort: () => void }> = [];
  const requests: string[] = [];
  function next(): void {
    if (holder !== null) return;
    const waiter = queue.shift();
    if (waiter) waiter.run();
  }
  const manager: ViewerLockManager = {
    request(name, options, callback) {
      requests.push(`${name}:${options.mode}`);
      return new Promise((resolve, reject) => {
        const waiter = {
          name,
          run: () => {
            holder = name;
            void callback().then(() => {
              holder = null;
              resolve(undefined);
              next();
            });
          },
          abort: () => {
            const i = queue.indexOf(waiter);
            if (i >= 0) queue.splice(i, 1);
            reject(new DOMException('aborted', 'AbortError'));
          },
        };
        options.signal?.addEventListener('abort', () => waiter.abort());
        queue.push(waiter);
        next();
      });
    },
  };
  return { manager, requests, held: () => holder !== null, waiting: () => queue.length };
}

interface Sub {
  listener: ViewerChannelListener;
  getToken?: () => Promise<string>;
}

/** One tab's transport: the subscriptions it holds now. */
function fakeTransport() {
  const subs = new Set<Sub>();
  const transport: ViewerChannelTransport = {
    subscribe(channel, listener, options) {
      expect(channel).toBe(CHANNEL);
      const sub: Sub = { listener, getToken: options?.getToken };
      subs.add(sub);
      return () => {
        subs.delete(sub);
      };
    },
  };
  return {
    transport,
    subs,
    counted: () => [...subs].filter((s) => s.getToken).length,
    plain: () => [...subs].filter((s) => !s.getToken).length,
    emit: (e: RealtimeEnvelope) => [...subs].forEach((s) => s.listener.onEvent(e)),
  };
}

function tokenFetch(...tokens: Array<string | null>) {
  const queue = [...tokens];
  return vi.fn<ViewerTokenFetch>(async () => {
    const token = queue.length > 1 ? queue.shift() : queue[0];
    if (token === null) return { ok: false, json: async () => ({ ok: false }) };
    return { ok: true, json: async () => ({ ok: true, value: { token, expiresAt: '2027-01-01T00:00:00.000Z' } }) };
  });
}

function fakePage() {
  const listeners = new Map<string, Set<(e: { persisted?: boolean }) => void>>();
  const page: ViewerPageEvents = {
    addEventListener(type, l) {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(l));
    },
    removeEventListener(type, l) {
      listeners.get(type)?.delete(l);
    },
  };
  return {
    page,
    fire: (type: 'pagehide' | 'pageshow', persisted = false) => [...(listeners.get(type) ?? [])].forEach((l) => l({ persisted })),
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

function tab(locks: ViewerLockManager | null, fetch = tokenFetch('tok-a')) {
  const rt = fakeTransport();
  const pg = fakePage();
  const seen: string[] = [];
  const off = subscribeCountedViewers({
    transport: rt.transport,
    channel: CHANNEL,
    listener: { onEvent: (e) => seen.push(e.id) },
    locks,
    fetch,
    page: pg.page,
  });
  return { rt, pg, seen, off, fetch };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('W45 — one counted subscription per browser', () => {
  it('two tabs sharing a lock manager: exactly one counted subscription, the other tab tokenless', async () => {
    const locks = fakeLocks();
    const a = tab(locks.manager);
    const b = tab(locks.manager);
    await flush();
    expect(locks.requests).toEqual([`${VIEWER_LOCK_NAME}:exclusive`, `${VIEWER_LOCK_NAME}:exclusive`]);
    expect(a.rt.counted() + b.rt.counted()).toBe(1);
    expect(a.rt.counted()).toBe(1);
    expect(a.rt.plain()).toBe(0);
    expect(b.rt.counted()).toBe(0);
    expect(b.rt.plain()).toBe(1);
    expect(a.fetch).toHaveBeenCalledWith(VIEWER_TOKEN_URL, { credentials: 'same-origin', cache: 'no-store' });
    expect(b.fetch).not.toHaveBeenCalled();
    expect(locks.waiting()).toBe(1);
  });

  it('the holder leaves → the waiting tab takes over and becomes the only counted one', async () => {
    const locks = fakeLocks();
    const a = tab(locks.manager);
    const b = tab(locks.manager, tokenFetch('tok-b'));
    await flush();
    a.off();
    await flush();
    expect(a.rt.subs.size).toBe(0);
    expect(b.rt.counted()).toBe(1);
    expect(b.rt.plain()).toBe(0);
    expect(locks.held()).toBe(true);
    b.off();
    await flush();
    expect(locks.held()).toBe(false);
    expect(locks.waiting()).toBe(0);
  });

  it('the first token is the probed one; a refresh asks again; an empty refresh rejects (the client retries)', async () => {
    const locks = fakeLocks();
    const a = tab(locks.manager, tokenFetch('tok-1', 'tok-2', ''));
    await flush();
    const counted = [...a.rt.subs][0];
    await expect(counted?.getToken?.()).resolves.toBe('tok-1');
    await expect(counted?.getToken?.()).resolves.toBe('tok-2');
    await expect(counted?.getToken?.()).rejects.toThrow();
    expect(a.fetch).toHaveBeenCalledTimes(3);
  });

  it('the holder gets no token (refused or empty) → stays tokenless while holding the lock', async () => {
    const locks = fakeLocks();
    const a = tab(locks.manager, tokenFetch(null));
    await flush();
    expect(a.rt.counted()).toBe(0);
    expect(a.rt.plain()).toBe(1);
    const b = tab(locks.manager, tokenFetch(''));
    await flush();
    expect(b.rt.plain()).toBe(1);
    a.off();
    await flush();
    expect(b.rt.counted()).toBe(0);
    expect(b.rt.plain()).toBe(1);
  });

  it('events reach the listener before, during and after the switch to the counted subscription', async () => {
    const locks = fakeLocks();
    const fetch = tokenFetch('tok-a');
    let release!: () => void;
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, json: async () => ({ ok: true, value: { token: 'tok-a' } }) });
        }),
    );
    const a = tab(locks.manager, fetch);
    a.rt.emit({ type: 'viewers', id: 'v1', data: {} });
    await flush();
    a.rt.emit({ type: 'viewers', id: 'v2', data: {} });
    release();
    await flush();
    expect(a.rt.counted()).toBe(1);
    a.rt.emit({ type: 'viewers', id: 'v3', data: {} });
    expect(a.seen).toEqual(['v1', 'v2', 'v3']);
  });

  it('pagehide releases the lock (the other tab takes over); pageshow from the back-forward cache asks again', async () => {
    const locks = fakeLocks();
    const a = tab(locks.manager);
    const b = tab(locks.manager, tokenFetch('tok-b'));
    await flush();
    a.pg.fire('pagehide', true);
    await flush();
    expect(a.rt.counted()).toBe(0);
    expect(a.rt.plain()).toBe(1);
    expect(b.rt.counted()).toBe(1);
    a.pg.fire('pageshow', true);
    await flush();
    expect(locks.waiting()).toBe(1);
    expect(a.rt.counted()).toBe(0);
    b.off();
    await flush();
    expect(a.rt.counted()).toBe(1);
    a.off();
    expect(a.pg.count()).toBe(0);
  });

  it('unsubscribe while waiting for the lock aborts the request and never asks for a token', async () => {
    const locks = fakeLocks();
    const a = tab(locks.manager);
    const b = tab(locks.manager);
    await flush();
    b.off();
    await flush();
    expect(locks.waiting()).toBe(0);
    expect(b.rt.subs.size).toBe(0);
    a.off();
    await flush();
    expect(b.fetch).not.toHaveBeenCalled();
  });

  it('a token arriving after unsubscribe subscribes nothing', async () => {
    const locks = fakeLocks();
    const fetch = tokenFetch('tok-a');
    let release!: () => void;
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, json: async () => ({ ok: true, value: { token: 'tok-a' } }) });
        }),
    );
    const a = tab(locks.manager, fetch);
    await flush();
    a.off();
    release();
    await flush();
    expect(a.rt.subs.size).toBe(0);
    expect(locks.held()).toBe(false);
  });
});

describe('W45 — without Web Locks every tab takes the counted path', () => {
  it('two tabs, no lock manager → both counted (accepted over-count), no crash', async () => {
    const a = tab(null);
    const b = tab(null, tokenFetch('tok-b'));
    await flush();
    expect(a.rt.counted()).toBe(1);
    expect(b.rt.counted()).toBe(1);
    a.off();
    b.off();
    expect(a.rt.subs.size + b.rt.subs.size).toBe(0);
  });
});

describe('W45 — nothing is stored', () => {
  it('no cookie, no localStorage, no sessionStorage write', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const cookie = vi.spyOn(document, 'cookie', 'set');
    const snapshot = () => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]);
    const before = snapshot();
    const locks = fakeLocks();
    const a = tab(locks.manager);
    const b = tab(locks.manager);
    await flush();
    a.off();
    await flush();
    b.off();
    expect(setItem).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
  });
});
