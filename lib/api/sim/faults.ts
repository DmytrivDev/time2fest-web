/**
 * Затримка й відмови сервісів імітації — ОДИН механізм для всіх доменів (`docs/backend/frontend-seam.md`, 6.2): так у
 * `sim` видно стани, які в `http` дасть справжня мережа («надсилаємо…», «зберігаємо…», «не вдалося зберегти»,
 * «не вдалося завантажити», помилка старту оплати…). Дошки й e2e вмикають їх без коду:
 *   • адреса: `?simDelay=auth:3000,checkout.start:2000` і `?simFail=checkout.start:network,auth.verifyCode:validation/wrong-code`
 *     (правило з адреси діє, поки сторінка відкрита; `сервіс[.метод]`, відмова — `код[/причина]`);
 *   • `window.__t2f.api.delay('profile', 2000)`, `.failNext('auth', 'requestCode', 'network')` (раз), `.fail(...)` (поки не
 *     `clear()`), `.clear()`.
 * Обгортка (`withFaults`) зачіпає лише асинхронні методи сервісу; `peek`, `subscribe*` та інші синхронні — без змін.
 * Відмова повертає `ApiResult` без виклику імітації (дія «на сервері» не відбулась).
 */
import { fail, type ApiErrorCode } from '../result';

export interface FaultFailure {
  code: ApiErrorCode;
  reason?: string;
  retryAfterMs?: number;
  attemptsLeft?: number;
}

interface FaultRule {
  service: string;
  /** Немає — усі асинхронні методи сервісу. */
  method?: string;
  delayMs?: number;
  failure?: FaultFailure;
  once?: boolean;
}

export interface FaultControls {
  /** Затримка відповідей сервісу (чи одного методу). 0 — прибрати. */
  delay(service: string, ms: number, method?: string): void;
  /** Наступний виклик методу (`undefined` — будь-якого асинхронного; сервіс `*` — будь-якого сервісу) відмовить. */
  failNext(service: string, method: string | undefined, code: ApiErrorCode, reason?: string, extra?: Omit<FaultFailure, 'code' | 'reason'>): void;
  /** Кожен такий виклик відмовляє, поки не `unfail`/`clear()`. */
  fail(service: string, method: string | undefined, code: ApiErrorCode, reason?: string, extra?: Omit<FaultFailure, 'code' | 'reason'>): void;
  /** Прибрати постійні відмови сервісу (чи методу). */
  unfail(service: string, method?: string): void;
  clear(): void;
  /** Тести: чинні правила. */
  list(): readonly FaultRule[];
}

/** Синхронні члени сервісів — обгортка їх не чіпає. */
const SYNC = /^(peek|subscribe|connection|slowModeSeconds|takenNickHints|authorPath|trackPresence|catalog|version|dev)/;

let rules: FaultRule[] = [];
let urlRead = false;

function readUrl(): void {
  if (urlRead || typeof window === 'undefined') return;
  urlRead = true;
  const q = new URLSearchParams(window.location.search);
  for (const part of (q.get('simDelay') ?? '').split(',').filter(Boolean)) {
    const [target = '', ms = '0'] = part.split(':');
    const [service = '', method] = target.split('.');
    const delayMs = Number(ms);
    if (service && Number.isFinite(delayMs)) rules.push({ service, method, delayMs });
  }
  for (const part of (q.get('simFail') ?? '').split(',').filter(Boolean)) {
    const [target = '', what = 'network'] = part.split(':');
    const [service = '', method] = target.split('.');
    const [code, reason] = what.split('/');
    if (service) rules.push({ service, method, failure: { code: code as ApiErrorCode, ...(reason ? { reason } : {}) } });
  }
}

function match(service: string, method: string): { delayMs: number; failure?: FaultFailure } | null {
  readUrl();
  const hit = rules.filter((r) => (r.service === service || r.service === '*') && (!r.method || r.method === method));
  if (!hit.length) return null;
  const delayMs = Math.max(0, ...hit.map((r) => r.delayMs ?? 0));
  const failing = hit.find((r) => r.failure);
  if (failing?.once) rules = rules.filter((r) => r !== failing);
  return { delayMs, failure: failing?.failure };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const simFaults: FaultControls = {
  delay(service, ms, method) {
    rules = rules.filter((r) => !(r.service === service && r.method === method && r.delayMs !== undefined && !r.failure));
    if (ms > 0) rules.push({ service, method, delayMs: ms });
  },
  failNext(service, method, code, reason, extra) {
    rules.push({ service, method, failure: { code, ...(reason ? { reason } : {}), ...extra }, once: true });
  },
  fail(service, method, code, reason, extra) {
    rules.push({ service, method, failure: { code, ...(reason ? { reason } : {}), ...extra } });
  },
  unfail(service, method) {
    rules = rules.filter((r) => !(r.failure && r.service === service && r.method === method));
  },
  clear() {
    rules = [];
  },
  list: () => rules,
};

/** Тести: забути правила й перечитати адресу. */
export function resetSimFaultsForTest(): void {
  rules = [];
  urlRead = false;
}

/** Обгорнути адаптер `sim`: асинхронні методи отримують затримку й відмову за правилами. */
export function withFaults<T extends object>(service: string, svc: T): T {
  return new Proxy(svc, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function' || typeof prop !== 'string' || SYNC.test(prop)) return value;
      const fn = value as (...args: unknown[]) => unknown;
      return function wrapped(this: unknown, ...args: unknown[]) {
        const rule = match(service, prop);
        if (!rule) return fn.apply(target, args);
        const { delayMs, failure } = rule;
        return (async () => {
          if (delayMs > 0) await sleep(delayMs);
          if (failure) {
            const { code, ...extra } = failure;
            return fail(code, extra);
          }
          return fn.apply(target, args);
        })();
      };
    },
  });
}
