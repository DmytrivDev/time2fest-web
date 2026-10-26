/**
 * Ранній запит `/api/time` (SC-001): інлайн-скрипт у `<head>` стартує його під час розбору HTML, а не після гідратації
 * (на мобільному 4G це ~3 с різниці). `TimeSource` бере цю відповідь першою пробою серії.
 * RTT і момент відповіді беремо з Resource Timing (`requestStart`/`responseStart`): вони не залежать від того,
 * наскільки зайнятий головний потік, коли спрацьовує колбек.
 */
export const TIME_PREFETCH_KEY = '__t2fTimePrefetch';

export interface TimePrefetch {
  url: string;
  p0: number;
  promise: Promise<{ now: unknown; p1: number } | null>;
}

export const TIME_PREFETCH_SCRIPT = `(function(){try{var u=new URL('/api/time',location.href).href;var p0=performance.now();window.${TIME_PREFETCH_KEY}={url:u,p0:p0,promise:fetch(u,{cache:'no-store',headers:{Accept:'application/json'}}).then(function(r){var p1=performance.now();if(!r.ok)return null;return r.json().then(function(b){return{now:b&&b.now,p1:p1}})}).catch(function(){return null})}}catch(e){}})();`;

/** Забирає (одноразово) ранню відповідь як пробу `{ rtt, offset }`; `null`, якщо її немає чи вона невдала. */
export async function takeTimePrefetch(
  win: unknown,
): Promise<{ rtt: number; offset: number } | null> {
  const w = win as Record<string, unknown> | null | undefined;
  const pre = w?.[TIME_PREFETCH_KEY] as TimePrefetch | undefined;
  if (!pre || typeof pre.promise?.then !== 'function') return null;
  delete w![TIME_PREFETCH_KEY];
  const res = await pre.promise;
  if (!res || typeof res.now !== 'number' || !Number.isInteger(res.now) || res.now < 0) return null;
  let t0 = pre.p0;
  let t1 = res.p1;
  try {
    const entries = performance.getEntriesByName(
      pre.url,
      'resource',
    ) as PerformanceResourceTiming[];
    const e = entries[0];
    if (e && e.requestStart > 0 && e.responseStart >= e.requestStart) {
      t0 = e.requestStart;
      t1 = e.responseStart;
    }
  } catch {
    // без Resource Timing — моменти з колбеків
  }
  return { rtt: t1 - t0, offset: res.now - (t0 + t1) / 2 };
}
