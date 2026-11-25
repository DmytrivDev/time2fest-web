/**
 * Адаптер `http` домену `auth` (SPEC-10, AC-31, AC-54). Рецепт — `docs/backend/frontend-seam.md` §6.0 (як `site.ts`).
 * - `session()` — `GET /api/auth/get-session`, тіло перевіряє `sessionSchema`; код, що його чекає цей пристрій,
 *   адаптер тримає локально (з відповіді `requestCode`) і додає в `Session.code`.
 * - `requestCode` — `POST /api/auth/email-otp/send-verification-otp {email, intent}` → `CodeInfo`;
 *   `verifyCode` — `POST /api/auth/sign-in/email-otp {email, otp}` → `SignInOutcome`, далі `session()` і, якщо власник
 *   сесії змінився, `transport.renewToken()` (новий токен підключення realtime, AC-31).
 * - `google` — `POST /api/auth/sign-in/social {returnPath}` → `{kind:'redirect', url}`; `signOut` — `POST /api/auth/sign-out`
 *   і `renewToken()`.
 * - `subscribe` — події `session` каналу `user:#<id>` → перечитування сесії; зміна власника — перепідписка.
 * - Помилки сервера проходять як `ApiError` (ті самі причини, що в `sim`, див. `authCodeError`). Токенів не зберігаємо:
 *   лише cookie (`credentials: 'include'`). `devCode` / `devReset` немає. Розбір відповідей — безzod-охоронці `@time2fest/contracts` (`authGuard`, П-14).
 */
import {
  isSessionEvent,
  parseCodeInfo,
  parseGoogleRedirect,
  parseSession,
  parseSignInOutcome,
  type ApiError,
  type ApiErrorCode,
} from '@time2fest/contracts';
import type { AuthIntent, AuthService, CodeInfo, GoogleOutcome, Session, SignInOutcome } from '../contracts/auth';
import { fail, ok, type ApiResult } from '../result';
import type { RealtimeTransport } from './realtime/types';

export const AUTH_URLS = {
  session: '/api/auth/get-session',
  requestCode: '/api/auth/email-otp/send-verification-otp',
  verifyCode: '/api/auth/sign-in/email-otp',
  google: '/api/auth/sign-in/social',
  signOut: '/api/auth/sign-out',
} as const;

export interface AuthFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type AuthFetch = (
  input: string,
  init: { method: 'GET' | 'POST'; credentials: 'include'; headers?: Record<string, string>; body?: string },
) => Promise<AuthFetchResponse>;

export interface HttpAuthOptions {
  fetch?: AuthFetch;
  /** Транспорт чи його завантажувач; `null` — realtime немає (лише `renewToken` пропускається, підписка мовчить). */
  transport?: RealtimeTransport | (() => Promise<RealtimeTransport>) | null;
}

export const ERROR_CODES: readonly ApiErrorCode[] = [
  'network',
  'unavailable',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'validation',
  'unknown',
];

const subjectOf = (s: Session): string => s.user?.id ?? s.guestId;

function errorFromStatus(status: number): ApiError {
  if (status === 429) return { code: 'rate_limited' };
  if (status === 400 || status === 422) return { code: 'validation' };
  if (status === 401) return { code: 'unauthorized' };
  if (status === 403) return { code: 'forbidden' };
  if (status === 404) return { code: 'not_found' };
  return { code: 'unavailable', message: `auth → ${status}` };
}

/** `{ok:false, error}` сервера → `ApiError` (лише відомі поля). */
export function errorOf(body: unknown, status: number): ApiError {
  const e = (body as { error?: unknown } | null)?.error;
  if (!e || typeof e !== 'object') return errorFromStatus(status);
  const raw = e as Record<string, unknown>;
  if (typeof raw.code !== 'string' || !ERROR_CODES.includes(raw.code as ApiErrorCode)) return errorFromStatus(status);
  const out: ApiError = { code: raw.code as ApiErrorCode };
  if (typeof raw.reason === 'string') out.reason = raw.reason;
  if (typeof raw.retryAfterMs === 'number') out.retryAfterMs = raw.retryAfterMs;
  if (typeof raw.attemptsLeft === 'number') out.attemptsLeft = raw.attemptsLeft;
  return out;
}

