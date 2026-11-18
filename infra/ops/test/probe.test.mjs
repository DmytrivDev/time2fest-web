// @ts-check
// AC-53: зонд простою щосекунди питає `GET /api/health` через край; простій — у цілих секундах.
import { describe, expect, it } from 'vitest';
import { downtimeMs, startProbe } from '../lib/probe.mjs';

const URL_OK = 'https://rehearsal.time2fest.com/api/health';
const flush = () => new Promise((r) => setImmediate(r));

/** Підставний годинник: таймери спрацьовують лише в `advance`. */
function manualClock() {
  let t = 0;
  /** @type {{ at: number, fn: () => void }[]} */
  let timers = [];
  return {
    now: () => t,
    /** @param {() => void} fn @param {number} ms */
    setTimeout(fn, ms) {
      const h = { at: t + ms, fn };
      timers.push(h);
      return h;
    },
    /** @param {unknown} h */
    clearTimeout(h) {
      timers = timers.filter((x) => x !== h);
    },
    /** @param {number} ms */
    async advance(ms) {
      const end = t + ms;
      await flush();
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const nx = timers[0];
        if (!nx || nx.at > end) break;
        timers.shift();
        t = nx.at;
        nx.fn();
        await flush();
      }
      t = end;
      await flush();
    },
  };
}

/**
 * Підставний fetch: відповідає статусами по черзі; `'hang'` — не відповідає, доки не скасують.
 * @param {(number | 'hang')[]} answers
 */
function scriptedFetch(answers) {
  /** @type {{ url: string, init: RequestInit | undefined }[]} */
  const calls = [];
  let aborted = 0;
  /** @type {typeof globalThis.fetch} */
  const fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const a = answers[calls.length - 1] ?? 200;
    if (a === 'hang') {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted += 1;
          reject(new Error('aborted'));
        });
      });
    }
    return new Response(null, { status: a });
  };
  return { fetch, calls, aborted: () => aborted };
}

describe('startProbe', () => {
  it('200, 503, 503, 200 at 1-second ticks → 2 s', async () => {
    const clock = manualClock();
    const f = scriptedFetch([200, 503, 503, 200]);
    const p = startProbe({ url: URL_OK, clock, fetch: f.fetch });
    await clock.advance(3000);
    expect(p.stop()).toEqual({ downtimeSeconds: 2, samples: 4, failures: 2 });
    expect(f.calls.map((c) => c.url)).toEqual(Array(4).fill(URL_OK));
    expect(f.calls[0].init?.method).toBe('GET');
  });

  it('all 200 → 0', async () => {
    const clock = manualClock();
    const p = startProbe({ url: URL_OK, clock, fetch: scriptedFetch([]).fetch });
    await clock.advance(5000);
    expect(p.stop()).toEqual({ downtimeSeconds: 0, samples: 6, failures: 0 });
  });

  it('a run still open at stop counts up to stop, rounded up', async () => {
    const clock = manualClock();
    const p = startProbe({ url: URL_OK, clock, fetch: scriptedFetch([200, 503]).fetch });
    await clock.advance(1500);
    expect(p.stop().downtimeSeconds).toBe(1);
    await clock.advance(5000);
    expect(p.stop().samples).toBe(2); // після stop проб немає, підсумок не змінюється
  });

  it('a request without an answer in 2 s is aborted and counts as a failure', async () => {
    const clock = manualClock();
    const f = scriptedFetch([200, 'hang', 200, 200]);
    const p = startProbe({ url: URL_OK, clock, fetch: f.fetch });
    await clock.advance(3000);
    expect(f.aborted()).toBe(1);
    expect(p.stop()).toEqual({ downtimeSeconds: 1, samples: 4, failures: 1 });
  });

  it('the check form (local target) uses the same arithmetic; a throwing check is a failure', async () => {
    const clock = manualClock();
    const answers = [true, false, 'throw', true];
    let i = 0;
    const check = async () => {
      const a = answers[i++] ?? true;
      if (a === 'throw') throw new Error('container down');
      return a === true;
    };
    const p = startProbe({ check, clock });
    await clock.advance(3000);
    expect(p.stop()).toEqual({ downtimeSeconds: 2, samples: 4, failures: 2 });
  });

  it('refuses a URL that is not https://<host>/api/health', () => {
    for (const url of ['http://rehearsal.time2fest.com/api/health', 'https://u:p@rehearsal.time2fest.com/api/health', 'https://rehearsal.time2fest.com/', 'nope']) {
      expect(() => startProbe({ url, clock: manualClock() })).toThrow(TypeError);
    }
  });
});

describe('downtimeMs', () => {
  it('sums several runs and ignores arrival order', () => {
    const s = [
      { at: 3000, ok: true }, { at: 0, ok: true }, { at: 1000, ok: false }, { at: 2000, ok: false },
      { at: 4000, ok: false }, { at: 5000, ok: true },
    ];
    expect(downtimeMs(s, 6000)).toBe(3000);
  });
});
