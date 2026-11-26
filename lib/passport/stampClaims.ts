/**
 * Штамп, якого сервер ще не підтвердив (стан шва №14, рішення виконавця за дорученням власника 2026-11-14).
 *
 * Людина була на північ — штамп показуємо одразу (як і раніше), а запит на підтвердження (`passport.claim`,
 * `POST /api/me/stamps`) повторюємо у фоні з наростаючою паузою (2 → 4 → 8 → 15 → 30 с, далі щопівхвилини). Якщо за
 * хвилину підтвердження немає — тихий рядок «Штамп збережено на цьому пристрої — додамо до паспорта, щойно з’явиться
 * зв’язок», і повторюємо далі: при поверненні мережі (`online`) і при наступному відкритті сайту (список — у сховищі
 * пристрою). Мережа ніколи не забирає штамп: лише явна відмова сервера («присутності не було», `forbidden` /
 * `validation` / `not_found`) знімає непідтверджений штамп. Опівночі жодних помилок.
 *
 * Чиста логіка без React і без браузера: таймери, годинник і сховище — залежності (тести — з підробленими таймерами).
 */
import type { ApiError, ApiResult } from '@/lib/api/result';
import type { Ms, Stamp } from '@/lib/data/types';

/** Паузи між спробами (мс): n-та невдала спроба → `CLAIM_BACKOFF_MS[n-1]`, далі — останнє значення. */
export const CLAIM_BACKOFF_MS = [2_000, 4_000, 8_000, 15_000, 30_000] as const;
/** Скільки чекаємо підтвердження, перш ніж сказати людині, що штамп поки лише на пристрої. */
export const UNCONFIRMED_AFTER_MS = 60_000;

export interface PendingClaim {
  stamp: Stamp;
  /** Коли штамп показано (реальний час пристрою, мс). */
  since: Ms;
  /** Скільки спроб уже зроблено. */
  attempts: number;
  /** Сервер дав остаточну відповідь, що не знімає штамп (`claim-closed`, `unknown-event`, `validation`…): штамп лишається, спроб більше немає (переживає перезавантаження). */
  settled?: true;
}

/** Пауза після `attempts` невдалих спроб. */
export function claimDelay(attempts: number): number {
  const i = Math.min(Math.max(attempts, 1), CLAIM_BACKOFF_MS.length) - 1;
  return CLAIM_BACKOFF_MS[i]!;
}

/** Єдина відмова, що знімає штамп з пристрою: сервер певен, що присутності не було (AC-60). */
export function removesStamp(e: ApiError): boolean {
  return e.code === 'forbidden' && e.reason === 'no-presence';
}

/** Відмова, після якої пробуємо ще (мережа, сервер недоступний, ліміт, невідома). Решта — рішення сервера. */
export function retryableClaimError(e: ApiError): boolean {
  return e.code === 'network' || e.code === 'unavailable' || e.code === 'rate_limited' || e.code === 'unknown';
}

export function isUnconfirmed(p: PendingClaim, now: Ms): boolean {
  return now - p.since >= UNCONFIRMED_AFTER_MS;
}

export interface ClaimerDeps {
  claim(stamp: Stamp): Promise<ApiResult<unknown>>;
  /** Реальний час пристрою. */
  now(): Ms;
  load(): PendingClaim[];
  save(list: readonly PendingClaim[]): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
}

export interface ClaimsSnapshot {
  /** Штампи, що чекають підтвердження (показуємо їх як звичайні). */
  pending: readonly PendingClaim[];
  /** Події, чиї штампи чекають довше хвилини — тихий рядок біля штампа й у паспорті. */
  unconfirmed: readonly string[];
}

export interface StampClaimer {
  /** Штамп показано: запам’ятати й просити підтвердження. `false` — уже чекає. */
  add(stamp: Stamp): boolean;
  /** Сервер підтвердив (відповідь чи подія `granted`): більше не чекаємо. */
  confirmed(eventId: string): void;
  /** Наступне відкриття сайту: підхопити список зі сховища й спробувати одразу. */
  resume(): void;
  /** З’явилась мережа — спробувати всі одразу. */
  retryNow(): void;
  snapshot(): ClaimsSnapshot;
  subscribe(cb: () => void): () => void;
  /** «Скинути стан гостя», тести. */
  reset(): void;
}

