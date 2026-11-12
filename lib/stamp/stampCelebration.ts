/**
 * Свято штампа в шапці (дошки `Desk-Stamp-Header` / `Phone-Stamp-Header` v2, рішення власника 2026-11-12: A + E).
 * Чиста логіка без React: черга свят, відкладення на час повного екрана й прихованої вкладки, таймлайн із паузою,
 * вибір слів і вікно підказки «Будь тут опівночі».
 *
 * - A: штамп нараховано — шапка ≈ 10 с золота: 0–0,4 с заливка · до 8 с текст · 8–9,2 с печатка летить до аватара ·
 *   10 с звичайна шапка (дзвіночок +1, аватар світиться ≈ 1,5 с). «Зменшити рух» — одразу золота, 9 с, і назад.
 * - Кілька штампів одного моменту (кімната з кількома вікнами) — одне свято.
 * - E: повноекранний перегляд чи прихована вкладка — свято не граємо, ставимо в чергу; вийшли з повного екрана —
 *   одне свято «Під час перегляду: …» на всі пропущені; повернулись на вкладку — «Поки тебе не було: …».
 *   Штамп, старший за 30 хв, — без свята (лише +1 на дзвіночку).
 */
import type { Gender, Ms } from '@/lib/data/types';

/** Заливка золотом зліва направо. */
export const FILL_MS = 400;
/** До цього моменту видно текст і «Подивитися штамп». */
export const TEXT_END_MS = 8_000;
/** Печатка долетіла до аватара. */
export const FLIGHT_END_MS = 9_200;
/** Свято закінчилось — звичайна шапка. */
export const CELEBRATION_MS = 10_000;
/** «Зменшити рух»: статичне золото стільки, потім одразу звичайна шапка. */
export const REDUCED_CELEBRATION_MS = 9_000;
/** Аватар один раз світиться золотом після свята. */
export const AVATAR_GLOW_MS = 1_500;
/** Штамп, старший за це (повернулись пізно), — без свята, лише +1 на дзвіночку. */
export const CATCH_UP_MAX_AGE_MS = 30 * 60_000;
/** Штамп прийшов за стільки (реальних) мс після повернення на вкладку — це «Поки тебе не було» (такт проспав північ). */
export const RETURN_GRACE_MS = 3_000;
/** Підказка «Будь тут опівночі — отримаєш штамп» — останні 60 с до півночі. */
export const HINT_BEFORE_MS = 60_000;

/** `now` — звичайне свято; `fullscreen` — після повного екрана; `tab` — після повернення на вкладку. */
export type CelebrationKind = 'now' | 'fullscreen' | 'tab';

export interface CelebrationStamp {
  eventId: string;
  /** Назва країни в називному відмінку. */
  country: string;
  gender: Gender;
  flagCode: string;
  /** Коли штамп нараховано (північ + 15 с, віртуальний час). */
  grantedAt: Ms;
}

export interface Celebration {
  id: number;
  kind: CelebrationKind;
  stamps: CelebrationStamp[];
}

export interface CelebrationEnv {
  /** `document.fullscreenElement` (повноекранний YouTube чи сцена відліку). */
  fullscreen: boolean;
  /** Вкладка прихована (`visibilityState === 'hidden'`). */
  hidden: boolean;
}

export interface CelebrationQueue {
  env: CelebrationEnv;
  /** Штампи, що прийшли, поки свято не можна було показати. */
  deferred: CelebrationStamp[];
  /** Свята, що чекають, поки дограє поточне. */
  queue: Celebration[];
  active: Celebration | null;
  seq: number;
}

export function createQueue(env: CelebrationEnv = { fullscreen: false, hidden: false }): CelebrationQueue {
  return { env, deferred: [], queue: [], active: null, seq: 0 };
}

const blocked = (env: CelebrationEnv) => env.fullscreen || env.hidden;

/** Лише свіжі (не старші за 30 хв) і без повторів за подією. */
function fresh(stamps: readonly CelebrationStamp[], now: Ms): CelebrationStamp[] {
  const seen = new Set<string>();
  const out: CelebrationStamp[] = [];
  for (const s of stamps) {
    if (seen.has(s.eventId) || now - s.grantedAt > CATCH_UP_MAX_AGE_MS) continue;
    seen.add(s.eventId);
    out.push(s);
  }
  return out;
}

function enqueue(q: CelebrationQueue, kind: CelebrationKind, stamps: CelebrationStamp[]): CelebrationQueue {
  if (!stamps.length) return q;
  // Ще не почате свято того ж виду — доповнюємо (одне свято на всі), а не ставимо друге поспіль.
  const last = q.queue[q.queue.length - 1];
  if (last && last.kind === kind) {
    const ids = new Set(last.stamps.map((s) => s.eventId));
    const merged = { ...last, stamps: [...last.stamps, ...stamps.filter((s) => !ids.has(s.eventId))] };
    return { ...q, queue: [...q.queue.slice(0, -1), merged] };
  }
  const c: Celebration = { id: q.seq + 1, kind, stamps };
  if (!q.active) return { ...q, active: c, seq: c.id };
  return { ...q, queue: [...q.queue, c], seq: c.id };
}

