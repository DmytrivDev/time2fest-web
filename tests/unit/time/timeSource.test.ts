import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeSource, type TimeSourceDeps } from '@/lib/time/TimeSource';

/** Справжній серверний час = EPOCH + perf (perf — монотонний час пристрою). */
const EPOCH = Date.parse('2026-12-31T23:38:00Z');

interface Harness {
  deps: TimeSourceDeps;
  clock: { perf: number; skew: number };
  timers: { fn: () => void; ms: number; cancelled: boolean }[];
  /** Затримки для наступних запитів: [туди, назад] або 'fail' / 'bad'. */
  plan: (readonly [number, number] | 'fail' | 'bad')[];
  warn: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
  doc: EventTarget & { visibilityState: DocumentVisibilityState };
  win: EventTarget;
}

function harness(): Harness {
  const clock = { perf: 1_000, skew: 0 };
  const timers: Harness['timers'] = [];
  const plan: Harness['plan'] = [];
  const warn = vi.fn();
  const fetch = vi.fn(async () => {
    const step = plan.shift() ?? 'fail';
    if (step === 'fail') {
      clock.perf += 50;
      throw new TypeError('network');
    }
    if (step === 'bad') {
      clock.perf += 50;
      return new Response(JSON.stringify({ t: 1 }), { status: 200 });
    }
    const [there, back] = step;
    clock.perf += there;
    const now = EPOCH + clock.perf;
    clock.perf += back;
    return new Response(JSON.stringify({ now }), { status: 200 });
  });
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
  });
  const win = new EventTarget();
  const deps: TimeSourceDeps = {
    fetch: fetch as unknown as typeof globalThis.fetch,
    perfNow: () => clock.perf,
    dateNow: () => EPOCH + clock.perf + clock.skew,
    sleep: async (ms) => {
      clock.perf += ms;
    },
    setTimer: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    warn,
    doc,
    win,
  };
  return { deps, clock, timers, plan, warn, fetch, doc, win };
}

const truth = (h: Harness) => EPOCH + h.clock.perf;
const pending = (h: Harness) => h.timers.filter((t) => !t.cancelled);
async function fire(h: Harness, t: { fn: () => void; cancelled: boolean }) {
  t.cancelled = true;
  t.fn();
  await vi.waitFor(() => undefined);
  await Promise.resolve();
}

