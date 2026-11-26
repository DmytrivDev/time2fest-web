/** AC-48, AC-59: http adapter of passport. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTP_DOMAINS } from '@/lib/api/http/domains';
import { createHttpPassport } from '@/lib/api/http/passport';
import type { ProfileFetch } from '@/lib/api/http/profile';
import type { PresenceClock } from '@/lib/api/contracts/passport';

const STAMP = { eventId: 'e1', grantedAt: 1, presenceSource: 'air', illustrationId: 'gb', cityName: 'London', countryIso: 'GB' };

type Init = { method: string; body?: string };

function fakeFetch(handler: (url: string, init: Init) => { status?: number; body: unknown }) {
  const f = vi.fn(async (url: string, init: Init) => {
    const r = handler(url, init);
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body };
  });
  return f as unknown as ProfileFetch & typeof f;
}

function fakeClock(start: number) {
  let t = start;
  const subs = new Set<() => void>();
  const clock: PresenceClock = {
    now: () => t,
    fallbackNow: () => t,
    subscribe: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
  return {
    clock,
    tick: (to: number) => {
      t = to;
      [...subs].forEach((s) => s());
    },
    subs,
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('http passport', () => {
  it('AC-48/59: in HTTP_DOMAINS, no mergeGuest', () => {
    expect(HTTP_DOMAINS).toContain('passport');
    const svc = createHttpPassport({ fetch: fakeFetch(() => ({ body: {} })) });
    expect((svc as { mergeGuest?: unknown }).mergeGuest).toBeUndefined();
  });

  it('stamps / peek / claim parse the envelope and keep reason + retryAfterMs', async () => {
    const f = fakeFetch((_url, init) => {
      if (init.method === 'GET') return { body: { ok: true, value: [STAMP] } };
      return { status: 403, body: { ok: false, error: { code: 'forbidden', reason: 'no-presence', retryAfterMs: 9000 } } };
    });
    const svc = createHttpPassport({ fetch: f });
    expect(svc.peek?.()).toBeUndefined();
    const r = await svc.stamps();
    expect(r.ok && r.value).toEqual([STAMP]);
    expect(svc.peek?.()).toEqual([STAMP]);
    const c = await svc.claim({ eventId: 'e2', source: 'room', at: 5 });
    expect(c).toEqual({ ok: false, error: { code: 'forbidden', reason: 'no-presence', retryAfterMs: 9000 } });
    expect(f).toHaveBeenLastCalledWith('/api/me/stamps', expect.objectContaining({ method: 'POST', body: JSON.stringify({ eventId: 'e2', source: 'room', at: 5 }) }));
  });

  it('beat loop follows nextBeatMs on the site clock and stops on null', async () => {
    const answers = [{ nextBeatMs: 20_000 }, { nextBeatMs: 20_000 }, { nextBeatMs: null }];
    const f = fakeFetch(() => ({ body: { ok: true, value: answers.shift() } }));
    const svc = createHttpPassport({ fetch: f });
    const { clock, tick, subs } = fakeClock(1_000_000);
    const off = svc.trackPresence({ source: 'country', eventIds: ['unknown-evt'], openedAt: new Map() }, clock);
    await flush();
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse((f.mock.calls[0]![1] as { body: string }).body)).toMatchObject({ eventIds: ['unknown-evt'], source: 'country' });
    tick(1_019_000);
    await flush();
    expect(f).toHaveBeenCalledTimes(1);
    tick(1_020_000);
    await flush();
    expect(f).toHaveBeenCalledTimes(2);
    tick(1_040_000);
    await flush();
    expect(f).toHaveBeenCalledTimes(3);
    tick(9_000_000);
    await flush();
    expect(f).toHaveBeenCalledTimes(3);
    off();
    expect(subs.size).toBe(0);
  });

  it('a failed beat retries after retryAfterMs (not earlier)', async () => {
    const answers = [
      { status: 503, body: { ok: false, error: { code: 'unavailable', retryAfterMs: 12_000 } } },
      { body: { ok: true, value: { nextBeatMs: null } } },
    ];
    const f = fakeFetch(() => answers.shift()!);
    const svc = createHttpPassport({ fetch: f });
    const { clock, tick } = fakeClock(1);
    const off = svc.trackPresence({ source: 'air', eventIds: ['x'], openedAt: new Map() }, clock);
    await flush();
    tick(11_000);
    await flush();
    expect(f).toHaveBeenCalledTimes(1);
    tick(12_001);
    await flush();
    expect(f).toHaveBeenCalledTimes(2);
    off();
  });

  it('null surface: no beats', async () => {
    const f = fakeFetch(() => ({ body: {} }));
    const svc = createHttpPassport({ fetch: f });
    svc.trackPresence(null, fakeClock(0).clock)();
    await flush();
    expect(f).not.toHaveBeenCalled();
  });
});
