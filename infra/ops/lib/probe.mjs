// @ts-check
// Зонд простою (AC-53): щосекунди один `GET https://<siteHost>/api/health` через край (тайм-аут 2 с; успіх — HTTP 200)
// або, для локальної цілі, підставна перевірка `check()`. `stop()` повертає простій у цілих секундах (вгору).
//
// Простій серії невдач = (перша успішна відповідь після серії) − (перша невдала проба серії); серія, що ще триває
// на `stop()`, рахується до `stop`. Для проб через рівні проміжки це кількість невдалих проб × крок:
// 200, 503, 503, 200 щосекунди → 2 с.

/**
 * @typedef {{
 *   now: () => number,
 *   setTimeout: (fn: () => void, ms: number) => unknown,
 *   clearTimeout: (handle: unknown) => void,
 * }} Clock Мілісекунди; у тестах — підставний годинник.
 * @typedef {{ at: number, ok: boolean }} Sample `at` — час початку проби.
 * @typedef {{ downtimeSeconds: number, samples: number, failures: number }} ProbeResult
 */

/** @type {Clock} */
const SYSTEM_CLOCK = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(/** @type {NodeJS.Timeout} */ (h)),
};

export const PROBE_TIMEOUT_MS = 2_000;

/**
 * Простій у мілісекундах за пробами (у будь-якому порядку надходження) до моменту `stopAt`.
 * @param {Sample[]} samples
 * @param {number} stopAt
 */
export function downtimeMs(samples, stopAt) {
  const sorted = [...samples].sort((a, b) => a.at - b.at);
  let total = 0;
  /** @type {number | null} */
  let failedSince = null;
  for (const s of sorted) {
    if (!s.ok && failedSince === null) failedSince = s.at;
    if (s.ok && failedSince !== null) {
      total += s.at - failedSince;
      failedSince = null;
    }
  }
  if (failedSince !== null) total += Math.max(0, stopAt - failedSince);
  return total;
}

/**
 * Обіцянка, що програє через `ms` (результат — `false`).
 * @param {Clock} clock
 * @param {number} ms
 * @param {() => void} [onTimeout]
 * @returns {{ promise: Promise<boolean>, cancel: () => void }}
 */
function timer(clock, ms, onTimeout) {
  /** @type {unknown} */
  let h;
  const promise = new Promise((resolve) => {
    h = clock.setTimeout(() => {
      onTimeout?.();
      resolve(false);
    }, ms);
  });
  return { promise: /** @type {Promise<boolean>} */ (promise), cancel: () => clock.clearTimeout(h) };
}

/**
 * Запускає зонд. Перша проба — одразу, далі кожні `every` мс від старту (без дрейфу).
 * @param {{
 *   url?: string,
 *   check?: () => Promise<boolean>,
 *   clock?: Clock,
 *   every?: number,
 *   timeoutMs?: number,
 *   fetch?: typeof globalThis.fetch,
 * }} o `url` — лише `https://…/api/health`; `check` — для локальної цілі (W18).
 * @returns {{ stop: () => ProbeResult }}
 */
export function startProbe(o) {
  const clock = o.clock ?? SYSTEM_CLOCK;
  const every = o.every ?? 1000;
  const timeoutMs = o.timeoutMs ?? PROBE_TIMEOUT_MS;
  if (!(every > 0) || !(timeoutMs > 0)) throw new TypeError('зонд: every і timeoutMs мають бути додатними');

  /** @type {() => Promise<boolean>} */
  let probeOnce;
  if (o.check) {
    const check = o.check;
    probeOnce = async () => {
      const t = timer(clock, timeoutMs);
      try {
        return await Promise.race([check().then((v) => v === true, () => false), t.promise]);
      } finally {
        t.cancel();
      }
    };
  } else {
    const url = parseProbeUrl(o.url);
    const doFetch = o.fetch ?? globalThis.fetch;
    probeOnce = async () => {
      const ac = new AbortController();
      const t = timer(clock, timeoutMs, () => ac.abort());
      try {
        const res = await Promise.race([
          doFetch(url, { method: 'GET', redirect: 'manual', cache: 'no-store', signal: ac.signal }),
          t.promise,
        ]);
        if (typeof res === 'boolean') return false; // тайм-аут
        const ok = res.status === 200;
        await res.body?.cancel().catch(() => {});
        return ok;
      } catch {
        return false;
      } finally {
        t.cancel();
      }
    };
  }

  /** @type {Sample[]} */
  const samples = [];
  const startedAt = clock.now();
  let n = 0;
  let stopped = false;
  /** @type {unknown} */
  let next;

  const tick = () => {
    if (stopped) return;
    const at = clock.now();
    probeOnce().then((ok) => {
      if (!stopped) samples.push({ at, ok }); // відповідь після `stop()` у підсумок не входить
    });
    n += 1;
    next = clock.setTimeout(tick, Math.max(0, startedAt + n * every - clock.now()));
  };
  tick();

  /** @type {ProbeResult | undefined} */
  let result;
  return {
    stop() {
      if (result) return result;
      stopped = true;
      clock.clearTimeout(next);
      const ms = downtimeMs(samples, clock.now());
      result = {
        downtimeSeconds: Math.ceil(ms / 1000),
        samples: samples.length,
        failures: samples.filter((s) => !s.ok).length,
      };
      return result;
    },
  };
}

/**
 * Лише `https://<host>/api/health` без облікових даних у URL.
 * @param {string | undefined} raw
 */
function parseProbeUrl(raw) {
  if (typeof raw !== 'string') throw new TypeError('зонд: потрібен url або check');
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new TypeError('зонд: недопустимий url');
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/api/health') {
    throw new TypeError('зонд: url має бути https://<host>/api/health');
  }
  return u.toString();
}