export function createHttpAuth(options: HttpAuthOptions = {}): AuthService {
  const doFetch: AuthFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const transportOpt = options.transport ?? null;

  let last: Session | undefined;
  /** Код, що його чекає цей пристрій (з відповіді `requestCode`). */
  let heldCode: CodeInfo | null = null;
  const listeners = new Set<(session: Session) => void>();
  let live: { stop(): void } | null = null;
  let transportPromise: Promise<RealtimeTransport | null> | undefined;

  function getTransport(): Promise<RealtimeTransport | null> {
    transportPromise ??= (async () => {
      if (!transportOpt) return null;
      return typeof transportOpt === 'function' ? transportOpt() : transportOpt;
    })().catch(() => null);
    return transportPromise;
  }

  async function renewToken(): Promise<void> {
    const t = await getTransport();
    if (!t) return;
    try {
      await t.renewToken();
    } catch {
      /* токен підключення оновиться за наступним перепідключенням */
    }
  }

  /** Запит → тіло `{ok:true,value}` перевірене схемою, чи `ApiError`. */
  async function call<T>(
    url: string,
    method: 'GET' | 'POST',
    body: unknown,
    parse: (value: unknown) => T | null,
  ): Promise<ApiResult<T>> {
    let res: AuthFetchResponse;
    try {
      res = await doFetch(url, {
        method,
        credentials: 'include',
        ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) } : {}),
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

  function withCode(s: Session): Session {
    return { ...s, code: heldCode };
  }

  function sameSession(a: Session | undefined, b: Session): boolean {
    return !!a && JSON.stringify(a) === JSON.stringify(b);
  }

  /** Новий знімок: запам'ятати, слухачам — лише коли щось змінилося. */
  function apply(s: Session): Session {
    if (sameSession(last, s)) return last as Session;
    last = s;
    for (const l of [...listeners]) l(s);
    return s;
  }

  const readSession = async (): Promise<ApiResult<Session>> => {
    const r = await call(AUTH_URLS.session, 'GET', undefined, parseSession as (v: unknown) => Session | null);
    if (!r.ok) return r;
    return ok(apply(withCode(r.value)));
  };

  function start(): { stop(): void } {
    let stopped = false;
    let channel = '';
    let off: (() => void) | undefined;
    let transport: RealtimeTransport | null = null;

    const attach = (s: Session) => {
      if (stopped || !transport) return;
      const next = `user:#${subjectOf(s)}`;
      if (next === channel) return;
      off?.();
      channel = next;
      off = transport.subscribe(next, {
        onEvent: (envelope) => {
          if (isSessionEvent(envelope)) void readSession().then((r) => r.ok && attach(r.value));
        },
        onResync: () => void readSession().then((r) => r.ok && attach(r.value)),
      });
    };

    void (async () => {
      transport = await getTransport();
      if (stopped || !transport) return;
      const r = last ? ok(last) : await readSession();
      if (r.ok) attach(r.value);
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
    session: readSession,
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
    async requestCode(email: string, intent: AuthIntent) {
      const r = await call(AUTH_URLS.requestCode, 'POST', { email, intent }, parseCodeInfo as (v: unknown) => CodeInfo | null);
      if (!r.ok) return r;
      heldCode = r.value;
      if (last) apply(withCode(last));
      return ok(heldCode);
    },
    async verifyCode(email: string, code: string): Promise<ApiResult<SignInOutcome>> {
      const r = await call(AUTH_URLS.verifyCode, 'POST', { email, otp: code }, parseSignInOutcome as (v: unknown) => SignInOutcome | null);
      if (!r.ok) {
        const e = r.error;
        if (heldCode && heldCode.email === email.trim().toLowerCase()) {
          if (e.reason === 'wrong-code' && typeof e.attemptsLeft === 'number') heldCode = { ...heldCode, attemptsLeft: e.attemptsLeft };
          else if (e.reason === 'expired' || e.reason === 'too-many-attempts') heldCode = null;
        }
        return r;
      }
      heldCode = null;
      const before = last ? subjectOf(last) : undefined;
      const s = await readSession();
      if (!s.ok || before === undefined || subjectOf(s.value) !== before) await renewToken();
      return ok(r.value);
    },
    async google({ returnPath, signal }): Promise<ApiResult<GoogleOutcome>> {
      if (signal?.aborted) return fail('conflict', { reason: 'cancelled' });
      const r = await call(AUTH_URLS.google, 'POST', { returnPath }, parseGoogleRedirect as (v: unknown) => GoogleOutcome | null);
      return r;
    },
    async signOut(): Promise<ApiResult<void>> {
      const r = await call(AUTH_URLS.signOut, 'POST', {}, () => ({}));
      if (!r.ok) return r;
      heldCode = null;
      await readSession();
      await renewToken();
      return ok(undefined);
    },
  };
}