describe('TimeSource', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('серія з 5 запитів з інтервалом ≈300 мс і медіана 3 найшвидших', async () => {
    // асиметричні затримки: швидкі симетричні дають точний результат; повільні — похибку
    h.plan.push([400, 100], [20, 20], [30, 30], [25, 25], [500, 600]);
    const ts = new TimeSource(h.deps);
    const p0 = h.clock.perf;
    await ts.sync();
    expect(h.fetch).toHaveBeenCalledTimes(5);
    // 4 паузи по 300 мс між запитами + rtt
    expect(h.clock.perf - p0).toBe(4 * 300 + 500 + 40 + 60 + 50 + 1100);
    expect(ts.status).toBe('server');
    expect(ts.ready).toBe(true);
    // Якір ставиться з першої відповіді (SC-001), медіана серії доводить його плавно за SLEW_MS.
    h.clock.perf += 2_000;
    expect(Math.abs(ts.now() - truth(h))).toBeLessThan(1);
  });

  it('ready одразу після першої вдалої відповіді, не чекаючи серії', async () => {
    h.plan.push([20, 20], [20, 20], [20, 20], [20, 20], [20, 20]);
    const ts = new TimeSource(h.deps);
    const seen: boolean[] = [];
    ts.subscribe(() => seen.push(ts.ready));
    await ts.sync();
    expect(seen[0]).toBe(true);
    expect(seen.length).toBe(2); // перша відповідь + уточнення медіаною
  });

  it('відкидає спроби з rtt > 2000 мс і невдалі', async () => {
    h.plan.push([1500, 1500], 'fail', [10, 10], 'bad', [3000, 10]);
    const ts = new TimeSource(h.deps);
    await ts.sync();
    expect(ts.status).toBe('server');
    // лишилась одна придатна спроба (симетрична) → точний якір
    expect(Math.abs(ts.now() - truth(h))).toBeLessThan(1);
  });

  it('now() = anchor.server + (performance.now() − anchor.perf)', async () => {
    h.plan.push([10, 10], [10, 10], [10, 10], [10, 10], [10, 10]);
    const ts = new TimeSource(h.deps);
    await ts.sync();
    const a = ts.anchor!;
    h.clock.perf += 12_345;
    expect(ts.now()).toBeCloseTo(a.server + (h.clock.perf - a.perf), 6);
  });

  it('зсув Date.now() на ±10 хв не впливає на відлік', async () => {
    h.plan.push([10, 10], [10, 10], [10, 10], [10, 10], [10, 10]);
    const ts = new TimeSource(h.deps);
    await ts.sync();
    const before = ts.now();
    h.clock.skew += 10 * 60_000;
    expect(ts.now()).toBe(before);
    h.clock.skew -= 20 * 60_000;
    h.clock.perf += 1_000;
    expect(ts.now()).toBe(before + 1_000);
  });

  it('резерв: годинник пристрою, один console.warn', async () => {
    const ts = new TimeSource(h.deps);
    expect(await ts.sync()).toBe(false);
    expect(ts.status).toBe('device-fallback');
    expect(ts.ready).toBe(true);
    expect(ts.now()).toBe(EPOCH + h.clock.perf + h.clock.skew);
    await ts.sync();
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0]![0]).toBe(
      '[time] /api/time недоступний, відлік від годинника пристрою',
    );
  });

  it('AC-2: fetch завжди відмовляє — device-fallback і рівно одне попередження на сеанс', async () => {
    const ts = new TimeSource(h.deps);
    ts.start();
    await vi.waitFor(() => expect(ts.ready).toBe(true));
    for (let i = 0; i < 3; i++) {
      const retry = pending(h).find((t) => t.ms !== 10 * 60_000)!;
      await fire(h, retry);
      await vi.waitFor(() => expect(pending(h).some((t) => t.ms !== 10 * 60_000)).toBe(true));
    }
    expect(ts.status).toBe('device-fallback');
    expect(h.warn).toHaveBeenCalledTimes(1);
    ts.stop();
  });

  it('AC-3: після вдалого заміру відмови не змінюють стан server і now()', async () => {
    h.plan.push([10, 10], [10, 10], [10, 10], [10, 10], [10, 10]);
    const ts = new TimeSource(h.deps);
    await ts.sync();
    const a = ts.anchor!;
    expect(await ts.sync()).toBe(false);
    expect(await ts.sync(1)).toBe(false);
    expect(ts.status).toBe('server');
    expect(ts.anchor).toBe(a);
    h.clock.perf += 5_000;
    expect(ts.now()).toBeCloseTo(a.server + (h.clock.perf - a.perf), 6);
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('експонентна пауза 5 → 10 → 20 → 60 с, після успіху — сервер', async () => {
    const ts = new TimeSource(h.deps);
    ts.start();
    await vi.waitFor(() => expect(ts.ready).toBe(true));
    expect(ts.status).toBe('device-fallback');
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      const retry = pending(h).find((t) => t.ms !== 10 * 60_000)!;
      delays.push(retry.ms);
      await fire(h, retry);
      await vi.waitFor(() => expect(pending(h).some((t) => t.ms !== 10 * 60_000)).toBe(true));
    }
    expect(delays).toEqual([5_000, 10_000, 20_000, 60_000, 60_000]);
    h.plan.push([10, 10], [10, 10], [10, 10], [10, 10], [10, 10]);
    const retry = pending(h).find((t) => t.ms !== 10 * 60_000)!;
    await fire(h, retry);
    await vi.waitFor(() => expect(ts.status).toBe('server'));
    ts.stop();
  });

  it('після резерву перехід на якір без смикання, якщо різниця < 1 с', async () => {
    h.clock.skew = 600; // годинник пристрою поспішає на 0,6 с
    const ts = new TimeSource(h.deps);
    await ts.sync(); // невдача → резерв
    expect(ts.now()).toBe(truth(h) + 600);
    h.plan.push([10, 10], [10, 10], [10, 10], [10, 10], [10, 10]);
    await ts.sync();
    // показання не стрибають: поправка йде плавно від резерву (+0,6 с) до якоря
    const right = ts.now() - truth(h);
    expect(right).toBeGreaterThan(0);
    expect(right).toBeLessThanOrEqual(600);
    h.clock.perf += 500;
    const mid = ts.now() - truth(h);
    expect(mid).toBeGreaterThanOrEqual(0);
    expect(mid).toBeLessThan(right);
    // за кілька секунд поправка завершена
    h.clock.perf += 5_000;
    expect(Math.abs(ts.now() - truth(h))).toBeLessThan(1);
  });

  it('різниця ≥ 1 с — перескок одразу', async () => {
    h.clock.skew = 5_000;
    const ts = new TimeSource(h.deps);
    await ts.sync();
    h.plan.push([10, 10], [10, 10], [10, 10], [10, 10], [10, 10]);
    await ts.sync();
    expect(Math.abs(ts.now() - truth(h))).toBeLessThan(1);
  });

  it('повторна синхронізація: visibilitychange після >60 с прихованості', async () => {
    h.plan.push([10, 10], [10, 10], [10, 10], [10, 10], [10, 10]);
    const ts = new TimeSource(h.deps);
    ts.start();
    await vi.waitFor(() => expect(ts.status).toBe('server'));
    const calls = h.fetch.mock.calls.length;

    h.doc.visibilityState = 'hidden';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    h.clock.perf += 30_000;
    h.doc.visibilityState = 'visible';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    expect(h.fetch.mock.calls.length).toBe(calls); // лише 30 с — без синхронізації

    h.doc.visibilityState = 'hidden';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    h.clock.perf += 61_000;
    h.doc.visibilityState = 'visible';
    h.plan.push([10, 10], [10, 10], [10, 10], [10, 10], [10, 10]);
    h.doc.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(h.fetch.mock.calls.length).toBe(calls + 5));
    ts.stop();
  });

  it('повторна синхронізація: online і фоново раз на 10 хв', async () => {
    h.plan.push([10, 10], [10, 10], [10, 10], [10, 10], [10, 10]);
    const ts = new TimeSource(h.deps);
    ts.start();
    await vi.waitFor(() => expect(ts.status).toBe('server'));
    const calls = h.fetch.mock.calls.length;

    h.plan.push([10, 10], [10, 10], [10, 10], [10, 10], [10, 10]);
    h.win.dispatchEvent(new Event('offline'));
    h.win.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(h.fetch.mock.calls.length).toBe(calls + 5));

    const periodic = pending(h).find((t) => t.ms === 10 * 60_000);
    expect(periodic).toBeDefined();
    h.plan.push([10, 10]);
    await fire(h, periodic!);
    await vi.waitFor(() => expect(h.fetch.mock.calls.length).toBe(calls + 6)); // одне опитування
    ts.stop();
  });
});
