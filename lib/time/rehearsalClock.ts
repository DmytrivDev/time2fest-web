/**
 * Репетиція (SPEC-07, AC-57): подія `clock` публічного каналу `site:state` → `TimeSource.resync()`.
 * Транспорт підвантажується динамічно; сам модуль підключається лише за ознакою збірки (NFR-3).
 */
export const CLOCK_CHANNEL = 'site:state';
export const RESYNC_DEBOUNCE_MS = 500;

interface Envelope {
  type?: unknown;
}
interface Transport {
  subscribe(
    channel: string,
    listener: { onEvent(event: Envelope): void; onResync?(): void; onForbidden?(): void },
  ): () => void;
}

export interface RehearsalClockDeps {
  loadTransport?: () => Promise<Transport>;
  setTimer?: (fn: () => void, ms: number) => () => void;
}

export function startRehearsalClock(source: { resync(): unknown }, deps: RehearsalClockDeps = {}): () => void {
  const load =
    deps.loadTransport ??
    (async () => {
      const m = await import('@/lib/api/http/realtime');
      return m.getRealtimeTransport() as unknown as Transport;
    });
  const setTimer =
    deps.setTimer ??
    ((fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    });
  let stopped = false;
  let unsubscribe: (() => void) | null = null;
  let cancelDebounce: (() => void) | null = null;

  const schedule = (): void => {
    cancelDebounce?.();
    cancelDebounce = setTimer(() => {
      cancelDebounce = null;
      if (!stopped) void source.resync();
    }, RESYNC_DEBOUNCE_MS);
  };

  void load()
    .then((transport) => {
      if (stopped) return;
      unsubscribe = transport.subscribe(CLOCK_CHANNEL, {
        onEvent: (event) => {
          if (event.type === 'clock') schedule();
        },
        onResync: schedule,
      });
    })
    .catch(() => {
      /* realtime недоступний: лишається періодична синхронізація */
    });

  return () => {
    stopped = true;
    cancelDebounce?.();
    cancelDebounce = null;
    unsubscribe?.();
    unsubscribe = null;
  };
}