export function createStampClaimer(deps: ClaimerDeps): StampClaimer {
  let list: PendingClaim[] = [];
  let loaded = false;
  const retryTimers = new Map<string, unknown>();
  const noticeTimers = new Map<string, unknown>();
  const inFlight = new Set<string>();
  /** Не раніше цього часу (мс пристрою): `retryAfterMs` сервера. */
  const notBefore = new Map<string, Ms>();
  const listeners = new Set<() => void>();
  let snap: ClaimsSnapshot = { pending: [], unconfirmed: [] };

  const emit = () => {
    const now = deps.now();
    snap = { pending: list, unconfirmed: list.filter((p) => isUnconfirmed(p, now)).map((p) => p.stamp.eventId) };
    listeners.forEach((l) => l());
  };
  const persist = () => deps.save(list);
  const find = (id: string) => list.find((p) => p.stamp.eventId === id);

  const clearTimers = (id: string) => {
    const r = retryTimers.get(id);
    if (r !== undefined) deps.clearTimer(r);
    retryTimers.delete(id);
    const n = noticeTimers.get(id);
    if (n !== undefined) deps.clearTimer(n);
    noticeTimers.delete(id);
  };

  const remove = (id: string) => {
    if (!find(id)) return;
    clearTimers(id);
    list = list.filter((p) => p.stamp.eventId !== id);
    persist();
    emit();
  };

  /** Хвилина минула — оновити «непідтверджені» (рядок з’являється сам, без дії людини). */
  const watchNotice = (p: PendingClaim) => {
    const left = p.since + UNCONFIRMED_AFTER_MS - deps.now();
    if (left <= 0) return;
    noticeTimers.set(
      p.stamp.eventId,
      deps.setTimer(() => {
        noticeTimers.delete(p.stamp.eventId);
        emit();
      }, left),
    );
  };

  const attempt = (id: string) => {
    const p = find(id);
    if (!p || p.settled || inFlight.has(id)) return;
    // Сервер просив зачекати: ні `online`, ні `resume` не обганяють його `retryAfterMs`.
    if (deps.now() < (notBefore.get(id) ?? 0) && retryTimers.has(id)) return;
    const r = retryTimers.get(id);
    if (r !== undefined) deps.clearTimer(r);
    retryTimers.delete(id);
    inFlight.add(id);
    p.attempts += 1;
    persist();
    const done = (res: ApiResult<unknown>) => {
      inFlight.delete(id);
      const cur = find(id);
      if (!cur) return;
      if (res.ok) return remove(id);
      if (removesStamp(res.error)) return remove(id);
      if (!retryableClaimError(res.error)) {
        // Остаточна відповідь без «присутності не було»: штамп лишається на пристрої, більше не питаємо.
        cur.settled = true;
        persist();
        emit();
        return;
      }
      const wait = Math.max(claimDelay(cur.attempts), res.error.retryAfterMs ?? 0);
      if (res.error.retryAfterMs) notBefore.set(id, deps.now() + wait);
      else notBefore.delete(id);
      retryTimers.set(
        id,
        deps.setTimer(() => {
          retryTimers.delete(id);
          attempt(id);
        }, wait),
      );
    };
    let pending: Promise<ApiResult<unknown>>;
    try {
      pending = deps.claim(p.stamp);
    } catch {
      pending = Promise.resolve({ ok: false, error: { code: 'network' } });
    }
    void pending.then(done, () => done({ ok: false, error: { code: 'network' } }));
  };

  const ensureLoaded = () => {
    if (loaded) return;
    loaded = true;
    const saved = deps.load();
    // Формат v1 читаємо як є: `settled` — необов’язкове поле.
    for (const p of saved) if (p && p.stamp && typeof p.stamp.eventId === 'string' && !find(p.stamp.eventId)) list = [...list, { ...p, ...(p.settled === true ? { settled: true as const } : {}) }];
  };

  return {
    add(stamp) {
      ensureLoaded();
      if (find(stamp.eventId)) return false;
      const p: PendingClaim = { stamp, since: deps.now(), attempts: 0 };
      list = [...list, p];
      persist();
      emit();
      watchNotice(p);
      attempt(stamp.eventId);
      return true;
    },
    confirmed(eventId) {
      remove(eventId);
    },
    resume() {
      const before = loaded;
      ensureLoaded();
      if (!before) {
        list.forEach(watchNotice);
        emit();
      }
      list.forEach((p) => attempt(p.stamp.eventId));
    },
    retryNow() {
      list.forEach((p) => attempt(p.stamp.eventId));
    },
    snapshot: () => snap,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    reset() {
      [...retryTimers.keys(), ...noticeTimers.keys()].forEach(clearTimers);
      inFlight.clear();
      notBefore.clear();
      list = [];
      loaded = true;
      persist();
      emit();
    },
  };
}