/**
 * Нові штампи. `returning` — вкладка щойно стала видимою (такт проспав північ): свято «Поки тебе не було».
 * Повний екран чи прихована вкладка — у відкладені; інакше — свято (одне на всі штампи виклику).
 */
export function addStamps(q: CelebrationQueue, stamps: readonly CelebrationStamp[], now: Ms, opts: { returning?: boolean } = {}): CelebrationQueue {
  const list = fresh(stamps, now);
  if (!list.length) return q;
  if (blocked(q.env)) {
    const ids = new Set(q.deferred.map((s) => s.eventId));
    return { ...q, deferred: [...q.deferred, ...list.filter((s) => !ids.has(s.eventId))] };
  }
  return enqueue(q, opts.returning ? 'tab' : 'now', list);
}

/**
 * Змінився стан сторінки. Коли все, що заважало, минуло, — одне свято на всі відкладені: вийшли з повного екрана —
 * «Під час перегляду», повернулись на вкладку — «Поки тебе не було». Старші за 30 хв — без свята.
 */
export function setEnv(q: CelebrationQueue, env: CelebrationEnv, now: Ms): CelebrationQueue {
  const was = q.env;
  const next = { ...q, env };
  if (blocked(env) || !blocked(was) || !q.deferred.length) return next;
  const kind: CelebrationKind = was.fullscreen && !env.fullscreen ? 'fullscreen' : 'tab';
  return enqueue({ ...next, deferred: [] }, kind, fresh(q.deferred, now));
}

/** Поточне свято дограло — наступне з черги. */
export function finishActive(q: CelebrationQueue): CelebrationQueue {
  const [head, ...rest] = q.queue;
  return { ...q, active: head ?? null, queue: rest };
}

/** Чи чекає щось на показ (дзвіночок тримає +1 до кінця свята). */
export function hasPending(q: CelebrationQueue): boolean {
  return !!q.active || q.queue.length > 0 || q.deferred.length > 0;
}

// ── Таймлайн із паузою (наведення, фокус, повний екран — WCAG 2.2.1) ─────────────────────────

export interface CelebrationClock {
  /** Скільки вже відіграно до `since`. */
  elapsed: number;
  /** Реальний час, з якого йде відлік; `null` — пауза. */
  since: number | null;
}

export const startClock = (realNow: number): CelebrationClock => ({ elapsed: 0, since: realNow });

export function clockElapsed(c: CelebrationClock, realNow: number): number {
  return c.elapsed + (c.since === null ? 0 : Math.max(0, realNow - c.since));
}

export function pauseClock(c: CelebrationClock, realNow: number): CelebrationClock {
  return c.since === null ? c : { elapsed: clockElapsed(c, realNow), since: null };
}

export function resumeClock(c: CelebrationClock, realNow: number): CelebrationClock {
  return c.since === null ? { elapsed: c.elapsed, since: realNow } : c;
}

/** `fill` — заливка; `show` — текст; `fly` — печатка летить; `settle` — шапка повертається; `done` — кінець. */
export type CelebrationPhase = 'fill' | 'show' | 'fly' | 'settle' | 'done';

export function celebrationPhase(elapsed: number, reduced: boolean): CelebrationPhase {
  if (reduced) return elapsed < REDUCED_CELEBRATION_MS ? 'show' : 'done';
  if (elapsed < FILL_MS) return 'fill';
  if (elapsed < TEXT_END_MS) return 'show';
  if (elapsed < FLIGHT_END_MS) return 'fly';
  if (elapsed < CELEBRATION_MS) return 'settle';
  return 'done';
}

/** Мс до наступної межі фаз (для таймера); `null` — свято скінчилось. */
export function nextBoundary(elapsed: number, reduced: boolean): number | null {
  const marks = reduced ? [REDUCED_CELEBRATION_MS] : [FILL_MS, TEXT_END_MS, FLIGHT_END_MS, CELEBRATION_MS];
  const next = marks.find((m) => m > elapsed);
  return next === undefined ? null : next - elapsed;
}

// ── Слова ─────────────────────────────────────────────────────────────────────────────────────

/** Повідомлення `header.celebration.*` з параметрами (рендерить компонент). */
export interface Msg {
  key: string;
  params?: Record<string, string | number>;
}

