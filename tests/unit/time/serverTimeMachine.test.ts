import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS, ServerTimeMachine, type ServerTimeMachineDeps } from '@/lib/time/serverTimeMachine';

/** SPEC-07 AC-59…AC-61: серверна машина часу над тестовим годинником (`GET/POST /api/_test/clock`). */
const ENDPOINT = '/api/_test/clock';
const V0 = Date.parse('2026-12-31T22:59:00Z');

type Step = readonly [number, number] | 'fail';

function harness() {
  const clock = { perf: 1_000 };
  /** Тестовий годинник сервера: віртуальний якір на його реальному часі (= perf). */
  const srv = { virtual: V0, real: clock.perf, speed: 1, frozen: false };
  const srvNow = () => (srv.frozen ? srv.virtual : srv.virtual + (clock.perf - srv.real) * srv.speed);
  const plan: Step[] = [];
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const onUnreachable = vi.fn();
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const step = plan.shift() ?? ([20, 20] as const);
    await Promise.resolve(); // мережа — після повернення з виклику, а не всередині `set()`
    if (step === 'fail') throw new TypeError('network');
    clock.perf += step[0];
    if (init?.method === 'POST') {
      const b = JSON.parse(String(init.body)) as { at?: number; speed?: number; frozen?: boolean };
      srv.virtual = b.at ?? srvNow();
      srv.real = clock.perf;
      if (b.speed !== undefined) srv.speed = b.speed;
      if (b.frozen !== undefined) srv.frozen = b.frozen;
    }
    const value = { now: Math.round(srvNow()), speed: srv.speed, frozen: srv.frozen };
    clock.perf += step[1];
    return new Response(JSON.stringify({ ok: true, value }), { status: 200 });
  });
  const deps: ServerTimeMachineDeps = {
    endpoint: ENDPOINT,
    fetch: fetch as unknown as typeof globalThis.fetch,
    perfNow: () => clock.perf,
    dateNow: () => 0,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    onUnreachable,
  };
  /** Сервер змінено поза сторінкою (інша вкладка, тест). */
  const changeServer = (at: number, speed = srv.speed) => {
    srv.virtual = at;
    srv.real = clock.perf;
    srv.speed = speed;
  };
  return { clock, srv, srvNow, plan, timers, fetch, deps, onUnreachable, changeServer };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const pendingPoll = (h: ReturnType<typeof harness>) => h.timers.find((t) => !t.cancelled && t.ms === POLL_MS);
async function firePoll(h: ReturnType<typeof harness>) {
  const t = pendingPoll(h)!;
  t.cancelled = true;
  t.fn();
  await settle();
  await settle();
}

