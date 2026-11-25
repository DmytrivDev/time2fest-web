/**
 * Адаптер `http` домену `profile` (SPEC-11, AC-59, AC-60). Рецепт — `docs/backend/frontend-seam.md` §6.0 (як `auth.ts`).
 * - `get` — `GET /api/me/profile`; `update` — `PATCH /api/me/profile`; графік — `PUT /api/me/schedule`,
 *   `POST /api/me/schedule/toggle|replace` (відповідь — список id); пошта — `POST|DELETE /api/me/email`,
 *   `POST /api/me/email/verify`; Google — `POST|DELETE /api/me/google`.
 * - Тіла відповідей перевіряють безzod-охоронці `@time2fest/contracts` (`profileGuard`, П-14); помилки — `errorOf` з `auth.ts`.
 * - `linkGoogle` — `POST /api/me/google {returnPath}` → перехід `location.assign(url)`; сторінка йде, тож повертаємо
 *   останній відомий профіль (контракт чекає `Profile`).
 * - `subscribe` — події `profile` (і `session`, бо змінює власника) каналу `user:#<суб'єкт>` → перечитування профілю;
 *   суб'єкта дає `GET /api/auth/get-session`; зміна власника — перепідписка.
 * - `exportData` / `deleteAccount` — `unavailable` до SPEC-20. Токенів не зберігаємо: лише cookie.
 */
import { isProfileEvent, isSessionEvent, parseGoogleRedirect, parseProfile, parseScheduleIds, parseSession } from '@time2fest/contracts';
import type { Profile, ProfileService } from '../contracts/profile';
import { fail, ok, type ApiResult } from '../result';
import { AUTH_URLS, errorOf } from './auth';
import type { RealtimeTransport } from './realtime/types';

export const PROFILE_URLS = {
  profile: '/api/me/profile',
  schedule: '/api/me/schedule',
  scheduleToggle: '/api/me/schedule/toggle',
  scheduleReplace: '/api/me/schedule/replace',
  email: '/api/me/email',
  emailVerify: '/api/me/email/verify',
  google: '/api/me/google',
} as const;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ProfileFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type ProfileFetch = (
  input: string,
  init: { method: Method; credentials: 'include'; headers?: Record<string, string>; body?: string },
) => Promise<ProfileFetchResponse>;

export interface HttpProfileOptions {
  fetch?: ProfileFetch;
  /** Транспорт чи його завантажувач; `null` — realtime немає (підписка мовчить). */
  transport?: RealtimeTransport | (() => Promise<RealtimeTransport>) | null;
  /** Перехід на сторінку Google (у тестах підміняється). */
  navigate?: (url: string) => void;
  /** Поточний шлях для `returnPath` (у тестах підміняється). */
  currentPath?: () => string;
}

