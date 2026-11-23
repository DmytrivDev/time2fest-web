/**
 * Лічена присутність глядача (SPEC-12 AC-59, AC-61, рішення плану [П-1]).
 * Серед вкладок одного браузера одна тримає Web Lock `t2f-viewer`: лише вона підписана на `live:viewers` з токеном
 * підписки (`GET /api/live/viewer-token`, у ньому `info.p = 1` і країна з Cloudflare) — сервер рахує саме такі записи
 * присутності. Решта вкладок підписані без токена. Коли вкладка з замком закривається, браузер звільняє замок і його
 * бере наступна вкладка, що чекає.
 * Нічого не зберігається: ні cookie, ні localStorage / sessionStorage, ні ідентифікатора; токен живе лише в клієнті
 * Centrifugo й ніде не логується. Без `navigator.locks` кожна вкладка йде лічуваним шляхом (переоблік, не збій).
 */
import type { RealtimeEnvelope, Unsubscribe } from '@time2fest/contracts';

export const VIEWER_TOKEN_URL = '/api/live/viewer-token';
export const VIEWER_LOCK_NAME = 't2f-viewer';

/** Слухач каналу; `RealtimeListener` транспорту йому відповідає. */
export interface ViewerChannelListener {
  onEvent(event: RealtimeEnvelope): void;
}

/**
 * Частина транспорту realtime, потрібна модулю (`RealtimeTransport` їй відповідає). Описана тут, а не імпортована з
 * `./realtime`, щоб модуль не мав жодного шляху до транспорту, крім ледачого в `live.ts` (AC-23, AC-55 SPEC-06).
 */
export interface ViewerChannelTransport {
  subscribe(channel: string, listener: ViewerChannelListener, options?: { getToken?: () => Promise<string> }): Unsubscribe;
}

/** Частина `LockManager`, якою користується модуль; `navigator.locks` їй відповідає. */
export interface ViewerLockManager {
  request(
    name: string,
    options: { mode: 'exclusive'; signal?: AbortSignal },
    callback: () => Promise<void>,
  ): Promise<unknown>;
}

/** Подія `pagehide` / `pageshow` сторінки; `window` їй відповідає. */
export interface ViewerPageEvents {
  addEventListener(type: 'pagehide' | 'pageshow', listener: (event: { persisted?: boolean }) => void): void;
  removeEventListener(type: 'pagehide' | 'pageshow', listener: (event: { persisted?: boolean }) => void): void;
}

export interface ViewerTokenResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

export type ViewerTokenFetch = (
  input: string,
  init: { credentials: 'same-origin'; cache: 'no-store' },
) => Promise<ViewerTokenResponse>;

export interface CountedViewersOptions {
  transport: ViewerChannelTransport;
  channel: string;
  listener: ViewerChannelListener;
  /** `null` — Web Locks немає. Типово `navigator.locks`. */
  locks?: ViewerLockManager | null;
  fetch?: ViewerTokenFetch;
  /** `null` — без подій сторінки. Типово `window`. */
  page?: ViewerPageEvents | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function defaultLocks(): ViewerLockManager | null {
  const nav = (globalThis as { navigator?: { locks?: ViewerLockManager } }).navigator;
  return nav?.locks && typeof nav.locks.request === 'function' ? nav.locks : null;
}

function defaultPage(): ViewerPageEvents | null {
  const win = (globalThis as { window?: ViewerPageEvents }).window;
  return win && typeof win.addEventListener === 'function' ? win : null;
}

/** Токен з тіла C1 (`{ok:true, value:{token}}`); будь-що інше, відмова чи збій мережі — `''`. */
async function requestViewerToken(doFetch: ViewerTokenFetch): Promise<string> {
  try {
    const res = await doFetch(VIEWER_TOKEN_URL, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return '';
    const body: unknown = await res.json();
    if (!isRecord(body) || body.ok !== true || !isRecord(body.value)) return '';
    const { token } = body.value;
    return typeof token === 'string' ? token : '';
  } catch {
    return '';
  }
}

/**
 * Підписати `listener` на канал глядачів: одразу без токена, а лічено — коли ця вкладка тримає замок (чи замків
 * немає). Повертає відписку, яка звільняє замок.
 */
export function subscribeCountedViewers(options: CountedViewersOptions): Unsubscribe {
  const { transport, channel, listener } = options;
  const locks = options.locks === undefined ? defaultLocks() : options.locks;
  const page = options.page === undefined ? defaultPage() : options.page;
  const doFetch: ViewerTokenFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  let stopped = false;
  let off: Unsubscribe = transport.subscribe(channel, listener);
  /** Номер поточного лічуваного сеансу; звільнення замка його збільшує, і запізнілий токен нічого не робить. */
  let session = 0;
  let counted = false;
  let held: { release(): void; abort: AbortController } | null = null;

  /** Перейти на лічену підписку: спершу підписка з токеном, потім відписка без нього — подій ніхто не втрачає. */
  async function becomeCounted(): Promise<void> {
    if (counted) return;
    const mine = session;
    const token = await requestViewerToken(doFetch);
    if (stopped || mine !== session || !token) return;
    let first: string | null = token;
    const offCounted = transport.subscribe(channel, listener, {
      getToken: async () => {
        if (first) {
          const t = first;
          first = null;
          return t;
        }
        // Оновлення (токен живе 1 год): порожня відповідь — помилка, і клієнт Centrifugo повторить пізніше.
        const next = await requestViewerToken(doFetch);
        if (!next) throw new Error('viewer token unavailable');
        return next;
      },
    });
    off();
    off = offCounted;
    counted = true;
  }

  /** Назад до підписки без токена (замок звільнено). */
  function becomePlain(): void {
    session += 1;
    if (!counted || stopped) return;
    const offPlain = transport.subscribe(channel, listener);
    off();
    off = offPlain;
    counted = false;
  }

  function acquire(): void {
    if (stopped || held) return;
    if (!locks) {
      void becomeCounted();
      return;
    }
    const abort = new AbortController();
    const current: { release(): void; abort: AbortController } = { release: () => {}, abort };
    held = current;
    locks
      .request(VIEWER_LOCK_NAME, { mode: 'exclusive', signal: abort.signal }, () => {
        if (stopped || held !== current) return Promise.resolve();
        // Замок тримається, доки проміс не виконано: до відписки чи `pagehide`.
        const holding = new Promise<void>((resolve) => {
          current.release = resolve;
        });
        void becomeCounted();
        return holding;
      })
      .catch(() => {
        /* запит скасовано (AbortError) чи замки недоступні: лишаємося без токена */
      });
  }

  function release(): void {
    const current = held;
    held = null;
    if (current) {
      current.abort.abort();
      current.release();
    }
    becomePlain();
  }

  const onPageHide = () => release();
  const onPageShow = (event: { persisted?: boolean }) => {
    if (event.persisted) acquire();
  };
  page?.addEventListener('pagehide', onPageHide);
  page?.addEventListener('pageshow', onPageShow);
  acquire();

  return () => {
    if (stopped) return;
    stopped = true;
    release();
    page?.removeEventListener('pagehide', onPageHide);
    page?.removeEventListener('pageshow', onPageShow);
    off();
  };
}