describe('ServerTimeMachine', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it('AC-59: старт без параметрів — стан із GET з поправкою RTT/2; ready після відповіді', async () => {
    h.plan.push([150, 150]);
    const m = new ServerTimeMachine(h.deps);
    const seen = vi.fn();
    m.subscribe(seen);
    expect(m.ready).toBe(false);
    m.start();
    await settle();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.fetch.mock.calls[0]![0]).toBe(ENDPOINT);
    expect(h.fetch.mock.calls[0]![1]?.method).toBeUndefined();
    expect(m.ready).toBe(true);
    expect(m.status).toBe('machine');
    expect(seen).toHaveBeenCalledTimes(1);
    // сервер порахував `now` посередині запиту — RTT/2 його доганяє
    expect(Math.abs(m.now() - h.srvNow())).toBeLessThanOrEqual(1);
    h.clock.perf += 10_000;
    expect(Math.abs(m.now() - h.srvNow())).toBeLessThanOrEqual(1);
    m.stop();
  });

  it('AC-60: set — одразу локально, POST { at, speed, frozen: false }, далі якір із відповіді', async () => {
    const m = new ServerTimeMachine(h.deps);
    m.start();
    await settle();
    const at = Date.parse('2026-12-31T23:59:30Z');
    m.set({ at, speed: 10 });
    expect(m.get()).toEqual({ at, speed: 10 });
    await settle();
    const post = h.fetch.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ at, speed: 10, frozen: false });
    expect(h.srv).toMatchObject({ virtual: at, speed: 10, frozen: false });
    h.clock.perf += 3_000;
    expect(Math.abs(m.now() - h.srvNow())).toBeLessThanOrEqual(10 * 20 + 1);
    expect(m.speed).toBe(10);
    m.stop();
  });

  it('AC-60: advance — POST з at = now + ms; від’ємне ігнорується', async () => {
    const m = new ServerTimeMachine(h.deps);
    m.start();
    await settle();
    const before = m.now();
    m.advance(60_000);
    expect(m.now()).toBe(Math.round(before + 60_000));
    m.advance(-5);
    await settle();
    const posts = h.fetch.mock.calls.filter((c) => c[1]?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]![1]!.body))).toEqual({ at: Math.round(before + 60_000) });
    m.stop();
  });

  it('start з параметрами — один POST і без GET', async () => {
    const m = new ServerTimeMachine(h.deps);
    const at = Date.parse('2027-01-01T00:59:00Z');
    m.start({ at, speed: 0 });
    expect(m.ready).toBe(true);
    expect(m.get()).toEqual({ at, speed: 0 });
    await settle();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.fetch.mock.calls[0]![1]?.method).toBe('POST');
    expect(JSON.parse(String(h.fetch.mock.calls[0]![1]!.body))).toEqual({ at, speed: 0, frozen: false });
    m.stop();
  });

  it('AC-61: зміну поза сторінкою видно з наступного опитування (≤2 с)', async () => {
    const m = new ServerTimeMachine(h.deps);
    m.start();
    await settle();
    expect(pendingPoll(h)!.ms).toBeLessThanOrEqual(2_000 - 2 * 20);
    const seen = vi.fn();
    m.subscribe(seen);
    const at = Date.parse('2027-01-01T01:59:00+02:00');
    h.changeServer(at, 60);
    h.clock.perf += POLL_MS;
    await firePoll(h);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(m.speed).toBe(60);
    expect(Math.abs(m.now() - h.srvNow())).toBeLessThanOrEqual(60);
    // наступне опитування заплановане
    expect(pendingPoll(h)).toBeDefined();
    m.stop();
  });

  it('frozen на сервері — швидкість 0, відлік стоїть', async () => {
    h.srv.frozen = true;
    const m = new ServerTimeMachine(h.deps);
    m.start();
    await settle();
    expect(m.speed).toBe(0);
    const v = m.now();
    h.clock.perf += 30_000;
    expect(m.now()).toBe(v);
    m.stop();
  });

  it('розбіжність ≤250 мс з опитування — якір не переставляється, без сповіщення', async () => {
    const m = new ServerTimeMachine(h.deps);
    m.start();
    await settle();
    const seen = vi.fn();
    m.subscribe(seen);
    h.changeServer(h.srvNow() + 200);
    await firePoll(h);
    expect(seen).not.toHaveBeenCalled();
    m.stop();
  });

  it('відмова лишає якір; одне попередження за сеанс; опитування триває', async () => {
    const m = new ServerTimeMachine(h.deps);
    m.start();
    await settle();
    const before = m.now();
    h.plan.push('fail', 'fail');
    h.clock.perf += POLL_MS;
    await firePoll(h);
    await firePoll(h);
    expect(m.ready).toBe(true);
    expect(m.now()).toBeCloseTo(before + POLL_MS, 6);
    expect(h.onUnreachable).toHaveBeenCalledTimes(1);
    expect(pendingPoll(h)).toBeDefined();
    m.stop();
  });

  it('відповідь опитування, що стартувало до локальної зміни, зміну не перебиває', async () => {
    const m = new ServerTimeMachine(h.deps);
    m.start();
    await settle();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const stale = { now: V0, speed: 1, frozen: false };
    h.fetch.mockImplementationOnce(async () => {
      await gate;
      return new Response(JSON.stringify({ ok: true, value: stale }), { status: 200 });
    });
    const t = pendingPoll(h)!;
    t.cancelled = true;
    t.fn();
    const at = Date.parse('2027-01-01T03:00:00Z');
    m.set({ at });
    release();
    await settle();
    await settle();
    expect(Math.abs(m.now() - at)).toBeLessThan(1_000);
    m.stop();
  });

  it('stop — опитування більше не планується', async () => {
    const m = new ServerTimeMachine(h.deps);
    m.start();
    await settle();
    m.stop();
    expect(pendingPoll(h)).toBeUndefined();
  });
});