export function createHttpProfile(options: HttpProfileOptions = {}): ProfileService {
  const doFetch: ProfileFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const transportOpt = options.transport ?? null;
  const navigate = options.navigate ?? ((url: string) => globalThis.location.assign(url));
  const currentPath = options.currentPath ?? (() => `${globalThis.location.pathname}${globalThis.location.search}`);

  let last: Profile | undefined;
  const listeners = new Set<(p: Profile) => void>();
  let live: { stop(): void } | null = null;
  let transportPromise: Promise<RealtimeTransport | null> | undefined;

  function getTransport(): Promise<RealtimeTransport | null> {
    transportPromise ??= (async () => {
      if (!transportOpt) return null;
      return typeof transportOpt === 'function' ? transportOpt() : transportOpt;
    })().catch(() => null);
    return transportPromise;
  }

  async function call<T>(url: string, method: Method, body: unknown, parse: (value: unknown) => T | null): Promise<ApiResult<T>> {
    let res: ProfileFetchResponse;
    try {
      res = await doFetch(url, {
        method,
        credentials: 'include',
        ...(method === 'GET' || method === 'DELETE' ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }),
      });
    } catch {
      return fail('network');
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    const env = json as { ok?: unknown; value?: unknown } | null | undefined;
    if (!res.ok || !env || typeof env !== 'object' || env.ok !== true) return { ok: false, error: errorOf(json, res.status) };
    const value = parse(env.value);
    return value === null ? fail('unavailable', { message: `invalid ${url} response` }) : ok(value);
  }

  /** Новий знімок: запам'ятати, слухачам — лише коли щось змінилося. */
  function apply(p: Profile): Profile {
    if (last && JSON.stringify(last) === JSON.stringify(p)) return last;
    last = p;
    for (const l of [...listeners]) l(p);
    return p;
  }

  const parseP = parseProfile as (v: unknown) => Profile | null;
  const parseIds = parseScheduleIds as (v: unknown) => readonly string[] | null;

  const readProfile = async (): Promise<ApiResult<Profile>> => {
    const r = await call(PROFILE_URLS.profile, 'GET', undefined, parseP);
    return r.ok ? ok(apply(r.value)) : r;
  };

  /** Дія, що повертає профіль. */
  const profileCall = async (url: string, method: Method, body?: unknown): Promise<ApiResult<Profile>> => {
    const r = await call(url, method, body, parseP);
    return r.ok ? ok(apply(r.value)) : r;
  };

  /** Дія, що повертає список id графіка; кеш оновлюємо, а подію `profile` отримаємо й так. */
  const scheduleCall = async (url: string, method: Method, body: unknown): Promise<ApiResult<readonly string[]>> => {
    const r = await call(url, method, body, parseIds);
    if (r.ok && last) apply({ ...last, schedule: r.value });
    return r;
  };

  async function subjectId(): Promise<string | null> {
    const r = await call(AUTH_URLS.session, 'GET', undefined, parseSession);
    if (!r.ok) return null;
    return r.value.user?.id ?? r.value.guestId;
  }

  function start(): { stop(): void } {
    let stopped = false;
    let channel = '';
    let off: (() => void) | undefined;
    let transport: RealtimeTransport | null = null;

    const attach = async () => {
      if (stopped || !transport) return;
      const id = await subjectId();
      if (stopped || !id) return;
      const next = `user:#${id}`;
      if (next === channel) return;
      off?.();
      channel = next;
      off = transport.subscribe(next, {
        onEvent: (envelope) => {
          if (isProfileEvent(envelope)) void readProfile();
          else if (isSessionEvent(envelope)) {
            void readProfile();
            void attach();
          }
        },
        onResync: () => void readProfile(),
      });
    };

    void (async () => {
      transport = await getTransport();
      if (stopped || !transport) return;
      await attach();
    })();

    return {
      stop() {
        stopped = true;
        off?.();
        off = undefined;
      },
    };
  }

  return {
    get: readProfile,
    peek: () => last,
    subscribe(cb) {
      listeners.add(cb);
      live ??= start();
      return () => {
        if (!listeners.delete(cb) || listeners.size > 0) return;
        live?.stop();
        live = null;
      };
    },
    update(patch) {
      // `detectedFlag` визначає сервер за країною запиту — поле не шлемо.
      const body = { ...patch };
      delete body.detectedFlag;
      return profileCall(PROFILE_URLS.profile, 'PATCH', body);
    },
    setSchedule: (eventIds) => scheduleCall(PROFILE_URLS.schedule, 'PUT', { eventIds: [...eventIds] }),
    toggleSchedule: (eventId) => scheduleCall(PROFILE_URLS.scheduleToggle, 'POST', { eventId }),
    replaceSchedule: (outIso, eventId) => scheduleCall(PROFILE_URLS.scheduleReplace, 'POST', { outIso, eventId }),
    changeEmail: (email) => profileCall(PROFILE_URLS.email, 'POST', { email }),
    confirmEmailChange: (code) => profileCall(PROFILE_URLS.emailVerify, 'POST', { code }),
    cancelEmailChange: () => profileCall(PROFILE_URLS.email, 'DELETE'),
    async linkGoogle() {
      const r = await call(PROFILE_URLS.google, 'POST', { returnPath: currentPath() }, parseGoogleRedirect);
      if (!r.ok) return r;
      navigate(r.value.url);
      return last ? ok(last) : readProfile();
    },
    unlinkGoogle: () => profileCall(PROFILE_URLS.google, 'DELETE'),
    async exportData() {
      return fail('unavailable', { reason: 'spec-20' });
    },
    async deleteAccount() {
      return fail('unavailable', { reason: 'spec-20' });
    },
  };
}