/** Десктоп (один рядок): [печатки] [lead] main · [✓] tail [Подивитися штамп ↓]. */
export interface DeskWords {
  lead?: Msg;
  main: Msg;
  tail: Msg;
  /** «✓» перед tail (звичайне свято одного штампа). */
  check: boolean;
  see: Msg;
}

/** Телефон (два рядки). */
export interface PhoneWords {
  line1: Msg;
  line2: Msg;
}

export interface WordsOptions {
  /** Гість без акаунта: «Штамп на цьому пристрої». */
  guest: boolean;
  /** Коротка форма для довгої назви країни (не влазить). */
  short: boolean;
}

/** Довга назва: на десктопі — понад ~40 знаків (дошка, кадр 10); на телефоні вирішує вимір (тут — запасний поріг). */
export const DESK_LONG_NAME = 40;
export const PHONE_LONG_NAME = 12;

export function isLongName(country: string, variant: 'desk' | 'phone'): boolean {
  return country.length > (variant === 'desk' ? DESK_LONG_NAME : PHONE_LONG_NAME);
}

/** Країни через кому, без повторів (дві події однієї країни — одна назва). */
export function countryNames(stamps: readonly CelebrationStamp[]): string {
  return [...new Set(stamps.map((s) => s.country))].join(', ');
}

function metMsg(s: CelebrationStamp): Msg {
  return { key: 'met', params: { country: s.country, gender: s.gender ?? 'other' } };
}

export function deskWords(c: Pick<Celebration, 'kind' | 'stamps'>, { guest, short }: WordsOptions): DeskWords {
  const first = c.stamps[0]!;
  const count = c.stamps.length;
  const see: Msg = { key: 'see', params: { count } };
  const names = countryNames(c.stamps);
  if (c.kind === 'now') {
    if (count > 1) return { main: { key: 'helloShort' }, tail: { key: 'newStampsList', params: { count, names } }, check: false, see };
    if (short) return { main: { key: 'helloShort' }, tail: { key: guest ? 'onDeviceOf' : 'inPassportOf', params: { country: first.country } }, check: true, see };
    return { main: { key: 'hello', params: { country: first.country } }, tail: { key: guest ? 'onDevice' : 'inPassport' }, check: true, see };
  }
  const lead: Msg = { key: c.kind === 'fullscreen' ? 'duringWatch' : 'whileAway' };
  if (count > 1) return { lead, main: { key: 'newStamps', params: { count } }, tail: { key: 'names', params: { names } }, check: false, see };
  return { lead, main: metMsg(first), tail: { key: guest ? 'stampOnDevice' : 'stampInPassport' }, check: false, see };
}

export function phoneWords(c: Pick<Celebration, 'kind' | 'stamps'>, { guest, short }: WordsOptions): PhoneWords {
  const first = c.stamps[0]!;
  const count = c.stamps.length;
  const names = countryNames(c.stamps);
  if (c.kind === 'now') {
    if (count > 1) return { line1: { key: 'helloShort' }, line2: { key: 'newStampsList', params: { count, names } } };
    if (short) return { line1: { key: 'helloShort' }, line2: { key: guest ? 'countryOnDevice' : 'countryInPassport', params: { country: first.country } } };
    return { line1: { key: 'hello', params: { country: first.country } }, line2: { key: guest ? 'onDevice' : 'inPassport' } };
  }
  if (count > 1) return { line1: { key: guest ? 'newStampsOnDevice' : 'newStampsInPassport', params: { count } }, line2: { key: 'names', params: { names } } };
  const lead = c.kind === 'fullscreen' ? 'duringWatch' : 'whileAway';
  return { line1: metMsg(first), line2: { key: `${lead}${guest ? 'OnDevice' : 'InPassport'}` } };
}

/**
 * Текст для читача екрана — один раз, ввічливо: «З Новим роком, Франція! Штамп у паспорті»; наздоганяння —
 * «Під час перегляду: Франція зустріла Новий рік · штамп у паспорті». `t` — перекладач `header.celebration`.
 */
export function spokenText(c: Pick<Celebration, 'kind' | 'stamps'>, guest: boolean, t: (key: string, params?: Record<string, string | number>) => string): string {
  const w = deskWords(c, { guest, short: false });
  const r = (m: Msg) => t(m.key, m.params);
  if (c.kind === 'now') return `${r(w.main)} ${r(w.tail)}`;
  const sep = c.stamps.length > 1 ? ' — ' : ' · ';
  return `${w.lead ? `${r(w.lead)} ` : ''}${r(w.main)}${sep}${r(w.tail)}`;
}

/** Підказка «Будь тут опівночі — отримаєш штамп»: останні 60 с до півночі, якщо штампа за подію ще немає. */
export function stampHintActive(msToMidnight: number, alreadyStamped: boolean): boolean {
  return !alreadyStamped && msToMidnight > 0 && msToMidnight <= HINT_BEFORE_MS;
}
